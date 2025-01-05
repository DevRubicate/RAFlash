/**
 * Unit tests for Evaluate.hx bytecode interpreter.
 *
 * Tests arithmetic, comparisons, broadcasting, ternary, and property access
 * using plain Dynamic objects (no Flash runtime needed).
 */
class TestEvaluate {

    static function eval(bytecode:Array<Dynamic>, ?context:Array<Dynamic>, ?keys:Array<Dynamic>, ?gameRoot:Dynamic):Array<Dynamic> {
        if (context == null) context = [];
        if (keys == null) keys = [];
        return Evaluate.evaluate(bytecode, 0, bytecode.length, context, keys, gameRoot);
    }

    public static function run() {
        // === Literals & Stack ===

        TestRunner.test("Evaluate - VALUE pushes number");
        var r = eval(["VALUE", "42"]);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 42, "value is 42");
        TestRunner.endTest();

        TestRunner.test("Evaluate - STRING pushes string");
        var r = eval(["STRING", "hello"]);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], "hello", "value is hello");
        TestRunner.endTest();

        TestRunner.test("Evaluate - NULL pushes null");
        var r = eval(["NULL"]);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], null, "value is null");
        TestRunner.endTest();

        // === Arithmetic (scalar × scalar) ===

        TestRunner.test("Evaluate - ADD two scalars");
        var r = eval(["VALUE", "3", "VALUE", "4", "ADD"]);
        TestRunner.assertEqual(r[0], 7, "3 + 4 = 7");
        TestRunner.endTest();

        TestRunner.test("Evaluate - SUB two scalars");
        var r = eval(["VALUE", "10", "VALUE", "3", "SUB"]);
        TestRunner.assertEqual(r[0], 7, "10 - 3 = 7");
        TestRunner.endTest();

        TestRunner.test("Evaluate - MUL two scalars");
        var r = eval(["VALUE", "6", "VALUE", "7", "MUL"]);
        TestRunner.assertEqual(r[0], 42, "6 * 7 = 42");
        TestRunner.endTest();

        TestRunner.test("Evaluate - DIV two scalars");
        var r = eval(["VALUE", "20", "VALUE", "4", "DIV"]);
        TestRunner.assertEqual(r[0], 5, "20 / 4 = 5");
        TestRunner.endTest();

        TestRunner.test("Evaluate - MOD two scalars");
        var r = eval(["VALUE", "10", "VALUE", "3", "MOD"]);
        TestRunner.assertEqual(r[0], 1, "10 % 3 = 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - POW two scalars");
        var r = eval(["VALUE", "2", "VALUE", "8", "POW"]);
        TestRunner.assertEqual(r[0], 256, "2 ^ 8 = 256");
        TestRunner.endTest();

        // === String concatenation via ADD ===

        TestRunner.test("Evaluate - ADD concatenates strings");
        var r = eval(["STRING", "hello", "STRING", " world", "ADD"]);
        TestRunner.assertEqual(r[0], "hello world", "string concat");
        TestRunner.endTest();

        TestRunner.test("Evaluate - ADD string + number concatenates");
        var r = eval(["STRING", "score: ", "VALUE", "100", "ADD"]);
        TestRunner.assertEqual(r[0], "score: 100", "string + number concat");
        TestRunner.endTest();

        // === Comparisons (return 1 or 0) ===

        TestRunner.test("Evaluate - EQUAL true");
        var r = eval(["VALUE", "5", "VALUE", "5", "EQUAL"]);
        TestRunner.assertEqual(r[0], 1, "5 == 5 is 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - EQUAL false");
        var r = eval(["VALUE", "5", "VALUE", "3", "EQUAL"]);
        TestRunner.assertEqual(r[0], 0, "5 == 3 is 0");
        TestRunner.endTest();

        TestRunner.test("Evaluate - NOT_EQUAL true");
        var r = eval(["VALUE", "5", "VALUE", "3", "NOT_EQUAL"]);
        TestRunner.assertEqual(r[0], 1, "5 != 3 is 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - GREATER true");
        var r = eval(["VALUE", "10", "VALUE", "5", "GREATER"]);
        TestRunner.assertEqual(r[0], 1, "10 > 5 is 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - GREATER false");
        var r = eval(["VALUE", "3", "VALUE", "5", "GREATER"]);
        TestRunner.assertEqual(r[0], 0, "3 > 5 is 0");
        TestRunner.endTest();

        TestRunner.test("Evaluate - GREATER_EQUAL equal case");
        var r = eval(["VALUE", "5", "VALUE", "5", "GREATER_EQUAL"]);
        TestRunner.assertEqual(r[0], 1, "5 >= 5 is 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LESSER true");
        var r = eval(["VALUE", "3", "VALUE", "5", "LESSER"]);
        TestRunner.assertEqual(r[0], 1, "3 < 5 is 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LESSER_EQUAL equal case");
        var r = eval(["VALUE", "5", "VALUE", "5", "LESSER_EQUAL"]);
        TestRunner.assertEqual(r[0], 1, "5 <= 5 is 1");
        TestRunner.endTest();

        // === Null comparisons ===

        TestRunner.test("Evaluate - EQUAL null vs empty array returns 1");
        // null == [] should return 1 (null means "empty")
        // We need to set up context as empty array and compare with null
        // Bytecode: push [null], push context (which is []), EQUAL
        // Actually: EQUAL with null checks if other side is empty array
        // The null check in evaluate: if b=[null], check a.length==0
        // So we need a on stack to be empty. READ_GLOBAL "this" with empty context gives []
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "NULL", "EQUAL"]);
        TestRunner.assertEqual(r[0], 1, "[] == null is 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - NOT_EQUAL null vs non-empty returns 1");
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "NULL", "NOT_EQUAL"], [42]);
        TestRunner.assertEqual(r[0], 1, "[42] != null is 1");
        TestRunner.endTest();

        // === Boolean operators ===

        TestRunner.test("Evaluate - AND true true");
        var r = eval(["VALUE", "1", "VALUE", "1", "AND"]);
        TestRunner.assertEqual(r[0], 1, "1 AND 1 = 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - AND true false");
        var r = eval(["VALUE", "1", "VALUE", "0", "AND"]);
        TestRunner.assertEqual(r[0], 0, "1 AND 0 = 0");
        TestRunner.endTest();

        TestRunner.test("Evaluate - OR false false");
        var r = eval(["VALUE", "0", "VALUE", "0", "OR"]);
        TestRunner.assertEqual(r[0], 0, "0 OR 0 = 0");
        TestRunner.endTest();

        TestRunner.test("Evaluate - OR true false");
        var r = eval(["VALUE", "1", "VALUE", "0", "OR"]);
        TestRunner.assertEqual(r[0], 1, "1 OR 0 = 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - XOR different");
        var r = eval(["VALUE", "1", "VALUE", "0", "XOR"]);
        TestRunner.assertEqual(r[0], 1, "1 XOR 0 = 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - XOR same");
        var r = eval(["VALUE", "1", "VALUE", "1", "XOR"]);
        TestRunner.assertEqual(r[0], 0, "1 XOR 1 = 0");
        TestRunner.endTest();

        // === READ_GLOBAL ===

        TestRunner.test("Evaluate - READ_GLOBAL this");
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL"], [10, 20, 30]);
        TestRunner.assertEqual(r.length, 3, "returns context array");
        TestRunner.assertEqual(r[0], 10, "first element");
        TestRunner.assertEqual(r[2], 30, "third element");
        TestRunner.endTest();

        TestRunner.test("Evaluate - READ_GLOBAL key");
        var r = eval(["IDENTIFIER", "key", "READ_GLOBAL"], [], ["a", "b", "c"]);
        TestRunner.assertEqual(r.length, 3, "returns keys array");
        TestRunner.assertEqual(r[0], "a", "first key");
        TestRunner.assertEqual(r[2], "c", "third key");
        TestRunner.endTest();

        // === TERNARY ===

        TestRunner.test("Evaluate - TERNARY true branch");
        // condition ? 10 : 20 where condition is 1
        // Bytecode: VALUE 1, TERNARY, <thenLen>, <then...>, <elseLen>, <else...>
        var r = eval(["VALUE", "1", "TERNARY", "2", "VALUE", "10", "2", "VALUE", "20"]);
        TestRunner.assertEqual(r[0], 10, "true branch returns 10");
        TestRunner.endTest();

        TestRunner.test("Evaluate - TERNARY false branch");
        var r = eval(["VALUE", "0", "TERNARY", "2", "VALUE", "10", "2", "VALUE", "20"]);
        TestRunner.assertEqual(r[0], 20, "false branch returns 20");
        TestRunner.endTest();

        // === matchesWildcard ===

        TestRunner.test("Evaluate - matchesWildcard exact match");
        TestRunner.assert(Evaluate.matchesWildcard("hello", "hello"), "exact match");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard no match");
        TestRunner.assert(!Evaluate.matchesWildcard("hello", "world"), "no match");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard star matches all");
        TestRunner.assert(Evaluate.matchesWildcard("anything", "*"), "star matches all");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard prefix");
        TestRunner.assert(Evaluate.matchesWildcard("hello world", "hello*"), "prefix match");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard suffix");
        TestRunner.assert(Evaluate.matchesWildcard("hello world", "*world"), "suffix match");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard middle");
        TestRunner.assert(Evaluate.matchesWildcard("hello world", "h*d"), "middle match");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard OR operator");
        TestRunner.assert(Evaluate.matchesWildcard("bar", "foo|bar|baz"), "OR match");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard OR no match");
        TestRunner.assert(!Evaluate.matchesWildcard("qux", "foo|bar|baz"), "OR no match");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard prefix no match");
        TestRunner.assert(!Evaluate.matchesWildcard("goodbye world", "hello*"), "prefix no match");
        TestRunner.endTest();
    }
}
