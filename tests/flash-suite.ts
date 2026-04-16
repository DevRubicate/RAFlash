/**
 * Flash Test Suite Runner
 *
 * Shared logic for running Flash Player-based test suites (AVM1 and AVM2).
 * Serves a test SWF via HTTP, handles Flash policy file requests, and
 * collects test results over XMLSocket (AVM1, null-terminated) or
 * Socket (AVM2, newline-terminated).
 */

import type { SuiteResult, TestResult } from "./framework.ts";

const POLICY_FILE = '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\0';
const TIMEOUT_MS = 30000;

interface FlashSuiteConfig {
    port: number;
    swfPath: string;
    delimiter: "\0" | "\n";
    /** Callback for each PASS/FAIL as it arrives (for live output). */
    onResult?: (result: TestResult) => void;
}

interface LogMessage {
    type: "log";
    message: string;
}

interface SummaryMessage {
    type: "summary";
    passed: number;
    failed: number;
    results: { name: string; passed: boolean; error?: string }[];
}

type Message = LogMessage | SummaryMessage;

export async function runFlashSuite(config: FlashSuiteConfig): Promise<SuiteResult> {
    const { port, swfPath, delimiter, onResult } = config;
    const start = performance.now();

    // Resolve to absolute path
    const absoluteSwfPath = swfPath.startsWith("/") || swfPath.includes(":")
        ? swfPath
        : `${Deno.cwd()}/${swfPath}`;

    // Verify SWF exists
    try {
        await Deno.stat(absoluteSwfPath);
    } catch {
        return {
            name: "",
            passed: 0,
            failed: 1,
            results: [{ name: "SWF file exists", passed: false, error: `Not found: ${absoluteSwfPath}`, durationMs: 0 }],
            durationMs: 0,
        };
    }

    const swfData = await Deno.readFile(absoluteSwfPath);
    const listener = Deno.listen({ port });

    // Timeout
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        try { listener.close(); } catch { /* ok */ }
    }, TIMEOUT_MS);

    // Launch Flash Player
    const fpPath = `${Deno.cwd()}/vendor/adobe/fp-32.0.0.380.exe`;
    const httpUrl = `http://localhost:${port}/${swfPath.split("/").pop()}`;

    let flashPid: number | null = null;
    let flashProcess: Deno.ChildProcess;
    if (Deno.build.os === "windows") {
        const command = new Deno.Command("powershell", {
            args: ["-NoProfile", "-Command",
                `$p = Start-Process -FilePath '${fpPath}' -ArgumentList '${httpUrl}' -WindowStyle Hidden -PassThru; Write-Output $p.Id`],
            cwd: Deno.cwd(),
            stdout: "piped",
        });
        flashProcess = command.spawn();
        const output = await new Response(flashProcess.stdout).text();
        const parsed = parseInt(output.trim());
        if (!isNaN(parsed)) flashPid = parsed;
    } else {
        const command = new Deno.Command(fpPath, {
            args: [httpUrl],
            cwd: Deno.cwd(),
        });
        flashProcess = command.spawn();
    }

    function killFlash(): void {
        if (Deno.build.os === "windows" && flashPid) {
            try { new Deno.Command("taskkill", { args: ["/F", "/PID", String(flashPid)] }).outputSync(); } catch { /* ok */ }
        }
        try { flashProcess.kill(); } catch { /* ok */ }
    }

    let suiteResult: SuiteResult | null = null;

    try {
        for await (const conn of listener) {
            const result = await handleConnection(conn, swfData, delimiter, onResult);
            if (result) {
                suiteResult = result;
                suiteResult.durationMs = performance.now() - start;
                break;
            }
        }
    } finally {
        clearTimeout(timeoutId);
        try { listener.close(); } catch { /* ok */ }
        killFlash();
    }

    if (timedOut || !suiteResult) {
        return {
            name: "",
            passed: 0,
            failed: 1,
            results: [{ name: "Flash suite completion", passed: false, error: "Timed out waiting for results", durationMs: 0 }],
            durationMs: performance.now() - start,
        };
    }

    return suiteResult;
}

async function handleConnection(
    conn: Deno.Conn,
    swfData: Uint8Array,
    delimiter: "\0" | "\n",
    onResult?: (result: TestResult) => void,
): Promise<SuiteResult | null> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();

    try {
        const { done, value } = await reader.read();
        if (done) return null;

        buffer = decoder.decode(value);

        // HTTP request — serve SWF
        if (buffer.startsWith("GET ")) {
            const response = [
                "HTTP/1.1 200 OK",
                "Content-Type: application/x-shockwave-flash",
                `Content-Length: ${swfData.length}`,
                "Connection: close",
                "",
                "",
            ].join("\r\n");

            await writer.write(encoder.encode(response));
            await writer.write(swfData);
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return null;
        }

        // Policy file request
        if (buffer.includes("<policy-file-request/>")) {
            await writer.write(encoder.encode(POLICY_FILE));
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return null;
        }

        // Socket data — read test results
        while (true) {
            while (buffer.includes(delimiter)) {
                const idx = buffer.indexOf(delimiter);
                const messageStr = buffer.substring(0, idx);
                buffer = buffer.substring(idx + 1);

                if (messageStr.trim()) {
                    try {
                        const message: Message = JSON.parse(messageStr);

                        if (message.type === "log" && onResult) {
                            // Parse "PASS: name" / "FAIL: name - error" from log messages
                            const msg = message.message;
                            if (msg.startsWith("PASS:")) {
                                onResult({ name: msg.substring(6).trim(), passed: true, durationMs: 0 });
                            } else if (msg.startsWith("FAIL:")) {
                                onResult({ name: msg.substring(6).trim(), passed: false, durationMs: 0 });
                            }
                        }

                        if (message.type === "summary") {
                            writer.releaseLock();
                            reader.releaseLock();
                            conn.close();

                            const results: TestResult[] = message.results.map((r) => ({
                                name: r.name,
                                passed: r.passed,
                                error: r.error,
                                durationMs: 0,
                            }));

                            return {
                                name: "",
                                passed: message.passed,
                                failed: message.failed,
                                results,
                                durationMs: 0,
                            };
                        }
                    } catch {
                        // Unparseable message — skip
                    }
                }
            }

            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value);
        }
    } catch {
        // Connection closed or error
    } finally {
        try { writer.releaseLock(); reader.releaseLock(); conn.close(); } catch { /* ok */ }
    }

    return null;
}
