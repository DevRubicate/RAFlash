/**
 * AVM2Firmware Test Runner
 *
 * Connects to a Deno test server via Socket, runs tests,
 * and reports results over the wire. Mirrors the AVM1 test pattern.
 */
import flash.net.Socket;
import flash.events.Event;
import flash.events.IOErrorEvent;
import flash.events.SecurityErrorEvent;

class TestRunner {
    static var passed:Int = 0;
    static var failed:Int = 0;
    static var currentTest:String = "";
    static var currentTestFailed:Bool = false;
    static var currentTestError:String = "";
    static var socket:Socket;
    static var connected:Bool = false;
    static var results:Array<{name:String, passed:Bool, error:String}> = [];

    static function main() {
        socket = new Socket();
        socket.addEventListener(Event.CONNECT, function(_:Event) {
            connected = true;
            log("Connected to test server");
            runAllTests();
            reportResults();
        });
        socket.addEventListener(IOErrorEvent.IO_ERROR, function(e:IOErrorEvent) {
            trace("ERROR: Socket IO error: " + e.text);
        });
        socket.addEventListener(SecurityErrorEvent.SECURITY_ERROR, function(e:SecurityErrorEvent) {
            trace("ERROR: Socket security error: " + e.text);
        });
        socket.connect("127.0.0.1", 9998);
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
            log("FAIL: " + currentTest + " - " + currentTestError);
        } else {
            passed++;
            log("PASS: " + currentTest);
        }
        results.push({name: currentTest, passed: !currentTestFailed, error: currentTestError});
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

    static function log(message:String) {
        if (connected) {
            socket.writeUTFBytes('{"type":"log","message":"' + escapeString(message) + '"}\n');
        }
        trace(message);
    }

    static function reportResults() {
        var summary = '{"type":"summary","passed":' + passed + ',"failed":' + failed + ',"results":[';
        for (i in 0...results.length) {
            if (i > 0) summary += ",";
            var r = results[i];
            summary += '{"name":"' + escapeString(r.name) + '","passed":' + r.passed;
            if (r.error.length > 0) {
                summary += ',"error":"' + escapeString(r.error) + '"';
            }
            summary += "}";
        }
        summary += "]}\n";
        socket.writeUTFBytes(summary);
        socket.flush();
        // Test server kills Flash Player after receiving the summary
    }

    static function escapeString(s:String):String {
        var result = "";
        for (i in 0...s.length) {
            var c = s.charAt(i);
            if (c == '"') result += '\\"';
            else if (c == '\\') result += '\\\\';
            else if (c == '\n') result += '\\n';
            else if (c == '\r') result += '\\r';
            else if (c == '\t') result += '\\t';
            else result += c;
        }
        return result;
    }
}
