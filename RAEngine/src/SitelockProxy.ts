/**
 * HTTP forward proxy for sitelock bypass.
 *
 * FlashpointProxy.exe redirects all WinInet HTTP traffic from Flash Player
 * to this proxy. We then:
 *   - Forward raflash.local requests to the flash server (firmware, assets, etc.)
 *   - Serve game SWFs when the Host matches a configured sitelock domain
 *   - Forward all other requests to their original destination
 */

const encoder = new TextEncoder();

interface NetworkRule {
    active: boolean;
    url: string;
    status: number;
    action: string;
    body: string;
    fileBytes?: Uint8Array;
}

const CONTENT_TYPES: Record<string, string> = {
    '.swf': 'application/x-shockwave-flash',
    '.xml': 'application/xml',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.flv': 'video/x-flv',
    '.zip': 'application/zip',
    '.csv': 'text/csv',
};

function contentTypeForUrl(url: string): string {
    const path = url.replace(/\?.*$/, ''); // strip query string
    const dot = path.lastIndexOf('.');
    if (dot >= 0) {
        const ext = path.slice(dot).toLowerCase();
        if (CONTENT_TYPES[ext]) return CONTENT_TYPES[ext];
    }
    return 'application/octet-stream';
}

interface ProxyConfig {
    /** Port to listen on (must match port.txt / FlashpointProxy.dll config) */
    port: number;
    /** Port of the RAEngine flash server (for raflash.local forwarding) */
    flashPort: number;
    /** The domain the game expects to be loaded from, or null for transparent forwarding */
    gameDomain: string | null;
    /** Optional callback for logging proxy requests */
    onRequest?: (method: string, url: string, status: number) => void;
    /** Live accessor for network behavior rules */
    getNetworkRules?: () => NetworkRule[];
}

let listener: Deno.TcpListener | null = null;
let config: ProxyConfig | null = null;

function httpResponse(status: number, statusText: string, headers: Record<string, string>, body?: Uint8Array): Uint8Array {
    const lines = [`HTTP/1.1 ${status} ${statusText}`];
    for (const [k, v] of Object.entries(headers)) {
        lines.push(`${k}: ${v}`);
    }
    lines.push('', '');
    const headerBytes = encoder.encode(lines.join('\r\n'));
    if (!body) return headerBytes;
    const result = new Uint8Array(headerBytes.length + body.length);
    result.set(headerBytes);
    result.set(body, headerBytes.length);
    return result;
}

/** Read from a reader until we have at least a full HTTP header block (\r\n\r\n). */
async function readFullRequest(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{ raw: Uint8Array; text: string } | null> {
    const chunks: Uint8Array[] = [];
    let totalLen = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done || !value) {
            if (totalLen === 0) return null;
            break;
        }
        chunks.push(value);
        totalLen += value.length;

        // Check if we have the full header
        const combined = concatChunks(chunks, totalLen);
        const text = new TextDecoder().decode(combined);
        if (text.includes('\r\n\r\n')) {
            return { raw: combined, text };
        }

        // Safety limit: 64KB for headers
        if (totalLen > 65536) break;
    }

    const combined = concatChunks(chunks, totalLen);
    return { raw: combined, text: new TextDecoder().decode(combined) };
}

