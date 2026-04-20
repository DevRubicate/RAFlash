/**
 * RAFlash Unified Test Runner
 *
 * Single entry point for all test suites. Orchestrates TypeScript tests
 * (RAEngine, RADisplay), Flash Player tests (AVM1, AVM2), and the
 * integration test with consistent output and a unified summary.
 *
 * Usage:
 *   deno run --allow-all tests/run.ts              # run all suites
 *   deno run --allow-all tests/run.ts engine        # RAEngine only
 *   deno run --allow-all tests/run.ts avm1 avm2     # multiple suites
 *
 * Suite names: avm1, avm2, engine, display, integration, recorded-test
 */

import { getRegisteredTests, type SuiteResult, type TestResult } from "./framework.ts";
import { runFlashSuite } from "./flash-suite.ts";

// -------------------------------------------------------------------------
// Output formatting
// -------------------------------------------------------------------------

function printSuiteHeader(name: string): void {
    console.log("");
    console.log(`=== ${name} ===`);
}

function printResult(result: TestResult): void {
    if (result.passed) {
        console.log(`  PASS  ${result.name}`);
    } else {
        console.log(`  FAIL  ${result.name}`);
        if (result.error) {
            console.log(`        ${result.error}`);
        }
    }
}

function printSuiteFooter(suite: SuiteResult): void {
    const total = suite.passed + suite.failed;
    const time = (suite.durationMs / 1000).toFixed(1);
    if (suite.failed === 0) {
        console.log(`  ${total} passed (${time}s)`);
    } else {
        console.log(`  ${suite.failed} failed, ${suite.passed} passed (${time}s)`);
    }
}

function printSummary(suites: SuiteResult[]): void {
    console.log("");
    console.log(`=== SUMMARY ===`);

    let totalPassed = 0;
    let totalFailed = 0;
    let totalTime = 0;

    for (const suite of suites) {
        totalPassed += suite.passed;
        totalFailed += suite.failed;
        totalTime += suite.durationMs;

        const count = suite.passed + suite.failed;
        const time = (suite.durationMs / 1000).toFixed(1);
        const failStr = suite.failed > 0 ? `${suite.failed} failed` : "";
        console.log(`  ${suite.name.padEnd(20)} ${String(count).padStart(4)} tests   ${`${suite.passed} passed`.padEnd(12)} ${failStr}  ${time}s`);
    }

    const totalCount = totalPassed + totalFailed;
    const totalTimeStr = (totalTime / 1000).toFixed(1);
    const failStr = totalFailed > 0 ? `${totalFailed} failed` : "";
    console.log(`  ${"Total".padEnd(20)} ${String(totalCount).padStart(4)} tests   ${`${totalPassed} passed`.padEnd(12)} ${failStr}  ${totalTimeStr}s`);
    console.log("");
}

// -------------------------------------------------------------------------
// TS suite runner (RAEngine, RADisplay)
// -------------------------------------------------------------------------

async function runTSSuite(name: string, testFiles: string[]): Promise<SuiteResult> {
    const start = performance.now();
    const allResults: TestResult[] = [];

    printSuiteHeader(name);

    for (const file of testFiles) {
        // Dynamically import the test file — this triggers test() registration
        const fileUrl = new URL(`../${file}`, import.meta.url).href;
        await import(fileUrl);

        // Collect registered tests
        const tests = getRegisteredTests();

        // Execute each test
        for (const t of tests) {
            const testStart = performance.now();

            // Suppress console.error during test execution to hide
            // intentional error output from code under test
            const origError = console.error;
            console.error = () => {};

            let result: TestResult;
            let wasAsync = false;
            try {
                const ret = t.fn();
                if (ret && typeof (ret as Promise<void>).then === "function") {
                    wasAsync = true;
                    await ret;
                }
                result = { name: t.name, passed: true, durationMs: performance.now() - testStart };
            } catch (e) {
                result = {
                    name: t.name,
                    passed: false,
                    error: (e as Error).message || String(e),
                    durationMs: performance.now() - testStart,
                };
            } finally {
                console.error = origError;
            }

            printResult(result);
            allResults.push(result);

            // Allow OS to release socket ports between async tests
            // (prevents EADDRINUSE when consecutive tests bind the same port)
            if (wasAsync) {
                await new Promise((r) => setTimeout(r, 50));
            }
        }
    }

    const suite: SuiteResult = {
        name,
        passed: allResults.filter((r) => r.passed).length,
        failed: allResults.filter((r) => !r.passed).length,
        results: allResults,
        durationMs: performance.now() - start,
    };

    printSuiteFooter(suite);
    return suite;
}

// -------------------------------------------------------------------------
// Suite definitions
// -------------------------------------------------------------------------

