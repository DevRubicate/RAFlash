/**
 * .ratest — data-driven Flash integration tests.
 *
 * A .ratest file is a line-oriented script that drives a Flash game
 * through RAFlash's headless mode. It captures the same interactions you'd
 * write imperatively in TypeScript (click, invoke, tick, set, assert,
 * wait) but in a declarative format that non-programmers can author and
 * review.
 *
 * Execution: `runRatestFile(path)` resolves the test's `hash` directive
 * to an on-disk game, then spawns `Main.ts --headless --headless-json`
 * against it and streams per-step results back from stdout. The parser,
 * `runStep`, and `RecordedTest` live here because Main.ts's devtools
 * Play button and `runHeadlessTest` both consume them.
 *
 * Grammar (each non-blank non-comment line is one statement):
 *
 *   # comment
 *
 *   ---- Directives (must appear before actions/assertions) ----
 *   hash   <md5>                -- MD5 of the target game SWF (required);
 *                                  same identity used elsewhere in RAFlash
 *                                  to attach achievements to a game.
 *   search <dir>                -- directory to scan when resolving the
 *                                  hash to an on-disk .swf/.raflash. May
 *                                  appear multiple times. Defaults to
 *                                  .tests/ and .build/games/.
 *   port   <n>                  -- TCP base port; passed through as
 *                                  `--port` to the spawned Main.ts so
 *                                  consecutive tests don't collide.
 *   timeout <ms>                -- per-step launch timeout (advisory)
 *
 *   ---- Actions ----
 *   click   <path>              -- call path.onRelease()
 *   invoke  <path> <method> [args...]
 *                               -- call a method, args are value literals
 *   tick    [n]                 -- call stage.tick() n times (default 1)
 *   set     <path> <prop> <v>   -- write a property
 *   pause   <ms>                -- sleep
 *   eval    <formula>           -- evaluate and discard (useful for warm-up)
 *
 *   ---- Assertions (each produces one test result row) ----
 *   assert  <formula> <op> <v>  -- op: == != >= <= > <
 *   wait    <formula> <op> <v> [timeout=<ms>]
 *                               -- poll until the comparison holds
 *   assertTriggered <id|"name"> -- passes iff the firmware has marked the
 *                                  achievement/asset TRIGGERED
 *   assertNotTriggered <id|"name">
 *                               -- inverse of assertTriggered
 *   waitTriggered <id|"name"> [timeout=<ms>]
 *                               -- poll until the asset triggers
 *   achievement <id|"name">     -- assert the asset triggers within 5s of
 *                                  this point. Async: execution does NOT
 *                                  block here; a background watcher reports
 *                                  pass/fail at end of test.
 *
 *   ---- Value literals ----
 *   42         -- number
 *   3.14       -- number
 *   -1         -- number
 *   "hello"    -- string (quotes stripped)
 *   'hello'    -- string
 *   true       -- boolean
 *   false      -- boolean
 *   null       -- null
 *
 * Known limitation: a formula containing a top-level comparison operator
 * (e.g. `assert (a == b) == true`) will misparse because the splitter
 * greedily takes the first operator. In practice this is rarely needed —
 * rewrite as `assert a == b`.
 */

import { crypto as stdCrypto } from "jsr:@std/crypto";
import { unzipSync } from "npm:fflate";
import type { SuiteResult, TestResult } from "./framework.ts";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

/**
 * The public surface that `runStep` drives. Lives here (not in an
 * implementation file) because both Main.ts's devtools Play path and
 * Main.ts's headless runner feed `runStep` their own `LiveRecordedTest`
 * — the interface is the contract between them.
 */
export interface RecordedTest {
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

type StepKind =
    | "click" | "invoke" | "tick" | "set" | "pause" | "eval"
    | "assert" | "wait"
    | "assertTriggered" | "assertNotTriggered" | "waitTriggered"
    | "achievement";

export interface Step {
    lineNo: number;
    source: string;
    kind: StepKind;
    // Action-specific fields (only the ones relevant to `kind` are populated)
    path?: string;
    method?: string;
    args?: unknown[];
    count?: number;
    ms?: number;
    property?: string;
    value?: unknown;
    // Assertion-specific
    formula?: string;
    op?: string;
    timeoutMs?: number;
}

interface Directives {
    hash?: string;
    searchPaths: string[];
    port?: number;
    timeoutMs?: number;
}

const DEFAULT_SEARCH_PATHS = [".tests", ".build/games"];

export interface ParsedRatest {
    filePath: string;
    directives: Directives;
    steps: Step[];
}

const OPS = ["==", "!=", ">=", "<=", ">", "<"];

// -------------------------------------------------------------------------
// Parsing
// -------------------------------------------------------------------------

export function parseRatest(filePath: string, text: string): ParsedRatest {
    const directives: Directives = { searchPaths: [] };
    const steps: Step[] = [];
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) continue;

