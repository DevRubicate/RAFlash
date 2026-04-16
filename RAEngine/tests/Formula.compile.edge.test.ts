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

import { test, assertEqual } from "../../tests/framework.ts";
import { Formula } from "../src/formula/Formula.ts";

const ERROR_MARKER = ["VERSION_1", "STRING", "ERROR"];

// =============================================================================
// Unary Negation
// =============================================================================

test("compile - unary negation of number", () => {
    const bytecode = Formula.compile("-5");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("SUB"), true);
    // Should contain VALUE 0 and VALUE 5
    const valueIndices = bytecode.reduce((acc: number[], s: string, i: number) => {
        if (s === "VALUE") acc.push(i);
        return acc;
    }, []);
    assertEqual(valueIndices.length, 2);
    assertEqual(bytecode[valueIndices[0] + 1], "0");
    assertEqual(bytecode[valueIndices[1] + 1], "5");
});

test("compile - unary negation of identifier", () => {
    const bytecode = Formula.compile("-x");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("SUB"), true);
    assertEqual(bytecode.includes("VALUE"), true);
    assertEqual(bytecode.includes("READ_GLOBAL"), true);
});

test("compile - negation in arithmetic: -x + 5", () => {
    const bytecode = Formula.compile("-x + 5");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("SUB"), true);
    assertEqual(bytecode.includes("ADD"), true);
});

test("compile - negation of property access", () => {
    const bytecode = Formula.compile("-stage.player.health");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("SUB"), true);
    assertEqual(bytecode.includes("OBJECT_ACCESS"), true);
});

// =============================================================================
// AND/XOR/OR Precedence
// =============================================================================

test("compile - AND and OR produce different bytecode order", () => {
    // "a && b || c" → AND first, then OR (AND binds tighter)
    const bytecodeAO = Formula.compile("a && b || c");
    assertEqual(bytecodeAO[0], "VERSION_1");
    const andIdxAO = bytecodeAO.indexOf("AND");
    const orIdxAO = bytecodeAO.indexOf("OR");
    assertEqual(andIdxAO >= 0, true);
    assertEqual(orIdxAO >= 0, true);
    // In RPN, AND should come before OR since it's deeper in the tree
    assertEqual(andIdxAO < orIdxAO, true);
});

test("compile - OR and AND reversed: a || b && c", () => {
    // Same as above — AND still evaluates before OR
    const bytecode = Formula.compile("a || b && c");
    const andIdx = bytecode.indexOf("AND");
    const orIdx = bytecode.indexOf("OR");
    assertEqual(andIdx < orIdx, true);
});

test("compile - XOR between AND and OR", () => {
    const bytecode = Formula.compile("a || b ^ c && d");
    const andIdx = bytecode.indexOf("AND");
    const xorIdx = bytecode.indexOf("XOR");
    const orIdx = bytecode.indexOf("OR");
    // AND < XOR < OR in bytecode position (RPN order)
    assertEqual(andIdx < xorIdx, true);
    assertEqual(xorIdx < orIdx, true);
});

test("compile - all three logical ops", () => {
    const bytecode = Formula.compile("a && b ^ c || d");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("AND"), true);
    assertEqual(bytecode.includes("XOR"), true);
    assertEqual(bytecode.includes("OR"), true);
});

// =============================================================================
// Numeric Dot Access
// =============================================================================

test("compile - numeric property name", () => {
    const bytecode = Formula.compile("root.tooltips.60");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("OBJECT_ACCESS"), true);
    // The number 60 should appear as an IDENTIFIER string comparison, not a VALUE
    assertEqual(bytecode.includes("IDENTIFIER"), true);
});

test("compile - numeric property name in comparison", () => {
    const bytecode = Formula.compile("root.tooltips.60 == 1");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("EQUAL"), true);
    assertEqual(bytecode.includes("OBJECT_ACCESS"), true);
});

test("compile - chained numeric properties", () => {
    // "root.0.1" — lexer sees 0.1 as a float, so only 1 OBJECT_ACCESS (root → "0.1")
    const bytecode = Formula.compile("root.0.1");
    assertEqual(bytecode[0], "VERSION_1");
    const accessCount = bytecode.filter((s: string) => s === "OBJECT_ACCESS").length;
    assertEqual(accessCount, 1);
});

// =============================================================================
// len() Function
// =============================================================================

test("compile - len() basic", () => {
    const bytecode = Formula.compile("len(stage)");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("LEN"), true);
});

test("compile - len() with property chain", () => {
    const bytecode = Formula.compile("len(stage.enemies)");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("LEN"), true);
    assertEqual(bytecode.includes("OBJECT_ACCESS"), true);
});

test("compile - len() in boolean condition", () => {
    const bytecode = Formula.compile("len(stage.enemies) > 0 && len(stage.allies) > 0");
    assertEqual(bytecode[0], "VERSION_1");
    const lenCount = bytecode.filter((s: string) => s === "LEN").length;
    assertEqual(lenCount, 2);
    assertEqual(bytecode.includes("AND"), true);
});

