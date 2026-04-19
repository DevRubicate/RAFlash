/**
 * LiveStagehand — a `StagehandLike` adapter that drives the live firmware
 * connection managed by RAEngine's Main.ts, so a `.ratest` file can play
 * back against the currently-running game instead of spawning a fresh
 * Flash Player process.
 *
 * Implements the same public surface that tests/ratest.ts's `runStep`
 * depends on (evaluate, setValue, invoke, click, tick, hasTriggered,
 * waitTriggered, waitFor, close). The concrete implementations forward
 * to `sendToFirmware()` and read firmware-maintained state off the shared
 * `AppData` singleton.
 */
import { Formula } from "./formula/Formula.ts";
import { AppData } from "./AppData.ts";
import type { StagehandLike } from "../../tests/ratest.ts";

type SendToFirmware = (
    command: string,
    params?: Record<string, unknown>,
    reconnectTimeout?: number,
) => Promise<Record<string, unknown>>;

/**
 * Fallback activation for DefineButton2 with BUTTONCONDACTION handlers.
 * AS2 exposes no API to invoke those actions, so we focus the Button and
 * post an Enter keystroke to the Flash Player window. Return true on
 * success. Omit to opt out of the fallback (click() then throws if
 * onRelease/onPress are absent).
 */
export type ActivateViaFocus = (path: string) => Promise<boolean>;

export class LiveStagehand implements StagehandLike {
    constructor(
        private readonly send: SendToFirmware,
        private readonly activateViaFocus?: ActivateViaFocus,
    ) {}

    async evaluate<T = unknown>(formula: string): Promise<T> {
        const compiled = Formula.compile(formula);
        const resp = await this.send("evaluate", { formula: compiled });
        if (!resp.success) throw new Error(`evaluate("${formula}") failed: ${resp.error ?? JSON.stringify(resp)}`);
        return extractValue(resp.result) as T;
    }

    async setValue(path: string, property: string, value: string | number | boolean | null): Promise<void> {
        const compiled = Formula.compile(path);
        const raw = value === null ? "null" : String(value);
        const resp = await this.send("setValue", { pathFormula: compiled, property, value: raw });
        if (!resp.success) throw new Error(`setValue(${path}.${property}) failed: ${resp.error ?? JSON.stringify(resp)}`);
    }

    async invoke<T = unknown>(path: string, method: string, args: unknown[] = []): Promise<T> {
        const compiled = Formula.compile(path);
        const resp = await this.send("invokeMethod", { pathFormula: compiled, method, args });
        if (!resp.success) throw new Error(`invoke(${path}.${method}) failed: ${resp.error ?? JSON.stringify(resp)}`);
        return extractValue(resp.result) as T;
    }

    async click(path: string): Promise<unknown> {
        // Fast path: AS2-assigned onRelease or onPress.
        const compiled = Formula.compile(path);
        const methods = ["onRelease", "onPress"];
        let lastError: string | undefined;
        for (const method of methods) {
            const resp = await this.send("invokeMethod", { pathFormula: compiled, method, args: [] });
            if (resp.success) return extractValue(resp.result);
            lastError = resp.error as string | undefined;
            // Only a "Not a function" failure means "try the next strategy".
            // Anything else (path not found, firmware error) is final.
            if (!lastError || lastError.indexOf("Not a function") !== 0) {
                throw new Error(`click(${path}) failed: ${lastError}`);
            }
        }
        // Fallback: DefineButton2 with a BUTTONCONDACTION can only be
        // triggered through Flash's event routing. We focus the element
        // and send an Enter keystroke via PostMessage, which triggers the
        // on(release) condition just like a real mouse-up would.
        if (this.activateViaFocus) {
            const ok = await this.activateViaFocus(path);
            if (ok) return undefined;
        }
        throw new Error(`click(${path}) failed: no onRelease/onPress handler and focus activation unavailable`);
    }

    async tick(n = 1): Promise<void> {
        for (let i = 0; i < n; i++) await this.invoke("stage", "tick");
    }

    hasTriggered(idOrName: number | string): boolean {
        const asset = resolveAsset(idOrName);
        if (!asset) throw new Error(`Unknown asset "${idOrName}"`);
        return asset.state === "TRIGGERED";
    }

    async waitTriggered(idOrName: number | string, timeoutMs = 5000): Promise<void> {
        const asset = resolveAsset(idOrName);
        if (!asset) throw new Error(`Unknown asset "${idOrName}"`);
        const deadline = Date.now() + timeoutMs;
        while (asset.state !== "TRIGGERED") {
            if (Date.now() > deadline) {
                throw new Error(`waitTriggered(${idOrName}) timed out after ${timeoutMs}ms`);
            }
            await new Promise((r) => setTimeout(r, 50));
        }
    }

    async waitFor<T = unknown>(
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

    async waitForElement(path: string, opts: { timeoutMs?: number } = {}): Promise<void> {
        const timeoutMs = opts.timeoutMs ?? 15000;
        const pollMs = 50;
        const deadline = Date.now() + timeoutMs;
        // The firmware's `checkElementReady` walks _parent up to gameRoot
        // and AND-folds _visible at every level. This catches the case
        // where the leaf is _visible=true but a wrapper ancestor is
        // _visible=false — the panel is hidden from the human even though
        // the leaf reports as visible.
        const compiled = Formula.compile(path);
        let lastReason: string | undefined;
        while (Date.now() < deadline) {
            const resp = await this.send("checkElementReady", { pathFormula: compiled });
            if (resp.success && resp.ready === true) return;
            lastReason = (resp.reason as string | undefined) ?? lastReason;
            await new Promise((r) => setTimeout(r, pollMs));
        }
        throw new Error(`waitForElement("${path}") timed out after ${timeoutMs}ms (last reason: ${lastReason ?? "unknown"})`);
    }

    close(): Promise<void> {
        // The live game stays running — nothing to tear down.
        return Promise.resolve();
    }
}

function resolveAsset(idOrName: number | string): { id: number; name?: string; state?: string } | null {
    for (const asset of AppData.data.assets) {
        if (typeof idOrName === "number" ? asset.id === idOrName : asset.name === idOrName) {
            return asset as unknown as { id: number; name?: string; state?: string };
        }
    }
    return null;
}

/**
 * The firmware's `formatOutput` helper returns `{output: [{value: V}, ...]}`
 * where string values are quoted for debugger display. Unwrap the singular
 * common case to a bare JS value so callers can compare against literals.
 * Multi-element arrays are returned as arrays of unwrapped values.
 */
function extractValue(result: unknown): unknown {
    if (result && typeof result === "object" && "output" in (result as Record<string, unknown>)) {
        const output = (result as Record<string, unknown>).output;
        if (Array.isArray(output) && output.length > 0) {
            if (output.length === 1) {
                const first = output[0];
                if (first && typeof first === "object" && "value" in first) {
                    return unwrapQuoted((first as { value: unknown }).value);
                }
                return first;
            }
            return output.map((o) =>
                o && typeof o === "object" && "value" in o
                    ? unwrapQuoted((o as { value: unknown }).value)
                    : o,
            );
        }
        return output;
    }
    return unwrapQuoted(result);
}

function unwrapQuoted(v: unknown): unknown {
    if (typeof v === "string" && v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
        return v.slice(1, -1);
    }
    return v;
}
