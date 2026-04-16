/**
 * End-to-End Integration Test Harness for AVM1
 *
 * Runs the real AVM1 firmware in real Flash Player against a self-playing
 * test game (IntegrationGame.swf). Acts as a simplified RAEngine: serves
 * SWFs over HTTP, speaks the XMLSocket protocol, sends achievements, and
 * verifies they trigger correctly.
 *
 * Exported as a function for the unified test runner. Can also be run
 * standalone: deno run --allow-net --allow-run --allow-read integration-harness.ts <game-swf-path>
 */

import { Formula } from "../../RAEngine/src/formula/Formula.ts";
import type { SuiteResult, TestResult } from "../../tests/framework.ts";

const PORT = 18081;
const TIMEOUT_MS = 30000;
const POLICY_FILE = '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\0';

// ---------------------------------------------------------------------------
// Achievement / AppData builder
// ---------------------------------------------------------------------------

let nextReqId = 1;

function makeRequirement(formula: string, cmp: string, value: string) {
    const id = nextReqId++;
    return {
        id, flag: "", typeA: "Mem", addressA: formula,
        compiledA: Formula.compile(formula), cmp, typeB: "Value",
        addressB: value, compiledB: Formula.compile(value), maxHits: 0, hits: 0,
    };
}

function makeAchievement(id: number, name: string, formula: string, cmp: string, value: string) {
    return {
        id, type: "ACHIEVEMENT", name, description: `Integration test: ${name}`,
        points: 10, progressionType: "STANDARD", category: "", badgeImage: "",
        state: "ACTIVE", published: false, modified: false,
        groups: [{ id: 1, type: "CORE", requirements: [makeRequirement(formula, cmp, value)] }],
    };
}

function buildAppData() {
    return {
        assets: [
            makeAchievement(1, "50 Gold", "stage.gold", ">=", "50"),
            makeAchievement(2, "200 Gold", "stage.gold", ">=", "200"),
            makeAchievement(3, "500 Gold", "stage.gold", ">=", "500"),
            makeAchievement(4, "Bat Slayer", "stage.enemies[1].health", "==", "0"),
            makeAchievement(5, "Poisoned", "stage.flags.poisoned", "==", "1"),
            makeAchievement(6, "Level 2", "stage.level", ">=", "2"),
            makeAchievement(7, "Player Died", "stage.player.alive", "==", "0"),
        ],
        codeNotes: [],
        gameConfig: {
            title: "Integration Test Game", originUrl: "", badgeImage: "",
            hashOverride: "", scaleMode: "neutral", align: "neutral", networkRules: [],
        },
    };
}

// ---------------------------------------------------------------------------
// Socket protocol helpers
// ---------------------------------------------------------------------------

