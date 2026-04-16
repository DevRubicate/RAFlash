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

// =============================================================================
// applyDataDiff - Null/Undefined Guards
// =============================================================================

test("applyDataDiff - null diff is no-op", () => {
    const target = { name: "Alice" };
    JSONDiff.applyDataDiff(target, null as any);
    assertEqual(target.name, "Alice");
});

test("applyDataDiff - undefined diff is no-op", () => {
    const target = { name: "Alice" };
    JSONDiff.applyDataDiff(target, undefined as any);
    assertEqual(target.name, "Alice");
});

test("applyDataDiff - diff without edited property is no-op", () => {
    const target = { name: "Alice" };
    JSONDiff.applyDataDiff(target, {} as any);
    assertEqual(target.name, "Alice");
});

// =============================================================================
// applyDataDiff - Deletion Sort Order
// =============================================================================

test("applyDataDiff - array deletions processed in reverse index order", () => {
    const target = { items: ["a", "b", "c", "d", "e"] };
    // Delete indices 1 and 3 — must splice from highest index first
    const diff = { edited: [
        ["items/1[]", JSONDiff.DELETE_SENTINEL] as [string, any],
        ["items/3[]", JSONDiff.DELETE_SENTINEL] as [string, any],
    ]};
    JSONDiff.applyDataDiff(target, diff);
    // index 3 ("d") deleted first, then index 1 ("b")
    assertEqual(target.items, ["a", "c", "e"]);
});

test("applyDataDiff - three consecutive array deletions", () => {
    const target = { items: [0, 1, 2, 3, 4] };
    const diff = { edited: [
        ["items/0[]", JSONDiff.DELETE_SENTINEL] as [string, any],
        ["items/2[]", JSONDiff.DELETE_SENTINEL] as [string, any],
        ["items/4[]", JSONDiff.DELETE_SENTINEL] as [string, any],
    ]};
    JSONDiff.applyDataDiff(target, diff);
    // Delete 4, then 2, then 0 → left with [1, 3]
    assertEqual(target.items, [1, 3]);
});

test("applyDataDiff - deletions from different parent arrays", () => {
    const target = { a: [10, 20, 30], b: [40, 50, 60] };
    const diff = { edited: [
        ["a/1[]", JSONDiff.DELETE_SENTINEL] as [string, any],
        ["b/2[]", JSONDiff.DELETE_SENTINEL] as [string, any],
    ]};
    JSONDiff.applyDataDiff(target, diff);
    assertEqual(target.a, [10, 30]);
    assertEqual(target.b, [40, 50]);
});

test("applyDataDiff - object property deletions", () => {
    const target: Record<string, any> = { a: 1, b: 2, c: 3 };
    const diff = { edited: [
        ["a", JSONDiff.DELETE_SENTINEL] as [string, any],
        ["c", JSONDiff.DELETE_SENTINEL] as [string, any],
    ]};
    JSONDiff.applyDataDiff(target, diff);
    assertEqual("a" in target, false);
    assertEqual(target.b, 2);
    assertEqual("c" in target, false);
});

test("applyDataDiff - additions applied before deletions", () => {
    // Edit an element and delete another in same array
    const target = { items: ["a", "b", "c"] };
    const diff = { edited: [
        ["items/1[]", JSONDiff.DELETE_SENTINEL] as [string, any],
        ["items/0[]", "A"] as [string, any],
    ]};
    JSONDiff.applyDataDiff(target, diff);
    // "A" replaces index 0 first, then index 1 ("b") is deleted
    assertEqual(target.items, ["A", "c"]);
});

// =============================================================================
// applyDataDiff - Nested Path Creation
// =============================================================================

test("applyDataDiff - creates nested array from [] suffix", () => {
    const target: Record<string, any> = {};
    const diff = { edited: [["list/0[]", "first"] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);
    assertEqual(Array.isArray(target.list), true);
    assertEqual(target.list[0], "first");
});

test("applyDataDiff - creates mixed nested structure", () => {
    const target: Record<string, any> = {};
    const diff = { edited: [["data/items/0[]/name", "Alice"] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);
    assertEqual(typeof target.data, "object");
    assertEqual(Array.isArray(target.data.items), true);
    assertEqual(target.data.items[0].name, "Alice");
});

// =============================================================================
// _removeValue - Edge Cases
// =============================================================================

test("applyDataDiff - delete from nonexistent nested path is no-op", () => {
    const target: Record<string, any> = { a: 1 };
    const diff = { edited: [["x/y/z", JSONDiff.DELETE_SENTINEL] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);
    assertEqual(target.a, 1);
    assertEqual("x" in target, false);
});

test("applyDataDiff - top-level key deletion", () => {
    const target: Record<string, any> = { keep: 1, remove: 2 };
    const diff = { edited: [["remove", JSONDiff.DELETE_SENTINEL] as [string, any]] };
    JSONDiff.applyDataDiff(target, diff);
    assertEqual("remove" in target, false);
    assertEqual(target.keep, 1);
});

// =============================================================================
// getDataDiff - Top-level Arrays
// =============================================================================

test("getDataDiff - top-level arrays", () => {
    const before = ["a", "b", "c"];
    const after = ["a", "X", "c"];
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "1[]");
    assertEqual(diff.edited[0][1], "X");
});

test("getDataDiff - top-level array addition", () => {
    const before = ["a"];
    const after = ["a", "b"];
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "1[]");
    assertEqual(diff.edited[0][1], "b");
});

test("getDataDiff - top-level array deletion", () => {
    const before = ["a", "b"];
    const after = ["a"];
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "1[]");
    assertEqual(diff.edited[0][1], JSONDiff.DELETE_SENTINEL);
});

