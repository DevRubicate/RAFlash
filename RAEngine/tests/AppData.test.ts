/**
 * AppData Pure Function Tests
 *
 * Tests for stripAssetData, sanitizeAssetForSave, and isAssetModified.
 * These are the testable pure functions in AppData that don't require file I/O.
 */

import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { AppData } from "../src/AppData.ts";

// =============================================================================
// stripAssetData
// =============================================================================

const simpleSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        id: { type: 'number' },
        name: { type: 'string' },
    },
};

Deno.test("stripAssetData - keeps schema-defined properties", () => {
    const data = { id: 1, name: "Test" };
    const result = AppData.stripAssetData(data, simpleSchema);
    assertEquals(result, { id: 1, name: "Test" });
});

Deno.test("stripAssetData - removes extra properties", () => {
    const data = { id: 1, name: "Test", _compiled: "bytecode", _internal: true };
    const result = AppData.stripAssetData(data, simpleSchema);
    assertEquals(result, { id: 1, name: "Test" });
});

Deno.test("stripAssetData - handles missing optional properties", () => {
    const data = { id: 1 };
    const result = AppData.stripAssetData(data, simpleSchema);
    assertEquals(result, { id: 1 });
});

Deno.test("stripAssetData - returns empty object for empty data", () => {
    const result = AppData.stripAssetData({}, simpleSchema);
    assertEquals(result, {});
});

Deno.test("stripAssetData - returns primitive as-is for non-object", () => {
    const result = AppData.stripAssetData(42 as unknown, simpleSchema);
    assertEquals(result, 42 as unknown as Record<string, unknown>);
});

Deno.test("stripAssetData - returns null as-is", () => {
    const result = AppData.stripAssetData(null, simpleSchema);
    assertEquals(result, null as unknown as Record<string, unknown>);
});

Deno.test("stripAssetData - returns empty object when schema has no properties", () => {
    const result = AppData.stripAssetData({ id: 1 }, { type: 'object' });
    assertEquals(result, {});
});

// Nested object schema
const nestedSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        id: { type: 'number' },
        config: {
            type: 'object',
            properties: {
                theme: { type: 'string' },
                volume: { type: 'number' },
            },
        },
    },
};

Deno.test("stripAssetData - strips nested objects recursively", () => {
    const data = {
        id: 1,
        config: { theme: "dark", volume: 80, _cache: "stale" },
        _extra: true,
    };
    const result = AppData.stripAssetData(data, nestedSchema);
    assertEquals(result, { id: 1, config: { theme: "dark", volume: 80 } });
});

// Array schema
const arraySchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'number' },
                    value: { type: 'string' },
                },
            },
        },
    },
};

Deno.test("stripAssetData - strips array items recursively", () => {
    const data = {
        items: [
            { id: 1, value: "a", _compiled: true },
            { id: 2, value: "b", _compiled: false },
        ],
    };
    const result = AppData.stripAssetData(data, arraySchema) as Record<string, unknown>;
    assertEquals(result.items, [
        { id: 1, value: "a" },
        { id: 2, value: "b" },
    ]);
});

Deno.test("stripAssetData - array without items schema returns empty array", () => {
    const data = [1, 2, 3];
    const result = AppData.stripAssetData(data, { type: 'array' });
    assertEquals(result, [] as unknown as Record<string, unknown>);
});

// Using the real asset schema
Deno.test("stripAssetData - real schema strips computed fields from asset", () => {
    const asset = {
        id: 1,
        name: "Beat Level 1",
        description: "Complete the first level",
        type: "achievement",
        points: 10,
        _saved: true,
        _modified: false,
        _originalSnapshot: {},
        compiledFormula: "bytecode...",
        groups: [{
            id: 1,
            type: "AND",
            requirements: [{
                id: 1,
                flag: "",
                typeA: "stage",
                addressA: "stage.level == 2",
                _compiledA: ["VERSION_1"],
                typeB: "value",
                addressB: "1",
            }],
        }],
    };

    const result = AppData.stripAssetData(asset, AppData.assetSchema) as Record<string, unknown>;

    // Should keep schema-defined fields
    assertEquals((result as Record<string, unknown>).id, 1);
    assertEquals((result as Record<string, unknown>).name, "Beat Level 1");
    assertEquals((result as Record<string, unknown>).points, 10);

    // Should strip computed/internal fields
    assertEquals("_saved" in result, false);
    assertEquals("_modified" in result, false);
    assertEquals("_originalSnapshot" in result, false);
    assertEquals("compiledFormula" in result, false);

    // Should strip computed fields from nested requirements
    const groups = (result as Record<string, unknown>).groups as Array<Record<string, unknown>>;
    const reqs = groups[0].requirements as Array<Record<string, unknown>>;
    assertEquals("_compiledA" in reqs[0], false);
    assertEquals(reqs[0].addressA, "stage.level == 2");
});

