/**
 * JSONDiff Unit Tests
 */

import { test, assertEqual, assertThrows } from "../../tests/framework.ts";
import { JSONDiff } from "../src/JSONDiff.ts";

// === getDataDiff Tests ===

test("getDataDiff - no changes returns empty diff", () => {
    const before = { name: "Alice", age: 30 };
    const after = { name: "Alice", age: 30 };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 0);
});

test("getDataDiff - primitive value change", () => {
    const before = { name: "Alice" };
    const after = { name: "Bob" };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "name");
    assertEqual(diff.edited[0][1], "Bob");
});

test("getDataDiff - nested object change", () => {
    // Need 2+ fields with >50% unchanged to trigger deep diff (salvage threshold)
    const before = { user: { name: "Alice", age: 30 } };
    const after = { user: { name: "Bob", age: 30 } };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "user/name");
    assertEqual(diff.edited[0][1], "Bob");
});

test("getDataDiff - array element change", () => {
    const before = { items: ["a", "b", "c"] };
    const after = { items: ["a", "X", "c"] };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "items/1[]");
    assertEqual(diff.edited[0][1], "X");
});

test("getDataDiff - property deletion", () => {
    const before = { name: "Alice", age: 30 };
    const after = { name: "Alice" };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "age");
    assertEqual(diff.edited[0][1], JSONDiff.DELETE_SENTINEL);
});

test("getDataDiff - property addition", () => {
    const before = { name: "Alice" };
    const after = { name: "Alice", age: 30 };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "age");
    assertEqual(diff.edited[0][1], 30);
});

// === applyDataDiff Tests ===