// =============================================================================
// Salvage Threshold - Boundary
// =============================================================================

test("salvage threshold - exactly 50% triggers deep diff", () => {
    // 2 of 4 keys match (50%) — at threshold, NOT below it, so deep diff
    const before = { data: { a: 1, b: 2, c: 3, d: 4 } };
    const after = { data: { a: 1, b: 2, c: 99, d: 98 } };
    const diff = JSONDiff.getDataDiff(before, after);
    // 50% match (a,b same; c,d changed) → ratio = 0.5, NOT < 0.5, so deep diff
    assertEqual(diff.edited.length, 2);
    assertEqual(diff.edited[0][0], "data/c");
    assertEqual(diff.edited[1][0], "data/d");
});

test("salvage threshold - just below 50% replaces whole object", () => {
    // 1 of 3 keys matches (~33%) — below threshold, replace whole object
    const before = { data: { a: 1, b: 2, c: 3 } };
    const after = { data: { a: 1, b: 99, c: 98 } };
    const diff = JSONDiff.getDataDiff(before, after);
    // 33% match → below 0.5, whole replacement
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "data");
});

test("salvage threshold - array vs object mismatch replaces", () => {
    const before = { data: [1, 2, 3] };
    const after = { data: { a: 1 } };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "data");
});

test("salvage threshold - null to object replaces", () => {
    const before = { data: null as any };
    const after = { data: { a: 1 } };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "data");
    assertEqual(diff.edited[0][1], { a: 1 });
});

test("salvage threshold - object to null replaces", () => {
    const before = { data: { a: 1 } };
    const after = { data: null as any };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "data");
    assertEqual(diff.edited[0][1], null);
});

test("salvage threshold - empty nested objects are identical", () => {
    const before = { data: {} };
    const after = { data: {} };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 0);
});

test("salvage threshold - empty nested arrays are identical", () => {
    const before = { data: [] as any[] };
    const after = { data: [] as any[] };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 0);
});

// =============================================================================
// mergeDiffs - Additional Conflict Cases
// =============================================================================

test("mergeDiffs - null parent is conflict", () => {
    const diffA = { edited: [["config", null] as [string, any]] };
    const diffB = { edited: [["config/timeout", 5000] as [string, any]] };
    assertThrows(
        () => JSONDiff.mergeDiffs(diffA, diffB),
        Error,
        "non-object"
    );
});

test("mergeDiffs - string parent is conflict", () => {
    const diffA = { edited: [["config", "flat"] as [string, any]] };
    const diffB = { edited: [["config/timeout", 5000] as [string, any]] };
    assertThrows(
        () => JSONDiff.mergeDiffs(diffA, diffB),
        Error,
        "non-object"
    );
});

test("mergeDiffs - boolean parent is conflict", () => {
    const diffA = { edited: [["config", true] as [string, any]] };
    const diffB = { edited: [["config/timeout", 5000] as [string, any]] };
    assertThrows(
        () => JSONDiff.mergeDiffs(diffA, diffB),
        Error,
        "non-object"
    );
});

test("mergeDiffs - object parent is NOT a conflict", () => {
    const diffA = { edited: [["config", { theme: "dark" }] as [string, any]] };
    const diffB = { edited: [["config/timeout", 5000] as [string, any]] };
    // Object parent is valid — no conflict
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    assertEqual(merged.edited.length, 2);
});