let requestCounter = 0;
function generateRequestId(): string {
    return `req-${++requestCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Value extraction helpers
// ---------------------------------------------------------------------------

function extractValue(result: unknown): unknown {
    if (result && typeof result === "object" && "output" in (result as Record<string, unknown>)) {
        const output = (result as Record<string, unknown>).output;
        if (Array.isArray(output) && output.length > 0) {
            const first = output[0];
            if (first && typeof first === "object" && "value" in first) return first.value;
            return first;
        }
        return output;
    }
    if (Array.isArray(result)) {
        if (result.length === 1) return result[0];
        return result;
    }
    return result;
}

function extractSearchResults(result: unknown): string[] {
    if (result && typeof result === "object" && "output" in (result as Record<string, unknown>)) {
        const output = (result as Record<string, unknown>).output;
        if (Array.isArray(output)) {
            return output.map((item) => {
                if (item && typeof item === "object" && "value" in item) {
                    let v = String(item.value);
                    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
                    return v;
                }
                return String(item);
            });
        }
    }
    if (Array.isArray(result)) return result.map(String);
    return [];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runIntegrationTests(gameSWFPath: string): Promise<SuiteResult> {
    const start = performance.now();
    const results: TestResult[] = [];

    function pass(name: string): void {
        results.push({ name, passed: true, durationMs: 0 });
    }
    function fail(name: string, error: string): void {
        results.push({ name, passed: false, error, durationMs: 0 });
    }
    function assert(name: string, condition: boolean, error: string): void {
        if (condition) pass(name); else fail(name, error);
    }
    function buildResult(): SuiteResult {
        return {
            name: "Integration",
            passed: results.filter((r) => r.passed).length,
            failed: results.filter((r) => !r.passed).length,
            results,
            durationMs: performance.now() - start,
        };
    }

    const firmwarePath = `${Deno.cwd()}/.build/firmware/AVM1.swf`;

    try { await Deno.stat(firmwarePath); } catch {
        fail("Firmware exists", `Not found: ${firmwarePath}. Run 'make avm1-build' first.`);
        return buildResult();
    }
    try { await Deno.stat(gameSWFPath); } catch {
        fail("Game SWF exists", `Not found: ${gameSWFPath}`);
        return buildResult();
    }

    const firmwareData = await Deno.readFile(firmwarePath);
    const gameData = await Deno.readFile(gameSWFPath);

    const listener = Deno.listen({ port: PORT });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        try { listener.close(); } catch { /* ok */ }
    }, TIMEOUT_MS);

    // Launch Flash Player
    const fpPath = `${Deno.cwd()}/vendor/adobe/fp-32.0.0.380.exe`;
    const httpUrl = `http://localhost:${PORT}/AVM1.swf`;

    let flashPid: number | null = null;
    let flashProcess: Deno.ChildProcess;
    if (Deno.build.os === "windows") {
        const command = new Deno.Command("powershell", {
            args: ["-NoProfile", "-Command",
                `$p = Start-Process -FilePath '${fpPath}' -ArgumentList '${httpUrl}' -WindowStyle Hidden -PassThru; Write-Output $p.Id`],
            cwd: Deno.cwd(), stdout: "piped",
        });
        flashProcess = command.spawn();
        const output = await new Response(flashProcess.stdout).text();
        const parsed = parseInt(output.trim());
        if (!isNaN(parsed)) flashPid = parsed;
    } else {
        const command = new Deno.Command(fpPath, { args: [httpUrl], cwd: Deno.cwd() });
        flashProcess = command.spawn();
    }

    function killFlash(): void {
        if (Deno.build.os === "windows" && flashPid) {
            try { new Deno.Command("taskkill", { args: ["/F", "/PID", String(flashPid)] }).outputSync(); } catch { /* ok */ }
        }
        try { flashProcess.kill(); } catch { /* ok */ }
    }

    // Run test protocol when XMLSocket connects
    const testDone = Promise.withResolvers<void>();

    const acceptLoop = (async () => {
        let socketHandedOff = false;
        for await (const conn of listener) {
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            const reader = conn.readable.getReader();
            const writer = conn.writable.getWriter();

            try {
                const { done, value } = await reader.read();
                if (done) { reader.releaseLock(); writer.releaseLock(); conn.close(); continue; }

                const firstChunk = decoder.decode(value);

                if (firstChunk.startsWith("GET ")) {
                    const path = firstChunk.split(" ")[1];
                    let swfData: Uint8Array | null = null;
                    if (path === "/game.swf") swfData = gameData;
                    else if (path === "/AVM1.swf" || path === "/avm1-firmware.swf") swfData = firmwareData;

                    if (!swfData) {
                        const notFound = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                        await writer.write(encoder.encode(notFound));
                    } else {
                        const response = `HTTP/1.1 200 OK\r\nContent-Type: application/x-shockwave-flash\r\nContent-Length: ${swfData.length}\r\nConnection: close\r\n\r\n`;
                        await writer.write(encoder.encode(response));
                        await writer.write(swfData);
                    }
                    writer.releaseLock(); reader.releaseLock(); conn.close();
                    continue;
                }

                if (firstChunk.includes("<policy-file-request/>")) {
                    await writer.write(encoder.encode(POLICY_FILE));
                    writer.releaseLock(); reader.releaseLock(); conn.close();
                    continue;
                }

                if (!socketHandedOff) {
                    socketHandedOff = true;
                    runTestProtocol(firstChunk, reader, writer, encoder, decoder, pass, fail, assert)
                        .then(() => testDone.resolve())
                        .catch(() => testDone.resolve());
                } else {
                    writer.releaseLock(); reader.releaseLock(); conn.close();
                }
            } catch {
                try { writer.releaseLock(); reader.releaseLock(); conn.close(); } catch { /* ok */ }
            }
        }
    })();

    try {
        await testDone.promise;
    } finally {
        clearTimeout(timeoutId);
        try { listener.close(); } catch { /* ok */ }
        killFlash();
        await acceptLoop.catch(() => {});
    }

    if (timedOut && results.length === 0) {
        fail("Integration suite completion", "Timed out waiting for Flash Player");
    }

    return buildResult();
}

// ---------------------------------------------------------------------------
// Test protocol
// ---------------------------------------------------------------------------

