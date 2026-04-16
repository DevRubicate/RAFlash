/**
 * Formula Compilation Edge Case Tests (v0.0.19 release coverage)
 *
 * End-to-end compilation tests for features/fixes since v0.0.18:
 *   - Unary negation (-expr)
 *   - AND/XOR/OR precedence
 *   - Numeric dot access (root.tooltips.60)
 *   - len() function
 *   - Floating-point literals
 *   - Remembered values
 *   - Bare 0x/0b prefix rejection
 *   - NOT operator
 *   - Ternary expressions
 *   - Leading dot / implicit this
 */

import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { Formula } from "../src/formula/Formula.ts";

const ERROR_MARKER = ["VERSION_1", "STRING", "ERROR"];

// =============================================================================
// Unary Negation
// =============================================================================

Deno.test("compile - unary negation of number", () => {
    const bytecode = Formula.compile("-5");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("SUB"), true);
    // Should contain VALUE 0 and VALUE 5
    const valueIndices = bytecode.reduce((acc: number[], s: string, i: number) => {
        if (s === "VALUE") acc.push(i);
        return acc;
    }, []);
    assertEquals(valueIndices.length, 2);
    assertEquals(bytecode[valueIndices[0] + 1], "0");
    assertEquals(bytecode[valueIndices[1] + 1], "5");
});

Deno.test("compile - unary negation of identifier", () => {
    const bytecode = Formula.compile("-x");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("SUB"), true);
    assertEquals(bytecode.includes("VALUE"), true);
    assertEquals(bytecode.includes("READ_GLOBAL"), true);
});

Deno.test("compile - negation in arithmetic: -x + 5", () => {
    const bytecode = Formula.compile("-x + 5");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("SUB"), true);
    assertEquals(bytecode.includes("ADD"), true);
});

Deno.test("compile - negation of property access", () => {
    const bytecode = Formula.compile("-stage.player.health");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("SUB"), true);
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
});

// =============================================================================
// AND/XOR/OR Precedence
// =============================================================================

Deno.test("compile - AND and OR produce different bytecode order", () => {
    // "a && b || c" → AND first, then OR (AND binds tighter)
    const bytecodeAO = Formula.compile("a && b || c");
    assertEquals(bytecodeAO[0], "VERSION_1");
    const andIdxAO = bytecodeAO.indexOf("AND");
    const orIdxAO = bytecodeAO.indexOf("OR");
    assertEquals(andIdxAO >= 0, true);
    assertEquals(orIdxAO >= 0, true);
    // In RPN, AND should come before OR since it's deeper in the tree
    assertEquals(andIdxAO < orIdxAO, true);
});

Deno.test("compile - OR and AND reversed: a || b && c", () => {
    // Same as above — AND still evaluates before OR
    const bytecode = Formula.compile("a || b && c");
    const andIdx = bytecode.indexOf("AND");
    const orIdx = bytecode.indexOf("OR");
    assertEquals(andIdx < orIdx, true);
});

Deno.test("compile - XOR between AND and OR", () => {
    const bytecode = Formula.compile("a || b ^ c && d");
    const andIdx = bytecode.indexOf("AND");
    const xorIdx = bytecode.indexOf("XOR");
    const orIdx = bytecode.indexOf("OR");
    // AND < XOR < OR in bytecode position (RPN order)
    assertEquals(andIdx < xorIdx, true);
    assertEquals(xorIdx < orIdx, true);
});

Deno.test("compile - all three logical ops", () => {
    const bytecode = Formula.compile("a && b ^ c || d");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("AND"), true);
    assertEquals(bytecode.includes("XOR"), true);
    assertEquals(bytecode.includes("OR"), true);
});

// =============================================================================
// Numeric Dot Access
// =============================================================================

Deno.test("compile - numeric property name", () => {
    const bytecode = Formula.compile("root.tooltips.60");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
    // The number 60 should appear as an IDENTIFIER string comparison, not a VALUE
    assertEquals(bytecode.includes("IDENTIFIER"), true);
});

Deno.test("compile - numeric property name in comparison", () => {
    const bytecode = Formula.compile("root.tooltips.60 == 1");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("EQUAL"), true);
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
});

Deno.test("compile - chained numeric properties", () => {
    // "root.0.1" — lexer sees 0.1 as a float, so only 1 OBJECT_ACCESS (root → "0.1")
    const bytecode = Formula.compile("root.0.1");
    assertEquals(bytecode[0], "VERSION_1");
    const accessCount = bytecode.filter((s: string) => s === "OBJECT_ACCESS").length;
    assertEquals(accessCount, 1);
});

// =============================================================================
// len() Function
// =============================================================================

Deno.test("compile - len() basic", () => {
    const bytecode = Formula.compile("len(stage)");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("LEN"), true);
});

Deno.test("compile - len() with property chain", () => {
    const bytecode = Formula.compile("len(stage.enemies)");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("LEN"), true);
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
});

Deno.test("compile - len() in boolean condition", () => {
    const bytecode = Formula.compile("len(stage.enemies) > 0 && len(stage.allies) > 0");
    assertEquals(bytecode[0], "VERSION_1");
    const lenCount = bytecode.filter((s: string) => s === "LEN").length;
    assertEquals(lenCount, 2);
    assertEquals(bytecode.includes("AND"), true);
});

