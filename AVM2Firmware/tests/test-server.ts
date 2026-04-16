/**
 * Deno Test Server for AVM2 (Haxe/Flash) Unit Tests
 *
 * Serves the test SWF via HTTP and receives test results via Socket.
 * By serving the SWF from localhost, Flash Player allows socket connections
 * without requiring trust file configuration.
 *
 * Usage: deno run --allow-net --allow-run --allow-read test-server.ts <swf-path>
 *
 * Exit codes:
 *   0 - All tests passed
 *   1 - One or more tests failed
 *   2 - Connection error or timeout
 */

const PORT = 9998;
const TIMEOUT_MS = 30000; // 30 second timeout

// ANSI colors for terminal output
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
};

// Flash socket policy file - required for Socket connections
const POLICY_FILE = '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\0';

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
}

interface LogMessage {
    type: "log";
    message: string;
}

interface SummaryMessage {
    type: "summary";
    passed: number;
    failed: number;
    results: TestResult[];
}

type Message = LogMessage | SummaryMessage;

async function handleConnection(
    conn: Deno.Conn,
    swfPath: string
): Promise<{ done: boolean; exitCode: number }> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();

    try {
        // Read first chunk to determine request type
        const { done, value } = await reader.read();
        if (done) {
            return { done: false, exitCode: 2 };
        }

        buffer = decoder.decode(value);

        // Check if it's an HTTP request (for serving the SWF)
        if (buffer.startsWith("GET ")) {
            console.log(`${colors.dim}Serving SWF via HTTP${colors.reset}`);

            // Read the SWF file
            const swfData = await Deno.readFile(swfPath);

            // Send HTTP response
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
            return { done: false, exitCode: 2 }; // Not done, wait for socket connection
        }

        // Check for policy file request (Flash sends this before Socket connect)
        if (buffer.includes("<policy-file-request/>")) {
            console.log(`${colors.dim}Received policy file request${colors.reset}`);
            await writer.write(encoder.encode(POLICY_FILE));
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return { done: false, exitCode: 2 }; // Not done, wait for next connection
        }

        // Must be test result data - process it
        // AS3 Socket sends newline-terminated JSON
        while (true) {
            // Process any complete messages in buffer
            while (buffer.includes("\n")) {
                const newlineIndex = buffer.indexOf("\n");
                const messageStr = buffer.substring(0, newlineIndex);
                buffer = buffer.substring(newlineIndex + 1);

                if (messageStr.trim()) {
                    try {
                        const message: Message = JSON.parse(messageStr);
                        const result = handleMessage(message);
                        if (message.type === "summary") {
                            writer.releaseLock();
                            reader.releaseLock();
                            conn.close();
                            return { done: true, exitCode: result };
                        }
                    } catch (_e) {
                        console.error(`${colors.red}Failed to parse message: ${messageStr}${colors.reset}`);
                    }
                }
            }

            // Read more data
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value);
        }
    } catch (_e) {
        // Connection closed or error
    } finally {
        try {
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
        } catch {
            // Already closed
        }
    }

    return { done: false, exitCode: 2 };
}

function handleMessage(message: Message): number {
    if (message.type === "log") {
        let output = message.message;
        if (output.startsWith("PASS:")) {
            output = `${colors.green}${output}${colors.reset}`;
        } else if (output.startsWith("FAIL:")) {
            output = `${colors.red}${output}${colors.reset}`;
        }
        console.log(output);
        return 2;
    }

    if (message.type === "summary") {
        console.log("");
        console.log("\u2500".repeat(50));
        console.log("");

        const { passed, failed } = message;
        const total = passed + failed;

        if (failed === 0) {
            console.log(`${colors.green}All ${total} tests passed${colors.reset}`);
            return 0;
        } else {
            console.log(`${colors.red}${failed} of ${total} tests failed${colors.reset}`);
            console.log("");
            for (const result of message.results) {
                if (!result.passed) {
                    console.log(`  ${colors.red}\u2717 ${result.name}${colors.reset}`);
                    if (result.error) {
                        console.log(`    ${colors.dim}${result.error}${colors.reset}`);
                    }
                }
            }
            return 1;
        }
    }

    return 2;
}

async function runTestServer(swfPath: string): Promise<number> {
    let exitCode = 2;

    // Resolve to absolute path
    const absoluteSwfPath = swfPath.startsWith("/") || swfPath.includes(":")
        ? swfPath
        : `${Deno.cwd()}/${swfPath}`;

    // Verify SWF exists
    try {
        await Deno.stat(absoluteSwfPath);
    } catch {
        console.error(`${colors.red}ERROR: SWF file not found: ${absoluteSwfPath}${colors.reset}`);
        return 2;
    }

    const listener = Deno.listen({ port: PORT });
    console.log(`${colors.cyan}AVM2 Test Server listening on port ${PORT}${colors.reset}`);

    // Set up timeout
    const timeoutId = setTimeout(() => {
        console.error(`${colors.red}ERROR: Timeout waiting for test results${colors.reset}`);
        listener.close();
        Deno.exit(2);
    }, TIMEOUT_MS);

    // Launch Flash Player with HTTP URL (not file path)
    console.log(`${colors.dim}Launching Flash Player...${colors.reset}`);

    const fpPath = `${Deno.cwd()}/vendor/adobe/fp-32.0.0.380.exe`;
    const httpUrl = `http://localhost:${PORT}/AVM2Tests.swf`;

    // Launch Flash Player hidden and capture its PID for reliable cleanup.
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

    try {
        // Handle connections (HTTP for SWF, policy request, then test results)
        for await (const conn of listener) {
            const result = await handleConnection(conn, absoluteSwfPath);
            if (result.done) {
                exitCode = result.exitCode;
                break;
            }
        }
    } finally {
        clearTimeout(timeoutId);
        try { listener.close(); } catch { /* ok */ }
        killFlash();
    }

    return exitCode;
}

// Main
const swfPath = Deno.args[0];
if (!swfPath) {
    console.error(`${colors.red}Usage: deno run --allow-net --allow-run --allow-read test-server.ts <swf-path>${colors.reset}`);
    Deno.exit(2);
}

const exitCode = await runTestServer(swfPath);
Deno.exit(exitCode);
