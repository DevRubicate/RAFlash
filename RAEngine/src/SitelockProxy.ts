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

interface ProxyConfig {
    /** Port to listen on (must match port.txt / FlashpointProxy.dll config) */
    port: number;
    /** Port of the RAEngine flash server (for raflash.local forwarding) */
    flashPort: number;
    /** The domain the game expects to be loaded from, or null for transparent forwarding */
    gameDomain: string | null;
    /** Local path to the game SWF file */
    gameFilePath: string;
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

async function forwardRequest(targetUrl: URL, requestLine: string, rawHeaders: string): Promise<Uint8Array> {
    const port = parseInt(targetUrl.port) || 80;
    const conn = await Deno.connect({ hostname: targetUrl.hostname, port });
    try {
        const writer = conn.writable.getWriter();

        // Rewrite request line to use relative path (as the real server expects)
        const relativeRequest = `GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.1\r\n${rawHeaders}\r\n`;
        await writer.write(encoder.encode(relativeRequest));
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
        const { done, value } = await reader.read();
        reader.releaseLock();
        if (done || !value) return;

        const request = new TextDecoder().decode(value);
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

        const targetUrl = new URL(match[2]);
        const rawHeaders = lines.slice(1).join('\r\n');

        // Check if this is a request for the game domain (sitelock bypass)
        if (config.gameDomain && (targetUrl.hostname === config.gameDomain || targetUrl.hostname === `www.${config.gameDomain}`)) {
            // Serve the local game SWF
            try {
                const swfData = await Deno.readFile(config.gameFilePath);
                const writer = conn.writable.getWriter();
                await writer.write(httpResponse(200, 'OK', {
                    'Content-Type': 'application/x-shockwave-flash',
                    'Content-Length': String(swfData.length),
                    'Connection': 'close',
                }, swfData));
                writer.releaseLock();
            } catch {
                const writer = conn.writable.getWriter();
                await writer.write(httpResponse(404, 'Not Found', { 'Connection': 'close' }));
                writer.releaseLock();
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
                const response = await forwardRequest(localUrl, requestLine, rawHeaders);
                const writer = conn.writable.getWriter();
                await writer.write(response);
                writer.releaseLock();
            } catch {
                const writer = conn.writable.getWriter();
                await writer.write(httpResponse(502, 'Bad Gateway', { 'Connection': 'close' }));
                writer.releaseLock();
            }
            conn.close();
            return;
        }

        // Unknown host — forward to original destination
        try {
            const response = await forwardRequest(targetUrl, requestLine, rawHeaders);
            const writer = conn.writable.getWriter();
            await writer.write(response);
            writer.releaseLock();
        } catch {
            const writer = conn.writable.getWriter();
            await writer.write(httpResponse(502, 'Bad Gateway', { 'Connection': 'close' }));
            writer.releaseLock();
        }
        conn.close();
    } catch {
        try { conn.close(); } catch { /* already closed */ }
    }
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