test("compile - len() of array index", () => {
    const bytecode = Formula.compile("len(stage.items[0])");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("LEN"), true);
    assertEqual(bytecode.includes("ARRAY_ACCESS"), true);
});

// =============================================================================
// Bare 0x/0b Rejection
// =============================================================================

test("compile - bare 0x returns error", () => {
    assertEqual(Formula.compile("0x"), ERROR_MARKER);
});

test("compile - bare 0b returns error", () => {
    assertEqual(Formula.compile("0b"), ERROR_MARKER);
});

test("compile - 0x in expression returns error", () => {
    assertEqual(Formula.compile("5 + 0x"), ERROR_MARKER);
});

// =============================================================================
// NOT Operator
// =============================================================================

test("compile - NOT on identifier", () => {
    const bytecode = Formula.compile("!x");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("NOT"), true);
    assertEqual(bytecode.includes("READ_GLOBAL"), true);
});

test("compile - NOT on property chain", () => {
    const bytecode = Formula.compile("!stage.player.dead");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("NOT"), true);
    assertEqual(bytecode.includes("OBJECT_ACCESS"), true);
});

test("compile - NOT in AND condition", () => {
    const bytecode = Formula.compile("!stage.player.dead && stage.level.coins > 0");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("NOT"), true);
    assertEqual(bytecode.includes("AND"), true);
    assertEqual(bytecode.includes("GREATER"), true);
});

test("compile - double NOT", () => {
    const bytecode = Formula.compile("!!x");
    assertEqual(bytecode[0], "VERSION_1");
    const notCount = bytecode.filter((s: string) => s === "NOT").length;
    assertEqual(notCount, 2);
});

// =============================================================================
// Remembered Values
// =============================================================================

test("compile - simple remembered value", () => {
    const bytecode = Formula.compile("{stage.score}");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("REMEMBER"), true);
});

test("compile - remembered value in comparison", () => {
    const bytecode = Formula.compile("{stage.score} > 100");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("REMEMBER"), true);
    assertEqual(bytecode.includes("GREATER"), true);
});

test("compile - remembered value with len()", () => {
    const bytecode = Formula.compile("{len(stage.items)}");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("REMEMBER"), true);
    assertEqual(bytecode.includes("LEN"), true);
});

// =============================================================================
// Ternary Expressions
// =============================================================================

test("compile - simple ternary", () => {
    const bytecode = Formula.compile("x > 0 ? x : 0");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("TERNARY"), true);
    assertEqual(bytecode.includes("GREATER"), true);
});

test("compile - ternary with property access", () => {
    const bytecode = Formula.compile("stage.hp != null ? stage.hp : 0");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("TERNARY"), true);
    assertEqual(bytecode.includes("NOT_EQUAL"), true);
    assertEqual(bytecode.includes("NULL"), true);
});

test("compile - nested ternary", () => {
    const bytecode = Formula.compile("a > 0 ? a > 5 ? 2 : 1 : 0");
    assertEqual(bytecode[0], "VERSION_1");
    const ternaryCount = bytecode.filter((s: string) => s === "TERNARY").length;
    assertEqual(ternaryCount, 2);
});

// =============================================================================
// Leading Dot (implicit this)
// =============================================================================

test("compile - leading dot produces implicit this", () => {
    const bytecode = Formula.compile(".health");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("OBJECT_ACCESS"), true);
    // Should have READ_GLOBAL for "this"
    const thisIdx = bytecode.indexOf("this");
    assertEqual(thisIdx >= 0, true);
});

test("compile - leading dot chained access", () => {
    const bytecode = Formula.compile(".player.health");
    assertEqual(bytecode[0], "VERSION_1");
    const accessCount = bytecode.filter((s: string) => s === "OBJECT_ACCESS").length;
    assertEqual(accessCount, 2);
});

// =============================================================================
// Complex Combinations
// =============================================================================

test("compile - negation with len()", () => {
    const bytecode = Formula.compile("-len(stage.enemies)");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("SUB"), true);
    assertEqual(bytecode.includes("LEN"), true);
});

test("compile - len() with numeric dot access", () => {
    const bytecode = Formula.compile("len(root.tooltips.60)");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("LEN"), true);
    assertEqual(bytecode.includes("OBJECT_ACCESS"), true);
});

test("compile - float in ternary", () => {
    const bytecode = Formula.compile("x > 3.14 ? 1.0 : 0.5");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("TERNARY"), true);
});

test("compile - all logical ops with comparisons", () => {
    const bytecode = Formula.compile("a > 0 && b < 5 ^ c == 1 || d != null");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("AND"), true);
    assertEqual(bytecode.includes("XOR"), true);
    assertEqual(bytecode.includes("OR"), true);
});