        const lineNo = i + 1;
        const [cmd, rest] = splitCommand(line);

        switch (cmd) {
            case "hash": {
                const h = rest.trim().toLowerCase();
                if (!/^[0-9a-f]{32}$/.test(h)) {
                    throw new RatestParseError(lineNo, `hash must be a 32-char hex MD5, got "${rest.trim()}"`);
                }
                directives.hash = h;
                continue;
            }
            case "search":
                requireArg(rest, lineNo, "search", "<directory>");
                directives.searchPaths.push(rest.trim());
                continue;
            case "port":
                directives.port = parseIntStrict(rest.trim(), lineNo, "port");
                continue;
            case "timeout":
                directives.timeoutMs = parseIntStrict(rest.trim(), lineNo, "timeout");
                continue;
        }

        steps.push(parseStep(lineNo, line, cmd, rest));
    }

    if (directives.searchPaths.length === 0) {
        directives.searchPaths = [...DEFAULT_SEARCH_PATHS];
    }

    return { filePath, directives, steps };
}

function splitCommand(line: string): [string, string] {
    const m = line.match(/^(\S+)\s*(.*)$/);
    return m ? [m[1], m[2]] : ["", ""];
}

function parseStep(lineNo: number, source: string, cmd: string, rest: string): Step {
    const base = { lineNo, source };
    switch (cmd) {
        case "click":
            requireArg(rest, lineNo, "click", "<path>");
            return { ...base, kind: "click", path: rest.trim() };

        case "invoke": {
            const tokens = tokenize(rest);
            if (tokens.length < 2) {
                throw new RatestParseError(lineNo, `invoke requires <path> <method> [args...]`);
            }
            const [path, method, ...argToks] = tokens;
            return { ...base, kind: "invoke", path, method, args: argToks.map(parseLiteral) };
        }

        case "tick": {
            const n = rest.trim() === "" ? 1 : parseIntStrict(rest.trim(), lineNo, "tick count");
            return { ...base, kind: "tick", count: n };
        }

        case "set": {
            const tokens = tokenize(rest);
            if (tokens.length < 3) {
                throw new RatestParseError(lineNo, `set requires <path> <property> <value>`);
            }
            const [path, property, ...valueToks] = tokens;
            return { ...base, kind: "set", path, property, value: parseLiteral(valueToks.join(" ")) };
        }

        case "pause":
            return { ...base, kind: "pause", ms: parseIntStrict(rest.trim(), lineNo, "pause ms") };

        case "eval":
            requireArg(rest, lineNo, "eval", "<formula>");
            return { ...base, kind: "eval", formula: rest.trim() };

        case "assert":
        case "wait": {
            let r = rest;
            let timeoutMs: number | undefined;
            if (cmd === "wait") {
                const tmatch = r.match(/\s+timeout=(\d+)\s*$/);
                if (tmatch) {
                    timeoutMs = parseInt(tmatch[1]);
                    r = r.slice(0, tmatch.index).trim();
                }
            }
            const split = splitOnOp(r);
            if (!split) {
                // `wait <path>` (no comparison op): element-polling form.
                // Blocks until the DSL path resolves to a truthy value
                // (i.e., the display-list element exists).
                if (cmd === "wait" && r.trim() !== "") {
                    return { ...base, kind: "wait", path: r.trim(), timeoutMs };
                }
                throw new RatestParseError(lineNo, `${cmd} requires a comparison: <formula> <op> <value>`);
            }
            return {
                ...base,
                kind: cmd,
                formula: split.formula,
                op: split.op,
                value: parseLiteral(split.value),
                timeoutMs,
            };
        }

        case "assertTriggered":
        case "assertNotTriggered":
        case "waitTriggered": {
            let r = rest.trim();
            let timeoutMs: number | undefined;
            if (cmd === "waitTriggered") {
                const tmatch = r.match(/\s+timeout=(\d+)\s*$/);
                if (tmatch) {
                    timeoutMs = parseInt(tmatch[1]);
                    r = r.slice(0, tmatch.index).trim();
                }
            }
            if (r === "") {
                throw new RatestParseError(lineNo, `${cmd} requires an asset id or "name"`);
            }
            const target = parseLiteral(r);
            if (typeof target !== "number" && typeof target !== "string") {
                throw new RatestParseError(lineNo, `${cmd} target must be a number or quoted string, got ${typeof target}`);
            }
            return { ...base, kind: cmd, value: target, timeoutMs };
        }

        case "achievement": {
            const r = rest.trim();
            if (r === "") {
                throw new RatestParseError(lineNo, `achievement requires an asset id or "name"`);
            }
            const target = parseLiteral(r);
            if (typeof target !== "number" && typeof target !== "string") {
                throw new RatestParseError(lineNo, `achievement target must be a number or quoted string, got ${typeof target}`);
            }
            return { ...base, kind: "achievement", value: target };
        }

        default:
            throw new RatestParseError(lineNo, `unknown command "${cmd}"`);
    }
}

