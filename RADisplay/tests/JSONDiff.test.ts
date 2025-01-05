/**
 * JSONDiff Unit Tests (Vitest)
 */

import { test, expect } from 'vitest';
import { JSONDiff } from '../src/js/JSONDiff.js';

// === getDataDiff Tests ===

test('getDataDiff - no changes returns empty diff', () => {
    const before = { name: 'Alice', age: 30 };
    const after = { name: 'Alice', age: 30 };
    const diff = JSONDiff.getDataDiff(before, after);
    expect(diff.edited.length).toBe(0);
});

test('getDataDiff - primitive value change', () => {
    const before = { name: 'Alice' };
    const after = { name: 'Bob' };
    const diff = JSONDiff.getDataDiff(before, after);
    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('name');
    expect(diff.edited[0][1]).toBe('Bob');
});

test('getDataDiff - nested object change', () => {
    // Need 2+ fields with >50% unchanged to trigger deep diff (salvage threshold)
    const before = { user: { name: 'Alice', age: 30 } };
    const after = { user: { name: 'Bob', age: 30 } };
    const diff = JSONDiff.getDataDiff(before, after);
    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('user/name');
    expect(diff.edited[0][1]).toBe('Bob');
});

test('getDataDiff - array element change', () => {
    const before = { items: ['a', 'b', 'c'] };
    const after = { items: ['a', 'X', 'c'] };
    const diff = JSONDiff.getDataDiff(before, after);
    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('items/1[]');
    expect(diff.edited[0][1]).toBe('X');
});

test('getDataDiff - property deletion', () => {
    const before = { name: 'Alice', age: 30 };
    const after = { name: 'Alice' };
    const diff = JSONDiff.getDataDiff(before, after);
    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('age');
    expect(diff.edited[0][1]).toBe(JSONDiff.DELETE_SENTINEL);
});

test('getDataDiff - property addition', () => {
    const before = { name: 'Alice' };
    const after = { name: 'Alice', age: 30 };
    const diff = JSONDiff.getDataDiff(before, after);
    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('age');
    expect(diff.edited[0][1]).toBe(30);
});

// === applyDataDiff Tests ===

test('applyDataDiff - apply primitive change', () => {
    const target = { name: 'Alice' };
    const diff = { edited: [['name', 'Bob']] };
    JSONDiff.applyDataDiff(target, diff);
    expect(target.name).toBe('Bob');
});

test('applyDataDiff - apply nested change', () => {
    const target = { user: { name: 'Alice' } };
    const diff = { edited: [['user/name', 'Bob']] };
    JSONDiff.applyDataDiff(target, diff);
    expect(target.user.name).toBe('Bob');
});

test('applyDataDiff - apply deletion', () => {
    const target: any = { name: 'Alice', age: 30 };
    const diff = { edited: [['age', JSONDiff.DELETE_SENTINEL]] };
    JSONDiff.applyDataDiff(target, diff);
    expect(target.name).toBe('Alice');
    expect('age' in target).toBe(false);
});

test('applyDataDiff - apply to array', () => {
    const target = { items: ['a', 'b', 'c'] };
    const diff = { edited: [['items/1[]', 'X']] };
    JSONDiff.applyDataDiff(target, diff);
    expect(target.items).toEqual(['a', 'X', 'c']);
});

test('applyDataDiff - array deletion removes element', () => {
    const target = { items: ['a', 'b', 'c'] };
    const diff = { edited: [['items/1[]', JSONDiff.DELETE_SENTINEL]] };
    JSONDiff.applyDataDiff(target, diff);
    expect(target.items).toEqual(['a', 'c']);
});

// === isPointlessDiff Tests ===

test('isPointlessDiff - empty edited array returns true', () => {
    const diff = { edited: [] };
    expect(JSONDiff.isPointlessDiff(diff)).toBe(true);
});

test('isPointlessDiff - has changes returns false', () => {
    const diff = { edited: [['name', 'Bob']] };
    expect(JSONDiff.isPointlessDiff(diff)).toBe(false);
});

// === mergeDiffs Tests ===