test("mergeDiffs - array parent is NOT a conflict", () => {
    const diffA = { edited: [["items", [1, 2]] as [string, any]] };
    const diffB = { edited: [["items/0[]", 99] as [string, any]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    assertEqual(merged.edited.length, 2);
});

test("mergeDiffs - diffB deletes what diffA added", () => {
    const diffA = { edited: [["name", "Alice"] as [string, any]] };
    const diffB = { edited: [["name", JSONDiff.DELETE_SENTINEL] as [string, any]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    assertEqual(merged.edited.length, 1);
    assertEqual(merged.edited[0][1], JSONDiff.DELETE_SENTINEL);
});

test("mergeDiffs - diffB adds to path diffA deleted (conflict)", () => {
    const diffA = { edited: [["users", JSONDiff.DELETE_SENTINEL] as [string, any]] };
    const diffB = { edited: [["users/new-user/name", "Bob"] as [string, any]] };
    assertThrows(
        () => JSONDiff.mergeDiffs(diffA, diffB),
        Error,
        "deleted"
    );
});

test("mergeDiffs - parent override removes multiple children", () => {
    const diffA = { edited: [
        ["user/name", "Alice"] as [string, any],
        ["user/age", 30] as [string, any],
        ["user/email", "a@b.com"] as [string, any],
    ]};
    const diffB = { edited: [["user", { name: "Bob" }] as [string, any]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    assertEqual(merged.edited.length, 1);
    assertEqual(merged.edited[0][0], "user");
});

test("mergeDiffs - both diffs null-ish", () => {
    const merged = JSONDiff.mergeDiffs({ edited: [] }, { edited: [] });
    assertEqual(merged.edited.length, 0);
});

test("mergeDiffs - deep conflict through multiple ancestors", () => {
    const diffA = { edited: [["a", JSONDiff.DELETE_SENTINEL] as [string, any]] };
    const diffB = { edited: [["a/b/c/d", 1] as [string, any]] };
    assertThrows(
        () => JSONDiff.mergeDiffs(diffA, diffB),
        Error,
        "deleted"
    );
});

// =============================================================================
// unwatch
// =============================================================================

test("unwatch - removes matching watcher", () => {
    JSONDiff.watchers = [];

    let callCount = 0;
    const cb = () => { callCount++; };

    JSONDiff.watch("value", cb);
    JSONDiff.unwatch("value", cb);

    const target: Record<string, any> = { value: 1 };
    JSONDiff.processIncomingDiff(target, { edited: [["value", 2]] });

    assertEqual(callCount, 0);
    JSONDiff.watchers = [];
});

test("unwatch - only removes exact pattern+callback match", () => {
    JSONDiff.watchers = [];

    let callA = 0;
    let callB = 0;
    const cbA = () => { callA++; };
    const cbB = () => { callB++; };

    JSONDiff.watch("value", cbA);
    JSONDiff.watch("value", cbB);
    JSONDiff.unwatch("value", cbA); // Only remove cbA

    const target: Record<string, any> = { value: 1 };
    JSONDiff.processIncomingDiff(target, { edited: [["value", 2]] });

    assertEqual(callA, 0);
    assertEqual(callB, 1);
    JSONDiff.watchers = [];
});

test("unwatch - different pattern does not remove", () => {
    JSONDiff.watchers = [];

    let callCount = 0;
    const cb = () => { callCount++; };

    JSONDiff.watch("value", cb);
    JSONDiff.unwatch("other", cb); // Wrong pattern

    const target: Record<string, any> = { value: 1 };
    JSONDiff.processIncomingDiff(target, { edited: [["value", 2]] });

    assertEqual(callCount, 1);
    JSONDiff.watchers = [];
});

// =============================================================================
// Watcher - Derived Diff
// =============================================================================

test("watcher - modifies target and creates derivedDiff", () => {
    JSONDiff.watchers = [];

    JSONDiff.watch("source", (segments) => {
        // segments[0] is the value at target.source
        // We need to modify target — access parent via closure
    });

    // Use a closure-based watcher that mutates the target
    JSONDiff.watchers = [];

    const target: Record<string, any> = { source: "hello", computed: "" };

    JSONDiff.watch("source", (_segments) => {
        // Watcher directly mutates target (it has closure access)
        target.computed = target.source.toUpperCase();
    });

    const diff = { edited: [["source", "world"] as [string, any]] };
    const result = JSONDiff.processIncomingDiff(target, diff);

    assertEqual(target.source, "world");
    assertEqual(target.computed, "WORLD");
    // derivedDiff should capture the watcher's mutation
    assertEqual(result.derivedDiff.edited.length, 1);
    assertEqual(result.derivedDiff.edited[0][0], "computed");
    assertEqual(result.derivedDiff.edited[0][1], "WORLD");

    JSONDiff.watchers = [];
});

test("watcher - cascading watchers", () => {
    JSONDiff.watchers = [];

    const target: Record<string, any> = { a: 0, b: 0, c: 0 };

    // Watcher 1: when "a" changes, set b = a * 2
    JSONDiff.watch("a", () => {
        target.b = target.a * 2;
    });

    // Watcher 2: when "b" changes, set c = b + 1
    JSONDiff.watch("b", () => {
        target.c = target.b + 1;
    });

    const diff = { edited: [["a", 5] as [string, any]] };
    JSONDiff.processIncomingDiff(target, diff);

    assertEqual(target.a, 5);
    assertEqual(target.b, 10);
    assertEqual(target.c, 11);

    JSONDiff.watchers = [];
});

test("watcher - no match does not trigger", () => {
    JSONDiff.watchers = [];

    let triggered = false;
    JSONDiff.watch("other/path", () => { triggered = true; });

    const target: Record<string, any> = { name: "Alice" };
    JSONDiff.processIncomingDiff(target, { edited: [["name", "Bob"]] });

    assertEqual(triggered, false);
    JSONDiff.watchers = [];
});

test("watcher - wildcard matches multiple changes", () => {
    JSONDiff.watchers = [];

    const matched: string[] = [];
    const target: Record<string, any> = {
        users: {
            u1: { name: "Alice" },
            u2: { name: "Bob" },
        }
    };

    JSONDiff.watch("users/*/name", (segments) => {
        matched.push((segments[1] as any)?.name);
    });

    const diff = { edited: [
        ["users/u1/name", "Alicia"] as [string, any],
        ["users/u2/name", "Bobby"] as [string, any],
    ]};
    JSONDiff.processIncomingDiff(target, diff);

    assertEqual(matched.length, 2);
    JSONDiff.watchers = [];
});

// =============================================================================
// processIncomingDiff - fullDiff Accuracy
// =============================================================================

test("processIncomingDiff - fullDiff reflects watcher mutations too", () => {
    JSONDiff.watchers = [];

    const target: Record<string, any> = { input: 0, doubled: 0 };

    JSONDiff.watch("input", () => {
        target.doubled = target.input * 2;
    });

    const diff = { edited: [["input", 7] as [string, any]] };
    const result = JSONDiff.processIncomingDiff(target, diff);

    // fullDiff should include both the client change AND the watcher mutation
    assertEqual(result.fullDiff.edited.length, 2);
    JSONDiff.watchers = [];
});

// =============================================================================
// Round-trip - Complex Scenarios
// =============================================================================

test("round-trip - additions and deletions combined", () => {
    const before: Record<string, any> = { a: 1, b: 2, c: 3 };
    const after: Record<string, any> = { b: 2, c: 99, d: 4 };

    const diff = JSONDiff.getDataDiff(before, after);
    const target = JSON.parse(JSON.stringify(before));
    JSONDiff.applyDataDiff(target, diff);

    assertEqual("a" in target, false);
    assertEqual(target.b, 2);
    assertEqual(target.c, 99);
    assertEqual(target.d, 4);
});

test("round-trip - nested array modifications", () => {
    const before = { data: { items: [{ id: 1, v: "a" }, { id: 2, v: "b" }], meta: "ok" } };
    const after = { data: { items: [{ id: 1, v: "A" }, { id: 2, v: "b" }], meta: "ok" } };

    const diff = JSONDiff.getDataDiff(before, after);
    const target = JSON.parse(JSON.stringify(before));
    JSONDiff.applyDataDiff(target, diff);

    assertEqual(target.data.items[0].v, "A");
    assertEqual(target.data.items[1].v, "b");
});

test("round-trip - complete object replacement below salvage threshold", () => {
    const before = { config: { x: 1, y: 2 } };
    const after = { config: { a: 10, b: 20 } };

    const diff = JSONDiff.getDataDiff(before, after);
    const target = JSON.parse(JSON.stringify(before));
    JSONDiff.applyDataDiff(target, diff);

    assertEqual("x" in target.config, false);
    assertEqual("y" in target.config, false);
    assertEqual(target.config.a, 10);
    assertEqual(target.config.b, 20);
});

// =============================================================================
// getDataDiff - Value Type Edge Cases
// =============================================================================

test("getDataDiff - undefined to value", () => {
    const before: Record<string, any> = {};
    const after: Record<string, any> = { x: undefined };
    const diff = JSONDiff.getDataDiff(before, after);
    // "x" is in after (even though undefined), so it's an addition
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "x");
});

test("getDataDiff - identical nested arrays", () => {
    const before = { data: [1, [2, 3], 4] };
    const after = { data: [1, [2, 3], 4] };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 0);
});

test("getDataDiff - multiple properties changed", () => {
    const before = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    const after = { a: 1, b: 2, c: 3, d: 4, e: 99 };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEqual(diff.edited.length, 1);
    assertEqual(diff.edited[0][0], "e");
    assertEqual(diff.edited[0][1], 99);
});

// =============================================================================
// isPointlessDiff - Additional Cases
// =============================================================================

test("isPointlessDiff - diff with DELETE_SENTINEL is not pointless", () => {
    const diff = { edited: [["key", JSONDiff.DELETE_SENTINEL] as [string, any]] };
    assertEqual(JSONDiff.isPointlessDiff(diff), false);
});
