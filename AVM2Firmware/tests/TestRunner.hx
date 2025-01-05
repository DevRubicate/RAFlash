/**
 * AVM2Firmware Test Runner
 *
 * Basic test framework for Haxe, compiled to Neko VM.
 * Mirrors the test pattern from AVM1Firmware.
 */
class TestRunner {
    static var passed:Int = 0;
    static var failed:Int = 0;
    static var currentTest:String = "";
    static var currentTestFailed:Bool = false;
    static var currentTestError:String = "";

    static function main() {
        runAllTests();
        reportResults();
    }

    static function runAllTests() {
        // Hello World tests - prove the system works
        test("hello world - basic assertion");
        assert(true, "basic assertion works");
        endTest();

        test("hello world - math works");
        assertEqual(1 + 1, 2, "math works");
        endTest();

        test("hello world - strings");
        assertEqual("hello", "hello", "string comparison works");
        endTest();

        // Domain logic tests
        TestEvaluate.run();
        // JSONDiff tests skipped: applyDataDiff uses untyped dynamic field
        // access (obj[key] = val) which only works on Flash target, not Neko.
    }

    // === Test Framework ===

    public static function test(name:String) {
        currentTest = name;
        currentTestFailed = false;
        currentTestError = "";
    }

    public static function endTest() {
        if (currentTestFailed) {
            failed++;
            trace("FAIL: " + currentTest + " - " + currentTestError);
        } else {
            passed++;
            trace("PASS: " + currentTest);
        }
    }

    public static function assert(condition:Bool, message:String) {
        if (!condition && !currentTestFailed) {
            currentTestFailed = true;
            currentTestError = "Assertion failed: " + message;
        }
    }

    public static function assertEqual(actual:Dynamic, expected:Dynamic, message:String) {
        if (actual != expected && !currentTestFailed) {
            currentTestFailed = true;
            currentTestError = "assertEqual failed: " + message + " (expected " + expected + ", got " + actual + ")";
        }
    }

    public static function assertNotEqual(actual:Dynamic, notExpected:Dynamic, message:String) {
        if (actual == notExpected && !currentTestFailed) {
            currentTestFailed = true;
            currentTestError = "assertNotEqual failed: " + message + " (got " + actual + ")";
        }
    }

    // === Reporting ===

    static function reportResults() {
        trace("");
        trace("──────────────────────────────────────────────────");
        trace("");

        var total = passed + failed;
        if (failed == 0) {
            trace("All " + total + " tests passed");
            Sys.exit(0);
        } else {
            trace(failed + " of " + total + " tests failed");
            Sys.exit(1);
        }
    }
}
