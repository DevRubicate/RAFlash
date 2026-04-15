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

        // === Broadcasting (scalar x array, array x array, mismatched) ===

        TestRunner.test("Evaluate - ADD scalar + array broadcasts");
        // [5] + [1,2,3] -> [6,7,8]
        // Push [5] via VALUE, push [1,2,3] via READ_GLOBAL this, ADD
        var r = eval(["VALUE", "5", "IDENTIFIER", "this", "READ_GLOBAL", "ADD"], [1, 2, 3]);
        TestRunner.assertEqual(r.length, 3, "result length");
        TestRunner.assertEqual(r[0], 6, "5+1=6");
        TestRunner.assertEqual(r[1], 7, "5+2=7");
        TestRunner.assertEqual(r[2], 8, "5+3=8");
        TestRunner.endTest();

        TestRunner.test("Evaluate - ADD array + scalar broadcasts");
        // [1,2,3] + [10] -> [11,12,13]
        // Push [1,2,3] via READ_GLOBAL this, push [10] via VALUE, ADD
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "VALUE", "10", "ADD"], [1, 2, 3]);
        TestRunner.assertEqual(r.length, 3, "result length");
        TestRunner.assertEqual(r[0], 11, "1+10=11");
        TestRunner.assertEqual(r[1], 12, "2+10=12");
        TestRunner.assertEqual(r[2], 13, "3+10=13");
        TestRunner.endTest();

        TestRunner.test("Evaluate - SUB scalar - array broadcasts");
        // [10] - [1,2,3] -> [9,8,7]
        var r = eval(["VALUE", "10", "IDENTIFIER", "this", "READ_GLOBAL", "SUB"], [1, 2, 3]);
        TestRunner.assertEqual(r.length, 3, "result length");
        TestRunner.assertEqual(r[0], 9, "10-1=9");
        TestRunner.assertEqual(r[1], 8, "10-2=8");
        TestRunner.assertEqual(r[2], 7, "10-3=7");
        TestRunner.endTest();

        TestRunner.test("Evaluate - MUL array x array element-wise");
        // [1,2,3] * [10,20,30] -> [10,40,90]
        // Push [1,2,3] via READ_GLOBAL this, push [10,20,30] via READ_GLOBAL key, MUL
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "IDENTIFIER", "key", "READ_GLOBAL", "MUL"], [1, 2, 3], [10, 20, 30]);
        TestRunner.assertEqual(r.length, 3, "result length");
        TestRunner.assertEqual(r[0], 10, "1*10=10");
        TestRunner.assertEqual(r[1], 40, "2*20=40");
        TestRunner.assertEqual(r[2], 90, "3*30=90");
        TestRunner.endTest();

        TestRunner.test("Evaluate - EQUAL scalar vs array broadcasts");
        // [5] == [5,3,5] -> [1,0,1]
        var r = eval(["VALUE", "5", "IDENTIFIER", "this", "READ_GLOBAL", "EQUAL"], [5, 3, 5]);
        TestRunner.assertEqual(r.length, 3, "result length");
        TestRunner.assertEqual(r[0], 1, "5==5 is 1");
        TestRunner.assertEqual(r[1], 0, "5==3 is 0");
        TestRunner.assertEqual(r[2], 1, "5==5 is 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - NOT on array");
        // NOT [1,0,1,0] -> [0,1,0,1]
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "NOT"], [1, 0, 1, 0]);
        TestRunner.assertEqual(r.length, 4, "result length");
        TestRunner.assertEqual(r[0], 0, "NOT 1 = 0");
        TestRunner.assertEqual(r[1], 1, "NOT 0 = 1");
        TestRunner.assertEqual(r[2], 0, "NOT 1 = 0");
        TestRunner.assertEqual(r[3], 1, "NOT 0 = 1");
        TestRunner.endTest();

        // === TERNARY with array condition (element-wise selection) ===

        TestRunner.test("Evaluate - TERNARY array condition element-wise");
        // condition [1,0,1], then 10, else 20 -> [10,20,10]
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "TERNARY", "2", "VALUE", "10", "2", "VALUE", "20"], [1, 0, 1]);
        TestRunner.assertEqual(r.length, 3, "result length");
        TestRunner.assertEqual(r[0], 10, "truthy -> then branch");
        TestRunner.assertEqual(r[1], 20, "falsy -> else branch");
        TestRunner.assertEqual(r[2], 10, "truthy -> then branch");
        TestRunner.endTest();

        // === NOT edge cases ===

        TestRunner.test("Evaluate - NOT of null is 1");
        var r = eval(["NULL", "NOT"]);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 1, "NOT null = 1 (null is falsy)");
        TestRunner.endTest();

        TestRunner.test("Evaluate - NOT of empty string is 1");
        var r = eval(["STRING", "", "NOT"]);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 1, "NOT empty string = 1 (empty string is falsy)");
        TestRunner.endTest();

        // === READ_GLOBAL stage ===

        TestRunner.test("Evaluate - READ_GLOBAL stage returns gameRoot");
        var gameRoot:Dynamic = {x: 1};
        var r = eval(["IDENTIFIER", "stage", "READ_GLOBAL"], [], [], gameRoot);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], gameRoot, "result is the gameRoot object");
        TestRunner.endTest();

        TestRunner.test("Evaluate - READ_GLOBAL stage_frame returns 0 on neko");
        var r = eval(["IDENTIFIER", "stage_frame", "READ_GLOBAL"]);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 0, "stage_frame is 0 on non-flash target");
        TestRunner.endTest();

        // === Unknown token returns null ===

        TestRunner.test("Evaluate - unknown token returns null");
        var r = eval(["GARBAGE"]);
        TestRunner.assertEqual(r, null, "unknown token returns null");
        TestRunner.endTest();

        // === REMEMBER ===

        TestRunner.test("Evaluate - REMEMBER returns fresh result");
        // REMEMBER 3, IDENTIFIER this, READ_GLOBAL
        // Clear remembered values first
        Evaluate.rememberedValues = new Map();
        var r = eval(["REMEMBER", "3", "IDENTIFIER", "this", "READ_GLOBAL"], [42]);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 42, "returns fresh value");
        TestRunner.endTest();

        TestRunner.test("Evaluate - REMEMBER returns cached when inner is empty");
        // Same bytecode but with empty context -> inner evaluates to []
        // Should return cached [42] from previous call
        var r = eval(["REMEMBER", "3", "IDENTIFIER", "this", "READ_GLOBAL"], []);
        TestRunner.assertEqual(r.length, 1, "result length from cache");
        TestRunner.assertEqual(r[0], 42, "returns cached value");
        TestRunner.endTest();

        TestRunner.test("Evaluate - REMEMBER returns empty when no cache and inner is empty");
        Evaluate.rememberedValues = new Map();
        var r = eval(["REMEMBER", "3", "IDENTIFIER", "this", "READ_GLOBAL"], []);
        TestRunner.assertEqual(r.length, 0, "returns empty array when no cache");
        TestRunner.endTest();

        // === formatOutput ===

        TestRunner.test("Evaluate - formatOutput number");
        var result:Dynamic = Evaluate.formatOutput([42], 0);
        TestRunner.assertEqual(result.output.length, 1, "one output item");
        TestRunner.assertEqual(result.output[0].value, 42, "number value preserved");
        TestRunner.endTest();

        TestRunner.test("Evaluate - formatOutput string");
        var result:Dynamic = Evaluate.formatOutput(["hello"], 0);
        TestRunner.assertEqual(result.output.length, 1, "one output item");
        TestRunner.assertEqual(result.output[0].value, "\"hello\"", "string value quoted");
        TestRunner.endTest();

        TestRunner.test("Evaluate - formatOutput null");
        var result:Dynamic = Evaluate.formatOutput([null], 0);
        TestRunner.assertEqual(result.output.length, 1, "one output item");
        TestRunner.assertEqual(result.output[0].value, "null", "null formatted as string");
        TestRunner.endTest();

        TestRunner.test("Evaluate - formatOutput bool");
        var result:Dynamic = Evaluate.formatOutput([true], 0);
        TestRunner.assertEqual(result.output.length, 1, "one output item");
        TestRunner.assertEqual(result.output[0].value, true, "bool value preserved");
        TestRunner.endTest();

        TestRunner.test("Evaluate - formatOutput multiple values");
        var result:Dynamic = Evaluate.formatOutput([1, 2, 3], 0);
        TestRunner.assertEqual(result.output.length, 3, "three output items");
        TestRunner.assertEqual(result.output[0].value, 1, "first value");
        TestRunner.assertEqual(result.output[1].value, 2, "second value");
        TestRunner.assertEqual(result.output[2].value, 3, "third value");
        TestRunner.endTest();

        // === matchesWildcard additional cases ===

        TestRunner.test("Evaluate - matchesWildcard multiple wildcards");
        TestRunner.assert(Evaluate.matchesWildcard("abcdef", "a*c*f"), "multiple wildcards match");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard empty string vs empty pattern");
        TestRunner.assert(Evaluate.matchesWildcard("", ""), "empty matches empty");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard empty string vs star");
        TestRunner.assert(Evaluate.matchesWildcard("", "*"), "empty matches star");
        TestRunner.endTest();

        TestRunner.test("Evaluate - matchesWildcard middle match failure");
        TestRunner.assert(!Evaluate.matchesWildcard("abc", "a*z"), "a*z does not match abc");
        TestRunner.endTest();

        // === OBJECT_ACCESS ===

        TestRunner.test("Evaluate - OBJECT_ACCESS simple property lookup");
        // Bytecode: push gameRoot (stage), OBJECT_ACCESS with filter key=="health"
        // gameRoot = {health: 42, mana: 10}
        var objRoot:Dynamic = {};
        untyped objRoot.health = 42;
        untyped objRoot.mana = 10;
        // Bytecode: IDENTIFIER stage, READ_GLOBAL, OBJECT_ACCESS 6, IDENTIFIER key, READ_GLOBAL, IDENTIFIER health, EQUAL
        var r = eval(["IDENTIFIER", "stage", "READ_GLOBAL",
                       "OBJECT_ACCESS", "6",
                       "IDENTIFIER", "key", "READ_GLOBAL", "IDENTIFIER", "health", "EQUAL"], [], [], objRoot);
        TestRunner.assertEqual(r.length, 1, "one property matched");
        TestRunner.assertEqual(r[0], 42, "health is 42");
        TestRunner.endTest();

        TestRunner.test("Evaluate - OBJECT_ACCESS through Array target (flattening)");
        // gameRoot.items is an Array of objects, each with a "name" property
        // stage.items.name should flatten the array and return all names
        var item1:Dynamic = {};
        untyped item1.name = "sword";
        var item2:Dynamic = {};
        untyped item2.name = "shield";
        var arrRoot:Dynamic = {};
        untyped arrRoot.items = [item1, item2];
        // Bytecode: stage.items.name
        // IDENTIFIER stage, READ_GLOBAL,
        // OBJECT_ACCESS 6 (key=="items"),
        // OBJECT_ACCESS 6 (key=="name")
        var r = eval(["IDENTIFIER", "stage", "READ_GLOBAL",
                       "OBJECT_ACCESS", "6",
                       "IDENTIFIER", "key", "READ_GLOBAL", "IDENTIFIER", "items", "EQUAL",
                       "OBJECT_ACCESS", "6",
                       "IDENTIFIER", "key", "READ_GLOBAL", "IDENTIFIER", "name", "EQUAL"], [], [], arrRoot);
        TestRunner.assertEqual(r.length, 2, "two names from flattened array");
        TestRunner.assertEqual(r[0], "sword", "first item name");
        TestRunner.assertEqual(r[1], "shield", "second item name");
        TestRunner.endTest();

        // === ARRAY_ACCESS ===

        TestRunner.test("Evaluate - ARRAY_ACCESS simple numeric index");
        // gameRoot.scores[0]
        var idxRoot:Dynamic = {};
        untyped idxRoot.scores = [100, 200, 300];
        // Bytecode: stage.scores[0]
        // IDENTIFIER stage, READ_GLOBAL,
        // OBJECT_ACCESS 6 (key=="scores"),
        // ARRAY_ACCESS 2 (VALUE 0)
        var r = eval(["IDENTIFIER", "stage", "READ_GLOBAL",
                       "OBJECT_ACCESS", "6",
                       "IDENTIFIER", "key", "READ_GLOBAL", "IDENTIFIER", "scores", "EQUAL",
                       "ARRAY_ACCESS", "2",
                       "VALUE", "0"], [], [], idxRoot);
        TestRunner.assertEqual(r.length, 1, "one element at index 0");
        TestRunner.assertEqual(r[0], 100, "first score is 100");
        TestRunner.endTest();

        TestRunner.test("Evaluate - ARRAY_ACCESS filter expression");
        // Filter: keep elements where this > 150
        // gameRoot.scores = [100, 200, 300]
        var filtRoot:Dynamic = {};
        untyped filtRoot.scores = [100, 200, 300];
        // Bytecode: stage.scores[this > 150]
        // IDENTIFIER stage, READ_GLOBAL,
        // OBJECT_ACCESS 6 (key=="scores"),
        // ARRAY_ACCESS 5 (IDENTIFIER this, READ_GLOBAL, VALUE 150, GREATER)
        var r = eval(["IDENTIFIER", "stage", "READ_GLOBAL",
                       "OBJECT_ACCESS", "6",
                       "IDENTIFIER", "key", "READ_GLOBAL", "IDENTIFIER", "scores", "EQUAL",
                       "ARRAY_ACCESS", "5",
                       "IDENTIFIER", "this", "READ_GLOBAL", "VALUE", "150", "GREATER"], [], [], filtRoot);
        TestRunner.assertEqual(r.length, 2, "two elements > 150");
        TestRunner.assertEqual(r[0], 200, "first filtered element");
        TestRunner.assertEqual(r[1], 300, "second filtered element");
        TestRunner.endTest();

        // === LEN ===

        TestRunner.test("Evaluate - LEN of empty context");
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "LEN"], [], []);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 0, "length of empty context");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LEN of multi-element context");
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "LEN"], [10, 20, 30], []);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 3, "length of 3-element context");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LEN of single-element");
        var r = eval(["VALUE", "42", "LEN"]);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 1, "scalar wraps to [42], length 1");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LEN in comparison");
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "LEN", "VALUE", "3", "EQUAL"], [10, 20, 30], []);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 1, "len([10,20,30]) == 3 is true");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LEN flattens inner arrays");
        // Simulates len(.arr) where arr is [1,2,3]: context = [[1,2,3]] → flatten → [1,2,3] → 3
        var inner:Array<Dynamic> = [1, 2, 3];
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "LEN"], [inner], []);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 3, "flattened inner array length");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LEN flattens empty inner array");
        // Simulates len(.arr) where arr is []: context = [[]] → flatten → [] → 0
        var empty:Array<Dynamic> = [];
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "LEN"], [empty], []);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 0, "flattened empty array length");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LEN of number is 1");
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "LEN"], [42], []);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 1, "non-array scalar stays as-is");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LEN of string is 1");
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "LEN"], ["hello"], []);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 1, "string is not flattened");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LEN of null is 1");
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "LEN"], [null], []);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 1, "null is not flattened");
        TestRunner.endTest();

        TestRunner.test("Evaluate - LEN of mixed arrays and scalars");
        // context = [[10, 20], 30] → flatten → [10, 20, 30] → 3
        var inner:Array<Dynamic> = [10, 20];
        var r = eval(["IDENTIFIER", "this", "READ_GLOBAL", "LEN"], [inner, 30], []);
        TestRunner.assertEqual(r.length, 1, "result length");
        TestRunner.assertEqual(r[0], 3, "array flattened, scalar kept");
        TestRunner.endTest();
    }
}