test('mergeDiffs - merge two non-overlapping diffs', () => {
    const diffA = { edited: [['name', 'Alice']] };
    const diffB = { edited: [['age', 30]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    expect(merged.edited.length).toBe(2);
});

test('mergeDiffs - second diff overwrites first for same key', () => {
    const diffA = { edited: [['name', 'Alice']] };
    const diffB = { edited: [['name', 'Bob']] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    expect(merged.edited.length).toBe(1);
    expect(merged.edited[0][1]).toBe('Bob');
});

test('mergeDiffs - throws on conflict: modifying deleted path', () => {
    const diffA = { edited: [['user', JSONDiff.DELETE_SENTINEL]] };
    const diffB = { edited: [['user/name', 'Bob']] };
    expect(() => JSONDiff.mergeDiffs(diffA, diffB)).toThrow(/deleted/);
});

test('mergeDiffs - throws on conflict: modifying primitive child', () => {
    const diffA = { edited: [['config', 123]] };
    const diffB = { edited: [['config/timeout', 5000]] };
    expect(() => JSONDiff.mergeDiffs(diffA, diffB)).toThrow(/non-object/);
});

test('mergeDiffs - parent replacement removes child ops', () => {
    const diffA = { edited: [['user/name', 'Alice'], ['user/age', 30]] };
    const diffB = { edited: [['user', { name: 'Bob' }]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);
    expect(merged.edited.length).toBe(1);
    expect(merged.edited[0][0]).toBe('user');
});

test('isPointlessDiff - null diff returns true', () => {
    expect(JSONDiff.isPointlessDiff(null as any)).toBe(true);
});

// === Round-trip Tests ===

test('round-trip - diff and apply produces identical result', () => {
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

    expect(target.name).toBe(after.name);
    expect(target.settings.theme).toBe(after.settings.theme);
    expect(target.tags[1]).toBe(after.tags[1]);
});

// === Salvage Threshold Tests ===

test('salvage threshold - low similarity replaces whole object', () => {
    // When <50% of keys match, replace the whole object
    const before = { data: { a: 1, b: 2 } };
    const after = { data: { x: 9, y: 8 } };  // 0% key overlap

    const diff = JSONDiff.getDataDiff(before, after);

    // Should replace 'data' entirely, not diff individual keys
    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('data');
    expect(diff.edited[0][1]).toEqual({ x: 9, y: 8 });
});

test('salvage threshold - high similarity creates nested diff', () => {
    // When >=50% similar, create nested diffs
    const before = { data: { a: 1, b: 2, c: 3, d: 4 } };
    const after = { data: { a: 1, b: 2, c: 3, d: 99 } };  // 75% same

    const diff = JSONDiff.getDataDiff(before, after);

    // Should diff into 'data', not replace it
    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('data/d');
    expect(diff.edited[0][1]).toBe(99);
});

// === Edge Cases - getDataDiff ===

test('getDataDiff - empty objects', () => {
    const diff = JSONDiff.getDataDiff({}, {});
    expect(diff.edited.length).toBe(0);
});

test('getDataDiff - empty arrays', () => {
    const before = { items: [] as any[] };
    const after = { items: [] as any[] };
    const diff = JSONDiff.getDataDiff(before, after);
    expect(diff.edited.length).toBe(0);
});

test('getDataDiff - deeply nested path', () => {
    // Need 2+ fields at each level to meet salvage threshold (>50% unchanged)
    const before = { a: { b: { c: { d: 1, e: 1 }, c2: 1 }, b2: 1 }, a2: 1 };
    const after = { a: { b: { c: { d: 2, e: 1 }, c2: 1 }, b2: 1 }, a2: 1 };
    const diff = JSONDiff.getDataDiff(before, after);

    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('a/b/c/d');
    expect(diff.edited[0][1]).toBe(2);
});

test('getDataDiff - type change object to primitive', () => {
    const before = { value: { nested: 1 } };
    const after = { value: 42 };
    const diff = JSONDiff.getDataDiff(before, after);

    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('value');
    expect(diff.edited[0][1]).toBe(42);
});

test('getDataDiff - type change array to object', () => {
    const before = { value: [1, 2, 3] };
    const after = { value: { a: 1 } };
    const diff = JSONDiff.getDataDiff(before, after);

    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('value');
});

test('getDataDiff - null value handling', () => {
    const before = { value: 'hello' };
    const after = { value: null };
    const diff = JSONDiff.getDataDiff(before, after);

    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][1]).toBe(null);
});

test('getDataDiff - boolean change', () => {
    const before = { enabled: true };
    const after = { enabled: false };
    const diff = JSONDiff.getDataDiff(before, after);

    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][1]).toBe(false);
});