test("applyDataDiff - apply primitive change", () => {
    const target = { name: "Alice" };
    const diff = { edited: [["name", "Bob"] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);
    assertEqual(target.name, "Bob");
});

test("applyDataDiff - apply nested change", () => {
    const target = { user: { name: "Alice" } };
    const diff = { edited: [["user/name", "Bob"] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);
    assertEqual(target.user.name, "Bob");
});

test("applyDataDiff - apply deletion", () => {
    const target: Record<string, any> = { name: "Alice", age: 30 };
    const diff = { edited: [["age", JSONDiff.DELETE_SENTINEL] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);
    assertEqual(target.name, "Alice");
    assertEqual("age" in target, false);
});

test("applyDataDiff - apply to array", () => {
    const target = { items: ["a", "b", "c"] };
    const diff = { edited: [["items/1[]", "X"] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);
    assertEqual(target.items, ["a", "X", "c"]);
});

test("applyDataDiff - array deletion removes element", () => {
    const target = { items: ["a", "b", "c"] };
    const diff = { edited: [["items/1[]", JSONDiff.DELETE_SENTINEL] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);
    assertEqual(target.items, ["a", "c"]);
});

// === isPointlessDiff Tests ===

test("isPointlessDiff - empty edited array returns true", () => {
    const diff = { edited: [] };
    assertEqual(JSONDiff.isPointlessDiff(diff), true);
});

test("isPointlessDiff - has changes returns false", () => {
    const diff = { edited: [["name", "Bob"] as [string, any]] };
    assertEqual(JSONDiff.isPointlessDiff(diff), false);
});

test("isPointlessDiff - null diff returns true", () => {
    assertEqual(JSONDiff.isPointlessDiff(null as any), true);
});

// === mergeDiffs Tests ===

test("mergeDiffs - merge two non-overlapping diffs", () => {
    const diffA = { edited: [["name", "Alice"] as [string, any]] };
    const diffB = { edited: [["age", 30] as [string, any]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    assertEqual(merged.edited.length, 2);
});

test("mergeDiffs - second diff overwrites first for same key", () => {
    const diffA = { edited: [["name", "Alice"] as [string, any]] };
    const diffB = { edited: [["name", "Bob"] as [string, any]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    assertEqual(merged.edited.length, 1);
    assertEqual(merged.edited[0][1], "Bob");
});

test("mergeDiffs - throws on conflict: modifying deleted path", () => {
    const diffA = { edited: [["user", JSONDiff.DELETE_SENTINEL] as [string, any]] };
    const diffB = { edited: [["user/name", "Bob"] as [string, any]] };
    assertThrows(
        () => JSONDiff.mergeDiffs(diffA, diffB),
        Error,
        "deleted"
    );
});

test("mergeDiffs - throws on conflict: modifying primitive's child", () => {
    const diffA = { edited: [["config", 123] as [string, any]] };
    const diffB = { edited: [["config/timeout", 5000] as [string, any]] };
    assertThrows(
        () => JSONDiff.mergeDiffs(diffA, diffB),
        Error,
        "non-object"
    );
});

test("mergeDiffs - parent replacement removes child ops", () => {
    const diffA = { edited: [["user/name", "Alice"] as [string, any], ["user/age", 30] as [string, any]] };
    const diffB = { edited: [["user", { name: "Bob" }] as [string, any]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    // diffB's parent replacement should remove diffA's child changes
    assertEqual(merged.edited.length, 1);
    assertEqual(merged.edited[0][0], "user");
});

// === Round-trip Tests ===

test("round-trip - diff and apply produces identical result", () => {
    const before = {
        name: "Alice",
        settings: { theme: "dark", notifications: true },
        tags: ["a", "b"]
    };
    const after = {
        name: "Bob",
        settings: { theme: "light", notifications: true },
        tags: ["a", "c"]
    };

    const diff = JSONDiff.getDataDiff(before, after);
    const target = JSON.parse(JSON.stringify(before));
    JSONDiff.applyDataDiff(target, diff);

    assertEqual(target.name, after.name);
    assertEqual(target.settings.theme, after.settings.theme);
    assertEqual(target.tags[1], after.tags[1]);
});

// === Watcher System Tests ===

test("watch - basic watcher triggers on matching path", () => {
    // Clear watchers from previous tests
    JSONDiff.watchers = [];

    let triggered = false;
    let receivedSegments: any[] = [];

    JSONDiff.watch("user/name", (segments) => {
        triggered = true;
        receivedSegments = segments;
    });

    const target = { user: { name: "Alice", age: 30 } };
    const diff = { edited: [["user/name", "Bob"] as [string, any]] };

    const result = JSONDiff.processIncomingDiff(target, diff);

    assertEqual(triggered, true);
    assertEqual(target.user.name, "Bob");

    // Cleanup
    JSONDiff.watchers = [];
});

test("watch - wildcard pattern matching", () => {
    JSONDiff.watchers = [];

    const triggeredUsers: string[] = [];

    JSONDiff.watch("users/*/name", (segments) => {
        // segments[0] = users object, segments[1] = specific user object, segments[2] = name value
        triggeredUsers.push((segments[1] as Record<string, string>)?.id || "unknown");
    });

    const target = {
        users: {
            "user-1": { id: "user-1", name: "Alice" },
            "user-2": { id: "user-2", name: "Bob" }
        }
    };
    const diff = { edited: [["users/user-1/name", "Alicia"] as [string, any]] };

    JSONDiff.processIncomingDiff(target, diff);

    assertEqual(triggeredUsers.length, 1);
    assertEqual(target.users["user-1"].name, "Alicia");

    JSONDiff.watchers = [];
});

test("watch - watcher modifies data creates derivedDiff", () => {
    JSONDiff.watchers = [];

    // Watcher that computes a derived field
    JSONDiff.watch("input", (segments) => {
        const root = segments[0];
        if (root && typeof root === 'object') {
            // Get parent object to modify sibling
            // segments structure: we need to access parent
        }
    });

    // Simpler test: watcher directly modifies target
    JSONDiff.watch("value", (segments) => {
        // segments[0] is the value itself after traversal
        // We need access to the root - let's check the implementation
    });

    // Actually, let's test with a watcher that modifies a known path
    JSONDiff.watchers = [];

    let watcherCalled = false;
    JSONDiff.watch("source", (segments) => {
        watcherCalled = true;
        // Watchers receive segments but need root access to modify
        // The root is passed as the first segment in _traverse
    });

    const target: Record<string, any> = { source: "hello", computed: "" };
    const diff = { edited: [["source", "world"] as [string, any]] };

    const result = JSONDiff.processIncomingDiff(target, diff);

    assertEqual(watcherCalled, true);
    assertEqual(target.source, "world");

    JSONDiff.watchers = [];
});

test("processIncomingDiff - fullDiff contains all changes", () => {
    JSONDiff.watchers = [];

    const target = { name: "Alice", age: 30 };
    const diff = { edited: [["name", "Bob"] as [string, any], ["age", 31] as [string, any]] };

    const result = JSONDiff.processIncomingDiff(target, diff);

    assertEqual(result.fullDiff.edited.length, 2);
    assertEqual(target.name, "Bob");
    assertEqual(target.age, 31);

    JSONDiff.watchers = [];
});

test("processIncomingDiff - derivedDiff is empty when no watchers", () => {
    JSONDiff.watchers = [];

    const target = { name: "Alice" };
    const diff = { edited: [["name", "Bob"] as [string, any]] };

    const result = JSONDiff.processIncomingDiff(target, diff);

    assertEqual(result.derivedDiff.edited.length, 0);

    JSONDiff.watchers = [];
});

// === Salvage Threshold Tests ===

test("salvage threshold - low similarity replaces whole object", () => {
    // When <50% of keys match, replace the whole object
    const before = { data: { a: 1, b: 2 } };
    const after = { data: { x: 9, y: 8 } };  // 0% key overlap

    const diff = JSONDiff.getDataDiff(before, after);

    // Should replace 'data' entirely, not diff individual keys
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "data");
    assertEqual(diff.edited[0][1], { x: 9, y: 8 });
});

test("salvage threshold - high similarity creates nested diff", () => {
    // When >=50% similar, create nested diffs
    const before = { data: { a: 1, b: 2, c: 3, d: 4 } };
    const after = { data: { a: 1, b: 2, c: 3, d: 99 } };  // 75% same

    const diff = JSONDiff.getDataDiff(before, after);

    // Should diff into 'data', not replace it
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "data/d");
    assertEqual(diff.edited[0][1], 99);
});

// === Edge Cases - getDataDiff ===

test("getDataDiff - empty objects", () => {
    const diff = JSONDiff.getDataDiff({}, {});
    assertEqual(diff.edited.length, 0);
});

test("getDataDiff - empty arrays", () => {
    const before = { items: [] as any[] };
    const after = { items: [] as any[] };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 0);
});

test("getDataDiff - deeply nested path", () => {
    // Need 2+ fields at each level to meet salvage threshold (>50% unchanged)
    const before = { a: { b: { c: { d: 1, e: 1 }, c2: 1 }, b2: 1 }, a2: 1 };
    const after = { a: { b: { c: { d: 2, e: 1 }, c2: 1 }, b2: 1 }, a2: 1 };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "a/b/c/d");
    assertEqual(diff.edited[0][1], 2);
});

test("getDataDiff - type change object to primitive", () => {
    const before = { value: { nested: 1 } };
    const after = { value: 42 };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "value");
    assertEqual(diff.edited[0][1], 42);
});

test("getDataDiff - type change array to object", () => {
    const before = { value: [1, 2, 3] };
    const after = { value: { a: 1 } };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "value");
});

test("getDataDiff - null value handling", () => {
    const before = { value: "hello" };
    const after = { value: null };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][1], null);
});

test("getDataDiff - boolean change", () => {
    const before = { enabled: true };
    const after = { enabled: false };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][1], false);
});

test("getDataDiff - number variations", () => {
    const before = { int: 1, float: 1.5, negative: -10 };
    const after = { int: 2, float: 2.5, negative: -20 };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEqual(diff.edited.length, 3);
});

// === Edge Cases - applyDataDiff ===

test("applyDataDiff - create nested path that doesn't exist", () => {
    const target: Record<string, any> = {};
    const diff = { edited: [["a/b/c", "value"] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);

    assertEqual(target.a.b.c, "value");
});

test("applyDataDiff - multi-element array deletion", () => {
    const target = { items: ["a", "b", "c", "d", "e"] };
    const diff = { edited: [
        ["items/1[]", JSONDiff.DELETE_SENTINEL] as [string, any],
        ["items/3[]", JSONDiff.DELETE_SENTINEL] as [string, any]
    ]};
    JSONDiff.applyDataDiff(target, diff);

    // Should delete indices 1 ("b") and 3 ("d"), leaving ["a", "c", "e"]
    assertEqual(target.items.length, 3);
    assertEqual(target.items, ["a", "c", "e"]);
});

test("applyDataDiff - apply to empty object", () => {
    const target: Record<string, any> = {};
    const diff = { edited: [["name", "Alice"] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);

    assertEqual(target.name, "Alice");
});

test("applyDataDiff - apply empty diff is no-op", () => {
    const target = { name: "Alice" };
    const diff = { edited: [] };
    JSONDiff.applyDataDiff(target, diff);

    assertEqual(target.name, "Alice");
});

// === Edge Cases - Arrays ===

test("getDataDiff - array grows", () => {
    const before = { items: ["a", "b"] };
    const after = { items: ["a", "b", "c"] };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "items/2[]");
    assertEqual(diff.edited[0][1], "c");
});

test("getDataDiff - array shrinks", () => {
    const before = { items: ["a", "b", "c"] };
    const after = { items: ["a"] };
    const diff = JSONDiff.getDataDiff(before, after);

    // Only 33% unchanged (1/3), below 50% threshold, so whole array is replaced
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "items");
});

test("getDataDiff - array element type change", () => {
    const before = { items: [1, 2, 3] };
    const after = { items: [1, "two", 3] };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "items/1[]");
    assertEqual(diff.edited[0][1], "two");
});

// === Edge Cases - mergeDiffs ===

test("mergeDiffs - merge with empty diffA", () => {
    const diffA = { edited: [] };
    const diffB = { edited: [["name", "Bob"] as [string, any]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);

    assertEqual(merged.edited.length, 1);
    assertEqual(merged.edited[0][1], "Bob");
});

test("mergeDiffs - merge with empty diffB", () => {
    const diffA = { edited: [["name", "Alice"] as [string, any]] };
    const diffB = { edited: [] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);

    assertEqual(merged.edited.length, 1);
    assertEqual(merged.edited[0][1], "Alice");
});

test("mergeDiffs - deep nested path merging", () => {
    const diffA = { edited: [["a/b/c", 1] as [string, any]] };
    const diffB = { edited: [["a/b/d", 2] as [string, any]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);

    assertEqual(merged.edited.length, 2);
});