function splitOnOp(s: string): { formula: string; op: string; value: string } | null {
    let inQuote = false;
    let qChar = "";
    let bracketDepth = 0;
    let parenDepth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inQuote) {
            if (c === qChar) inQuote = false;
            continue;
        }
        if (c === '"' || c === "'") { inQuote = true; qChar = c; continue; }
        if (c === "[") { bracketDepth++; continue; }
        if (c === "]") { bracketDepth--; continue; }
        if (c === "(") { parenDepth++; continue; }
        if (c === ")") { parenDepth--; continue; }
        // Only split at the *top-level* operator. A path like
        // `stage[type(this) == 'MovieClip' && ._x == 167]` has `==`
        // inside brackets/parens that belong to the path syntax, not
        // to the outer `wait`/`assert` comparison.
        if (bracketDepth > 0 || parenDepth > 0) continue;
        for (const op of OPS) {
            if (s.substring(i, i + op.length) === op) {
                return {
                    formula: s.substring(0, i).trim(),
                    op,
                    value: s.substring(i + op.length).trim(),
                };
            }
        }
    }
    return null;
}

function tokenize(s: string): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < s.length) {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (i >= s.length) break;
        if (s[i] === '"' || s[i] === "'") {
            const q = s[i];
            let j = i + 1;
            while (j < s.length && s[j] !== q) j++;
            out.push(s.substring(i, j + 1));
            i = j + 1;
        } else {
            let j = i;
            while (j < s.length && !/\s/.test(s[j])) j++;
            out.push(s.substring(i, j));
            i = j;
        }
    }
    return out;
}

function parseLiteral(s: string): unknown {
    s = s.trim();
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null") return null;
    if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
        (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
        return s.slice(1, -1);
    }
    const n = Number(s);
    if (!isNaN(n) && s !== "") return n;
    return s;
}

function parseIntStrict(s: string, lineNo: number, field: string): number {
    const n = parseInt(s);
    if (isNaN(n)) throw new RatestParseError(lineNo, `${field} must be an integer, got "${s}"`);
    return n;
}

function requireArg(s: string, lineNo: number, cmd: string, hint: string): void {
    if (s.trim() === "") throw new RatestParseError(lineNo, `${cmd} requires ${hint}`);
}

class RatestParseError extends Error {
    constructor(public lineNo: number, msg: string) {
        super(`line ${lineNo}: ${msg}`);
    }
}

// -------------------------------------------------------------------------
// Hash resolution
// -------------------------------------------------------------------------

/**
 * Result of resolving a .ratest `hash` directive to an on-disk game file.
 * Always a path (.swf or .raflash) — Main.ts's --headless mode handles
 * both transparently, including data.json.hashOverride for archives, so
 * the runner doesn't need to extract bytes itself.
 */
interface ResolvedGame {
    path: string;
}

// Cache of (search-path -> hash -> resolved-game). Built lazily and reused
// across .ratest files within the same run, so each SWF/archive in the
// search path is hashed only once per test session.
const hashIndexCache = new Map<string, Map<string, ResolvedGame>>();

