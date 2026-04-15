/**
 * Formula.compile() Tests
 *
 * Tests for the full compilation pipeline: source code -> bytecode.
 * Valid formulas produce bytecode starting with VERSION_1.
 * Invalid formulas return ['VERSION_1', 'STRING', 'ERROR'].
 */

import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { Formula } from "../src/formula/Formula.ts";

const ERROR_MARKER = ["VERSION_1", "STRING", "ERROR"];

// =============================================================================
// Basic Structure
// =============================================================================

Deno.test("compile - valid formula starts with VERSION_1", () => {
    const bytecode = Formula.compile("1 + 2");
    assertEquals(bytecode[0], "VERSION_1");
});

Deno.test("compile - invalid formula returns error marker", () => {
    assertEquals(Formula.compile("=== invalid"), ERROR_MARKER);
});

// =============================================================================
// Invalid Inputs
// =============================================================================

Deno.test("compile - unclosed string returns error", () => {
    assertEquals(Formula.compile('"unclosed'), ERROR_MARKER);
});

Deno.test("compile - bare = returns error", () => {
    assertEquals(Formula.compile("="), ERROR_MARKER);
});

Deno.test("compile - unbalanced parens returns error", () => {
    assertEquals(Formula.compile("(1 + 2"), ERROR_MARKER);
});

Deno.test("compile - triple equals returns error", () => {
    assertEquals(Formula.compile("1 === 2"), ERROR_MARKER);
});

Deno.test("compile - lone ampersand returns error", () => {
    assertEquals(Formula.compile("1 & 2"), ERROR_MARKER);
});

Deno.test("compile - lone pipe returns error", () => {
    assertEquals(Formula.compile("1 | 2"), ERROR_MARKER);
});

// =============================================================================
// Empty and Simple Literals
// =============================================================================

Deno.test("compile - empty string compiles to READ_GLOBAL this", () => {
    const bytecode = Formula.compile("");
    assertEquals(bytecode, ["VERSION_1", "IDENTIFIER", "this", "READ_GLOBAL"]);
});

Deno.test("compile - number literal", () => {
    const bytecode = Formula.compile("42");
    assertEquals(bytecode, ["VERSION_1", "VALUE", "42"]);
});

Deno.test("compile - string literal", () => {
    const bytecode = Formula.compile('"hello"');
    assertEquals(bytecode, ["VERSION_1", "STRING", "hello"]);
});

Deno.test("compile - null literal", () => {
    const bytecode = Formula.compile("null");
    assertEquals(bytecode, ["VERSION_1", "NULL"]);
});

Deno.test("compile - float literal", () => {
    const bytecode = Formula.compile("3.14");
    assertEquals(bytecode, ["VERSION_1", "VALUE", "3.14"]);
});

Deno.test("compile - float with leading zero", () => {
    const bytecode = Formula.compile("0.5");
    assertEquals(bytecode, ["VERSION_1", "VALUE", "0.5"]);
});

Deno.test("compile - float in arithmetic", () => {
    const bytecode = Formula.compile("1 + 0.5");
    assertEquals(bytecode, ["VERSION_1", "VALUE", "1", "VALUE", "0.5", "ADD"]);
});

Deno.test("compile - float in comparison", () => {
    const bytecode = Formula.compile("stage.health > 2.5");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("GREATER"), true);
    assertEquals(bytecode.includes("VALUE"), true);
    assertEquals(bytecode[bytecode.length - 3], "VALUE");
    assertEquals(bytecode[bytecode.length - 2], "2.5");
});

Deno.test("compile - hex not affected by float support", () => {
    const bytecode = Formula.compile("0xFF");
    assertEquals(bytecode, ["VERSION_1", "VALUE", "0xFF"]);
});

Deno.test("compile - property access not affected by float support", () => {
    const bytecode = Formula.compile("stage.player");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
    // Should NOT contain a float-like VALUE
    const values = bytecode.filter((s: string, i: number) => bytecode[i - 1] === "VALUE");
    assertEquals(values.every((v: string) => !v.includes(".")), true);
});

// =============================================================================
// Realistic Game Formulas
// =============================================================================

Deno.test("compile - health check formula", () => {
    const bytecode = Formula.compile("stage.player.health == 0");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
    assertEquals(bytecode.includes("EQUAL"), true);
    assertEquals(bytecode.includes("VALUE"), true);
});

Deno.test("compile - property traversal formula", () => {
    const bytecode = Formula.compile("stage.enemies.health");
    assertEquals(bytecode[0], "VERSION_1");
    // Two OBJECT_ACCESS instructions for .enemies and .health
    const accessCount = bytecode.filter((s: string) => s === "OBJECT_ACCESS").length;
    assertEquals(accessCount, 2);
});