async function runTestProtocol(
    initialData: string,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    encoder: TextEncoder,
    decoder: TextDecoder,
    pass: (name: string) => void,
    fail: (name: string, error: string) => void,
    assert: (name: string, condition: boolean, error: string) => void,
): Promise<void> {
    const triggeredAchievements: number[] = [];
    let gameLoaded = false;
    let readyReceived = false;
    let readerDone = false;

    const pendingRequests = new Map<string, (response: Record<string, unknown>) => void>();
    let waitResolve: (() => void) | null = null;

    function processMessage(json: string): void {
        let parsed: unknown;
        try { parsed = JSON.parse(json); } catch { return; }

        if (Array.isArray(parsed) && parsed[0] === "RESPONSE") {
            const resolver = pendingRequests.get(String(parsed[1]));
            if (resolver) { pendingRequests.delete(String(parsed[1])); resolver(parsed[2] as Record<string, unknown>); }
            return;
        }

        const msg = parsed as { type?: string; data?: Record<string, unknown> };
        if (!msg.type) return;

        if (msg.type === "ready") readyReceived = true;
        else if (msg.type === "gameLoaded") gameLoaded = true;
        else if (msg.type === "editData") {
            const edited = (msg.data as Record<string, unknown>)?.edited as [string, unknown][] | undefined;
            if (edited) {
                for (const [path, value] of edited) {
                    const match = path.match(/^assets\/(\d+)\/state$/);
                    if (match && value === "TRIGGERED") {
                        const appData = buildAppData();
                        const asset = appData.assets[parseInt(match[1])];
                        if (asset) triggeredAchievements.push(asset.id);
                    }
                }
            }
        }

        if (waitResolve) { const r = waitResolve; waitResolve = null; r(); }
    }

    const readPump = (async () => {
        let buffer = initialData;
        function drain(): void {
            while (buffer.includes("\0")) {
                const idx = buffer.indexOf("\0");
                const msg = buffer.substring(0, idx);
                buffer = buffer.substring(idx + 1);
                if (msg.trim()) processMessage(msg);
            }
        }
        drain();
        while (true) {
            try {
                const { done, value } = await reader.read();
                if (done) { readerDone = true; break; }
                buffer += decoder.decode(value);
                drain();
            } catch { readerDone = true; break; }
        }
        if (waitResolve) { const r = waitResolve; waitResolve = null; r(); }
    })();

    async function waitFor(condition: () => boolean, description: string, timeoutMs = 15000): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (!condition()) {
            if (readerDone || Date.now() > deadline) { fail(description, `Timed out after ${timeoutMs}ms`); return false; }
            await new Promise<void>((resolve) => { waitResolve = resolve; setTimeout(resolve, Math.min(500, deadline - Date.now())); });
        }
        return true;
    }

    function sendRequest(command: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        const id = generateRequestId();
        const message = JSON.stringify(["REQUEST", id, { command, params }]);
        return new Promise((resolve) => {
            pendingRequests.set(id, resolve);
            writer.write(encoder.encode(message + "\0")).catch(() => {
                pendingRequests.delete(id);
                resolve({ success: false, error: "connection closed" });
            });
        });
    }

    async function sendRequestWithTimeout(command: string, params: Record<string, unknown>, timeoutMs = 10000): Promise<Record<string, unknown>> {
        return await Promise.race([
            sendRequest(command, params),
            new Promise<Record<string, unknown>>((resolve) => setTimeout(() => resolve({ success: false, error: "timeout" }), timeoutMs)),
        ]);
    }

    // Phase 1: Handshake
    if (!await waitFor(() => readyReceived, "Firmware sends ready")) return;
    pass("Firmware sends ready");

    const appData = buildAppData();
    const setupResponse = await sendRequestWithTimeout("setup", {
        data: appData, gameUrl: `http://localhost:${PORT}/game.swf`,
        settings: { firmwareMode: "parent", fixTextFieldBindings: true, fixSoundAttach: true,
            benchmarkingEnabled: false, interpreterFastPath: true, avm1ExecutionMode: "interpreter" },
    });
    assert("Setup succeeds", setupResponse?.success === true, `Expected success=true, got ${JSON.stringify(setupResponse)}`);

    if (!await waitFor(() => gameLoaded, "Game loads")) return;
    pass("Game loads successfully");

    // Phase 2: Achievement triggers
    const allTriggered = await waitFor(() => triggeredAchievements.length >= 7, "All 7 achievements trigger", 10000);
    if (allTriggered) pass("All 7 achievements triggered");

    for (const expected of [
        { id: 1, name: "50 Gold" }, { id: 2, name: "200 Gold" }, { id: 3, name: "500 Gold" },
        { id: 4, name: "Bat Slayer" }, { id: 5, name: "Poisoned" }, { id: 6, name: "Level 2" },
        { id: 7, name: "Player Died" },
    ]) {
        assert(`Achievement "${expected.name}" triggered`, triggeredAchievements.includes(expected.id),
            `Achievement id=${expected.id} not found in triggered list: [${triggeredAchievements.join(", ")}]`);
    }

    const gold50Index = triggeredAchievements.indexOf(1);
    const gold200Index = triggeredAchievements.indexOf(2);
    const gold500Index = triggeredAchievements.indexOf(3);
    if (gold50Index >= 0 && gold200Index >= 0 && gold500Index >= 0) {
        assert("Gold achievements trigger in order (50 < 200 < 500)",
            gold50Index < gold200Index && gold200Index < gold500Index,
            `Order was: 50Gold@${gold50Index}, 200Gold@${gold200Index}, 500Gold@${gold500Index}`);
    }

    const batIndex = triggeredAchievements.indexOf(4);
    const diedIndex = triggeredAchievements.indexOf(7);
    if (batIndex >= 0 && diedIndex >= 0) {
        assert("Bat Slayer triggers before Player Died", batIndex < diedIndex,
            `Bat Slayer@${batIndex}, Player Died@${diedIndex}`);
    }

    // Phase 3: DSL Evaluation
    const goldResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.gold") });
    if (goldResult?.success) {
        const value = extractValue(goldResult.result);
        assert("evaluate stage.gold returns number >= 500", typeof value === "number" && value >= 500, `Expected number >= 500, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.gold", `Request failed: ${JSON.stringify(goldResult)}`);

    const healthResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.player.health") });
    if (healthResult?.success) {
        const value = extractValue(healthResult.result);
        assert("evaluate stage.player.health returns 0", value === 0, `Expected 0, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.player.health", `Request failed: ${JSON.stringify(healthResult)}`);

    const levelResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.level") });
    if (levelResult?.success) {
        const value = extractValue(levelResult.result);
        assert("evaluate stage.level returns >= 2", typeof value === "number" && value >= 2, `Expected >= 2, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.level", `Request failed: ${JSON.stringify(levelResult)}`);

    const batHealthResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.enemies[1].health") });
    if (batHealthResult?.success) {
        const value = extractValue(batHealthResult.result);
        assert("evaluate stage.enemies[1].health returns 0", value === 0, `Expected 0, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.enemies[1].health", `Request failed: ${JSON.stringify(batHealthResult)}`);

    await new Promise((r) => setTimeout(r, 1500));
    const nestedResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.nested.deep.value") });
    if (nestedResult?.success) {
        const value = extractValue(nestedResult.result);
        assert("evaluate stage.nested.deep.value returns 99 (after frame 60)", value === 99, `Expected 99, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.nested.deep.value", `Request failed: ${JSON.stringify(nestedResult)}`);

    const frameResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.frameNum") });
    if (frameResult?.success) {
        const value = extractValue(frameResult.result);
        assert("evaluate stage.frameNum returns positive number", typeof value === "number" && value > 0, `Expected positive number, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.frameNum", `Request failed: ${JSON.stringify(frameResult)}`);

    // Phase 4: Memory Search
    const searchResult = await sendRequestWithTimeout("searchTargetForValue", { value: "goblin", pathFormula: null, pathString: "", searchMode: "value" });
    if (searchResult?.success) {
        const paths = extractSearchResults(searchResult.result);
        assert("Memory search finds 'goblin'", paths.length > 0, `Expected non-empty results, got ${JSON.stringify(searchResult.result)}`);
        if (paths.length > 0) {
            assert("Memory search path includes 'enemies'", paths.some((p) => p.includes("enemies")), `Expected path containing 'enemies', got ${JSON.stringify(paths)}`);
        }
    } else fail("Memory search for 'goblin'", `Request failed: ${JSON.stringify(searchResult)}`);

    const nameSearchResult = await sendRequestWithTimeout("searchTargetForValue", { value: "gold", pathFormula: null, pathString: "", searchMode: "name" });
    if (nameSearchResult?.success) {
        const paths = extractSearchResults(nameSearchResult.result);
        assert("Memory search by name finds 'gold'", paths.length > 0, `Expected non-empty results, got ${JSON.stringify(nameSearchResult.result)}`);
    } else fail("Memory search by name for 'gold'", `Request failed: ${JSON.stringify(nameSearchResult)}`);

    // Cleanup
    try { reader.cancel(); } catch { /* ok */ }
    await readPump.catch(() => {});
}

// ---------------------------------------------------------------------------
// Standalone entry point (for running outside the unified runner)
// ---------------------------------------------------------------------------

if (import.meta.main) {
    const gameSWFPath = Deno.args[0];
    if (!gameSWFPath) {
        console.error("Usage: deno run --allow-net --allow-run --allow-read integration-harness.ts <game-swf-path>");
        Deno.exit(2);
    }
    const absolutePath = gameSWFPath.startsWith("/") || gameSWFPath.includes(":")
        ? gameSWFPath : `${Deno.cwd()}/${gameSWFPath}`;

    const result = await runIntegrationTests(absolutePath);
    for (const r of result.results) {
        console.log(`${r.passed ? "PASS" : "FAIL"}: ${r.name}${r.error ? ` — ${r.error}` : ""}`);
    }
    console.log(`\n${result.passed} passed, ${result.failed} failed`);
    Deno.exit(result.failed > 0 ? 1 : 0);
}