// =============================================================================
// sanitizeAssetForSave
// =============================================================================

Deno.test("sanitizeAssetForSave - filters null requirements", () => {
    const asset = {
        id: 1,
        groups: [{
            id: 1,
            requirements: [
                { id: 1, maxHits: 0 },
                null,
                { id: 2, maxHits: 5 },
                undefined,
            ],
        }],
    } as any;

    AppData.sanitizeAssetForSave(asset);
    assertEquals(asset.groups[0].requirements.length, 2);
    assertEquals(asset.groups[0].requirements[0].id, 1);
    assertEquals(asset.groups[0].requirements[1].id, 2);
});

Deno.test("sanitizeAssetForSave - normalizes maxHits to integer", () => {
    const asset = {
        id: 1,
        groups: [{
            id: 1,
            requirements: [
                { id: 1, maxHits: 3.7 },
                { id: 2, maxHits: undefined },
                { id: 3, maxHits: null },
                { id: 4, maxHits: NaN },
                { id: 5, maxHits: Infinity },
            ],
        }],
    } as any;

    AppData.sanitizeAssetForSave(asset);
    const reqs = asset.groups[0].requirements;
    assertEquals(reqs[0].maxHits, 3);   // floored
    assertEquals(reqs[1].maxHits, 0);   // undefined → 0
    assertEquals(reqs[2].maxHits, 0);   // null → 0
    assertEquals(reqs[3].maxHits, 0);   // NaN → 0
    assertEquals(reqs[4].maxHits, 0);   // Infinity → 0
});

Deno.test("sanitizeAssetForSave - no-op for asset without groups", () => {
    const asset = { id: 1 } as any;
    AppData.sanitizeAssetForSave(asset);
    assertEquals(asset.id, 1);
});

Deno.test("sanitizeAssetForSave - no-op for group without requirements", () => {
    const asset = { id: 1, groups: [{ id: 1 }] } as any;
    AppData.sanitizeAssetForSave(asset);
    assertEquals(asset.groups[0].id, 1);
});

Deno.test("sanitizeAssetForSave - valid maxHits integers unchanged", () => {
    const asset = {
        id: 1,
        groups: [{
            id: 1,
            requirements: [
                { id: 1, maxHits: 0 },
                { id: 2, maxHits: 5 },
                { id: 3, maxHits: 100 },
            ],
        }],
    } as any;

    AppData.sanitizeAssetForSave(asset);
    assertEquals(asset.groups[0].requirements[0].maxHits, 0);
    assertEquals(asset.groups[0].requirements[1].maxHits, 5);
    assertEquals(asset.groups[0].requirements[2].maxHits, 100);
});

// =============================================================================
// isAssetModified
// =============================================================================

Deno.test("isAssetModified - returns false for unsaved asset", () => {
    const asset = { id: 1, name: "Test", _saved: false } as any;
    assertEquals(AppData.isAssetModified(asset), false);
});

Deno.test("isAssetModified - returns false for unmodified asset", () => {
    const asset = {
        id: 1,
        name: "Test",
        _saved: true,
        _originalSnapshot: AppData.stripAssetData({ id: 1, name: "Test" }, AppData.assetSchema),
    } as any;
    assertEquals(AppData.isAssetModified(asset), false);
});

Deno.test("isAssetModified - returns true when name changed", () => {
    const original = { id: 1, name: "Original" };
    const asset = {
        id: 1,
        name: "Changed",
        _saved: true,
        _originalSnapshot: AppData.stripAssetData(original, AppData.assetSchema),
    } as any;
    assertEquals(AppData.isAssetModified(asset), true);
});

Deno.test("isAssetModified - ignores computed fields", () => {
    const original = { id: 1, name: "Test" };
    const asset = {
        id: 1,
        name: "Test",
        _saved: true,
        _compiled: "new bytecode",
        _internal: true,
        _originalSnapshot: AppData.stripAssetData(original, AppData.assetSchema),
    } as any;
    // Computed fields (_compiled, _internal) not in schema, so should be ignored
    assertEquals(AppData.isAssetModified(asset), false);
});

Deno.test("isAssetModified - returns false when no snapshot", () => {
    const asset = { id: 1, name: "Test", _saved: true, _originalSnapshot: null } as any;
    assertEquals(AppData.isAssetModified(asset), false);
});