function concatChunks(chunks: Uint8Array[], totalLen: number): Uint8Array {
    if (chunks.length === 1) return chunks[0];
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

async function forwardRequest(targetUrl: URL, method: string, rawHeaders: string, body?: Uint8Array): Promise<Uint8Array> {
    const port = parseInt(targetUrl.port) || 80;
    const conn = await Deno.connect({ hostname: targetUrl.hostname, port });
    try {
        const writer = conn.writable.getWriter();

        // Rewrite request line to use relative path (as the real server expects)
        // Force Connection: close so the upstream server closes when done
        const headersWithClose = rawHeaders.replace(/Connection:\s*keep-alive/i, 'Connection: close');
        let request = `${method} ${targetUrl.pathname}${targetUrl.search} HTTP/1.1\r\n${headersWithClose}\r\n`;
        const requestBytes = encoder.encode(request);

        if (body && body.length > 0) {
            const full = new Uint8Array(requestBytes.length + body.length);
            full.set(requestBytes);
            full.set(body, requestBytes.length);
            await writer.write(full);
        } else {
            await writer.write(requestBytes);
        }
        writer.releaseLock();

        // Read full response
        const chunks: Uint8Array[] = [];
        const reader = conn.readable.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        reader.releaseLock();

        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    } finally {
        try { conn.close(); } catch { /* already closed */ }
    }
}

async function handleConnection(conn: Deno.TcpConn) {
    if (!config) return;

    try {
        const reader = conn.readable.getReader();
        const result = await readFullRequest(reader);
        reader.releaseLock();
        if (!result) return;

        const { raw, text: request } = result;
        const lines = request.split('\r\n');
        const requestLine = lines[0];

        // Parse: "GET http://host/path HTTP/1.1"
        const match = requestLine.match(/^(\w+)\s+(https?:\/\/[^\s]+)\s+HTTP/);
        if (!match) {
            const writer = conn.writable.getWriter();
            await writer.write(httpResponse(400, 'Bad Request', { 'Connection': 'close' }));
            writer.releaseLock();
            conn.close();
            return;
        }

        const method = match[1];
        const targetUrl = new URL(match[2]);
        const rawHeaders = lines.slice(1).join('\r\n');

        // Extract body if present (everything after \r\n\r\n)
        const headerEnd = raw.indexOf(0x0D); // Find the split point in raw bytes
        const headerEndStr = request.indexOf('\r\n\r\n');
        const body = headerEndStr >= 0 ? raw.slice(new TextEncoder().encode(request.slice(0, headerEndStr + 4)).length) : undefined;

        const log = config.onRequest;

        // Game domain → forward to the flash server (same-origin with firmware for sandbox compat)
        if (config.gameDomain && (targetUrl.hostname === config.gameDomain || targetUrl.hostname === `www.${config.gameDomain}`)) {
            try {
                const localUrl = new URL(targetUrl.href);
                localUrl.hostname = '127.0.0.1';
                localUrl.port = String(config.flashPort);
                const response = await forwardRequest(localUrl, method, rawHeaders, body);
                const writer = conn.writable.getWriter();
                await writer.write(response);
                writer.releaseLock();
                log?.(method, match[2], 200);
            } catch {
                const writer = conn.writable.getWriter();
                await writer.write(httpResponse(502, 'Bad Gateway', { 'Connection': 'close' }));
                writer.releaseLock();
                log?.(method, match[2], 502);
            }
            conn.close();
            return;
        }

        // raflash.local → forward to the flash server
        if (targetUrl.hostname === 'raflash.local') {
            try {
                const localUrl = new URL(targetUrl.href);
                localUrl.hostname = '127.0.0.1';
                localUrl.port = String(config.flashPort);
                const response = await forwardRequest(localUrl, method, rawHeaders, body);
                const writer = conn.writable.getWriter();
                await writer.write(response);
                writer.releaseLock();
                log?.(method, match[2], 200);
            } catch {
                const writer = conn.writable.getWriter();
                await writer.write(httpResponse(502, 'Bad Gateway', { 'Connection': 'close' }));
                writer.releaseLock();
                log?.(method, match[2], 502);
            }
            conn.close();
            return;
        }

        // Check network behavior rules (exact URL match)
        const rules = config.getNetworkRules?.() || [];
        const fullUrl = match[2];
        const matchedRule = rules.find(r => r.active && r.url && r.url === fullUrl);
        if (matchedRule) {
            const statusText = matchedRule.status === 200 ? 'OK' : String(matchedRule.status);
            let bodyBytes: Uint8Array;
            let contentType: string;

            if (matchedRule.action === 'file' && matchedRule.fileBytes) {
                bodyBytes = matchedRule.fileBytes;
                contentType = contentTypeForUrl(fullUrl);
            } else {
                bodyBytes = encoder.encode(matchedRule.body || '');
                contentType = 'text/plain';
            }

            const writer = conn.writable.getWriter();
            await writer.write(httpResponse(matchedRule.status, statusText, {
                'Connection': 'close',
                'Content-Type': contentType,
                'Content-Length': String(bodyBytes.length),
            }, bodyBytes));
            writer.releaseLock();
            log?.(method, fullUrl, matchedRule.status);
            conn.close();
            return;
        }

        // Unknown host — block and return 404 (never forward to real internet)
        {
            const writer = conn.writable.getWriter();
            await writer.write(httpResponse(404, 'Not Found', { 'Connection': 'close', 'Content-Length': '0' }));
            writer.releaseLock();
            log?.(method, `[UNHANDLED] ${fullUrl}`, 404);
        }
        conn.close();
    } catch {
        try { conn.close(); } catch { /* already closed */ }
    }
}

/** Convert a full URL to its zip path inside network/. e.g. http://host.com/a/b.swf → network/host.com/a/b.swf */
export function networkRuleZipPath(url: string): string {
    const stripped = url.replace(/^https?:\/\//, '');
    return 'network/' + stripped;
}

export function startSitelockProxy(proxyConfig: ProxyConfig) {
    config = proxyConfig;
    listener = Deno.listen({ port: config.port });

    (async () => {
        for await (const conn of listener!) {
            handleConnection(conn).catch(() => {});
        }
    })();
}

export function stopSitelockProxy() {
    if (listener) {
        listener.close();
        listener = null;
    }
    config = null;
}
