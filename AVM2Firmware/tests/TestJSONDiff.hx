/**
 * Unit tests for JSONDiff.hx diff application.
 *
 * Tests applyDataDiff with sets, deletes, nested paths, and array operations.
 * All operations use plain Dynamic objects (no Flash runtime needed).
 */
class TestJSONDiff {

    /** Helper to build a diff object with properly typed edited array */
    static function makeDiff(ops:Array<Array<Dynamic>>):Dynamic {
        // Must cast to Array<Dynamic> so JSONDiff.applyDataDiff can call .concat() on Neko
        var edited:Array<Dynamic> = cast ops;
        return {edited: edited};
    }

    /** Helper to build a single [path, value] edit */
    static function op(path:String, value:Dynamic):Array<Dynamic> {
        return [path, value];
    }

    public static function run() {
        // === Set operations ===

        TestRunner.test("JSONDiff - set primitive property");
        var obj:Dynamic = {name: "Alice"};
        JSONDiff.applyDataDiff(obj, makeDiff([op("name", "Bob")]));
        TestRunner.assertEqual(untyped obj.name, "Bob", "name changed to Bob");
        TestRunner.endTest();

        TestRunner.test("JSONDiff - set new property");
        var obj:Dynamic = {name: "Alice"};
        JSONDiff.applyDataDiff(obj, makeDiff([op("age", 30)]));
        TestRunner.assertEqual(untyped obj.age, 30, "age added");
        TestRunner.endTest();

        TestRunner.test("JSONDiff - set nested path");
        var obj:Dynamic = {user: {name: "Alice", age: 25}};
        JSONDiff.applyDataDiff(obj, makeDiff([op("user/name", "Bob")]));
        TestRunner.assertEqual(untyped obj.user.name, "Bob", "nested name changed");
        TestRunner.assertEqual(untyped obj.user.age, 25, "age unchanged");
        TestRunner.endTest();

        TestRunner.test("JSONDiff - set creates intermediate objects");
        var obj:Dynamic = {};
        JSONDiff.applyDataDiff(obj, makeDiff([op("a/b", "deep")]));
        TestRunner.assertEqual(untyped obj.a.b, "deep", "intermediate created");
        TestRunner.endTest();

        TestRunner.test("JSONDiff - set array element by index");
        var obj:Dynamic = {items: ["a", "b", "c"]};
        JSONDiff.applyDataDiff(obj, makeDiff([op("items/1[]", "B")]));
        TestRunner.assertEqual(untyped obj.items[1], "B", "array[1] changed");
        TestRunner.assertEqual(untyped obj.items[0], "a", "array[0] unchanged");
        TestRunner.assertEqual(untyped obj.items[2], "c", "array[2] unchanged");
        TestRunner.endTest();

        // === Delete operations ===

        TestRunner.test("JSONDiff - delete property");
        var obj:Dynamic = {name: "Alice", age: 30};
        JSONDiff.applyDataDiff(obj, makeDiff([op("age", "__DELETE__")]));
        TestRunner.assertEqual(untyped __typeof__(untyped obj.age), "undefined", "age deleted");
        TestRunner.assertEqual(untyped obj.name, "Alice", "name unchanged");
        TestRunner.endTest();

        TestRunner.test("JSONDiff - delete array element splices");
        var obj:Dynamic = {items: ["a", "b", "c"]};
        JSONDiff.applyDataDiff(obj, makeDiff([op("items/1[]", "__DELETE__")]));
        TestRunner.assertEqual(untyped obj.items.length, 2, "array shrunk");
        TestRunner.assertEqual(untyped obj.items[0], "a", "first element kept");
        TestRunner.assertEqual(untyped obj.items[1], "c", "second element is now c");
        TestRunner.endTest();

        TestRunner.test("JSONDiff - multiple deletes in reverse index order");
        var obj:Dynamic = {items: ["a", "b", "c", "d"]};
        JSONDiff.applyDataDiff(obj, makeDiff([op("items/1[]", "__DELETE__"), op("items/3[]", "__DELETE__")]));
        TestRunner.assertEqual(untyped obj.items.length, 2, "two elements removed");
        TestRunner.assertEqual(untyped obj.items[0], "a", "a kept");
        TestRunner.assertEqual(untyped obj.items[1], "c", "c kept");
        TestRunner.endTest();

        // === Mixed operations ===

        TestRunner.test("JSONDiff - mixed set and delete");
        var obj:Dynamic = {name: "Alice", age: 30, city: "NYC"};
        JSONDiff.applyDataDiff(obj, makeDiff([op("name", "Bob"), op("city", "__DELETE__")]));
        TestRunner.assertEqual(untyped obj.name, "Bob", "name changed");
        TestRunner.assertEqual(untyped __typeof__(untyped obj.city), "undefined", "city deleted");
        TestRunner.assertEqual(untyped obj.age, 30, "age unchanged");
        TestRunner.endTest();

        // === Edge cases ===

        TestRunner.test("JSONDiff - null diff is no-op");
        var obj:Dynamic = {name: "Alice"};
        JSONDiff.applyDataDiff(obj, null);
        TestRunner.assertEqual(untyped obj.name, "Alice", "unchanged after null diff");
        TestRunner.endTest();

        TestRunner.test("JSONDiff - empty edited array is no-op");
        var obj:Dynamic = {name: "Alice"};
        JSONDiff.applyDataDiff(obj, {edited: cast([], Array<Dynamic>)});
        TestRunner.assertEqual(untyped obj.name, "Alice", "unchanged after empty diff");
        TestRunner.endTest();

        TestRunner.test("JSONDiff - delete nested property");
        var obj:Dynamic = {user: {name: "Alice", age: 30}};
        JSONDiff.applyDataDiff(obj, makeDiff([op("user/age", "__DELETE__")]));
        TestRunner.assertEqual(untyped __typeof__(untyped obj.user.age), "undefined", "nested delete");
        TestRunner.assertEqual(untyped obj.user.name, "Alice", "sibling unchanged");
        TestRunner.endTest();

        TestRunner.test("JSONDiff - set boolean value");
        var obj:Dynamic = {active: false};
        JSONDiff.applyDataDiff(obj, makeDiff([op("active", true)]));
        TestRunner.assertEqual(untyped obj.active, true, "boolean set to true");
        TestRunner.endTest();

        TestRunner.test("JSONDiff - set numeric value");
        var obj:Dynamic = {score: 0};
        JSONDiff.applyDataDiff(obj, makeDiff([op("score", 100)]));
        TestRunner.assertEqual(untyped obj.score, 100, "number updated");
        TestRunner.endTest();
    }
}