test('getDataDiff - number variations', () => {
    const before = { int: 1, float: 1.5, negative: -10 };
    const after = { int: 2, float: 2.5, negative: -20 };
    const diff = JSONDiff.getDataDiff(before, after);

    expect(diff.edited.length).toBe(3);
});

// === Edge Cases - applyDataDiff ===

test('applyDataDiff - create nested path that doesn\'t exist', () => {
    const target: Record<string, any> = {};
    const diff = { edited: [['a/b/c', 'value']] };
    JSONDiff.applyDataDiff(target, diff);

    expect(target.a.b.c).toBe('value');
});

test('applyDataDiff - multi-element array deletion', () => {
    const target = { items: ['a', 'b', 'c', 'd', 'e'] };
    const diff = { edited: [
        ['items/1[]', JSONDiff.DELETE_SENTINEL],
        ['items/3[]', JSONDiff.DELETE_SENTINEL]
    ]};
    JSONDiff.applyDataDiff(target, diff);

    // Should delete indices 1 ("b") and 3 ("d"), leaving ["a", "c", "e"]
    expect(target.items.length).toBe(3);
    expect(target.items).toEqual(['a', 'c', 'e']);
});

test('applyDataDiff - apply to empty object', () => {
    const target: Record<string, any> = {};
    const diff = { edited: [['name', 'Alice']] };
    JSONDiff.applyDataDiff(target, diff);

    expect(target.name).toBe('Alice');
});

test('applyDataDiff - apply empty diff is no-op', () => {
    const target = { name: 'Alice' };
    const diff = { edited: [] };
    JSONDiff.applyDataDiff(target, diff);

    expect(target.name).toBe('Alice');
});

// === Edge Cases - Arrays ===

test('getDataDiff - array grows', () => {
    const before = { items: ['a', 'b'] };
    const after = { items: ['a', 'b', 'c'] };
    const diff = JSONDiff.getDataDiff(before, after);

    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('items/2[]');
    expect(diff.edited[0][1]).toBe('c');
});

test('getDataDiff - array shrinks', () => {
    const before = { items: ['a', 'b', 'c'] };
    const after = { items: ['a'] };
    const diff = JSONDiff.getDataDiff(before, after);

    // Only 33% unchanged (1/3), below 50% threshold, so whole array is replaced
    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('items');
});

test('getDataDiff - array element type change', () => {
    const before = { items: [1, 2, 3] };
    const after = { items: [1, 'two', 3] };
    const diff = JSONDiff.getDataDiff(before, after);

    expect(diff.edited.length).toBe(1);
    expect(diff.edited[0][0]).toBe('items/1[]');
    expect(diff.edited[0][1]).toBe('two');
});

// === Edge Cases - mergeDiffs ===

test('mergeDiffs - merge with empty diffA', () => {
    const diffA = { edited: [] };
    const diffB = { edited: [['name', 'Bob']] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);

    expect(merged.edited.length).toBe(1);
    expect(merged.edited[0][1]).toBe('Bob');
});

test('mergeDiffs - merge with empty diffB', () => {
    const diffA = { edited: [['name', 'Alice']] };
    const diffB = { edited: [] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);

    expect(merged.edited.length).toBe(1);
    expect(merged.edited[0][1]).toBe('Alice');
});

test('mergeDiffs - deep nested path merging', () => {
    const diffA = { edited: [['a/b/c', 1]] };
    const diffB = { edited: [['a/b/d', 2]] };
    const merged = JSONDiff.mergeDiffs(diffA, diffB);

    expect(merged.edited.length).toBe(2);
});