const SUITES: Record<string, () => Promise<SuiteResult>> = {
    avm1: async () => {
        printSuiteHeader("AVM1 Unit Tests");
        const result = await runFlashSuite({
            port: 9999,
            swfPath: ".tests/AVM1Tests.swf",
            delimiter: "\0",
            onResult: printResult,
        });
        result.name = "AVM1 Unit Tests";
        printSuiteFooter(result);
        return result;
    },

    avm2: async () => {
        printSuiteHeader("AVM2 Unit Tests");
        const result = await runFlashSuite({
            port: 9998,
            swfPath: ".tests/AVM2Tests.swf",
            delimiter: "\n",
            onResult: printResult,
        });
        result.name = "AVM2 Unit Tests";
        printSuiteFooter(result);
        return result;
    },

    engine: () => runTSSuite("RAEngine", [
        "RAEngine/tests/Formula.test.ts",
        "RAEngine/tests/Lexer.test.ts",
        "RAEngine/tests/Parser.test.ts",
        "RAEngine/tests/Builder.test.ts",
        "RAEngine/tests/Compile.test.ts",
        "RAEngine/tests/Formula.compile.test.ts",
        "RAEngine/tests/JSONDiff.test.ts",
        "RAEngine/tests/AppData.test.ts",
        "RAEngine/tests/UserProfile.test.ts",
        "RAEngine/tests/SWFWriter.test.ts",
        "RAEngine/tests/AVM1Builder.test.ts",
        "RAEngine/tests/AVM2Builder.test.ts",
        "RAEngine/tests/AVM2Injector.test.ts",
        "RAEngine/tests/NativeEvalCompiler.test.ts",
        "RAEngine/tests/NativeEvalCompilerAVM2.test.ts",
        "RAEngine/tests/SitelockProxy.test.ts",
        "RAEngine/tests/NetworkBehavior.test.ts",
        "RAEngine/tests/detectPattern.test.ts",
        "RAEngine/tests/Lexer.edge.test.ts",
        "RAEngine/tests/Parser.edge.test.ts",
        "RAEngine/tests/Builder.edge.test.ts",
        "RAEngine/tests/UserProfile.edge.test.ts",
        "RAEngine/tests/SitelockProxy.edge.test.ts",
        "RAEngine/tests/NetworkBehavior.edge.test.ts",
        "RAEngine/tests/Formula.compile.edge.test.ts",
    ]),

    display: () => runTSSuite("RADisplay", [
        "RADisplay/tests/JSONDiff.test.ts",
    ]),

    integration: async () => {
        printSuiteHeader("Integration");
        const { runIntegrationTests } = await import("../AVM1Firmware/tests/integration-harness.ts");
        const result: SuiteResult = await runIntegrationTests(`${Deno.cwd()}/.tests/IntegrationGame.swf`);
        result.name = "Integration";
        // Print results that the harness collected
        for (const r of result.results) {
            printResult(r);
        }
        printSuiteFooter(result);
        return result;
    },

    "recorded-test": async () => {
        printSuiteHeader("Recorded Test");
        const { runRatestFile, discoverRatestFiles } = await import("./ratest.ts");
        const files = await discoverRatestFiles(`${Deno.cwd()}/tests/ratests`);
        const allResults: TestResult[] = [];
        const start = performance.now();
        for (const file of files) {
            const fileResult = await runRatestFile(file);
            const rel = file.split(/[\\/]/).pop() ?? file;
            console.log(`  ${rel}`);
            for (const r of fileResult.results) {
                printResult(r);
                allResults.push(r);
            }
            // Stop after the first file with failures for faster feedback.
            if (fileResult.failed > 0) break;
        }
        const combined: SuiteResult = {
            name: "Recorded Test",
            passed: allResults.filter((r) => r.passed).length,
            failed: allResults.filter((r) => !r.passed).length,
            results: allResults,
            durationMs: performance.now() - start,
        };
        printSuiteFooter(combined);
        return combined;
    },
};

// Default order when running all suites
const DEFAULT_ORDER = ["avm1", "avm2", "engine", "display", "integration", "recorded-test"];

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------

const args = Deno.args.map((a) => a.toLowerCase());
const suitesToRun = args.length > 0
    ? args.filter((a) => a in SUITES)
    : DEFAULT_ORDER;

if (suitesToRun.length === 0) {
    console.error(`Unknown suite(s): ${args.join(", ")}`);
    console.error(`Available: ${Object.keys(SUITES).join(", ")}`);
    Deno.exit(2);
}

const results: SuiteResult[] = [];
for (const suiteName of suitesToRun) {
    const result = await SUITES[suiteName]();
    results.push(result);

    // Fail fast: stop on first suite failure
    if (result.failed > 0) break;
}

printSummary(results);

const totalFailed = results.reduce((sum, s) => sum + s.failed, 0);
Deno.exit(totalFailed > 0 ? 1 : 0);