Deno.test("compile - len() of array index", () => {
    const bytecode = Formula.compile("len(stage.items[0])");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("LEN"), true);
    assertEquals(bytecode.includes("ARRAY_ACCESS"), true);
});

// =============================================================================
// Bare 0x/0b Rejection
// =============================================================================

Deno.test("compile - bare 0x returns error", () => {
    assertEquals(Formula.compile("0x"), ERROR_MARKER);
});

Deno.test("compile - bare 0b returns error", () => {
    assertEquals(Formula.compile("0b"), ERROR_MARKER);
});

Deno.test("compile - 0x in expression returns error", () => {
    assertEquals(Formula.compile("5 + 0x"), ERROR_MARKER);
});

// =============================================================================
// NOT Operator
// =============================================================================

Deno.test("compile - NOT on identifier", () => {
    const bytecode = Formula.compile("!x");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("NOT"), true);
    assertEquals(bytecode.includes("READ_GLOBAL"), true);
});

Deno.test("compile - NOT on property chain", () => {
    const bytecode = Formula.compile("!stage.player.dead");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("NOT"), true);
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
});

Deno.test("compile - NOT in AND condition", () => {
    const bytecode = Formula.compile("!stage.player.dead && stage.level.coins > 0");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("NOT"), true);
    assertEquals(bytecode.includes("AND"), true);
    assertEquals(bytecode.includes("GREATER"), true);
});

Deno.test("compile - double NOT", () => {
    const bytecode = Formula.compile("!!x");
    assertEquals(bytecode[0], "VERSION_1");
    const notCount = bytecode.filter((s: string) => s === "NOT").length;
    assertEquals(notCount, 2);
});

// =============================================================================
// Remembered Values
// =============================================================================

Deno.test("compile - simple remembered value", () => {
    const bytecode = Formula.compile("{stage.score}");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("REMEMBER"), true);
});

Deno.test("compile - remembered value in comparison", () => {
    const bytecode = Formula.compile("{stage.score} > 100");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("REMEMBER"), true);
    assertEquals(bytecode.includes("GREATER"), true);
});

Deno.test("compile - remembered value with len()", () => {
    const bytecode = Formula.compile("{len(stage.items)}");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("REMEMBER"), true);
    assertEquals(bytecode.includes("LEN"), true);
});

// =============================================================================
// Ternary Expressions
// =============================================================================

Deno.test("compile - simple ternary", () => {
    const bytecode = Formula.compile("x > 0 ? x : 0");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("TERNARY"), true);
    assertEquals(bytecode.includes("GREATER"), true);
});

Deno.test("compile - ternary with property access", () => {
    const bytecode = Formula.compile("stage.hp != null ? stage.hp : 0");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("TERNARY"), true);
    assertEquals(bytecode.includes("NOT_EQUAL"), true);
    assertEquals(bytecode.includes("NULL"), true);
});

Deno.test("compile - nested ternary", () => {
    const bytecode = Formula.compile("a > 0 ? a > 5 ? 2 : 1 : 0");
    assertEquals(bytecode[0], "VERSION_1");
    const ternaryCount = bytecode.filter((s: string) => s === "TERNARY").length;
    assertEquals(ternaryCount, 2);
});

// =============================================================================
// Leading Dot (implicit this)
// =============================================================================

Deno.test("compile - leading dot produces implicit this", () => {
    const bytecode = Formula.compile(".health");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
    // Should have READ_GLOBAL for "this"
    const thisIdx = bytecode.indexOf("this");
    assertEquals(thisIdx >= 0, true);
});

Deno.test("compile - leading dot chained access", () => {
    const bytecode = Formula.compile(".player.health");
    assertEquals(bytecode[0], "VERSION_1");
    const accessCount = bytecode.filter((s: string) => s === "OBJECT_ACCESS").length;
    assertEquals(accessCount, 2);
});

// =============================================================================
// Complex Combinations
// =============================================================================

Deno.test("compile - negation with len()", () => {
    const bytecode = Formula.compile("-len(stage.enemies)");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("SUB"), true);
    assertEquals(bytecode.includes("LEN"), true);
});

Deno.test("compile - len() with numeric dot access", () => {
    const bytecode = Formula.compile("len(root.tooltips.60)");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("LEN"), true);
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
});

Deno.test("compile - float in ternary", () => {
    const bytecode = Formula.compile("x > 3.14 ? 1.0 : 0.5");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("TERNARY"), true);
});

Deno.test("compile - all logical ops with comparisons", () => {
    const bytecode = Formula.compile("a > 0 && b < 5 ^ c == 1 || d != null");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("AND"), true);
    assertEquals(bytecode.includes("XOR"), true);
    assertEquals(bytecode.includes("OR"), true);
});

Deno.test("compile - NOT with remembered value", () => {
    const bytecode = Formula.compile("!{stage.player.dead}");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("NOT"), true);
    assertEquals(bytecode.includes("REMEMBER"), true);
});
