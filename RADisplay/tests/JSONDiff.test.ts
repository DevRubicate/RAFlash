/**
 * JSONDiff Unit Tests (Deno)
 */

import { assertEquals, assertThrows } from "https://deno.land/std/assert/mod.ts";
import { JSONDiff, type Diff } from '../src/js/JSONDiff.ts';

// === getDataDiff Tests ===

Deno.test('getDataDiff - no changes returns empty diff', () => {
    const before = { name: 'Alice', age: 30 };
    const after = { name: 'Alice', age: 30 };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEquals(diff.edited.length, 0);
});

Deno.test('getDataDiff - primitive value change', () => {
    const before = { name: 'Alice' };
    const after = { name: 'Bob' };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'name');
    assertEquals(diff.edited[0][1], 'Bob');
});

Deno.test('getDataDiff - nested object change', () => {
    // Need 2+ fields with >50% unchanged to trigger deep diff (salvage threshold)
    const before = { user: { name: 'Alice', age: 30 } };
    const after = { user: { name: 'Bob', age: 30 } };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'user/name');
    assertEquals(diff.edited[0][1], 'Bob');
});

Deno.test('getDataDiff - array element change', () => {
    const before = { items: ['a', 'b', 'c'] };
    const after = { items: ['a', 'X', 'c'] };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'items/1[]');
    assertEquals(diff.edited[0][1], 'X');
});

Deno.test('getDataDiff - property deletion', () => {
    const before = { name: 'Alice', age: 30 };
    const after = { name: 'Alice' };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'age');
    assertEquals(diff.edited[0][1], JSONDiff.DELETE_SENTINEL);
});

Deno.test('getDataDiff - property addition', () => {
    const before = { name: 'Alice' };
    const after = { name: 'Alice', age: 30 };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'age');
    assertEquals(diff.edited[0][1], 30);
});

// === applyDataDiff Tests ===

Deno.test('applyDataDiff - apply primitive change', () => {
    const target = { name: 'Alice' };
    const diff = { edited: [['name', 'Bob']] } as Diff;
    JSONDiff.applyDataDiff(target, diff);
    assertEquals(target.name, 'Bob');
});

Deno.test('applyDataDiff - apply nested change', () => {
    const target = { user: { name: 'Alice' } };
    const diff = { edited: [['user/name', 'Bob']] } as Diff;
    JSONDiff.applyDataDiff(target, diff);
    assertEquals(target.user.name, 'Bob');
});

Deno.test('applyDataDiff - apply deletion', () => {
    const target: Record<string, unknown> = { name: 'Alice', age: 30 };
    const diff = { edited: [['age', JSONDiff.DELETE_SENTINEL]] } as Diff;
    JSONDiff.applyDataDiff(target, diff);
    assertEquals(target.name, 'Alice');
    assertEquals('age' in target, false);
});

Deno.test('applyDataDiff - apply to array', () => {
    const target = { items: ['a', 'b', 'c'] };
    const diff = { edited: [['items/1[]', 'X']] } as Diff;
    JSONDiff.applyDataDiff(target, diff);
    assertEquals(target.items, ['a', 'X', 'c']);
});

Deno.test('applyDataDiff - array deletion removes element', () => {
    const target = { items: ['a', 'b', 'c'] };
    const diff = { edited: [['items/1[]', JSONDiff.DELETE_SENTINEL]] } as Diff;
    JSONDiff.applyDataDiff(target, diff);
    assertEquals(target.items, ['a', 'c']);
});

// === isPointlessDiff Tests ===

Deno.test('isPointlessDiff - empty edited array returns true', () => {
    const diff = { edited: [] } as Diff;
    assertEquals(JSONDiff.isPointlessDiff(diff), true);
});

Deno.test('isPointlessDiff - has changes returns false', () => {
    const diff = { edited: [['name', 'Bob']] } as Diff;
    assertEquals(JSONDiff.isPointlessDiff(diff), false);
});

// === mergeDiffs Tests ===

Deno.test('mergeDiffs - merge two non-overlapping diffs', () => {
    const diffA = { edited: [['name', 'Alice']] } as Diff;
    const diffB = { edited: [['age', 30]] } as Diff;
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    assertEquals(merged.edited.length, 2);
});

