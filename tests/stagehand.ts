/**
 * Stagehand — a scripted driver for Flash games.
 *
 * Launches Adobe Flash Player with the AVM1 firmware, loads a target game
 * SWF inside the firmware, and speaks the firmware's XMLSocket protocol
 * to offer an interaction API:
 *
 *     const sh = await Stagehand.launch({ swfPath: ".tests/Game.swf" });
 *     await sh.click("stage.fireButton");
 *     await sh.tick(5);
 *     const x = await sh.evaluate<number>("stage.player.x");
 *     await sh.close();
 *
 * The firmware already exposes `evaluate` (read via DSL), `setValue`
 * (write property), and `invokeMethod` (call a method on a path). This
 * file is a thin, opinionated wrapper that hides the socket protocol and
 * the SWF-serving HTTP server.
 *
 * The name mirrors the theatrical metaphor already present in the DSL:
 * the firmware's `stage.*` traversal operates on the game's stage, and a
 * stagehand is what moves things on that stage from behind the scenes.
 */

import { Formula } from "../RAEngine/src/formula/Formula.ts";

const POLICY_FILE = '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\0';

/**
 * Minimal shape of the firmware's appData — what actually matters for
 * Stagehand is the `assets` list, since that's where achievement IDs and
 * names come from for trigger tracking. Anything else passes through.
 */
export interface AppData {
    assets: Array<{ id: number; name?: string; type?: string; [k: string]: unknown }>;
    codeNotes?: unknown[];
    gameConfig?: Record<string, unknown>;
    [k: string]: unknown;
}

/**
 * The subset of Stagehand's public API that `runStep` (tests/ratest.ts)
 * depends on. Extracted so playback can run against either a fresh-launch
 * Stagehand or a live-connected adapter that drives an already-running
 * RAEngine firmware.
 */
export interface StagehandLike {
    evaluate<T = unknown>(formula: string): Promise<T>;
    setValue(path: string, property: string, value: string | number | boolean | null): Promise<void>;
    invoke<T = unknown>(path: string, method: string, args?: unknown[]): Promise<T>;
    click(path: string): Promise<unknown>;
    tick(n?: number): Promise<void>;
    hasTriggered(idOrName: number | string): boolean;
    waitTriggered(idOrName: number | string, timeoutMs?: number): Promise<void>;
    waitFor<T = unknown>(
        formula: string,
        predicate: (value: T) => boolean,
        opts?: { timeoutMs?: number; pollMs?: number },
    ): Promise<T>;
    waitForElement(path: string, opts?: { timeoutMs?: number }): Promise<void>;
    close(): Promise<void>;
}

export interface LaunchOptions {
    /**
     * Path to the target game SWF on disk. Exactly one of swfPath or
     * swfBytes must be supplied.
     */
    swfPath?: string;
    /**
     * Raw SWF bytes for the target game. Used when the SWF comes from
     * inside an archive (e.g. a .raflash zip) and writing it to a temp
     * file would be wasteful.
     */
    swfBytes?: Uint8Array;
    /**
     * Achievement/rich-presence data to send in the firmware setup
     * message. Requirements must already have compiledA/compiledB
     * fields populated (Formula.compile). If omitted, an empty stub
     * is sent — the firmware runs with no achievements loaded.
     */
    appData?: AppData;
    /** TCP port for firmware <-> harness. Default 18090. */
    port?: number;
    /** Overall timeout for the initial handshake + game load. Default 20s. */
    launchTimeoutMs?: number;
    /** Path to the AVM1 firmware SWF. Default .build/firmware/AVM1.swf. */
    firmwarePath?: string;
    /** Path to the Flash Player executable. Default vendor/adobe/fp-32.0.0.380.exe. */
    flashPlayerPath?: string;
}

interface PendingRequest {
    resolve: (response: Record<string, unknown>) => void;
}

