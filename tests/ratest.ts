/**
 * .ratest — data-driven Flash integration tests.
 *
 * A .ratest file is a line-oriented script that drives a Flash game through
 * the Stagehand harness. It captures the same interactions you'd write
 * imperatively in TypeScript (click, invoke, tick, set, assert, wait) but
 * in a declarative format that non-programmers can author and review.
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
 *   port   <n>                  -- TCP port for the firmware socket
 *   timeout <ms>                -- launch timeout
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
import { type AppData, Stagehand } from "./stagehand.ts";
import { Formula } from "../RAEngine/src/formula/Formula.ts";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

type StepKind =
    | "click" | "invoke" | "tick" | "set" | "pause" | "eval"
    | "assert" | "wait"
    | "assertTriggered" | "assertNotTriggered" | "waitTriggered";

interface Step {
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

        default:
            throw new RatestParseError(lineNo, `unknown command "${cmd}"`);
    }
}

function splitOnOp(s: string): { formula: string; op: string; value: string } | null {
    let inQuote = false;
    let qChar = "";
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inQuote) {
            if (c === qChar) inQuote = false;
            continue;
        }
        if (c === '"' || c === "'") { inQuote = true; qChar = c; continue; }
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
 * A resolved game is either a SWF on disk (.swf file) or a SWF extracted
 * from an archive (.raflash). Callers pass this straight through to
 * Stagehand.launch.
 */
export interface ResolvedGame {
    /** Human-readable source path (for diagnostics). */
    source: string;
    /** Either a direct path (fast) or bytes (extracted from a zip). */
    swfPath?: string;
    swfBytes?: Uint8Array;
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
 * Extract a .raflash archive and compute its identity.
 *
 * Identity matches RAEngine's convention: `data.json.hashOverride` if
 * present, otherwise MD5 of the inner `start.swf` bytes. This is the same
 * identity used to attach achievements to a game, so a .raflash produced
 * from a .swf automatically resolves under the original .swf's hash.
 */
async function resolveRaflash(path: string): Promise<{ hash: string; swfBytes: Uint8Array } | null> {
    let files: Record<string, Uint8Array>;
    try {
        const zipData = await Deno.readFile(path);
        files = unzipSync(zipData);
    } catch {
        return null;
    }
    const swfBytes = files["start.swf"];
    if (!swfBytes) return null;

    let hashOverride: string | undefined;
    if (files["data.json"]) {
        try {
            const parsed = JSON.parse(new TextDecoder().decode(files["data.json"]));
            if (typeof parsed?.hashOverride === "string" && parsed.hashOverride !== "") {
                hashOverride = parsed.hashOverride.toLowerCase();
            }
        } catch {
            // Malformed data.json — fall back to SWF hash.
        }
    }

    const hash = hashOverride ?? await md5Bytes(swfBytes);
    return { hash, swfBytes };
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
                if (!index.has(hash)) index.set(hash, { source: path, swfPath: path });
            } else if (lower.endsWith(".raflash")) {
                const resolved = await resolveRaflash(path);
                if (resolved && !index.has(resolved.hash)) {
                    index.set(resolved.hash, { source: path, swfBytes: resolved.swfBytes });
                }
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
                lines.push(`  ${h}  ${game.source}`);
            }
        }
    }
    return lines.join("\n");
}

// -------------------------------------------------------------------------
// Achievement loading
// -------------------------------------------------------------------------

/**
 * Try to load RAFlash's on-disk achievement data for this game hash.
 *
 * The on-disk format stores source formulas (`addressA`, `addressB`,
 * RICH_PRESENCE `formula`) but not the compiled bytecode the firmware
 * needs — RAEngine normally compiles those at load time. This function
 * does the same compilation so the loaded data is firmware-ready.
 *
 * Returns null if no file is found at the conventional location.
 */
async function loadAchievements(hash: string): Promise<AppData | null> {
    const path = `.build/RACache/games/${hash}.json`;
    let text: string;
    try {
        text = await Deno.readTextFile(path);
    } catch (e) {
        if (e instanceof Deno.errors.NotFound) return null;
        throw e;
    }

    const appData = JSON.parse(text) as AppData;

    for (const asset of appData.assets ?? []) {
        // `state` is ephemeral and not persisted; RAEngine's loader always
        // initializes it to "ACTIVE" so the firmware will evaluate the asset.
        // Without this, achievements silently skip (see Main.as checkAchievements).
        (asset as Record<string, unknown>).state = "ACTIVE";

        // Rich presence assets carry a top-level formula.
        if (asset.type === "RICH_PRESENCE" && typeof asset.formula === "string") {
            (asset as Record<string, unknown>).compiledFormula = Formula.compile(asset.formula);
        }
        const groups = (asset as Record<string, unknown>).groups as
            Array<{ requirements?: Array<Record<string, unknown>> }> | undefined;
        for (const group of groups ?? []) {
            for (const req of group.requirements ?? []) {
                // Firmware expects flag to be a string (not null).
                if (req.flag == null) req.flag = "";
                if (req.hits == null) req.hits = 0;
                if (typeof req.addressA === "string" && req.addressA !== "") {
                    req.compiledA = Formula.compile(req.addressA);
                }
                if (typeof req.addressB === "string" && req.addressB !== "") {
                    req.compiledB = Formula.compile(req.addressB);
                }
            }
        }
    }

    // Fill in required stubs that the firmware expects to exist.
    if (!appData.codeNotes) appData.codeNotes = [];
    if (!appData.gameConfig) {
        appData.gameConfig = {
            title: "", originUrl: "", badgeImage: "",
            hashOverride: "", scaleMode: "neutral", align: "neutral", networkRules: [],
        };
    }
    return appData;
}

// -------------------------------------------------------------------------
// Execution
// -------------------------------------------------------------------------

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

    // Achievements are optional — if a JSON file exists at the conventional
    // RAEngine location for this hash, load it so the firmware evaluates
    // achievements and trigger tests can observe them.
    let appData: AppData | null;
    try {
        appData = await loadAchievements(parsed.directives.hash);
    } catch (err) {
        results.push({
            name: `load achievements for ${parsed.directives.hash}`,
            passed: false,
            error: (err as Error).message || String(err),
            durationMs: 0,
        });
        return finalize(filePath, results, start);
    }

    let page: Stagehand | null = null;
    try {
        page = await Stagehand.launch({
            swfPath: game.swfPath,
            swfBytes: game.swfBytes,
            appData: appData ?? undefined,
            port: parsed.directives.port,
            launchTimeoutMs: parsed.directives.timeoutMs,
        });
    } catch (err) {
        results.push({
            name: `launch hash ${parsed.directives.hash} (${game.source})`,
            passed: false,
            error: (err as Error).message || String(err),
            durationMs: 0,
        });
        return finalize(filePath, results, start);
    }

    try {
        for (const step of parsed.steps) {
            await runStep(page, step, results);
        }
    } finally {
        await page.close();
    }

    return finalize(filePath, results, start);
}

async function runStep(page: Stagehand, step: Step, results: TestResult[]): Promise<void> {
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
                const timeoutMs = step.timeoutMs ?? 5000;
                const last = await page.waitFor(
                    step.formula!,
                    (v) => compareValues(v, step.op!, step.value),
                    { timeoutMs },
                );
                results.push({
                    name,
                    passed: true,
                    durationMs: performance.now() - t0,
                    error: undefined,
                });
                void last;
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
