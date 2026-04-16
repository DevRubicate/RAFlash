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
 * Suite names: avm1, avm2, engine, display, integration
 */

import { getRegisteredTests, type SuiteResult, type TestResult } from "./framework.ts";
import { runFlashSuite } from "./flash-suite.ts";

// -------------------------------------------------------------------------
// Output formatting
// -------------------------------------------------------------------------

const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
};

function printSuiteHeader(name: string): void {
    console.log("");
    console.log(`${colors.bold}\u2550`.repeat(50) + colors.reset);
    console.log(`${colors.bold}  ${name}${colors.reset}`);
    console.log(`${colors.bold}\u2550`.repeat(50) + colors.reset);
}

function printResult(result: TestResult): void {
    if (result.passed) {
        console.log(`  ${colors.green}PASS${colors.reset}  ${result.name}`);
    } else {
        console.log(`  ${colors.red}FAIL${colors.reset}  ${result.name}`);
        if (result.error) {
            console.log(`        ${colors.dim}${result.error}${colors.reset}`);
        }
    }
}

function printSuiteFooter(suite: SuiteResult): void {
    const total = suite.passed + suite.failed;
    const time = (suite.durationMs / 1000).toFixed(1);
    if (suite.failed === 0) {
        console.log(`  ${colors.green}${total} passed${colors.reset} ${colors.dim}(${time}s)${colors.reset}`);
    } else {
        console.log(`  ${colors.red}${suite.failed} failed${colors.reset}, ${colors.green}${suite.passed} passed${colors.reset} ${colors.dim}(${time}s)${colors.reset}`);
    }
}

function printSummary(suites: SuiteResult[]): void {
    console.log("");
    console.log(`${colors.bold}\u2550`.repeat(50) + colors.reset);
    console.log(`${colors.bold}  SUMMARY${colors.reset}`);
    console.log(`${colors.bold}\u2550`.repeat(50) + colors.reset);

    let totalPassed = 0;
    let totalFailed = 0;
    let totalTime = 0;

    for (const suite of suites) {
        totalPassed += suite.passed;
        totalFailed += suite.failed;
        totalTime += suite.durationMs;

        const count = suite.passed + suite.failed;
        const time = (suite.durationMs / 1000).toFixed(1);
        const nameCol = suite.name.padEnd(20);
        const passStr = `${suite.passed} passed`.padEnd(12);
        const failStr = suite.failed > 0
            ? `${colors.red}${suite.failed} failed${colors.reset}`
            : "";

        console.log(`  ${nameCol} ${count.toString().padStart(4)} tests   ${passStr} ${failStr}  ${colors.dim}${time}s${colors.reset}`);
    }

    console.log(`  ${"─".repeat(48)}`);

    const totalCount = totalPassed + totalFailed;
    const totalTimeStr = (totalTime / 1000).toFixed(1);

    if (totalFailed === 0) {
        console.log(`  ${colors.green}${colors.bold}Total${colors.reset}${" ".repeat(15)} ${totalCount.toString().padStart(4)} tests   ${totalPassed} passed               ${colors.dim}${totalTimeStr}s${colors.reset}`);
    } else {
        console.log(`  ${colors.red}${colors.bold}Total${colors.reset}${" ".repeat(15)} ${totalCount.toString().padStart(4)} tests   ${totalPassed} passed   ${colors.red}${totalFailed} failed${colors.reset}  ${colors.dim}${totalTimeStr}s${colors.reset}`);
    }
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
        "RAEngine/tests/hello.test.ts",
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
        "RAEngine/tests/NativeEvalCompiler.test.ts",
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
        "RADisplay/tests/hello.test.ts",
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
};

// Default order when running all suites
const DEFAULT_ORDER = ["avm1", "avm2", "engine", "display", "integration"];

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