export class Stagehand {
    private readonly listener: Deno.Listener;
    private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
    private readonly encoder = new TextEncoder();
    private readonly decoder = new TextDecoder();
    private readonly pending = new Map<string, PendingRequest>();
    private readonly flashPid: number | null;
    private readonly flashProcess: Deno.ChildProcess;
    private readerDone = false;
    private nextReqId = 1;
    private waitResolve: (() => void) | null = null;

    // Asset tracking — populated from the appData passed at launch, and
    // updated as firmware editData events mark assets TRIGGERED.
    private readonly assetsByIndex: Array<{ id: number; name?: string }> = [];
    private readonly assetIdByName = new Map<string, number>();
    private readonly triggeredIds = new Set<number>();

    private constructor(
        listener: Deno.Listener,
        reader: ReadableStreamDefaultReader<Uint8Array>,
        writer: WritableStreamDefaultWriter<Uint8Array>,
        flashProcess: Deno.ChildProcess,
        flashPid: number | null,
        initialBuffer: string,
        appData: AppData | undefined,
    ) {
        this.listener = listener;
        this.reader = reader;
        this.writer = writer;
        this.flashProcess = flashProcess;
        this.flashPid = flashPid;
        if (appData?.assets) {
            for (const asset of appData.assets) {
                this.assetsByIndex.push({ id: asset.id, name: asset.name });
                if (asset.name) this.assetIdByName.set(asset.name, asset.id);
            }
        }
        this.startReadPump(initialBuffer);
    }

    /**
     * Launch Flash Player, wait for the firmware to connect and the game to
     * load, then return a ready-to-use Stagehand.
     */
    static async launch(options: LaunchOptions): Promise<Stagehand> {
        const port = options.port ?? 18090;
        const launchTimeoutMs = options.launchTimeoutMs ?? 20000;
        const firmwarePath = options.firmwarePath ?? `${Deno.cwd()}/.build/firmware/AVM1.swf`;
        const flashPlayerPath = options.flashPlayerPath ?? `${Deno.cwd()}/vendor/adobe/fp-32.0.0.380.exe`;

        if (!options.swfPath && !options.swfBytes) {
            throw new Error("Stagehand.launch requires swfPath or swfBytes");
        }

        // Verify inputs exist early so errors are clear.
        await Deno.stat(firmwarePath).catch(() => {
            throw new Error(`AVM1 firmware not found: ${firmwarePath}. Run 'make avm1-build' first.`);
        });
        await Deno.stat(flashPlayerPath).catch(() => {
            throw new Error(`Flash Player not found: ${flashPlayerPath}`);
        });

        let gameData: Uint8Array;
        if (options.swfBytes) {
            gameData = options.swfBytes;
        } else {
            const swfAbs = options.swfPath!.startsWith("/") || options.swfPath!.includes(":")
                ? options.swfPath!
                : `${Deno.cwd()}/${options.swfPath!}`;
            await Deno.stat(swfAbs).catch(() => {
                throw new Error(`Game SWF not found: ${swfAbs}`);
            });
            gameData = await Deno.readFile(swfAbs);
        }
        const firmwareData = await Deno.readFile(firmwarePath);

        const listener = Deno.listen({ port });

        // Start Flash Player pointed at the firmware URL. The firmware
        // parses ?port=NNNN from its own SWF URL to decide where to open
        // its XMLSocket — without it, it falls back to the hardcoded
        // default (18081) which would miss our listener.
        const httpUrl = `http://localhost:${port}/AVM1.swf?port=${port}`;
        let flashPid: number | null = null;
        let flashProcess: Deno.ChildProcess;
        if (Deno.build.os === "windows") {
            const command = new Deno.Command("powershell", {
                args: ["-NoProfile", "-Command",
                    `$p = Start-Process -FilePath '${flashPlayerPath}' -ArgumentList '${httpUrl}' -WindowStyle Hidden -PassThru; Write-Output $p.Id`],
                cwd: Deno.cwd(), stdout: "piped",
            });
            flashProcess = command.spawn();
            const output = await new Response(flashProcess.stdout).text();
            const parsed = parseInt(output.trim());
            if (!isNaN(parsed)) flashPid = parsed;
        } else {
            const command = new Deno.Command(flashPlayerPath, { args: [httpUrl], cwd: Deno.cwd() });
            flashProcess = command.spawn();
        }

        const killFlash = () => {
            if (Deno.build.os === "windows" && flashPid !== null) {
                try { new Deno.Command("taskkill", { args: ["/F", "/PID", String(flashPid)] }).outputSync(); } catch { /* ok */ }
            }
            try { flashProcess.kill(); } catch { /* ok */ }
        };

        // Accept the SWF HTTP fetch, the Flash policy request, and finally
        // the XMLSocket connection from the firmware. Keep serving HTTP until
        // the socket connection arrives.
        const deadline = Date.now() + launchTimeoutMs;
        let socketConn: Deno.Conn | null = null;
        let socketInitialChunk = "";

        try {
            while (socketConn === null) {
                if (Date.now() > deadline) {
                    throw new Error(`Timed out during Flash Player launch after ${launchTimeoutMs}ms`);
                }
                const accept = listener.accept();
                const timer = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("accept timeout")), deadline - Date.now()),
                );
                const conn = await Promise.race([accept, timer]);