async function md5Bytes(data: Uint8Array): Promise<string> {
    // Cast around stricter typings pulled in by npm:fflate — Deno.readFile
    // returns Uint8Array<ArrayBufferLike> but @std/crypto's digest signature
    // here wants Uint8Array<ArrayBuffer>. Runtime is fine in both cases.
    const buf = await stdCrypto.subtle.digest("MD5", data as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Derive the hash a .raflash archive will claim at load time. Matches
 * Main.ts: `data.json.hashOverride` if present, otherwise MD5 of the
 * inner `start.swf`.
 */
async function raflashHash(path: string): Promise<string | null> {
    let files: Record<string, Uint8Array>;
    try {
        const zipData = await Deno.readFile(path);
        files = unzipSync(zipData);
    } catch {
        return null;
    }
    const swfBytes = files["start.swf"];
    if (!swfBytes) return null;

    if (files["data.json"]) {
        try {
            const parsed = JSON.parse(new TextDecoder().decode(files["data.json"]));
            if (typeof parsed?.hashOverride === "string" && parsed.hashOverride !== "") {
                return parsed.hashOverride.toLowerCase();
            }
        } catch {
            // Malformed data.json — fall back to SWF hash.
        }
    }

    return await md5Bytes(swfBytes);
}

async function indexForSearchPath(dir: string): Promise<Map<string, ResolvedGame>> {
    const cached = hashIndexCache.get(dir);
    if (cached) return cached;

    const index = new Map<string, ResolvedGame>();
    try {
        for await (const entry of Deno.readDir(dir)) {
            if (!entry.isFile) continue;
            const lower = entry.name.toLowerCase();
            const path = `${dir}/${entry.name}`;

            if (lower.endsWith(".swf")) {
                const hash = await md5Bytes(await Deno.readFile(path));
                if (!index.has(hash)) index.set(hash, { path });
            } else if (lower.endsWith(".raflash")) {
                const hash = await raflashHash(path);
                if (hash && !index.has(hash)) index.set(hash, { path });
            }
        }
    } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    hashIndexCache.set(dir, index);
    return index;
}

async function resolveHashToGame(hash: string, searchPaths: string[]): Promise<ResolvedGame | null> {
    for (const dir of searchPaths) {
        const absDir = dir.startsWith("/") || dir.includes(":")
            ? dir
            : `${Deno.cwd()}/${dir}`;
        const index = await indexForSearchPath(absDir);
        const hit = index.get(hash);
        if (hit) return hit;
    }
    return null;
}

async function describeAvailableHashes(searchPaths: string[]): Promise<string> {
    const lines: string[] = [];
    for (const dir of searchPaths) {
        const absDir = dir.startsWith("/") || dir.includes(":")
            ? dir
            : `${Deno.cwd()}/${dir}`;
        const index = await indexForSearchPath(absDir);
        if (index.size === 0) {
            lines.push(`  ${dir}: (no .swf or .raflash files found)`);
        } else {
            for (const [h, game] of index) {
                lines.push(`  ${h}  ${game.path}`);
            }
        }
    }
    return lines.join("\n");
}

// -------------------------------------------------------------------------
// Execution — spawn headless Main.ts and stream results
// -------------------------------------------------------------------------

const DENO_PERMISSIONS = [
    "--allow-ffi", "--allow-net", "--allow-run",
    "--allow-read", "--allow-write", "--allow-env",
];

/** Deno process launch timeout — generous since firmware startup can be slow. */
const LAUNCH_TIMEOUT_MS = 60000;

export async function runRatestFile(filePath: string): Promise<SuiteResult> {
    const start = performance.now();
    const results: TestResult[] = [];

    let parsed: ParsedRatest;
    try {
        const text = await Deno.readTextFile(filePath);
        parsed = parseRatest(filePath, text);
    } catch (e) {
        results.push({ name: `parse ${filePath}`, passed: false, error: (e as Error).message, durationMs: 0 });
        return finalize(filePath, results, start);
    }

    if (!parsed.directives.hash) {
        results.push({
            name: "directives",
            passed: false,
            error: `${filePath}: missing required "hash <md5>" directive`,
            durationMs: 0,
        });
        return finalize(filePath, results, start);
    }

    const game = await resolveHashToGame(parsed.directives.hash, parsed.directives.searchPaths);
    if (!game) {
        const available = await describeAvailableHashes(parsed.directives.searchPaths);
        results.push({
            name: `resolve hash ${parsed.directives.hash}`,
            passed: false,
            error: `no .swf or .raflash with hash ${parsed.directives.hash} found in ${parsed.directives.searchPaths.join(", ")}.\nAvailable:\n${available}`,
            durationMs: 0,
        });
        return finalize(filePath, results, start);
    }

    // Spawn Main.ts in headless mode. Run with cwd=.build/ so the
    // firmware-directory probe in main() finds `firmware/` and every
    // relative path (vendor/adobe, assets/, RACache) resolves the same
    // way the shipping exe does. Game/test paths are absolutized so they
    // survive the cwd switch.
    const projectRoot = Deno.cwd();
    const buildDir = `${projectRoot}/.build`;
    const absGame = absPath(game.path, projectRoot);
    const absTest = absPath(filePath, projectRoot);

    const args = [
        "run",
        ...DENO_PERMISSIONS,
        "../RAEngine/src/Main.ts",
        "--headless",
        "--headless-json",
        absGame,
        absTest,
    ];
    if (parsed.directives.port !== undefined) {
        args.push("--port", String(parsed.directives.port));
    }

    const command = new Deno.Command("deno", {
        args,
        cwd: buildDir,
        stdout: "piped",
        stderr: "piped",
    });
    const child = command.spawn();

    // Guard against a wedged Main.ts: if it hasn't exited by the deadline,
    // kill the process so the test suite can move on. The fallback error
    // is surfaced as a single failing result row.
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch { /* already exited */ }
    }, LAUNCH_TIMEOUT_MS);

    const [stdoutText, stderrText, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.status,
    ]);
    clearTimeout(timeoutHandle);

    // Parse stdout for JSON event lines. Any other output (plain logs,
    // warnings, blank lines) is ignored — the contract is that every
    // headless-mode step and summary event is a JSON line with a `type`
    // field. If the process failed without emitting any, surface stderr
    // as the failure reason.
    let summary: { passed: number; failed: number; durationMs: number } | null = null;
    for (const line of stdoutText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        let event: unknown;
        try {
            event = JSON.parse(trimmed);
        } catch {
            continue;
        }
        const e = event as { type?: string };
        if (e.type === "step") {
            const s = event as { name: string; passed: boolean; error: string | null; durationMs: number };
            results.push({
                name: s.name,
                passed: s.passed,
                error: s.error ?? undefined,
                durationMs: s.durationMs,
            });
        } else if (e.type === "summary") {
            summary = event as { passed: number; failed: number; durationMs: number };
        }
    }

    if (!summary || status.code !== 0 || timedOut) {
        // Runner-level failure: the child crashed, timed out, or never
        // emitted a summary. Attach whatever diagnostic context we have.
        const reason = timedOut
            ? `headless run exceeded ${LAUNCH_TIMEOUT_MS}ms`
            : !summary
                ? `headless run exited with code ${status.code} without emitting a summary`
                : `headless run exited with code ${status.code}`;
        const detail = stderrText.trim();
        results.push({
            name: `headless ${parsed.directives.hash}`,
            passed: false,
            error: detail ? `${reason}\n${detail}` : reason,
            durationMs: 0,
        });
    }

    return finalize(filePath, results, start);
}

