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

function makeRequirementWithFlag(formula: string, cmp: string, value: string, flag: string, maxHits = 0) {
    const id = nextReqId++;
    return {
        id, flag, typeA: "Mem", addressA: formula,
        compiledA: Formula.compile(formula), cmp, typeB: "Value",
        addressB: value, compiledB: Formula.compile(value), maxHits, hits: 0,
    };
}

function makeDeltaRequirement(formula: string, cmp: string, value: string) {
    const id = nextReqId++;
    return {
        id, flag: "", typeA: "DELTA", addressA: formula,
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

function makeMemVsDeltaRequirement(formula: string, cmp: string, deltaFormula: string) {
    const id = nextReqId++;
    return {
        id, flag: "", typeA: "Mem", addressA: formula,
        compiledA: Formula.compile(formula), cmp, typeB: "DELTA",
        addressB: deltaFormula, compiledB: Formula.compile(deltaFormula), maxHits: 0, hits: 0,
    };
}

function makeMultiReqAchievement(id: number, name: string, requirements: ReturnType<typeof makeRequirement>[]) {
    return {
        id, type: "ACHIEVEMENT", name, description: `Integration test: ${name}`,
        points: 10, progressionType: "STANDARD", category: "", badgeImage: "",
        state: "ACTIVE", published: false, modified: false,
        groups: [{ id: 1, type: "CORE", requirements }],
    };
}

function makeMultiGroupAchievement(
    id: number, name: string,
    groups: { type: string; requirements: ReturnType<typeof makeRequirement>[] }[],
) {
    return {
        id, type: "ACHIEVEMENT", name, description: `Integration test: ${name}`,
        points: 10, progressionType: "STANDARD", category: "", badgeImage: "",
        state: "ACTIVE", published: false, modified: false,
        groups: groups.map((g, i) => ({ id: i + 1, type: g.type, requirements: g.requirements })),
    };
}

function makeRichPresence(id: number, formula: string) {
    return {
        id, type: "RICH_PRESENCE", name: "Rich Presence", description: "Integration test: Rich Presence",
        points: 0, progressionType: "STANDARD", category: "", badgeImage: "",
        state: "ACTIVE", published: false, modified: false,
        formula, compiledFormula: Formula.compile(formula),
        groups: [],
    };
}

function buildAppData() {
    return {
        assets: [
            // --- Original achievements (IDs 1-7) ---
            makeAchievement(1, "50 Gold", "stage.gold", ">=", "50"),
            makeAchievement(2, "200 Gold", "stage.gold", ">=", "200"),
            makeAchievement(3, "500 Gold", "stage.gold", ">=", "500"),
            makeAchievement(4, "Bat Slayer", "stage.enemies[1].health", "==", "0"),
            makeAchievement(5, "Poisoned", "stage.flags.poisoned", "==", "1"),
            makeAchievement(6, "Level 2", "stage.level", ">=", "2"),
            makeAchievement(7, "Player Died", "stage.player.alive", "==", "0"),

            // --- Arithmetic formula achievements (IDs 8-10) ---
            // score is always gold*2, so score >= 100 triggers at frame 5 (gold=50)
            makeAchievement(8, "Score 100", "stage.score", ">=", "100"),
            // gold + level >= 202 triggers at frame 20 (gold=200, level=1)
            makeAchievement(9, "Gold Plus Level", "stage.gold + stage.level", ">=", "201"),
            // player.speed >= 15 triggers when level=2 (speed = 10 + (level-1)*5 = 15)
            makeAchievement(10, "Speed Boost", "stage.player.speed", ">=", "15"),

            // --- Multi-requirement achievements (IDs 11-13) ---
            // Both conditions must be true: gold >= 250 AND poisoned
            makeMultiReqAchievement(11, "Poisoned Rich", [
                makeRequirement("stage.gold", ">=", "250"),
                makeRequirement("stage.flags.poisoned", "==", "1"),
            ]),
            // Three conditions: bat dead AND goblin dead AND gold >= 200
            makeMultiReqAchievement(12, "Double Kill Rich", [
                makeRequirement("stage.enemies[1].health", "==", "0"),
                makeRequirement("stage.enemies[0].health", "==", "0"),
                makeRequirement("stage.gold", ">=", "200"),
            ]),
            // Player alive AND mana >= 60 (mana starts 50, +1/frame, so frame 10+)
            // AND gold >= 100 (frame 10), triggers at frame 10
            makeMultiReqAchievement(13, "Mana and Gold", [
                makeRequirement("stage.player.alive", "==", "1"),
                makeRequirement("stage.player.mana", ">=", "60"),
                makeRequirement("stage.gold", ">=", "100"),
            ]),

            // --- Deep nested property achievements (IDs 14-15) ---
            makeAchievement(14, "Zone1 Boss Defeated", "stage.world.zone1.boss.defeated", "==", "1"),
            makeAchievement(15, "Zone2 Boss Defeated", "stage.world.zone2.boss.defeated", "==", "1"),

            // --- Hit count achievements (IDs 16-17) ---
            // Requires gold >= 50 to be true for 3 frames (hit target = 3)
            makeMultiReqAchievement(16, "Sustained Gold", [
                makeRequirementWithFlag("stage.gold", ">=", "50", "", 3),
            ]),
            // Reset If: gold >= 300 resets hits. Normal: gold >= 100 needs 5 hits.
            // Gold reaches 100 at frame 10, reaches 300 at frame 30.
            // Between frame 10 and 30 there are 20 frames of hits, so 5 hits is reached by frame 14.
            makeMultiReqAchievement(17, "Gold Before Reset", [
                makeRequirementWithFlag("stage.gold", ">=", "100", "", 5),
                makeRequirementWithFlag("stage.gold", ">=", "300", "RESET_IF", 0),
            ]),

            // --- Computed value achievements (IDs 18-19) ---
            // aliveEnemies drops to 2 when bat dies (frame 5)
            makeAchievement(18, "First Kill", "stage.aliveEnemies", "==", "2"),
            // aliveEnemies drops to 1 when goblin dies (frame 15)
            makeAchievement(19, "Two Kills", "stage.aliveEnemies", "==", "1"),

            // --- len() achievements (IDs 20-21) ---
            // inventory gains "potion" at frame 5
            makeAchievement(20, "Inventory Started", "len(stage.inventory)", ">=", "1"),
            // inventory has 3 items at frame 15 (potion, shield, sword)
            makeAchievement(21, "Full Inventory", "len(stage.inventory)", ">=", "3"),

            // --- String comparison achievement (ID 22) ---
            // phase changes to "combat" at frame 20
            makeAchievement(22, "Combat Phase", "stage.phase", "==", '"combat"'),

            // --- Delta requirement achievement (ID 23) ---
            // Detects the moment level changes: current level > previous level
            // Level changes from 1->2 at frame 50
            makeMultiReqAchievement(23, "Level Changed", [
                makeMemVsDeltaRequirement("stage.level", ">", "stage.level"),
            ]),

            // --- ALT group achievement (ID 24) ---
            // CORE: gold >= 200 (frame 20). ALT: bat dead (frame 5) OR goblin dead (frame 15)
            // Triggers at frame 20 when CORE passes and ALT already satisfied
            makeMultiGroupAchievement(24, "ALT Group Test", [
                { type: "CORE", requirements: [makeRequirement("stage.gold", ">=", "200")] },
                { type: "ALT", requirements: [
                    makeRequirement("stage.enemies[1].health", "==", "0"),
                    makeRequirement("stage.enemies[0].health", "==", "0"),
                ]},
            ]),

            // --- PAUSE_IF achievement (ID 25) ---
            // Normal: gold >= 50 needs 15 hits. PAUSE_IF: combo == 0 (pauses on frames 10, 20, 30...)
            // Without pause: 15 hits from frame 5 = triggers frame 19
            // With pause: skips frame 10, so triggers frame 20 or 21
            makeMultiReqAchievement(25, "Paused Accumulation", [
                makeRequirementWithFlag("stage.gold", ">=", "50", "", 15),
                makeRequirementWithFlag("stage.combo", "==", "0", "PAUSE_IF", 0),
            ]),

            // --- AND_NEXT chain achievement (ID 26) ---
            // gold >= 100 AND shielded == 1 (compound condition, both must be true same frame)
            // Gold >= 100 at frame 10, shielded always true -> triggers frame 10
            makeMultiReqAchievement(26, "AND_NEXT Chain", [
                makeRequirementWithFlag("stage.gold", ">=", "100", "AND_NEXT"),
                makeRequirement("stage.flags.shielded", "==", "1"),
            ]),

            // --- OR_NEXT chain achievement (ID 27) ---
            // player dead OR poisoned (either condition satisfies the chain)
            // Poisoned at frame 25 (before player dies at frame 50) -> triggers frame 25
            makeMultiReqAchievement(27, "OR_NEXT Chain", [
                makeRequirementWithFlag("stage.player.alive", "==", "0", "OR_NEXT"),
                makeRequirement("stage.flags.poisoned", "==", "1"),
            ]),

            // --- MEASURED achievement (ID 28) ---
            // gold >= 50 with MEASURED flag, maxHits=5: tracks hit progress toward 5
            // Gold >= 50 from frame 5, so 5 hits reached at frame 9
            makeMultiReqAchievement(28, "MEASURED Hit Progress", [
                makeRequirementWithFlag("stage.gold", ">=", "50", "MEASURED", 5),
            ]),

            // --- TRIGGER achievement (ID 29) ---
            // CORE: gold >= 200 (frame 20). TRIGGER: zone2.boss.defeated (frame 35).
            // At frame 20 non-trigger reqs are met → primed. At frame 35 trigger fires.
            makeMultiReqAchievement(29, "TRIGGER Boss Gate", [
                makeRequirement("stage.gold", ">=", "200"),
                makeRequirementWithFlag("stage.world.zone2.boss.defeated", "==", "1", "TRIGGER"),
            ]),

            // --- RESET_NEXT_IF achievement (ID 30) ---
            // RESET_NEXT_IF: combo == 0 (fires at frames 10,20,30...) resets next req's hits.
            // Normal: gold >= 100 with maxHits=8.
            // Gold >= 100 starts at frame 10. combo==0 at frame 10 resets hits.
            // Accumulates 9 hits from frame 11-19 (combo != 0), triggers at frame 18.
            makeMultiReqAchievement(30, "RESET_NEXT_IF Combo", [
                makeRequirementWithFlag("stage.combo", "==", "0", "RESET_NEXT_IF"),
                makeRequirementWithFlag("stage.gold", ">=", "100", "", 8),
            ]),

            // --- SUB_HITS achievement (ID 31) ---
            // ADD_HITS: gold >= 50 (accumulates from frame 5).
            // SUB_HITS: combo == 0 (fires at frames 10,20,30... subtracts hits).
            // Terminal: gold >= 50 with maxHits=10.
            // Hits accumulate from frame 5. At frame 10, combo resets subtract 1.
            // Net hits grow faster than subtractions, so should trigger before frame 25.
            makeMultiReqAchievement(31, "SUB_HITS Net Accumulation", [
                makeRequirementWithFlag("stage.gold", ">=", "50", "ADD_HITS"),
                makeRequirementWithFlag("stage.combo", "==", "0", "SUB_HITS"),
                makeRequirementWithFlag("stage.gold", ">=", "50", "", 10),
            ]),

            // --- ADD_SOURCE achievement (ID 32) ---
            // ADD_SOURCE: stage.multiplier (value 3 initially, 5 at frame 45).
            // Terminal: stage.gold >= 53 (gold + multiplier >= 53).
            // At frame 5 gold=50, accumulator=3, effective=53 → triggers frame 5.
            makeMultiReqAchievement(32, "ADD_SOURCE Bonus", [
                makeRequirementWithFlag("stage.multiplier", "==", "0", "ADD_SOURCE"),
                makeRequirement("stage.gold", ">=", "53"),
            ]),

            // --- SUB_SOURCE achievement (ID 33) ---
            // ADD_SOURCE: stage.multiplier (3). SUB_SOURCE: stage.level (1).
            // Accumulator = 3 - 1 = 2. Terminal: stage.gold >= 52 (gold + 2 >= 52).
            // At frame 5 gold=50, accumulator=2, effective=52 → triggers frame 5.
            makeMultiReqAchievement(33, "SUB_SOURCE Penalty", [
                makeRequirementWithFlag("stage.multiplier", "==", "0", "ADD_SOURCE"),
                makeRequirementWithFlag("stage.level", "==", "0", "SUB_SOURCE"),
                makeRequirement("stage.gold", ">=", "52"),
            ]),

            // --- MEASURED_IF achievement (ID 34) ---
            // MEASURED: gold >= 50 with maxHits=3. MEASURED_IF: player.alive == 1.
            // Measures progress only while player is alive.
            // Gold >= 50 from frame 5, alive=true until frame 50 → triggers at frame 7.
            makeMultiReqAchievement(34, "MEASURED_IF Gated", [
                makeRequirementWithFlag("stage.gold", ">=", "50", "MEASURED", 3),
                makeRequirementWithFlag("stage.player.alive", "==", "1", "MEASURED_IF"),
            ]),

            // --- Ternary achievement (ID 35) ---
            // Formula uses ternary: alive ? health : -1.
            // When player dies (frame 50), alive=false → returns -1.
            makeAchievement(35, "Ternary Dead Check", "stage.player.alive ? stage.player.health : -1", "==", "-1"),

            // --- XOR achievement (ID 36) ---
            // zone1.boss.defeated XOR zone2.boss.defeated == 0: both false initially (XOR=0) but
            // that's trivially true, so add gold >= 350 gate. Zone1 defeated frame 15, zone2 frame 35.
            // At frame 35: both defeated → XOR=0, and gold=350 → triggers frame 35.
            makeMultiReqAchievement(36, "XOR Both Bosses Defeated", [
                makeRequirement("stage.world.zone1.boss.defeated ^ stage.world.zone2.boss.defeated", "==", "0"),
                makeRequirement("stage.gold", ">=", "350"),
            ]),

            // --- Multiple ALT groups achievement (ID 37) ---
            // CORE: gold >= 150 (frame 15).
            // ALT1: bat dead (frame 5) — satisfied before CORE.
            // ALT2: phase == "combat" (frame 20) — not yet satisfied when CORE passes.
            // Should trigger at frame 15 because CORE + ALT1 both pass.
            makeMultiGroupAchievement(37, "Multiple ALT Groups", [
                { type: "CORE", requirements: [makeRequirement("stage.gold", ">=", "150")] },
                { type: "ALT", requirements: [makeRequirement("stage.enemies[1].health", "==", "0")] },
                { type: "ALT", requirements: [makeRequirement("stage.phase", "==", '"combat"')] },
            ]),

            // --- Rich Presence (ID 38) ---
            // Rich Presence asset: evaluates formula and sends richPresenceUpdate messages.
            makeRichPresence(38, '"Gold: " + stage.gold'),
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
    const richPresenceMessages: string[] = [];
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
        else if (msg.type === "richPresenceUpdate") {
            const result = (msg.data as Record<string, unknown>)?.result as string | undefined;
            if (result) richPresenceMessages.push(result);
        }
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
    const TOTAL_ACHIEVEMENTS = 37;
    const allTriggered = await waitFor(
        () => triggeredAchievements.length >= TOTAL_ACHIEVEMENTS,
        `All ${TOTAL_ACHIEVEMENTS} achievements trigger`, 15000,
    );
    if (allTriggered) pass(`All ${TOTAL_ACHIEVEMENTS} achievements triggered`);

    // Verify each achievement triggered individually
    const expectedAchievements = [
        { id: 1, name: "50 Gold" }, { id: 2, name: "200 Gold" }, { id: 3, name: "500 Gold" },
        { id: 4, name: "Bat Slayer" }, { id: 5, name: "Poisoned" }, { id: 6, name: "Level 2" },
        { id: 7, name: "Player Died" }, { id: 8, name: "Score 100" },
        { id: 9, name: "Gold Plus Level" }, { id: 10, name: "Speed Boost" },
        { id: 11, name: "Poisoned Rich" }, { id: 12, name: "Double Kill Rich" },
        { id: 13, name: "Mana and Gold" },
        { id: 14, name: "Zone1 Boss Defeated" }, { id: 15, name: "Zone2 Boss Defeated" },
        { id: 16, name: "Sustained Gold" }, { id: 17, name: "Gold Before Reset" },
        { id: 18, name: "First Kill" }, { id: 19, name: "Two Kills" },
        { id: 20, name: "Inventory Started" }, { id: 21, name: "Full Inventory" },
        { id: 22, name: "Combat Phase" },
        { id: 23, name: "Level Changed" },
        { id: 24, name: "ALT Group Test" },
        { id: 25, name: "Paused Accumulation" },
        { id: 26, name: "AND_NEXT Chain" },
        { id: 27, name: "OR_NEXT Chain" },
        { id: 28, name: "MEASURED Hit Progress" },
        { id: 29, name: "TRIGGER Boss Gate" },
        { id: 30, name: "RESET_NEXT_IF Combo" },
        { id: 31, name: "SUB_HITS Net Accumulation" },
        { id: 32, name: "ADD_SOURCE Bonus" },
        { id: 33, name: "SUB_SOURCE Penalty" },
        { id: 34, name: "MEASURED_IF Gated" },
        { id: 35, name: "Ternary Dead Check" },
        { id: 36, name: "XOR Both Bosses Defeated" },
        { id: 37, name: "Multiple ALT Groups" },
    ];
    for (const expected of expectedAchievements) {
        assert(`Achievement "${expected.name}" triggered`, triggeredAchievements.includes(expected.id),
            `Achievement id=${expected.id} not found in triggered list: [${triggeredAchievements.join(", ")}]`);
    }

    // Ordering checks
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

    // Score 100 should trigger early (at frame 5, same as 50 Gold) - before 200 Gold
    const score100Index = triggeredAchievements.indexOf(8);
    if (score100Index >= 0 && gold200Index >= 0) {
        assert("Score 100 triggers before 200 Gold", score100Index < gold200Index,
            `Score100@${score100Index}, 200Gold@${gold200Index}`);
    }

    // First Kill (bat dies frame 5) before Two Kills (goblin dies frame 15)
    const firstKillIndex = triggeredAchievements.indexOf(18);
    const twoKillsIndex = triggeredAchievements.indexOf(19);
    if (firstKillIndex >= 0 && twoKillsIndex >= 0) {
        assert("First Kill triggers before Two Kills", firstKillIndex < twoKillsIndex,
            `FirstKill@${firstKillIndex}, TwoKills@${twoKillsIndex}`);
    }

    // Zone1 Boss (frame 15) triggers before Zone2 Boss (frame 35)
    const zone1Index = triggeredAchievements.indexOf(14);
    const zone2Index = triggeredAchievements.indexOf(15);
    if (zone1Index >= 0 && zone2Index >= 0) {
        assert("Zone1 Boss triggers before Zone2 Boss", zone1Index < zone2Index,
            `Zone1@${zone1Index}, Zone2@${zone2Index}`);
    }

    // Sustained Gold (hit count 3) should trigger shortly after 50 Gold
    const sustainedIndex = triggeredAchievements.indexOf(16);
    if (gold50Index >= 0 && sustainedIndex >= 0) {
        assert("Sustained Gold triggers after 50 Gold", sustainedIndex > gold50Index,
            `SustainedGold@${sustainedIndex}, 50Gold@${gold50Index}`);
    }

    // Gold Before Reset should trigger before gold reaches 300 (frame 30)
    const goldBeforeResetIndex = triggeredAchievements.indexOf(17);
    const gold200Idx = triggeredAchievements.indexOf(2);
    if (goldBeforeResetIndex >= 0 && gold200Idx >= 0) {
        assert("Gold Before Reset triggers before 200 Gold or near it",
            goldBeforeResetIndex <= gold200Idx + 2,
            `GoldBeforeReset@${goldBeforeResetIndex}, 200Gold@${gold200Idx}`);
    }

    // Inventory Started (frame 5) triggers before Full Inventory (frame 15)
    const invStartedIdx = triggeredAchievements.indexOf(20);
    const invFullIdx = triggeredAchievements.indexOf(21);
    if (invStartedIdx >= 0 && invFullIdx >= 0) {
        assert("Inventory Started triggers before Full Inventory",
            invStartedIdx < invFullIdx,
            `InvStarted@${invStartedIdx}, InvFull@${invFullIdx}`);
    }

    // AND_NEXT Chain (frame 10) triggers before Combat Phase (frame 20)
    const andNextIdx = triggeredAchievements.indexOf(26);
    const combatPhaseIdx = triggeredAchievements.indexOf(22);
    if (andNextIdx >= 0 && combatPhaseIdx >= 0) {
        assert("AND_NEXT Chain triggers before Combat Phase",
            andNextIdx < combatPhaseIdx,
            `ANDNext@${andNextIdx}, Combat@${combatPhaseIdx}`);
    }

    // OR_NEXT Chain (frame 25, via poisoned) triggers before Player Died (frame 50)
    const orNextIdx = triggeredAchievements.indexOf(27);
    if (orNextIdx >= 0 && diedIndex >= 0) {
        assert("OR_NEXT Chain triggers before Player Died",
            orNextIdx < diedIndex,
            `ORNext@${orNextIdx}, Died@${diedIndex}`);
    }

    // Level Changed (Delta, frame 50) triggers after OR_NEXT Chain (frame 25)
    const levelChangedIdx = triggeredAchievements.indexOf(23);
    if (levelChangedIdx >= 0 && orNextIdx >= 0) {
        assert("Level Changed (Delta) triggers after OR_NEXT Chain",
            levelChangedIdx > orNextIdx,
            `LevelChanged@${levelChangedIdx}, ORNext@${orNextIdx}`);
    }

    // MEASURED Hit Progress (gold>=50, 5 hits from frame 5 = frame 9) before 200 Gold (frame 20)
    const measuredIdx = triggeredAchievements.indexOf(28);
    if (measuredIdx >= 0 && gold200Index >= 0) {
        assert("MEASURED Hit Progress triggers before 200 Gold",
            measuredIdx < gold200Index,
            `Measured@${measuredIdx}, 200Gold@${gold200Index}`);
    }

    // Paused Accumulation (15 hits with pause, ~frame 20) triggers before 500 Gold (frame 50)
    const pausedIdx = triggeredAchievements.indexOf(25);
    if (pausedIdx >= 0 && gold500Index >= 0) {
        assert("Paused Accumulation triggers before 500 Gold",
            pausedIdx < gold500Index,
            `Paused@${pausedIdx}, 500Gold@${gold500Index}`);
    }

    // ALT Group Test (CORE: gold>=200, frame 20) triggers before 500 Gold (frame 50)
    const altGroupIdx = triggeredAchievements.indexOf(24);
    if (altGroupIdx >= 0 && gold500Index >= 0) {
        assert("ALT Group Test triggers before 500 Gold",
            altGroupIdx < gold500Index,
            `ALTGroup@${altGroupIdx}, 500Gold@${gold500Index}`);
    }

    // TRIGGER Boss Gate (frame 35) triggers after 200 Gold (frame 20) and before 500 Gold (frame 50)
    const triggerIdx = triggeredAchievements.indexOf(29);
    if (triggerIdx >= 0 && gold200Index >= 0) {
        assert("TRIGGER Boss Gate triggers after 200 Gold",
            triggerIdx > gold200Index,
            `Trigger@${triggerIdx}, 200Gold@${gold200Index}`);
    }
    if (triggerIdx >= 0 && gold500Index >= 0) {
        assert("TRIGGER Boss Gate triggers before 500 Gold",
            triggerIdx < gold500Index,
            `Trigger@${triggerIdx}, 500Gold@${gold500Index}`);
    }

    // RESET_NEXT_IF Combo (frame ~18) triggers before 200 Gold (frame 20)
    const resetNextIdx = triggeredAchievements.indexOf(30);
    if (resetNextIdx >= 0 && gold200Index >= 0) {
        assert("RESET_NEXT_IF triggers before 200 Gold",
            resetNextIdx < gold200Index,
            `ResetNext@${resetNextIdx}, 200Gold@${gold200Index}`);
    }

    // ADD_SOURCE Bonus (frame 5) triggers early, before 200 Gold (frame 20)
    const addSourceIdx = triggeredAchievements.indexOf(32);
    if (addSourceIdx >= 0 && gold200Index >= 0) {
        assert("ADD_SOURCE triggers before 200 Gold",
            addSourceIdx < gold200Index,
            `AddSource@${addSourceIdx}, 200Gold@${gold200Index}`);
    }

    // SUB_SOURCE Penalty (frame 5) triggers early, before 200 Gold (frame 20)
    const subSourceIdx = triggeredAchievements.indexOf(33);
    if (subSourceIdx >= 0 && gold200Index >= 0) {
        assert("SUB_SOURCE triggers before 200 Gold",
            subSourceIdx < gold200Index,
            `SubSource@${subSourceIdx}, 200Gold@${gold200Index}`);
    }

    // MEASURED_IF Gated (frame 7) triggers early, before 200 Gold (frame 20)
    const measuredIfIdx = triggeredAchievements.indexOf(34);
    if (measuredIfIdx >= 0 && gold200Index >= 0) {
        assert("MEASURED_IF triggers before 200 Gold",
            measuredIfIdx < gold200Index,
            `MeasuredIf@${measuredIfIdx}, 200Gold@${gold200Index}`);
    }

    // Ternary Dead Check (frame 50) triggers at same time or after 500 Gold
    const ternaryIdx = triggeredAchievements.indexOf(35);
    if (ternaryIdx >= 0 && gold200Index >= 0) {
        assert("Ternary Dead Check triggers after 200 Gold",
            ternaryIdx > gold200Index,
            `Ternary@${ternaryIdx}, 200Gold@${gold200Index}`);
    }

    // XOR Both Bosses Defeated (frame 35) triggers after 200 Gold (frame 20) and before 500 Gold (frame 50)
    const xorIdx = triggeredAchievements.indexOf(36);
    if (xorIdx >= 0 && gold200Index >= 0) {
        assert("XOR triggers after 200 Gold",
            xorIdx > gold200Index,
            `XOR@${xorIdx}, 200Gold@${gold200Index}`);
    }
    if (xorIdx >= 0 && gold500Index >= 0) {
        assert("XOR triggers before 500 Gold",
            xorIdx < gold500Index,
            `XOR@${xorIdx}, 500Gold@${gold500Index}`);
    }

    // Multiple ALT Groups (frame 15) triggers before 200 Gold (frame 20)
    const multiAltIdx = triggeredAchievements.indexOf(37);
    if (multiAltIdx >= 0 && gold200Index >= 0) {
        assert("Multiple ALT Groups triggers before 200 Gold",
            multiAltIdx < gold200Index,
            `MultiALT@${multiAltIdx}, 200Gold@${gold200Index}`);
    }

    // SUB_HITS Net Accumulation triggers before 500 Gold (frame 50)
    const subHitsIdx = triggeredAchievements.indexOf(31);
    if (subHitsIdx >= 0 && gold500Index >= 0) {
        assert("SUB_HITS triggers before 500 Gold",
            subHitsIdx < gold500Index,
            `SubHits@${subHitsIdx}, 500Gold@${gold500Index}`);
    }

    // Phase 3: DSL Evaluation - Basic property reads
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

    // Phase 3b: DSL Evaluation - Arithmetic operations
    // Use single expression to avoid cross-frame race between two separate evaluate calls
    const scoreCheckResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.score - stage.gold * 2") });
    if (scoreCheckResult?.success) {
        const value = extractValue(scoreCheckResult.result);
        assert("score == gold * 2 (computed property)", value === 0,
            `Expected stage.score - stage.gold * 2 == 0, got ${JSON.stringify(value)}`);
    } else fail("evaluate score vs gold*2", `Request failed: ${JSON.stringify(scoreCheckResult)}`);

    const arithmeticResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.gold + stage.level") });
    if (arithmeticResult?.success) {
        const value = extractValue(arithmeticResult.result);
        assert("evaluate stage.gold + stage.level returns number", typeof value === "number" && value > 500,
            `Expected number > 500, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.gold + stage.level", `Request failed: ${JSON.stringify(arithmeticResult)}`);

    const subResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.gold - 100") });
    if (subResult?.success) {
        const value = extractValue(subResult.result);
        assert("evaluate stage.gold - 100 returns positive number", typeof value === "number" && value > 0,
            `Expected positive number, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.gold - 100", `Request failed: ${JSON.stringify(subResult)}`);

    const mulResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.multiplier * stage.level") });
    if (mulResult?.success) {
        const value = extractValue(mulResult.result);
        assert("evaluate stage.multiplier * stage.level returns number >= 5",
            typeof value === "number" && value >= 5,
            `Expected number >= 5, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.multiplier * stage.level", `Request failed: ${JSON.stringify(mulResult)}`);

    // Phase 3c: DSL Evaluation - Comparison operators
    const cmpGtResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.gold > 100") });
    if (cmpGtResult?.success) {
        const value = extractValue(cmpGtResult.result);
        assert("evaluate stage.gold > 100 returns truthy", value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.gold > 100", `Request failed: ${JSON.stringify(cmpGtResult)}`);

    const cmpEqResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.player.health == 0") });
    if (cmpEqResult?.success) {
        const value = extractValue(cmpEqResult.result);
        assert("evaluate stage.player.health == 0 returns truthy", value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.player.health == 0", `Request failed: ${JSON.stringify(cmpEqResult)}`);

    const cmpNeqResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.gold != 0") });
    if (cmpNeqResult?.success) {
        const value = extractValue(cmpNeqResult.result);
        assert("evaluate stage.gold != 0 returns truthy", value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.gold != 0", `Request failed: ${JSON.stringify(cmpNeqResult)}`);

    // Phase 3d: DSL Evaluation - Boolean operators
    const negResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("!stage.player.alive") });
    if (negResult?.success) {
        const value = extractValue(negResult.result);
        assert("evaluate !stage.player.alive returns truthy (player is dead)", value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate !stage.player.alive", `Request failed: ${JSON.stringify(negResult)}`);

    const andResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.flags.poisoned && stage.flags.shielded") });
    if (andResult?.success) {
        const value = extractValue(andResult.result);
        assert("evaluate poisoned && shielded returns truthy (both true)", value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate poisoned && shielded", `Request failed: ${JSON.stringify(andResult)}`);

    const orResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.player.alive || stage.flags.poisoned") });
    if (orResult?.success) {
        const value = extractValue(orResult.result);
        assert("evaluate alive || poisoned returns truthy (poisoned is true)", value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate alive || poisoned", `Request failed: ${JSON.stringify(orResult)}`);

    // Phase 3e: DSL Evaluation - Ternary expressions
    const ternaryResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.player.alive ? stage.player.health : -1") });
    if (ternaryResult?.success) {
        const value = extractValue(ternaryResult.result);
        assert("evaluate ternary (dead player) returns -1", value === -1,
            `Expected -1, got ${JSON.stringify(value)}`);
    } else fail("evaluate ternary expression", `Request failed: ${JSON.stringify(ternaryResult)}`);

    const ternaryResult2 = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.flags.poisoned ? 999 : 0") });
    if (ternaryResult2?.success) {
        const value = extractValue(ternaryResult2.result);
        assert("evaluate ternary (poisoned=true) returns 999", value === 999,
            `Expected 999, got ${JSON.stringify(value)}`);
    } else fail("evaluate ternary poisoned", `Request failed: ${JSON.stringify(ternaryResult2)}`);

    // Phase 3f: DSL Evaluation - Deep nested access
    const deepResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.world.zone1.boss.defeated") });
    if (deepResult?.success) {
        const value = extractValue(deepResult.result);
        assert("evaluate stage.world.zone1.boss.defeated returns truthy", value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate deep nested boss.defeated", `Request failed: ${JSON.stringify(deepResult)}`);

    const deepResult2 = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.world.zone2.difficulty") });
    if (deepResult2?.success) {
        const value = extractValue(deepResult2.result);
        assert("evaluate stage.world.zone2.difficulty returns 2", value === 2,
            `Expected 2, got ${JSON.stringify(value)}`);
    } else fail("evaluate deep nested difficulty", `Request failed: ${JSON.stringify(deepResult2)}`);

    // Phase 3g: DSL Evaluation - Array indexing variants
    const enemy0Result = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.enemies[0].health") });
    if (enemy0Result?.success) {
        const value = extractValue(enemy0Result.result);
        assert("evaluate stage.enemies[0].health (goblin) returns 0", value === 0,
            `Expected 0, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.enemies[0].health", `Request failed: ${JSON.stringify(enemy0Result)}`);

    const enemy2Result = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.enemies[2].health") });
    if (enemy2Result?.success) {
        const value = extractValue(enemy2Result.result);
        assert("evaluate stage.enemies[2].health (dragon) returns 200", value === 200,
            `Expected 200, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.enemies[2].health", `Request failed: ${JSON.stringify(enemy2Result)}`);

    // Phase 3h: DSL Evaluation - Player properties
    const manaResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.player.mana") });
    if (manaResult?.success) {
        const value = extractValue(manaResult.result);
        assert("evaluate stage.player.mana returns number <= 100", typeof value === "number" && value <= 100,
            `Expected number <= 100, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.player.mana", `Request failed: ${JSON.stringify(manaResult)}`);

    const speedResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.player.speed") });
    if (speedResult?.success) {
        const value = extractValue(speedResult.result);
        assert("evaluate stage.player.speed returns >= 15", typeof value === "number" && value >= 15,
            `Expected >= 15, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.player.speed", `Request failed: ${JSON.stringify(speedResult)}`);

    // Phase 3i: DSL Evaluation - Scalar properties
    const aliveEnemiesResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.aliveEnemies") });
    if (aliveEnemiesResult?.success) {
        const value = extractValue(aliveEnemiesResult.result);
        assert("evaluate stage.aliveEnemies returns 1 (only dragon left)", value === 1,
            `Expected 1, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.aliveEnemies", `Request failed: ${JSON.stringify(aliveEnemiesResult)}`);

    const multiplierResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.multiplier") });
    if (multiplierResult?.success) {
        const value = extractValue(multiplierResult.result);
        assert("evaluate stage.multiplier returns 5 (changed at frame 45)", value === 5,
            `Expected 5, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.multiplier", `Request failed: ${JSON.stringify(multiplierResult)}`);

    // Phase 3j: DSL Evaluation - Literal values
    const literalResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("42") });
    if (literalResult?.success) {
        const value = extractValue(literalResult.result);
        assert("evaluate literal 42 returns 42", value === 42,
            `Expected 42, got ${JSON.stringify(value)}`);
    } else fail("evaluate literal 42", `Request failed: ${JSON.stringify(literalResult)}`);

    const exprLiteralResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("10 + 20 * 3") });
    if (exprLiteralResult?.success) {
        const value = extractValue(exprLiteralResult.result);
        assert("evaluate 10 + 20 * 3 returns 70 (precedence)", value === 70,
            `Expected 70, got ${JSON.stringify(value)}`);
    } else fail("evaluate 10 + 20 * 3", `Request failed: ${JSON.stringify(exprLiteralResult)}`);

    const parenResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("(10 + 20) * 3") });
    if (parenResult?.success) {
        const value = extractValue(parenResult.result);
        assert("evaluate (10 + 20) * 3 returns 90 (parentheses)", value === 90,
            `Expected 90, got ${JSON.stringify(value)}`);
    } else fail("evaluate (10 + 20) * 3", `Request failed: ${JSON.stringify(parenResult)}`);

    // Phase 3k: DSL Evaluation - len() function
    const lenEnemiesResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("len(stage.enemies)") });
    if (lenEnemiesResult?.success) {
        const value = extractValue(lenEnemiesResult.result);
        assert("evaluate len(stage.enemies) returns 3", value === 3,
            `Expected 3, got ${JSON.stringify(value)}`);
    } else fail("evaluate len(stage.enemies)", `Request failed: ${JSON.stringify(lenEnemiesResult)}`);

    const lenInventoryResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("len(stage.inventory)") });
    if (lenInventoryResult?.success) {
        const value = extractValue(lenInventoryResult.result);
        assert("evaluate len(stage.inventory) returns 3", value === 3,
            `Expected 3, got ${JSON.stringify(value)}`);
    } else fail("evaluate len(stage.inventory)", `Request failed: ${JSON.stringify(lenInventoryResult)}`);

    // Phase 3l: DSL Evaluation - Division, modulo, exponentiation
    const divResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.gold / 10") });
    if (divResult?.success) {
        const value = extractValue(divResult.result);
        assert("evaluate stage.gold / 10 returns frameNum (positive number)",
            typeof value === "number" && value > 0,
            `Expected positive number, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.gold / 10", `Request failed: ${JSON.stringify(divResult)}`);

    const modResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.frameNum % 10") });
    if (modResult?.success) {
        const value = extractValue(modResult.result);
        assert("evaluate stage.frameNum % 10 returns 0-9",
            typeof value === "number" && value >= 0 && value <= 9,
            `Expected 0-9, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.frameNum % 10", `Request failed: ${JSON.stringify(modResult)}`);

    const powResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("2 ** 10") });
    if (powResult?.success) {
        const value = extractValue(powResult.result);
        assert("evaluate 2 ** 10 returns 1024", value === 1024,
            `Expected 1024, got ${JSON.stringify(value)}`);
    } else fail("evaluate 2 ** 10", `Request failed: ${JSON.stringify(powResult)}`);

    // Phase 3m: DSL Evaluation - stage_frame global
    const stageFrameResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage_frame") });
    if (stageFrameResult?.success) {
        const value = extractValue(stageFrameResult.result);
        assert("evaluate stage_frame returns positive number",
            typeof value === "number" && value > 0,
            `Expected positive number, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage_frame", `Request failed: ${JSON.stringify(stageFrameResult)}`);

    // Phase 3n: DSL Evaluation - Remembered values {expr}
    const rememberedResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("{stage.combo}") });
    if (rememberedResult?.success) {
        const value = extractValue(rememberedResult.result);
        assert("evaluate {stage.combo} returns cached non-zero value",
            typeof value === "number" && value > 0,
            `Expected positive number (cached from last non-zero combo), got ${JSON.stringify(value)}`);
    } else fail("evaluate {stage.combo}", `Request failed: ${JSON.stringify(rememberedResult)}`);

    // Phase 3o: DSL Evaluation - String comparison
    const strCmpResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile('stage.phase == "critical"') });
    if (strCmpResult?.success) {
        const value = extractValue(strCmpResult.result);
        assert("evaluate stage.phase == \"critical\" returns truthy",
            value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.phase == \"critical\"", `Request failed: ${JSON.stringify(strCmpResult)}`);

    const strCmpResult2 = await sendRequestWithTimeout("evaluate", { formula: Formula.compile('stage.player.name == "Hero"') });
    if (strCmpResult2?.success) {
        const value = extractValue(strCmpResult2.result);
        assert("evaluate stage.player.name == \"Hero\" returns truthy",
            value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.player.name == \"Hero\"", `Request failed: ${JSON.stringify(strCmpResult2)}`);

    const strNeqResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile('stage.phase != "explore"') });
    if (strNeqResult?.success) {
        const value = extractValue(strNeqResult.result);
        assert("evaluate stage.phase != \"explore\" returns truthy (phase is critical)",
            value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate stage.phase != \"explore\"", `Request failed: ${JSON.stringify(strNeqResult)}`);

    // Phase 3p: DSL Evaluation - XOR operator
    const xorResult = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.flags.poisoned ^ stage.player.alive") });
    if (xorResult?.success) {
        const value = extractValue(xorResult.result);
        assert("evaluate poisoned ^ alive returns truthy (true XOR false = true)",
            value === true || value === 1,
            `Expected truthy, got ${JSON.stringify(value)}`);
    } else fail("evaluate poisoned ^ alive", `Request failed: ${JSON.stringify(xorResult)}`);

    const xorResult2 = await sendRequestWithTimeout("evaluate", { formula: Formula.compile("stage.flags.poisoned ^ stage.flags.shielded") });
    if (xorResult2?.success) {
        const value = extractValue(xorResult2.result);
        assert("evaluate poisoned ^ shielded returns falsy (true XOR true = false)",
            value === false || value === 0,
            `Expected falsy, got ${JSON.stringify(value)}`);
    } else fail("evaluate poisoned ^ shielded", `Request failed: ${JSON.stringify(xorResult2)}`);

    // Phase 3q: Rich Presence verification
    // Wait a moment to ensure at least one RP evaluation cycle (1 second interval)
    if (richPresenceMessages.length === 0) {
        await waitFor(() => richPresenceMessages.length > 0, "Rich Presence sends update", 5000);
    }
    assert("Rich Presence sends at least one update",
        richPresenceMessages.length > 0,
        `Expected richPresenceUpdate messages, got ${richPresenceMessages.length}`);
    if (richPresenceMessages.length > 0) {
        const lastRP = richPresenceMessages[richPresenceMessages.length - 1];
        assert("Rich Presence contains 'Gold: ' prefix",
            lastRP.startsWith("Gold: "),
            `Expected RP starting with 'Gold: ', got '${lastRP}'`);
        // The gold value should be a positive number after the prefix
        const goldNum = parseInt(lastRP.replace("Gold: ", ""));
        assert("Rich Presence gold value is positive number",
            !isNaN(goldNum) && goldNum > 0,
            `Expected positive number in RP, got '${lastRP}'`);
    }

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

    // Phase 4b: Additional memory searches
    const dragonSearch = await sendRequestWithTimeout("searchTargetForValue", { value: "dragon", pathFormula: null, pathString: "", searchMode: "value" });
    if (dragonSearch?.success) {
        const paths = extractSearchResults(dragonSearch.result);
        assert("Memory search finds 'dragon'", paths.length > 0, `Expected non-empty results, got ${JSON.stringify(dragonSearch.result)}`);
    } else fail("Memory search for 'dragon'", `Request failed: ${JSON.stringify(dragonSearch)}`);

    const heroSearch = await sendRequestWithTimeout("searchTargetForValue", { value: "Hero", pathFormula: null, pathString: "", searchMode: "value" });
    if (heroSearch?.success) {
        const paths = extractSearchResults(heroSearch.result);
        assert("Memory search finds 'Hero' (player.name)", paths.length > 0, `Expected non-empty results, got ${JSON.stringify(heroSearch.result)}`);
        if (paths.length > 0) {
            assert("Memory search 'Hero' path includes 'player'", paths.some((p) => p.includes("player")),
                `Expected path containing 'player', got ${JSON.stringify(paths)}`);
        }
    } else fail("Memory search for 'Hero'", `Request failed: ${JSON.stringify(heroSearch)}`);

    const forestSearch = await sendRequestWithTimeout("searchTargetForValue", { value: "forest", pathFormula: null, pathString: "", searchMode: "value" });
    if (forestSearch?.success) {
        const paths = extractSearchResults(forestSearch.result);
        assert("Memory search finds 'forest' (world.zone1.name)", paths.length > 0, `Expected non-empty results, got ${JSON.stringify(forestSearch.result)}`);
    } else fail("Memory search for 'forest'", `Request failed: ${JSON.stringify(forestSearch)}`);

    const nameSearchPhase = await sendRequestWithTimeout("searchTargetForValue", { value: "phase", pathFormula: null, pathString: "", searchMode: "name" });
    if (nameSearchPhase?.success) {
        const paths = extractSearchResults(nameSearchPhase.result);
        assert("Memory search by name finds 'phase'", paths.length > 0, `Expected non-empty results, got ${JSON.stringify(nameSearchPhase.result)}`);
    } else fail("Memory search by name for 'phase'", `Request failed: ${JSON.stringify(nameSearchPhase)}`);

    const nameSearchMana = await sendRequestWithTimeout("searchTargetForValue", { value: "mana", pathFormula: null, pathString: "", searchMode: "name" });
    if (nameSearchMana?.success) {
        const paths = extractSearchResults(nameSearchMana.result);
        assert("Memory search by name finds 'mana'", paths.length > 0, `Expected non-empty results, got ${JSON.stringify(nameSearchMana.result)}`);
    } else fail("Memory search by name for 'mana'", `Request failed: ${JSON.stringify(nameSearchMana)}`);

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