Deno.test("compile - remembered value formula", () => {
    const bytecode = Formula.compile("{stage.score}");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("REMEMBER"), true);
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
});

Deno.test("compile - array index formula", () => {
    const bytecode = Formula.compile("stage.items[0]");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
    assertEquals(bytecode.includes("ARRAY_ACCESS"), true);
});

Deno.test("compile - arithmetic with property access", () => {
    const bytecode = Formula.compile("stage.player.x + 100");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("ADD"), true);
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
});

// =============================================================================
// Complex Expressions
// =============================================================================

Deno.test("compile - ternary expression", () => {
    const bytecode = Formula.compile('x > 0 ? x : 0');
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("GREATER"), true);
    assertEquals(bytecode.includes("TERNARY"), true);
});

Deno.test("compile - compound boolean", () => {
    const bytecode = Formula.compile("a > 0 && b < 10");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("GREATER"), true);
    assertEquals(bytecode.includes("LESSER"), true);
    assertEquals(bytecode.includes("AND"), true);
});

Deno.test("compile - nested arithmetic", () => {
    const bytecode = Formula.compile("(1 + 2) * 3");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("ADD"), true);
    assertEquals(bytecode.includes("MUL"), true);
});

Deno.test("compile - modulo operator", () => {
    const bytecode = Formula.compile("10 % 3");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("MOD"), true);
});

Deno.test("compile - exponent operator", () => {
    const bytecode = Formula.compile("2 ** 3");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("POW"), true);
});

Deno.test("compile - complex game condition", () => {
    const bytecode = Formula.compile("stage.player.health > 0 && stage.level.coins >= 10");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("AND"), true);
    assertEquals(bytecode.includes("GREATER"), true);
    assertEquals(bytecode.includes("GREATER_EQUAL"), true);
    const accessCount = bytecode.filter((s: string) => s === "OBJECT_ACCESS").length;
    assertEquals(accessCount, 4);
});

Deno.test("compile - not equal with null", () => {
    const bytecode = Formula.compile("stage.player.health != null");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("NOT_EQUAL"), true);
    assertEquals(bytecode.includes("NULL"), true);
});

Deno.test("compile - ternary with null check", () => {
    const bytecode = Formula.compile("stage.player.health != null ? stage.player.health : 0");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("TERNARY"), true);
    assertEquals(bytecode.includes("NOT_EQUAL"), true);
});

// =============================================================================
// Function Calls
// =============================================================================

Deno.test("compile - len() produces LEN opcode", () => {
    const bytecode = Formula.compile("len(stage.enemies)");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("LEN"), true);
    assertEquals(bytecode.includes("OBJECT_ACCESS"), true);
    // LEN should be the last instruction
    assertEquals(bytecode[bytecode.length - 1], "LEN");
});

Deno.test("compile - len() in comparison", () => {
    const bytecode = Formula.compile("len(stage.enemies) >= 5");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("LEN"), true);
    assertEquals(bytecode.includes("GREATER_EQUAL"), true);
});

Deno.test("compile - len() with simple identifier", () => {
    const bytecode = Formula.compile("len(stage)");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("LEN"), true);
    assertEquals(bytecode.includes("READ_GLOBAL"), true);
});

Deno.test("compile - nested len()", () => {
    const bytecode = Formula.compile("len(len(stage))");
    assertEquals(bytecode[0], "VERSION_1");
    const lenCount = bytecode.filter((s: string) => s === "LEN").length;
    assertEquals(lenCount, 2);
});

Deno.test("compile - len() in arithmetic", () => {
    const bytecode = Formula.compile("len(stage.enemies) + len(stage.allies)");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("ADD"), true);
    const lenCount = bytecode.filter((s: string) => s === "LEN").length;
    assertEquals(lenCount, 2);
});

Deno.test("compile - len() of literal", () => {
    const bytecode = Formula.compile("len(42)");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("LEN"), true);
    assertEquals(bytecode.includes("VALUE"), true);
});

Deno.test("compile - len() in ternary", () => {
    const bytecode = Formula.compile("len(stage.items) > 0 ? 1 : 0");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("LEN"), true);
    assertEquals(bytecode.includes("TERNARY"), true);
});

Deno.test("compile - len() in remembered value", () => {
    const bytecode = Formula.compile("{len(stage.items)}");
    assertEquals(bytecode[0], "VERSION_1");
    assertEquals(bytecode.includes("LEN"), true);
    assertEquals(bytecode.includes("REMEMBER"), true);
});