                const reader = conn.readable.getReader();
                const writer = conn.writable.getWriter();
                const decoder = new TextDecoder();
                const encoder = new TextEncoder();
                const { done, value } = await reader.read();
                if (done) { reader.releaseLock(); writer.releaseLock(); conn.close(); continue; }

                const firstChunk = decoder.decode(value);

                if (firstChunk.startsWith("GET ")) {
                    const fullPath = firstChunk.split(" ")[1];
                    const path = fullPath.split("?")[0];
                    let data: Uint8Array | null = null;
                    if (path === "/game.swf") data = gameData;
                    else if (path === "/AVM1.swf" || path === "/avm1-firmware.swf") data = firmwareData;

                    if (!data) {
                        await writer.write(encoder.encode("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
                    } else {
                        const header = `HTTP/1.1 200 OK\r\nContent-Type: application/x-shockwave-flash\r\nContent-Length: ${data.length}\r\nConnection: close\r\n\r\n`;
                        await writer.write(encoder.encode(header));
                        await writer.write(data);
                    }
                    writer.releaseLock(); reader.releaseLock(); conn.close();
                    continue;
                }

                if (firstChunk.includes("<policy-file-request/>")) {
                    await writer.write(encoder.encode(POLICY_FILE));
                    writer.releaseLock(); reader.releaseLock(); conn.close();
                    continue;
                }

                // This is the XMLSocket connection from the firmware.
                socketConn = conn;
                socketInitialChunk = firstChunk;
                // Hold onto this reader/writer — we don't release them.
                const page = new Stagehand(listener, reader, writer, flashProcess, flashPid, firstChunk, options.appData);
                // Background-serve any further SWF/policy requests (e.g. game.swf fetch
                // happens AFTER the firmware's socket connection in some modes).
                page.startHttpLoop(firmwareData, gameData);

                // Wait for the firmware "ready" event, then send setup.
                await page.waitForEvent("ready", deadline);
                await page.sendSetup(port, options.appData);
                await page.waitForEvent("gameLoaded", deadline);
                return page;
            }
            throw new Error("unreachable");
        } catch (err) {
            try { listener.close(); } catch { /* ok */ }
            killFlash();
            throw err;
        }
    }

    // -- Public API -----------------------------------------------------

    /** Evaluate a DSL formula and return the first extracted value. */
    async evaluate<T = unknown>(formula: string): Promise<T> {
        const compiled = Formula.compile(formula);
        const resp = await this.request("evaluate", { formula: compiled });
        if (!resp.success) throw new Error(`evaluate("${formula}") failed: ${JSON.stringify(resp)}`);
        return extractValue(resp.result) as T;
    }

    /** Set a property on an object reached by `path`. */
    async setValue(path: string, property: string, value: string | number | boolean | null): Promise<void> {
        const compiled = Formula.compile(path);
        const raw = value === null ? "null" : String(value);
        const resp = await this.request("setValue", { pathFormula: compiled, property, value: raw });
        if (!resp.success) throw new Error(`setValue(${path}.${property}) failed: ${JSON.stringify(resp)}`);
    }

    /**
     * Invoke a method on an object reached by `path`. The method's return
     * value is returned (unwrapped via formatOutput).
     */
    async invoke<T = unknown>(path: string, method: string, args: unknown[] = []): Promise<T> {
        const compiled = Formula.compile(path);
        const resp = await this.request("invokeMethod", { pathFormula: compiled, method, args });
        if (!resp.success) throw new Error(`invoke(${path}.${method}) failed: ${JSON.stringify(resp)}`);
        return extractValue(resp.result) as T;
    }

    /** Synthesize a click by calling `onRelease` on the target MovieClip. */
    click(path: string): Promise<unknown> {
        return this.invoke(path, "onRelease");
    }

    /**
     * Advance the game by `n` ticks. Assumes the game exposes `_root.tick`.
     * The game is responsible for making tick() the only source of
     * state advancement so tests are fully deterministic.
     */
    async tick(n = 1): Promise<void> {
        for (let i = 0; i < n; i++) await this.invoke("stage", "tick");
    }

    /**
     * Resolve a triggered-asset reference to its numeric ID. Accepts the
     * ID directly or the asset's `name` field from the loaded appData.
     */
    private resolveAssetId(idOrName: number | string): number {
        if (typeof idOrName === "number") return idOrName;
        const id = this.assetIdByName.get(idOrName);
        if (id === undefined) {
            throw new Error(`Unknown asset "${idOrName}" — not found in loaded appData`);
        }
        return id;
    }

    /** True if the firmware has emitted a TRIGGERED edit for this asset. */
    hasTriggered(idOrName: number | string): boolean {
        return this.triggeredIds.has(this.resolveAssetId(idOrName));
    }

    /** Poll until the firmware marks the asset TRIGGERED, or time out. */
    async waitTriggered(idOrName: number | string, timeoutMs = 5000): Promise<void> {
        const id = this.resolveAssetId(idOrName);
        const deadline = Date.now() + timeoutMs;
        while (!this.triggeredIds.has(id)) {
            if (this.readerDone) throw new Error(`waitTriggered(${idOrName}): firmware disconnected`);
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                throw new Error(`waitTriggered(${idOrName}) timed out after ${timeoutMs}ms`);
            }
            await new Promise<void>((resolve) => {
                this.waitResolve = resolve;
                setTimeout(resolve, Math.min(50, remaining));
            });
        }
    }

    /**
     * Poll `path` until it resolves to a truthy value — i.e., the named
     * display-list element exists. Thin wrapper over `waitFor`, used by
     * the `wait <path>` ratest step to gate clicks on element presence
     * instead of arbitrary `pause N` delays.
     */
    async waitForElement(path: string, opts: { timeoutMs?: number } = {}): Promise<void> {
        const timeoutMs = opts.timeoutMs ?? 15000;
        const pollMs = 50;
        const deadline = Date.now() + timeoutMs;
        // Firmware-side `checkElementReady` walks _parent up to gameRoot
        // and AND-folds _visible. Avoids the false-positive where the leaf
        // is _visible=true but an ancestor wrapper is hidden, which means
        // the panel is invisible to the human even though we'd consider
        // the click target ready.
        const compiled = Formula.compile(path);
        let lastReason: string | undefined;
        while (Date.now() < deadline) {
            const resp = await this.request("checkElementReady", { pathFormula: compiled });
            if (resp.success && resp.ready === true) return;
            lastReason = (resp.reason as string | undefined) ?? lastReason;
            await new Promise((r) => setTimeout(r, pollMs));
        }
        throw new Error(`waitForElement("${path}") timed out after ${timeoutMs}ms (last reason: ${lastReason ?? "unknown"})`);
    }

    /**
     * Poll `formula` every `pollMs` until `predicate(value)` returns true
     * or `timeoutMs` elapses.
     */
    async waitFor<T>(
        formula: string,
        predicate: (value: T) => boolean,
        opts: { timeoutMs?: number; pollMs?: number } = {},
    ): Promise<T> {
        const timeoutMs = opts.timeoutMs ?? 5000;
        const pollMs = opts.pollMs ?? 50;
        const deadline = Date.now() + timeoutMs;
        let last: T | undefined;
        while (Date.now() < deadline) {
            last = await this.evaluate<T>(formula);
            if (predicate(last)) return last;
            await new Promise((r) => setTimeout(r, pollMs));
        }
        throw new Error(`waitFor("${formula}") timed out after ${timeoutMs}ms (last value: ${JSON.stringify(last)})`);
    }

    /** Shut down the socket, HTTP listener, and Flash Player process. */
    async close(): Promise<void> {
        try { this.writer.releaseLock(); } catch { /* ok */ }
        try { this.reader.releaseLock(); } catch { /* ok */ }
        try { this.listener.close(); } catch { /* ok */ }
        if (Deno.build.os === "windows" && this.flashPid !== null) {
            try { new Deno.Command("taskkill", { args: ["/F", "/PID", String(this.flashPid)] }).outputSync(); } catch { /* ok */ }
        }
        try { this.flashProcess.kill(); } catch { /* ok */ }
        try { await this.flashProcess.status; } catch { /* ok */ }
    }

    // -- Internal -------------------------------------------------------

    private startReadPump(initial: string): void {
        let buffer = initial;
        const drain = (): void => {
            while (buffer.includes("\0")) {
                const idx = buffer.indexOf("\0");
                const msg = buffer.substring(0, idx);
                buffer = buffer.substring(idx + 1);
                if (msg.trim()) this.processMessage(msg);
            }
        };
        drain();
        (async () => {
            while (true) {
                try {
                    const { done, value } = await this.reader.read();
                    if (done) { this.readerDone = true; break; }
                    buffer += this.decoder.decode(value);
                    drain();
                } catch { this.readerDone = true; break; }
            }
            this.pokeWaiter();
        })();
    }

    private startHttpLoop(firmwareData: Uint8Array, gameData: Uint8Array): void {
        (async () => {
            for await (const conn of this.listener) {
                try {
                    const reader = conn.readable.getReader();
                    const writer = conn.writable.getWriter();
                    const { done, value } = await reader.read();
                    if (done) { reader.releaseLock(); writer.releaseLock(); conn.close(); continue; }
                    const firstChunk = this.decoder.decode(value);

                    if (firstChunk.startsWith("GET ")) {
                        const path = firstChunk.split(" ")[1];
                        let data: Uint8Array | null = null;
                        if (path === "/game.swf") data = gameData;
                        else if (path === "/AVM1.swf" || path === "/avm1-firmware.swf") data = firmwareData;
                        if (!data) {
                            await writer.write(this.encoder.encode("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
                        } else {
                            const header = `HTTP/1.1 200 OK\r\nContent-Type: application/x-shockwave-flash\r\nContent-Length: ${data.length}\r\nConnection: close\r\n\r\n`;
                            await writer.write(this.encoder.encode(header));
                            await writer.write(data);
                        }
                    } else if (firstChunk.includes("<policy-file-request/>")) {
                        await writer.write(this.encoder.encode(POLICY_FILE));
                    }
                    try { writer.releaseLock(); reader.releaseLock(); } catch { /* ok */ }
                    conn.close();
                } catch { /* ok, listener probably closing */ }
            }
        })();
    }

    private eventsSeen = new Set<string>();

    private processMessage(json: string): void {
        let parsed: unknown;
        try { parsed = JSON.parse(json); } catch { return; }
        if (Array.isArray(parsed) && parsed[0] === "RESPONSE") {
            const req = this.pending.get(String(parsed[1]));
            if (req) {
                this.pending.delete(String(parsed[1]));
                req.resolve(parsed[2] as Record<string, unknown>);
            }
        } else {
            const msg = parsed as { type?: string; data?: Record<string, unknown> };
            if (msg.type) this.eventsSeen.add(msg.type);
            if (msg.type === "editData") {
                // Firmware reports asset state changes via path-valued edits.
                // `assets/<index>/state` → "TRIGGERED" means the achievement
                // (or rich presence, etc.) at that array index just triggered.
                const edited = msg.data?.edited as Array<[string, unknown]> | undefined;
                if (edited) {
                    for (const [path, value] of edited) {
                        const m = /^assets\/(\d+)\/state$/.exec(path);
                        if (m && value === "TRIGGERED") {
                            const idx = parseInt(m[1]);
                            const asset = this.assetsByIndex[idx];
                            if (asset) this.triggeredIds.add(asset.id);
                        }
                    }
                }
            }
        }
        this.pokeWaiter();
    }

    private pokeWaiter(): void {
        if (this.waitResolve) {
            const r = this.waitResolve;
            this.waitResolve = null;
            r();
        }
    }

    private async waitForEvent(type: string, deadline: number): Promise<void> {
        while (!this.eventsSeen.has(type)) {
            if (this.readerDone) throw new Error(`Firmware disconnected before ${type}`);
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error(`Timed out waiting for "${type}" event`);
            await new Promise<void>((resolve) => {
                this.waitResolve = resolve;
                setTimeout(resolve, Math.min(500, remaining));
            });
        }
    }

    private async sendSetup(port: number, appData: AppData | undefined): Promise<void> {
        const data = appData ?? {
            assets: [],
            codeNotes: [],
            gameConfig: {
                title: "Stagehand Test", originUrl: "", badgeImage: "",
                hashOverride: "", scaleMode: "neutral", align: "neutral", networkRules: [],
            },
        };
        const resp = await this.request("setup", {
            data,
            gameUrl: `http://localhost:${port}/game.swf`,
            settings: {
                firmwareMode: "parent", fixTextFieldBindings: true, fixSoundAttach: true,
                benchmarkingEnabled: false, interpreterFastPath: true, avm1ExecutionMode: "interpreter",
            },
        });
        if (!resp.success) throw new Error(`setup failed: ${JSON.stringify(resp)}`);
    }

    private request(command: string, params: Record<string, unknown>, timeoutMs = 10000): Promise<Record<string, unknown>> {
        const id = `req-${this.nextReqId++}-${Date.now()}`;
        const message = JSON.stringify(["REQUEST", id, { command, params }]);
        return new Promise((resolve) => {
            this.pending.set(id, { resolve });
            this.writer.write(this.encoder.encode(message + "\0")).catch(() => {
                this.pending.delete(id);
                resolve({ success: false, error: "connection closed" });
            });
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    resolve({ success: false, error: "timeout" });
                }
            }, timeoutMs);
        });
    }
}

// Unwraps the firmware's formatOutput envelope of { output: [{ value }] }.
// formatOutput wraps strings in literal quote characters (e.g. "idle" comes
// back as the 6-char string `"idle"`) because its primary consumer is the
// RADisplay debugger. The Stagehand API returns native JS-like values,
// so we unwrap the quote wrapper here.
function extractValue(result: unknown): unknown {
    if (result && typeof result === "object" && "output" in (result as Record<string, unknown>)) {
        const output = (result as Record<string, unknown>).output;
        if (Array.isArray(output) && output.length > 0) {
            const first = output[0];
            if (first && typeof first === "object" && "value" in first) {
                return unwrapQuoted((first as { value: unknown }).value);
            }
            return first;
        }
        return output;
    }
    if (Array.isArray(result)) {
        if (result.length === 1) return unwrapQuoted(result[0]);
        return result.map(unwrapQuoted);
    }
    return unwrapQuoted(result);
}

function unwrapQuoted(v: unknown): unknown {
    if (typeof v === "string" && v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
        return v.slice(1, -1);
    }
    return v;
}