Deno.test('mergeDiffs - second diff overwrites first for same key', () => {
    const diffA = { edited: [['name', 'Alice']] } as Diff;
    const diffB = { edited: [['name', 'Bob']] } as Diff;
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    assertEquals(merged.edited.length, 1);
    assertEquals(merged.edited[0][1], 'Bob');
});

Deno.test('mergeDiffs - throws on conflict: modifying deleted path', () => {
    const diffA = { edited: [['user', JSONDiff.DELETE_SENTINEL]] } as Diff;
    const diffB = { edited: [['user/name', 'Bob']] } as Diff;
    assertThrows(() => JSONDiff.mergeDiffs(diffA, diffB), Error, 'deleted');
});

Deno.test('mergeDiffs - throws on conflict: modifying primitive child', () => {
    const diffA = { edited: [['config', 123]] } as Diff;
    const diffB = { edited: [['config/timeout', 5000]] } as Diff;
    assertThrows(() => JSONDiff.mergeDiffs(diffA, diffB), Error, 'non-object');
});

Deno.test('mergeDiffs - parent replacement removes child ops', () => {
    const diffA = { edited: [['user/name', 'Alice'], ['user/age', 30]] } as Diff;
    const diffB = { edited: [['user', { name: 'Bob' }]] } as Diff;
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    assertEquals(merged.edited.length, 1);
    assertEquals(merged.edited[0][0], 'user');
});

Deno.test('isPointlessDiff - null diff returns true', () => {
    assertEquals(JSONDiff.isPointlessDiff(null as unknown as Diff), true);
});

// === Round-trip Tests ===

Deno.test('round-trip - diff and apply produces identical result', () => {
    const before = {
        name: 'Alice',
        settings: { theme: 'dark', notifications: true },
        tags: ['a', 'b']
    };
    const after = {
        name: 'Bob',
        settings: { theme: 'light', notifications: true },
        tags: ['a', 'c']
    };

    const diff = JSONDiff.getDataDiff(before, after);
    const target = JSON.parse(JSON.stringify(before));
    JSONDiff.applyDataDiff(target, diff);

    assertEquals(target.name, after.name);
    assertEquals(target.settings.theme, after.settings.theme);
    assertEquals(target.tags[1], after.tags[1]);
});

// === Salvage Threshold Tests ===

Deno.test('salvage threshold - low similarity replaces whole object', () => {
    // When <50% of keys match, replace the whole object
    const before = { data: { a: 1, b: 2 } };
    const after = { data: { x: 9, y: 8 } };  // 0% key overlap

    const diff = JSONDiff.getDataDiff(before, after);

    // Should replace 'data' entirely, not diff individual keys
    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'data');
    assertEquals(diff.edited[0][1], { x: 9, y: 8 });
});

Deno.test('salvage threshold - high similarity creates nested diff', () => {
    // When >=50% similar, create nested diffs
    const before = { data: { a: 1, b: 2, c: 3, d: 4 } };
    const after = { data: { a: 1, b: 2, c: 3, d: 99 } };  // 75% same

    const diff = JSONDiff.getDataDiff(before, after);

    // Should diff into 'data', not replace it
    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'data/d');
    assertEquals(diff.edited[0][1], 99);
});

// === Edge Cases - getDataDiff ===

Deno.test('getDataDiff - empty objects', () => {
    const diff = JSONDiff.getDataDiff({}, {});
    assertEquals(diff.edited.length, 0);
});

Deno.test('getDataDiff - empty arrays', () => {
    const before = { items: [] as unknown[] };
    const after = { items: [] as unknown[] };
    const diff = JSONDiff.getDataDiff(before, after);
    assertEquals(diff.edited.length, 0);
});

Deno.test('getDataDiff - deeply nested path', () => {
    // Need 2+ fields at each level to meet salvage threshold (>50% unchanged)
    const before = { a: { b: { c: { d: 1, e: 1 }, c2: 1 }, b2: 1 }, a2: 1 };
    const after = { a: { b: { c: { d: 2, e: 1 }, c2: 1 }, b2: 1 }, a2: 1 };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'a/b/c/d');
    assertEquals(diff.edited[0][1], 2);
});

Deno.test('getDataDiff - type change object to primitive', () => {
    const before = { value: { nested: 1 } };
    const after = { value: 42 };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'value');
    assertEquals(diff.edited[0][1], 42);
});

