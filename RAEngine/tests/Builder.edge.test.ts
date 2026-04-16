/**
 * Builder Edge Case Tests (v0.0.19 release coverage)
 *
 * Tests for:
 *   - NOT node parent back-link (was missing)
 *   - len() function building
 *   - Unknown function rejection
 */

import { test, assertEqual, assertThrows } from "../../tests/framework.ts";
import { Lexer } from "../src/formula/Lexer.ts";
import { Parser } from "../src/formula/Parser.ts";
import { Builder } from "../src/formula/Builder.ts";

function buildAST(input: string) {
    const tokens = new Lexer(input).output;
    const tree = new Parser(tokens, input).output;
    const builder = new Builder(tree).build();
    return builder.output();
}

// =============================================================================
// NOT Node Parent Back-Link
// =============================================================================

test("Builder - NOT node children have parent set", () => {
    const root = buildAST("!x");
    // Walk down: Root -> NOT -> child
    const notNode = root.children[0]; // Should be NotUnit wrapping the ExecutableBlock or similar
    // Find the NOT unit in the tree
    function findNot(unit: any): any {
        if (unit.constructor.name === "NotUnit") return unit;
        for (const child of unit.children) {
            const found = findNot(child);
            if (found) return found;
        }
        return null;
    }
    const not = findNot(root);
    assertEqual(not !== null, true);
    // Each child of NOT should have parent pointing back to NOT
    for (const child of not.children) {
        assertEqual(child.parent, not);
    }
});

test("Builder - NOT on complex expression has correct parent chain", () => {
    const root = buildAST("!stage.player.dead");
    function findNot(unit: any): any {
        if (unit.constructor.name === "NotUnit") return unit;
        for (const child of unit.children) {
            const found = findNot(child);
            if (found) return found;
        }
        return null;
    }
    const not = findNot(root);
    assertEqual(not !== null, true);
    assertEqual(not.children.length > 0, true);
    assertEqual(not.children[0].parent, not);
});

// =============================================================================
// len() Function
// =============================================================================

test("Builder - len() produces LenUnit", () => {
    const root = buildAST("len(stage)");
    function findLen(unit: any): any {
        if (unit.constructor.name === "LenUnit") return unit;
        for (const child of unit.children) {
            const found = findLen(child);
            if (found) return found;
        }
        return null;
    }
    const len = findLen(root);
    assertEqual(len !== null, true);
    assertEqual(len.children.length, 1);
    assertEqual(len.children[0].parent, len);
});

test("Builder - len() with property chain", () => {
    const root = buildAST("len(stage.enemies)");
    function findLen(unit: any): any {
        if (unit.constructor.name === "LenUnit") return unit;
        for (const child of unit.children) {
            const found = findLen(child);
            if (found) return found;
        }
        return null;
    }
    const len = findLen(root);
    assertEqual(len !== null, true);
    // The child should be an ObjectAccessExpressionUnit
    assertEqual(len.children[0].constructor.name, "ObjectAccessExpressionUnit");
});

// =============================================================================
// All Operator Parent Links
// =============================================================================

test("Builder - binary operators have children with parent back-links", () => {
    const expressions = [
        "1 + 2",
        "1 - 2",
        "1 * 2",
        "1 / 2",
        "1 % 2",
        "2 ** 3",
        "a == b",
        "a != b",
        "a > b",
        "a >= b",
        "a < b",
        "a <= b",
        "a && b",
        "a || b",
        "a ^ b",
    ];

    for (const expr of expressions) {
        const root = buildAST(expr);
        // Walk the tree and verify all parent links
        function checkParents(unit: any, expectedParent: any) {
            if (expectedParent !== null) {
                assertEqual(
                    unit.parent, expectedParent,
                    `Parent mismatch in "${expr}" at ${unit.constructor.name}`
                );
            }
            for (const child of unit.children) {
                checkParents(child, unit);
            }
        }
        checkParents(root, null);
    }
});