function absPath(p: string, base: string): string {
    if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return p;
    return `${base}/${p}`;
}

/**
 * Per-run state for `achievement` steps. The `achievement` kind is
 * inherently async: it kicks off a 5s background watcher and the step
 * completes immediately so subsequent steps can keep playing the game.
 * The caller owns the promise list so it can drain (await + report) at
 * end of run, and so it knows which step indices produced deferred
 * outcomes.
 *
 * `achievementsEnabled: false` makes `achievement` steps a no-op (they
 * appear in the file but do not assert anything), matching the Recorded
 * Test view's "Achievements: No" toggle.
 */
export interface RunContext {
    achievementsEnabled?: boolean;
    pendingAchievements?: Array<Promise<void>>;
    onAchievementOutcome?: (target: number | string, passed: boolean, error: string | undefined, durationMs: number) => void;
}

export async function runStep(page: RecordedTest, step: Step, results: TestResult[], ctx: RunContext = {}): Promise<void> {
    const t0 = performance.now();
    const name = `${step.source}`;
    try {
        switch (step.kind) {
            case "click":
                await page.click(step.path!);
                return;
            case "invoke":
                await page.invoke(step.path!, step.method!, step.args ?? []);
                return;
            case "tick":
                await page.tick(step.count ?? 1);
                return;
            case "set":
                await page.setValue(step.path!, step.property!, step.value as string | number | boolean | null);
                return;
            case "pause":
                await new Promise((r) => setTimeout(r, step.ms ?? 0));
                return;
            case "eval":
                await page.evaluate(step.formula!);
                return;
            case "assert": {
                const actual = await page.evaluate(step.formula!);
                const ok = compareValues(actual, step.op!, step.value);
                results.push({
                    name,
                    passed: ok,
                    error: ok ? undefined : `got ${formatValue(actual)}, expected ${step.op} ${formatValue(step.value)}`,
                    durationMs: performance.now() - t0,
                });
                return;
            }
            case "wait": {
                if (step.path != null) {
                    // Element-polling form: wait until the path resolves.
                    await page.waitForElement(step.path, { timeoutMs: step.timeoutMs ?? 15000 });
                } else {
                    // Formula-polling form: wait until the comparison holds.
                    const last = await page.waitFor(
                        step.formula!,
                        (v) => compareValues(v, step.op!, step.value),
                        { timeoutMs: step.timeoutMs ?? 5000 },
                    );
                    void last;
                }
                results.push({
                    name,
                    passed: true,
                    durationMs: performance.now() - t0,
                    error: undefined,
                });
                return;
            }
            case "assertTriggered": {
                const ok = page.hasTriggered(step.value as number | string);
                results.push({
                    name,
                    passed: ok,
                    error: ok ? undefined : `asset ${formatValue(step.value)} has not triggered`,
                    durationMs: performance.now() - t0,
                });
                return;
            }
            case "assertNotTriggered": {
                const triggered = page.hasTriggered(step.value as number | string);
                results.push({
                    name,
                    passed: !triggered,
                    error: triggered ? `asset ${formatValue(step.value)} unexpectedly triggered` : undefined,
                    durationMs: performance.now() - t0,
                });
                return;
            }
            case "waitTriggered": {
                const timeoutMs = step.timeoutMs ?? 5000;
                await page.waitTriggered(step.value as number | string, timeoutMs);
                results.push({
                    name,
                    passed: true,
                    durationMs: performance.now() - t0,
                    error: undefined,
                });
                return;
            }
            case "achievement": {
                const target = step.value as number | string;
                if (ctx.achievementsEnabled === false) {
                    return;
                }
                const stepStart = t0;
                const promise = (async () => {
                    let passed = true;
                    let err: string | undefined;
                    try {
                        await page.waitTriggered(target, 5000);
                    } catch (e) {
                        passed = false;
                        err = (e as Error).message || String(e);
                    }
                    const durationMs = performance.now() - stepStart;
                    results.push({ name, passed, error: err, durationMs });
                    ctx.onAchievementOutcome?.(target, passed, err, durationMs);
                })();
                if (ctx.pendingAchievements) {
                    ctx.pendingAchievements.push(promise);
                } else {
                    // Standalone callers without a tracker still get correct
                    // semantics — we just block on the watcher in-line.
                    await promise;
                }
                return;
            }
        }
    } catch (err) {
        // Actions that would otherwise be silent still surface errors as failures.
        results.push({
            name,
            passed: false,
            error: (err as Error).message || String(err),
            durationMs: performance.now() - t0,
        });
    }
}

