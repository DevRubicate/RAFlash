/**
 * JSONDiff Unit Tests for AS2
 */
import JSONDiff;

class TestJSONDiff {
    /**
     * Run all JSONDiff tests.
     * Uses the TestRunner's static methods for assertions.
     */
    public static function run():Void {
        // === getDataDiff Tests ===

        TestRunner.test("getDataDiff - no changes returns empty diff");
        var before1:Object = { name: "Alice", age: 30 };
        var after1:Object = { name: "Alice", age: 30 };
        var diff1:Object = JSONDiff.getDataDiff(before1, after1);
        TestRunner.assertEqual(diff1.edited.length, 0, "should have no edits");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - primitive value change");
        var before2:Object = { name: "Alice" };
        var after2:Object = { name: "Bob" };
        var diff2:Object = JSONDiff.getDataDiff(before2, after2);
        TestRunner.assertEqual(diff2.edited.length, 1, "should have one edit");
        TestRunner.assertEqual(diff2.edited[0][0], "name", "path should be 'name'");
        TestRunner.assertEqual(diff2.edited[0][1], "Bob", "value should be 'Bob'");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - nested object change");
        // Need 2+ fields with >50% unchanged to trigger deep diff (salvage threshold)
        var before3:Object = { user: { name: "Alice", age: 30 } };
        var after3:Object = { user: { name: "Bob", age: 30 } };
        var diff3:Object = JSONDiff.getDataDiff(before3, after3);
        TestRunner.assertEqual(diff3.edited.length, 1, "should have one edit");
        TestRunner.assertEqual(diff3.edited[0][0], "user/name", "path should be 'user/name'");
        TestRunner.assertEqual(diff3.edited[0][1], "Bob", "value should be 'Bob'");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - array element change");
        var before4:Object = { items: ["a", "b", "c"] };
        var after4:Object = { items: ["a", "X", "c"] };
        var diff4:Object = JSONDiff.getDataDiff(before4, after4);
        TestRunner.assertEqual(diff4.edited.length, 1, "should have one edit");
        TestRunner.assertEqual(diff4.edited[0][0], "items/1[]", "path should be 'items/1[]'");
        TestRunner.assertEqual(diff4.edited[0][1], "X", "value should be 'X'");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - property deletion");
        var before5:Object = { name: "Alice", age: 30 };
        var after5:Object = { name: "Alice" };
        var diff5:Object = JSONDiff.getDataDiff(before5, after5);
        TestRunner.assertEqual(diff5.edited.length, 1, "should have one edit");
        TestRunner.assertEqual(diff5.edited[0][0], "age", "path should be 'age'");
        TestRunner.assertEqual(diff5.edited[0][1], JSONDiff.DELETE_SENTINEL, "value should be DELETE_SENTINEL");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - property addition");
        var before6:Object = { name: "Alice" };
        var after6:Object = { name: "Alice", age: 30 };
        var diff6:Object = JSONDiff.getDataDiff(before6, after6);
        TestRunner.assertEqual(diff6.edited.length, 1, "should have one edit");
        TestRunner.assertEqual(diff6.edited[0][0], "age", "path should be 'age'");
        TestRunner.assertEqual(diff6.edited[0][1], 30, "value should be 30");
        TestRunner.endTest();

        // === applyDataDiff Tests ===

        TestRunner.test("applyDataDiff - apply primitive change");
        var target1:Object = { name: "Alice" };
        var applyDiff1:Object = { edited: [["name", "Bob"]] };
        JSONDiff.applyDataDiff(target1, applyDiff1);
        TestRunner.assertEqual(target1.name, "Bob", "name should be 'Bob'");
        TestRunner.endTest();

        TestRunner.test("applyDataDiff - apply nested change");
        var target2:Object = { user: { name: "Alice" } };
        var applyDiff2:Object = { edited: [["user/name", "Bob"]] };
        JSONDiff.applyDataDiff(target2, applyDiff2);
        TestRunner.assertEqual(target2.user.name, "Bob", "user.name should be 'Bob'");
        TestRunner.endTest();

        TestRunner.test("applyDataDiff - apply deletion");
        var target3:Object = { name: "Alice", age: 30 };
        var applyDiff3:Object = { edited: [["age", JSONDiff.DELETE_SENTINEL]] };
        JSONDiff.applyDataDiff(target3, applyDiff3);
        TestRunner.assertEqual(target3.name, "Alice", "name should remain 'Alice'");
        TestRunner.assertEqual(target3.age, undefined, "age should be undefined");
        TestRunner.endTest();

        TestRunner.test("applyDataDiff - apply to array");
        var target4:Object = { items: ["a", "b", "c"] };
        var applyDiff4:Object = { edited: [["items/1[]", "X"]] };
        JSONDiff.applyDataDiff(target4, applyDiff4);
        TestRunner.assertEqual(target4.items[0], "a", "items[0] should be 'a'");
        TestRunner.assertEqual(target4.items[1], "X", "items[1] should be 'X'");
        TestRunner.assertEqual(target4.items[2], "c", "items[2] should be 'c'");
        TestRunner.endTest();

        TestRunner.test("applyDataDiff - array deletion removes element");
        var target5:Object = { items: ["a", "b", "c"] };
        var applyDiff5:Object = { edited: [["items/1[]", JSONDiff.DELETE_SENTINEL]] };
        JSONDiff.applyDataDiff(target5, applyDiff5);
        TestRunner.assertEqual(target5.items.length, 2, "array should have 2 elements");
        TestRunner.assertEqual(target5.items[0], "a", "items[0] should be 'a'");
        TestRunner.assertEqual(target5.items[1], "c", "items[1] should be 'c'");
        TestRunner.endTest();

        TestRunner.test("applyDataDiff - multi-element array deletion (index order)");
        // Delete indices 1 and 3 from [a,b,c,d,e] - must delete higher index first
        var target6:Object = { items: ["a", "b", "c", "d", "e"] };
        var applyDiff6:Object = { edited: [
            ["items/1[]", JSONDiff.DELETE_SENTINEL],
            ["items/3[]", JSONDiff.DELETE_SENTINEL]
        ]};
        JSONDiff.applyDataDiff(target6, applyDiff6);
        // Should remove "b" (index 1) and "d" (index 3), leaving ["a", "c", "e"]
        TestRunner.assertEqual(target6.items.length, 3, "array should have 3 elements");
        TestRunner.assertEqual(target6.items[0], "a", "items[0] should be 'a'");
        TestRunner.assertEqual(target6.items[1], "c", "items[1] should be 'c'");
        TestRunner.assertEqual(target6.items[2], "e", "items[2] should be 'e'");
        TestRunner.endTest();

        // === isPointlessDiff Tests ===

        TestRunner.test("isPointlessDiff - empty edited array returns true");
        var emptyDiff:Object = { edited: [] };
        TestRunner.assertEqual(JSONDiff.isPointlessDiff(emptyDiff), true, "should return true");
        TestRunner.endTest();

        TestRunner.test("isPointlessDiff - has changes returns false");
        var nonEmptyDiff:Object = { edited: [["name", "Bob"]] };
        TestRunner.assertEqual(JSONDiff.isPointlessDiff(nonEmptyDiff), false, "should return false");
        TestRunner.endTest();

        // === mergeDiffs Tests ===

        TestRunner.test("mergeDiffs - merge two non-overlapping diffs");
        var mergeA1:Object = { edited: [["name", "Alice"]] };
        var mergeB1:Object = { edited: [["age", 30]] };
        var merged1:Object = JSONDiff.mergeDiffs(mergeA1, mergeB1);
        TestRunner.assertEqual(merged1.edited.length, 2, "should have 2 edits");
        TestRunner.endTest();

        TestRunner.test("mergeDiffs - second diff overwrites first for same key");
        var mergeA2:Object = { edited: [["name", "Alice"]] };
        var mergeB2:Object = { edited: [["name", "Bob"]] };
        var merged2:Object = JSONDiff.mergeDiffs(mergeA2, mergeB2);
        TestRunner.assertEqual(merged2.edited.length, 1, "should have 1 edit");
        // Find the name edit
        var foundBob:Boolean = false;
        for (var i:Number = 0; i < merged2.edited.length; i++) {
            if (merged2.edited[i][0] == "name" && merged2.edited[i][1] == "Bob") {
                foundBob = true;
            }
        }
        TestRunner.assert(foundBob, "merged diff should have name='Bob'");
        TestRunner.endTest();

        TestRunner.test("mergeDiffs - throws on conflict: modifying deleted path");
        var mergeA3:Object = { edited: [["user", JSONDiff.DELETE_SENTINEL]] };
        var mergeB3:Object = { edited: [["user/name", "Bob"]] };
        var threw3:Boolean = false;
        try {
            JSONDiff.mergeDiffs(mergeA3, mergeB3);
        } catch (e:Error) {
            threw3 = true;
        }
        TestRunner.assert(threw3, "should throw on conflict");
        TestRunner.endTest();

        TestRunner.test("mergeDiffs - throws on conflict: modifying primitive child");
        var mergeA4:Object = { edited: [["config", 123]] };
        var mergeB4:Object = { edited: [["config/timeout", 5000]] };
        var threw4:Boolean = false;
        try {
            JSONDiff.mergeDiffs(mergeA4, mergeB4);
        } catch (e:Error) {
            threw4 = true;
        }
        TestRunner.assert(threw4, "should throw on conflict");
        TestRunner.endTest();

        TestRunner.test("isPointlessDiff - null diff returns true");
        TestRunner.assertEqual(JSONDiff.isPointlessDiff(null), true, "should return true for null");
        TestRunner.endTest();

        // === Round-trip Test ===

        TestRunner.test("round-trip - diff and apply produces identical result");
        var rtBefore:Object = {
            name: "Alice",
            settings: { theme: "dark" },
            tags: ["a", "b"]
        };
        var rtAfter:Object = {
            name: "Bob",
            settings: { theme: "light" },
            tags: ["a", "c"]
        };
        var rtDiff:Object = JSONDiff.getDataDiff(rtBefore, rtAfter);
        var rtTarget:Object = JSON.parse(JSON.stringify(rtBefore));
        JSONDiff.applyDataDiff(rtTarget, rtDiff);
        TestRunner.assertEqual(rtTarget.name, "Bob", "name should be 'Bob'");
        TestRunner.assertEqual(rtTarget.settings.theme, "light", "theme should be 'light'");
        TestRunner.assertEqual(rtTarget.tags[1], "c", "tags[1] should be 'c'");
        TestRunner.endTest();

        // === Salvage Threshold Tests ===

        TestRunner.test("salvage threshold - low similarity replaces whole object");
        var salvLowBefore:Object = { data: { a: 1, b: 2 } };
        var salvLowAfter:Object = { data: { x: 9, y: 8 } };
        var salvLowDiff:Object = JSONDiff.getDataDiff(salvLowBefore, salvLowAfter);
        TestRunner.assertEqual(salvLowDiff.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(salvLowDiff.edited[0][0], "data", "path should be 'data'");
        TestRunner.endTest();

        TestRunner.test("salvage threshold - high similarity creates nested diff");
        var salvHighBefore:Object = { data: { a: 1, b: 2, c: 3, d: 4 } };
        var salvHighAfter:Object = { data: { a: 1, b: 2, c: 3, d: 99 } };
        var salvHighDiff:Object = JSONDiff.getDataDiff(salvHighBefore, salvHighAfter);
        TestRunner.assertEqual(salvHighDiff.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(salvHighDiff.edited[0][0], "data/d", "path should be 'data/d'");
        TestRunner.assertEqual(salvHighDiff.edited[0][1], 99, "value should be 99");
        TestRunner.endTest();

        // === Edge Cases - getDataDiff ===

        TestRunner.test("getDataDiff - empty objects");
        var emptyObjDiff:Object = JSONDiff.getDataDiff({}, {});
        TestRunner.assertEqual(emptyObjDiff.edited.length, 0, "should have no edits");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - empty arrays");
        var emptyArrBefore:Object = { items: [] };
        var emptyArrAfter:Object = { items: [] };
        var emptyArrDiff:Object = JSONDiff.getDataDiff(emptyArrBefore, emptyArrAfter);
        TestRunner.assertEqual(emptyArrDiff.edited.length, 0, "should have no edits");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - deeply nested path");
        var deepBefore:Object = { a: { b: { c: { d: 1, e: 1 }, c2: 1 }, b2: 1 }, a2: 1 };
        var deepAfter:Object = { a: { b: { c: { d: 2, e: 1 }, c2: 1 }, b2: 1 }, a2: 1 };
        var deepDiff:Object = JSONDiff.getDataDiff(deepBefore, deepAfter);
        TestRunner.assertEqual(deepDiff.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(deepDiff.edited[0][0], "a/b/c/d", "path should be 'a/b/c/d'");
        TestRunner.assertEqual(deepDiff.edited[0][1], 2, "value should be 2");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - type change object to primitive");
        var typeObjBefore:Object = { value: { nested: 1 } };
        var typeObjAfter:Object = { value: 42 };
        var typeObjDiff:Object = JSONDiff.getDataDiff(typeObjBefore, typeObjAfter);
        TestRunner.assertEqual(typeObjDiff.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(typeObjDiff.edited[0][0], "value", "path should be 'value'");
        TestRunner.assertEqual(typeObjDiff.edited[0][1], 42, "value should be 42");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - type change array to object");
        var typeArrBefore:Object = { value: [1, 2, 3] };
        var typeArrAfter:Object = { value: { a: 1 } };
        var typeArrDiff:Object = JSONDiff.getDataDiff(typeArrBefore, typeArrAfter);
        TestRunner.assertEqual(typeArrDiff.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(typeArrDiff.edited[0][0], "value", "path should be 'value'");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - null value handling");
        var nullBefore:Object = { value: "hello" };
        var nullAfter:Object = { value: null };
        var nullDiff:Object = JSONDiff.getDataDiff(nullBefore, nullAfter);
        TestRunner.assertEqual(nullDiff.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(nullDiff.edited[0][1], null, "value should be null");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - boolean change");
        var boolBefore:Object = { enabled: true };
        var boolAfter:Object = { enabled: false };
        var boolDiff:Object = JSONDiff.getDataDiff(boolBefore, boolAfter);
        TestRunner.assertEqual(boolDiff.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(boolDiff.edited[0][1], false, "value should be false");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - number variations");
        var numBefore:Object = { intVal: 1, floatVal: 1.5, negVal: -10 };
        var numAfter:Object = { intVal: 2, floatVal: 2.5, negVal: -20 };
        var numDiff:Object = JSONDiff.getDataDiff(numBefore, numAfter);
        TestRunner.assertEqual(numDiff.edited.length, 3, "should have 3 edits");
        TestRunner.endTest();

        // === Edge Cases - applyDataDiff ===

        TestRunner.test("applyDataDiff - create nested path that doesn't exist");
        var nestedTarget:Object = {};
        var nestedDiff:Object = { edited: [["a/b/c", "value"]] };
        JSONDiff.applyDataDiff(nestedTarget, nestedDiff);
        TestRunner.assertEqual(nestedTarget.a.b.c, "value", "nested path should be created");
        TestRunner.endTest();

        TestRunner.test("applyDataDiff - apply to empty object");
        var emptyTarget:Object = {};
        var addNameDiff:Object = { edited: [["name", "Alice"]] };
        JSONDiff.applyDataDiff(emptyTarget, addNameDiff);
        TestRunner.assertEqual(emptyTarget.name, "Alice", "name should be 'Alice'");
        TestRunner.endTest();

        TestRunner.test("applyDataDiff - apply empty diff is no-op");
        var noopTarget:Object = { name: "Alice" };
        var noopDiff:Object = { edited: [] };
        JSONDiff.applyDataDiff(noopTarget, noopDiff);
        TestRunner.assertEqual(noopTarget.name, "Alice", "name should remain 'Alice'");
        TestRunner.endTest();

        // === Edge Cases - Arrays ===

        TestRunner.test("getDataDiff - array grows");
        var growBefore:Object = { items: ["a", "b"] };
        var growAfter:Object = { items: ["a", "b", "c"] };
        var growDiff:Object = JSONDiff.getDataDiff(growBefore, growAfter);
        TestRunner.assertEqual(growDiff.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(growDiff.edited[0][0], "items/2[]", "path should be 'items/2[]'");
        TestRunner.assertEqual(growDiff.edited[0][1], "c", "value should be 'c'");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - array shrinks");
        var shrinkBefore:Object = { items: ["a", "b", "c"] };
        var shrinkAfter:Object = { items: ["a"] };
        var shrinkDiff:Object = JSONDiff.getDataDiff(shrinkBefore, shrinkAfter);
        // Only 33% unchanged (1/3), below 50% threshold, so whole array is replaced
        TestRunner.assertEqual(shrinkDiff.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(shrinkDiff.edited[0][0], "items", "path should be 'items'");
        TestRunner.endTest();

        TestRunner.test("getDataDiff - array element type change");
        var typeChangeBefore:Object = { items: [1, 2, 3] };
        var typeChangeAfter:Object = { items: [1, "two", 3] };
        var typeChangeDiff:Object = JSONDiff.getDataDiff(typeChangeBefore, typeChangeAfter);
        TestRunner.assertEqual(typeChangeDiff.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(typeChangeDiff.edited[0][0], "items/1[]", "path should be 'items/1[]'");
        TestRunner.assertEqual(typeChangeDiff.edited[0][1], "two", "value should be 'two'");
        TestRunner.endTest();

        // === Edge Cases - mergeDiffs ===

        TestRunner.test("mergeDiffs - merge with empty diffA");
        var emptyADiffA:Object = { edited: [] };
        var emptyADiffB:Object = { edited: [["name", "Bob"]] };
        var emptyAMerged:Object = JSONDiff.mergeDiffs(emptyADiffA, emptyADiffB);
        TestRunner.assertEqual(emptyAMerged.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(emptyAMerged.edited[0][1], "Bob", "value should be 'Bob'");
        TestRunner.endTest();

        TestRunner.test("mergeDiffs - merge with empty diffB");
        var emptyBDiffA:Object = { edited: [["name", "Alice"]] };
        var emptyBDiffB:Object = { edited: [] };
        var emptyBMerged:Object = JSONDiff.mergeDiffs(emptyBDiffA, emptyBDiffB);
        TestRunner.assertEqual(emptyBMerged.edited.length, 1, "should have 1 edit");
        TestRunner.assertEqual(emptyBMerged.edited[0][1], "Alice", "value should be 'Alice'");
        TestRunner.endTest();

        TestRunner.test("mergeDiffs - deep nested path merging");
        var deepMergeA:Object = { edited: [["a/b/c", 1]] };
        var deepMergeB:Object = { edited: [["a/b/d", 2]] };
        var deepMerged:Object = JSONDiff.mergeDiffs(deepMergeA, deepMergeB);
        TestRunner.assertEqual(deepMerged.edited.length, 2, "should have 2 edits");
        TestRunner.endTest();
    }
}
