/**
 * AS2 Test Runner
 *
 * Connects to a Deno test server via XMLSocket, runs tests, and reports results.
 * Usage: Compiled with MTASC, run with Flash Player.
 */
class TestRunner {
    // Socket connection to Deno test server
    private static var socket:XMLSocket;
    private static var connected:Boolean = false;

    // Test results
    private static var results:Array;
    private static var passed:Number = 0;
    private static var failed:Number = 0;

    // Current test state
    private static var currentTest:String = "";
    private static var currentTestFailed:Boolean = false;
    private static var currentTestError:String = "";

    // Entry point
    public static function main():Void {
        results = [];
        socket = new XMLSocket();

        socket.onConnect = function(success:Boolean):Void {
            if (success) {
                TestRunner.connected = true;
                TestRunner.log("Connected to test server");
                TestRunner.runAllTests();
                TestRunner.reportResults();
            } else {
                trace("ERROR: Failed to connect to test server on port 9999");
                trace("Make sure the Deno test server is running.");
                fscommand("quit");
            }
        };

        socket.onClose = function():Void {
            TestRunner.connected = false;
        };

        // Connect to Deno test server
        socket.connect("localhost", 9999);
    }

    // Run all test suites
    private static function runAllTests():Void {
        // Hello World test - just to prove the system works
        test("hello world - basic assertion");
        assert(true, "basic assertion works");
        endTest();

        test("hello world - math");
        assertEqual(1 + 1, 2, "math works");
        endTest();

        test("hello world - strings");
        assertEqual("hello", "hello", "string comparison works");
        endTest();

        // JSONDiff tests
        TestJSONDiff.run();

        // Flag logic tests (Reset If, Pause If, etc.)
        TestFlags.run();
    }

    // === Test Framework ===

    public static function test(name:String):Void {
        currentTest = name;
        currentTestFailed = false;
        currentTestError = "";
    }

    public static function endTest():Void {
        if (currentTestFailed) {
            failed++;
            results.push({name: currentTest, passed: false, error: currentTestError});
            log("FAIL: " + currentTest + " - " + currentTestError);
        } else {
            passed++;
            results.push({name: currentTest, passed: true, error: ""});
            log("PASS: " + currentTest);
        }
    }

    public static function assert(condition:Boolean, message:String):Void {
        if (!condition && !currentTestFailed) {
            currentTestFailed = true;
            currentTestError = "Assertion failed: " + message;
        }
    }

    public static function assertEqual(actual, expected, message:String):Void {
        if (actual != expected && !currentTestFailed) {
            currentTestFailed = true;
            currentTestError = "assertEqual failed: " + message + " (expected " + expected + ", got " + actual + ")";
        }
    }

    public static function assertNotEqual(actual, notExpected, message:String):Void {
        if (actual == notExpected && !currentTestFailed) {
            currentTestFailed = true;
            currentTestError = "assertNotEqual failed: " + message + " (got " + actual + ")";
        }
    }

    // === Reporting ===

    private static function log(message:String):Void {
        if (connected) {
            socket.send("{\"type\":\"log\",\"message\":\"" + escapeString(message) + "\"}" + chr(0));
        }
        trace(message);
    }

    private static function reportResults():Void {
        var summary:String = "{\"type\":\"summary\",\"passed\":" + passed + ",\"failed\":" + failed + ",\"results\":[";
        for (var i:Number = 0; i < results.length; i++) {
            if (i > 0) {
                summary = summary + ",";
            }
            var r:Object = results[i];
            summary = summary + "{\"name\":\"" + escapeString(r.name) + "\",\"passed\":" + r.passed;
            if (r.error.length > 0) {
                summary = summary + ",\"error\":\"" + escapeString(r.error) + "\"";
            }
            summary = summary + "}";
        }
        summary = summary + "]}" + chr(0);

        socket.send(summary);

        // Give the socket time to send, then quit
        _root.onEnterFrame = function():Void {
            delete _root.onEnterFrame;
            fscommand("quit");
        };
    }

    private static function escapeString(s:String):String {
        var result:String = "";
        for (var i:Number = 0; i < s.length; i++) {
            var c:String = s.charAt(i);
            if (c == "\"") {
                result = result + "\\\"";
            } else if (c == "\\") {
                result = result + "\\\\";
            } else if (c == "\n") {
                result = result + "\\n";
            } else if (c == "\r") {
                result = result + "\\r";
            } else if (c == "\t") {
                result = result + "\\t";
            } else {
                result = result + c;
            }
        }
        return result;
    }
}