function compareValues(a: unknown, op: string, b: unknown): boolean {
    // The Formula DSL is collection-oriented — every value is an array.
    // The firmware's extractValue auto-unwraps singletons, so by the time
    // we get here a scalar test should already be a bare value. A surviving
    // array means the formula evaluated to an empty result (length 0) or
    // matched multiple objects (length > 1) — comparing that against a
    // literal silently returns false via JS coercion rules ("1,2" == 12 is
    // false), which masks the actual problem (DSL ambiguity).
    if (Array.isArray(a)) {
        throw new Error(`expected a scalar, got array of length ${a.length}: ${JSON.stringify(a)}`);
    }
    switch (op) {
        case "==": return a == b;
        case "!=": return a != b;
        case ">=": return (a as number) >= (b as number);
        case "<=": return (a as number) <= (b as number);
        case ">":  return (a as number) >  (b as number);
        case "<":  return (a as number) <  (b as number);
    }
    return false;
}

function formatValue(v: unknown): string {
    if (typeof v === "string") return JSON.stringify(v);
    return String(v);
}

function finalize(filePath: string, results: TestResult[], start: number): SuiteResult {
    return {
        name: filePath,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        results,
        durationMs: performance.now() - start,
    };
}

// -------------------------------------------------------------------------
// Discovery — run all *.ratest files under a directory
// -------------------------------------------------------------------------

export async function discoverRatestFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith(".ratest")) {
            files.push(`${dir}/${entry.name}`);
        }
    }
    files.sort();
    return files;
}