test("compile - NOT with remembered value", () => {
    const bytecode = Formula.compile("!{stage.player.dead}");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("NOT"), true);
    assertEqual(bytecode.includes("REMEMBER"), true);
});

// =============================================================================
// Ternary with Property Access in Both Branches
// =============================================================================

test("compile - ternary with property access in both branches", () => {
    const bytecode = Formula.compile("stage.x > 0 ? stage.a : stage.b");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("TERNARY"), true);
    assertEqual(bytecode.includes("GREATER"), true);
    // 3 property chains: stage.x, stage.a, stage.b → 3 OBJECT_ACCESS
    const accessCount = bytecode.filter((s: string) => s === "OBJECT_ACCESS").length;
    assertEqual(accessCount, 3);
});

test("compile - ternary with chained property access in branches", () => {
    const bytecode = Formula.compile("stage.player.health != null ? stage.player.health : 0");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("TERNARY"), true);
    assertEqual(bytecode.includes("NOT_EQUAL"), true);
    assertEqual(bytecode.includes("NULL"), true);
    // stage.player.health appears twice (condition + then), stage.player.health → 2 accesses each = 4
    const accessCount = bytecode.filter((s: string) => s === "OBJECT_ACCESS").length;
    assertEqual(accessCount, 4);
});

// =============================================================================
// Function Call with Complex Inner Expression
// =============================================================================

test("compile - len() with array access inside", () => {
    const bytecode = Formula.compile("len(stage.enemies[0])");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("LEN"), true);
    assertEqual(bytecode.includes("OBJECT_ACCESS"), true);
    assertEqual(bytecode.includes("ARRAY_ACCESS"), true);
});

test("compile - len() with arithmetic inside", () => {
    const bytecode = Formula.compile("len(stage.items) + 1");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("LEN"), true);
    assertEqual(bytecode.includes("ADD"), true);
});

test("compile - len() with comparison inside parens", () => {
    const bytecode = Formula.compile("len(stage.enemies) >= 5 && len(stage.allies) > 0");
    assertEqual(bytecode[0], "VERSION_1");
    const lenCount = bytecode.filter((s: string) => s === "LEN").length;
    assertEqual(lenCount, 2);
    assertEqual(bytecode.includes("AND"), true);
    assertEqual(bytecode.includes("GREATER_EQUAL"), true);
    assertEqual(bytecode.includes("GREATER"), true);
});

// =============================================================================
// Remembered Value Combinations
// =============================================================================

test("compile - remembered value with property chain", () => {
    const bytecode = Formula.compile("{stage.player.health}");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("REMEMBER"), true);
    const accessCount = bytecode.filter((s: string) => s === "OBJECT_ACCESS").length;
    assertEqual(accessCount, 2);
});

test("compile - remembered value with bare identifier", () => {
    const bytecode = Formula.compile("{x}");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("REMEMBER"), true);
    assertEqual(bytecode.includes("READ_GLOBAL"), true);
});

test("compile - remembered value in arithmetic", () => {
    const bytecode = Formula.compile("{stage.score} + 100");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("REMEMBER"), true);
    assertEqual(bytecode.includes("ADD"), true);
});

test("compile - two remembered values in comparison", () => {
    const bytecode = Formula.compile("{stage.score} > {stage.highScore}");
    assertEqual(bytecode[0], "VERSION_1");
    const rememberCount = bytecode.filter((s: string) => s === "REMEMBER").length;
    assertEqual(rememberCount, 2);
    assertEqual(bytecode.includes("GREATER"), true);
});

test("compile - arithmetic inside remembered value returns error", () => {
    // Binary operators inside {} are not supported
    assertEqual(Formula.compile("{stage.score + 100}"), ERROR_MARKER);
    assertEqual(Formula.compile("{1 + 2}"), ERROR_MARKER);
});

// =============================================================================
// Ternary Inside Parentheses with Outer Arithmetic
// =============================================================================

test("compile - ternary in parens with outer addition", () => {
    const bytecode = Formula.compile("1 + (x > 0 ? 2 : 3)");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("TERNARY"), true);
    assertEqual(bytecode.includes("ADD"), true);
    assertEqual(bytecode.includes("GREATER"), true);
});

test("compile - ternary in parens with outer multiplication", () => {
    const bytecode = Formula.compile("(x > 0 ? 2 : 3) * 4");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("TERNARY"), true);
    assertEqual(bytecode.includes("MUL"), true);
});

test("compile - ternary in parens as part of larger expression", () => {
    const bytecode = Formula.compile("1 + (x ? 2 : 3) * 4");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("TERNARY"), true);
    assertEqual(bytecode.includes("ADD"), true);
    assertEqual(bytecode.includes("MUL"), true);
    // MUL should bind tighter than ADD in the output
    const mulIdx = bytecode.indexOf("MUL");
    const addIdx = bytecode.indexOf("ADD");
    assertEqual(mulIdx < addIdx, true);
});