Deno.test('getDataDiff - type change array to object', () => {
    const before = { value: [1, 2, 3] };
    const after = { value: { a: 1 } };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'value');
});

Deno.test('getDataDiff - null value handling', () => {
    const before = { value: 'hello' };
    const after = { value: null };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][1], null);
});

Deno.test('getDataDiff - boolean change', () => {
    const before = { enabled: true };
    const after = { enabled: false };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][1], false);
});

Deno.test('getDataDiff - number variations', () => {
    const before = { int: 1, float: 1.5, negative: -10 };
    const after = { int: 2, float: 2.5, negative: -20 };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEquals(diff.edited.length, 3);
});

// === Edge Cases - applyDataDiff ===

Deno.test('applyDataDiff - create nested path that doesn\'t exist', () => {
    const target: Record<string, unknown> = {};
    const diff = { edited: [['a/b/c', 'value']] } as Diff;
    JSONDiff.applyDataDiff(target, diff);

    assertEquals((target.a as Record<string, unknown> as Record<string, Record<string, string>>).b.c, 'value');
});

Deno.test('applyDataDiff - multi-element array deletion', () => {
    const target = { items: ['a', 'b', 'c', 'd', 'e'] };
    const diff = { edited: [
        ['items/1[]', JSONDiff.DELETE_SENTINEL],
        ['items/3[]', JSONDiff.DELETE_SENTINEL]
    ]} as Diff;
    JSONDiff.applyDataDiff(target, diff);

    // Should delete indices 1 ("b") and 3 ("d"), leaving ["a", "c", "e"]
    assertEquals(target.items.length, 3);
    assertEquals(target.items, ['a', 'c', 'e']);
});

Deno.test('applyDataDiff - apply to empty object', () => {
    const target: Record<string, unknown> = {};
    const diff = { edited: [['name', 'Alice']] } as Diff;
    JSONDiff.applyDataDiff(target, diff);

    assertEquals(target.name, 'Alice');
});

Deno.test('applyDataDiff - apply empty diff is no-op', () => {
    const target = { name: 'Alice' };
    const diff = { edited: [] } as Diff;
    JSONDiff.applyDataDiff(target, diff);

    assertEquals(target.name, 'Alice');
});

// === Edge Cases - Arrays ===

Deno.test('getDataDiff - array grows', () => {
    const before = { items: ['a', 'b'] };
    const after = { items: ['a', 'b', 'c'] };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'items/2[]');
    assertEquals(diff.edited[0][1], 'c');
});

Deno.test('getDataDiff - array shrinks', () => {
    const before = { items: ['a', 'b', 'c'] };
    const after = { items: ['a'] };
    const diff = JSONDiff.getDataDiff(before, after);

    // Only 33% unchanged (1/3), below 50% threshold, so whole array is replaced
    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'items');
});

Deno.test('getDataDiff - array element type change', () => {
    const before = { items: [1, 2, 3] };
    const after = { items: [1, 'two', 3] };
    const diff = JSONDiff.getDataDiff(before, after);

    assertEquals(diff.edited.length, 1);
    assertEquals(diff.edited[0][0], 'items/1[]');
    assertEquals(diff.edited[0][1], 'two');
});

// === Edge Cases - mergeDiffs ===

Deno.test('mergeDiffs - merge with empty diffA', () => {
    const diffA = { edited: [] } as Diff;
    const diffB = { edited: [['name', 'Bob']] } as Diff;
    const merged = JSONDiff.mergeDiffs(diffA, diffB);

    assertEquals(merged.edited.length, 1);
    assertEquals(merged.edited[0][1], 'Bob');
});

Deno.test('mergeDiffs - merge with empty diffB', () => {
    const diffA = { edited: [['name', 'Alice']] } as Diff;
    const diffB = { edited: [] } as Diff;
    const merged = JSONDiff.mergeDiffs(diffA, diffB);

    assertEquals(merged.edited.length, 1);
    assertEquals(merged.edited[0][1], 'Alice');
});

Deno.test('mergeDiffs - deep nested path merging', () => {
    const diffA = { edited: [['a/b/c', 1]] } as Diff;
    const diffB = { edited: [['a/b/d', 2]] } as Diff;
    const merged = JSONDiff.mergeDiffs(diffA, diffB);

    assertEquals(merged.edited.length, 2);
});
