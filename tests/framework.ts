/**
 * RAFlash Test Framework
 *
 * Minimal test API used by all TypeScript test files. Tests register
 * themselves via test() into a module-level queue. The runner imports
 * each test file (triggering registration), then calls getRegisteredTests()
 * to collect and execute them.
 */

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export interface TestCase {
    name: string;
    fn: () => void | Promise<void>;
}

export interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
    durationMs: number;
}

export interface SuiteResult {
    name: string;
    passed: number;
    failed: number;
    results: TestResult[];
    durationMs: number;
}

// -------------------------------------------------------------------------
// Test registration
// -------------------------------------------------------------------------

const pendingTests: TestCase[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
    pendingTests.push({ name, fn });
}

/**
 * Returns all registered tests and clears the queue.
 * Called by the runner after dynamically importing a test file.
 */
export function getRegisteredTests(): TestCase[] {
    const tests = [...pendingTests];
    pendingTests.length = 0;
    return tests;
}

// -------------------------------------------------------------------------
// Assertions
// -------------------------------------------------------------------------

export function assertEqual(actual: unknown, expected: unknown, message?: string): void {
    if (!deepEqual(actual, expected)) {
        const msg = message
            ? `${message}: expected ${format(expected)}, got ${format(actual)}`
            : `Expected ${format(expected)}, got ${format(actual)}`;
        throw new Error(msg);
    }
}

export function assertNotEqual(actual: unknown, expected: unknown, message?: string): void {
    if (deepEqual(actual, expected)) {
        const msg = message
            ? `${message}: expected values to differ, both are ${format(actual)}`
            : `Expected values to differ, both are ${format(actual)}`;
        throw new Error(msg);
    }
}

export function assertThrows(
    fn: () => void,
    errorClassOrMessage?: (new (...args: unknown[]) => Error) | string,
    msgIncludes?: string,
): void {
    // Handle overloads: assertThrows(fn, ErrorClass, msg) or assertThrows(fn, msg)
    let ErrorClass: (new (...args: unknown[]) => Error) | undefined;
    let includesStr: string | undefined;

    if (typeof errorClassOrMessage === "string") {
        includesStr = errorClassOrMessage;
    } else if (typeof errorClassOrMessage === "function") {
        ErrorClass = errorClassOrMessage;
        includesStr = msgIncludes;
    }

    let threw = false;
    try {
        fn();
    } catch (e) {
        threw = true;
        if (ErrorClass && !(e instanceof ErrorClass)) {
            throw new Error(
                `Expected ${ErrorClass.name} but got ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`,
            );
        }
        if (includesStr && !(e as Error).message?.includes(includesStr)) {
            throw new Error(
                `Expected error message to include "${includesStr}", got "${(e as Error).message}"`,
            );
        }
    }
    if (!threw) {
        throw new Error("Expected function to throw, but it did not");
    }
}

// -------------------------------------------------------------------------
// Deep equality
// -------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;

    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === "number" && typeof b === "number") {
        // Handle NaN equality
        if (Number.isNaN(a) && Number.isNaN(b)) return true;
        return a === b;
    }

    if (typeof a !== "object") return false;

    // Arrays
    if (Array.isArray(a)) {
        if (!Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }
    if (Array.isArray(b)) return false;

    // Plain objects
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
        if (!deepEqual(aObj[key], bObj[key])) return false;
    }

    return true;
}

function format(value: unknown): string {
    if (typeof value === "string") return JSON.stringify(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
