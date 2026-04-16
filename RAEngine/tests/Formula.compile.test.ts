/**
 * Formula.compile() Tests
 *
 * Tests for the full compilation pipeline: source code -> bytecode.
 * Valid formulas produce bytecode starting with VERSION_1.
 * Invalid formulas return ['VERSION_1', 'STRING', 'ERROR'].
 */

import { test, assertEqual } from "../../tests/framework.ts";
import { Formula } from "../src/formula/Formula.ts";

const ERROR_MARKER = ["VERSION_1", "STRING", "ERROR"];

// =============================================================================
// Basic Structure
// =============================================================================

test("compile - invalid formula returns error marker", () => {
    assertEqual(Formula.compile("=== invalid"), ERROR_MARKER);
});

// =============================================================================
// Invalid Inputs
// =============================================================================

test("compile - unclosed string returns error", () => {
    assertEqual(Formula.compile('"unclosed'), ERROR_MARKER);
});

test("compile - bare = returns error", () => {
    assertEqual(Formula.compile("="), ERROR_MARKER);
});

test("compile - unbalanced parens returns error", () => {
    assertEqual(Formula.compile("(1 + 2"), ERROR_MARKER);
});

test("compile - triple equals returns error", () => {
    assertEqual(Formula.compile("1 === 2"), ERROR_MARKER);
});

test("compile - lone ampersand returns error", () => {
    assertEqual(Formula.compile("1 & 2"), ERROR_MARKER);
});

test("compile - lone pipe returns error", () => {
    assertEqual(Formula.compile("1 | 2"), ERROR_MARKER);
});

// =============================================================================
// Empty and Simple Literals
// =============================================================================

test("compile - empty string compiles to READ_GLOBAL this", () => {
    const bytecode = Formula.compile("");
    assertEqual(bytecode, ["VERSION_1", "IDENTIFIER", "this", "READ_GLOBAL"]);
});

test("compile - float in arithmetic", () => {
    const bytecode = Formula.compile("1 + 0.5");
    assertEqual(bytecode, ["VERSION_1", "VALUE", "1", "VALUE", "0.5", "ADD"]);
});

test("compile - float in comparison", () => {
    const bytecode = Formula.compile("stage.health > 2.5");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("GREATER"), true);
    assertEqual(bytecode.includes("VALUE"), true);
    assertEqual(bytecode[bytecode.length - 3], "VALUE");
    assertEqual(bytecode[bytecode.length - 2], "2.5");
});

test("compile - property access not affected by float support", () => {
    const bytecode = Formula.compile("stage.player");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("OBJECT_ACCESS"), true);
    // Should NOT contain a float-like VALUE
    const values = bytecode.filter((s: string, i: number) => bytecode[i - 1] === "VALUE");
    assertEqual(values.every((v: string) => !v.includes(".")), true);
});

// =============================================================================
// Realistic Game Formulas
// =============================================================================

test("compile - not equal with null", () => {
    const bytecode = Formula.compile("stage.player.health != null");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("NOT_EQUAL"), true);
    assertEqual(bytecode.includes("NULL"), true);
});

test("compile - ternary with null check", () => {
    const bytecode = Formula.compile("stage.player.health != null ? stage.player.health : 0");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("TERNARY"), true);
    assertEqual(bytecode.includes("NOT_EQUAL"), true);
});

// =============================================================================
// Function Calls
// =============================================================================

test("compile - len() produces LEN opcode", () => {
    const bytecode = Formula.compile("len(stage.enemies)");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("LEN"), true);
    assertEqual(bytecode.includes("OBJECT_ACCESS"), true);
    // LEN should be the last instruction
    assertEqual(bytecode[bytecode.length - 1], "LEN");
});

test("compile - len() in comparison", () => {
    const bytecode = Formula.compile("len(stage.enemies) >= 5");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("LEN"), true);
    assertEqual(bytecode.includes("GREATER_EQUAL"), true);
});

test("compile - len() in arithmetic", () => {
    const bytecode = Formula.compile("len(stage.enemies) + len(stage.allies)");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("ADD"), true);
    const lenCount = bytecode.filter((s: string) => s === "LEN").length;
    assertEqual(lenCount, 2);
});

test("compile - len() in ternary", () => {
    const bytecode = Formula.compile("len(stage.items) > 0 ? 1 : 0");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("LEN"), true);
    assertEqual(bytecode.includes("TERNARY"), true);
});

test("compile - len() in remembered value", () => {
    const bytecode = Formula.compile("{len(stage.items)}");
    assertEqual(bytecode[0], "VERSION_1");
    assertEqual(bytecode.includes("LEN"), true);
    assertEqual(bytecode.includes("REMEMBER"), true);
});

// =============================================================================
// Function Call Error Cases
// =============================================================================

test("compile - unknown function returns error", () => {
    assertEqual(Formula.compile("foo(x)"), ERROR_MARKER);
});

test("compile - unknown function with property arg returns error", () => {
    assertEqual(Formula.compile("bar(stage.player)"), ERROR_MARKER);
});

test("compile - semicolons are rejected", () => {
    assertEqual(Formula.compile("a; b"), ERROR_MARKER);
});

test("compile - len() with no arguments returns error", () => {
    assertEqual(Formula.compile("len()"), ERROR_MARKER);
});

test("compile - len() with multiple arguments returns error", () => {
    assertEqual(Formula.compile("len(a, b)"), ERROR_MARKER);
});
