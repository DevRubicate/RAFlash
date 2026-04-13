/**
 * Formula DSL End-to-End Compilation Tests
 *
 * Tests the full pipeline: source → Lexer → Parser → Builder → MnemonicGenerator → bytecode.
 * Each test verifies that a DSL expression compiles to the expected bytecode sequence.
 */

import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { Lexer } from "../src/formula/Lexer.ts";
import { Parser } from "../src/formula/Parser.ts";
import { Builder } from "../src/formula/Builder.ts";
import { MnemonicGenerator } from "../src/formula/MnemonicGenerator.ts";

// Helper: compile source to mnemonic bytecode array
function compile(input: string): string[] {
    const lexer = new Lexer(input);
    const parser = new Parser(lexer.output, input);
    const builder = new Builder(parser.output).build();
    return new MnemonicGenerator(builder.output()).generate();
}

// =============================================================================
// Literals
// =============================================================================

Deno.test("Compile - number literal", () => {
    assertEquals(compile("42"), ["VERSION_1", "VALUE", "42"]);
});

Deno.test("Compile - string literal", () => {
    assertEquals(compile('"hello"'), ["VERSION_1", "STRING", "hello"]);
});

Deno.test("Compile - null literal", () => {
    assertEquals(compile("null"), ["VERSION_1", "NULL"]);
});

Deno.test("Compile - identifier becomes READ_GLOBAL", () => {
    assertEquals(compile("stage"), ["VERSION_1", "IDENTIFIER", "stage", "READ_GLOBAL"]);
});

// =============================================================================
// Arithmetic Operators
// =============================================================================

Deno.test("Compile - addition", () => {
    assertEquals(compile("1 + 2"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "ADD",
    ]);
});

Deno.test("Compile - subtraction", () => {
    assertEquals(compile("5 - 3"), [
        "VERSION_1", "VALUE", "5", "VALUE", "3", "SUB",
    ]);
});

Deno.test("Compile - multiplication", () => {
    assertEquals(compile("2 * 3"), [
        "VERSION_1", "VALUE", "2", "VALUE", "3", "MUL",
    ]);
});

Deno.test("Compile - division", () => {
    assertEquals(compile("10 / 2"), [
        "VERSION_1", "VALUE", "10", "VALUE", "2", "DIV",
    ]);
});

Deno.test("Compile - modulo", () => {
    assertEquals(compile("10 % 3"), [
        "VERSION_1", "VALUE", "10", "VALUE", "3", "MOD",
    ]);
});

Deno.test("Compile - exponent", () => {
    assertEquals(compile("2 ** 8"), [
        "VERSION_1", "VALUE", "2", "VALUE", "8", "POW",
    ]);
});

// =============================================================================
// Operator Precedence
// =============================================================================

Deno.test("Compile - multiplication before addition (1 + 2 * 3)", () => {
    // Should be: 1 + (2 * 3), not (1 + 2) * 3
    assertEquals(compile("1 + 2 * 3"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "VALUE", "3", "MUL", "ADD",
    ]);
});

Deno.test("Compile - division before subtraction (10 - 6 / 2)", () => {
    assertEquals(compile("10 - 6 / 2"), [
        "VERSION_1", "VALUE", "10", "VALUE", "6", "VALUE", "2", "DIV", "SUB",
    ]);
});

Deno.test("Compile - exponent before multiplication (2 * 3 ** 2)", () => {
    // Should be: 2 * (3 ** 2)
    assertEquals(compile("2 * 3 ** 2"), [
        "VERSION_1", "VALUE", "2", "VALUE", "3", "VALUE", "2", "POW", "MUL",
    ]);
});

Deno.test("Compile - parentheses override precedence ((1 + 2) * 3)", () => {
    assertEquals(compile("(1 + 2) * 3"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "ADD", "VALUE", "3", "MUL",
    ]);
});

Deno.test("Compile - left associativity of addition (1 + 2 + 3)", () => {
    // (1 + 2) + 3
    assertEquals(compile("1 + 2 + 3"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "ADD", "VALUE", "3", "ADD",
    ]);
});

Deno.test("Compile - right associativity of exponent (2 ** 3 ** 2)", () => {
    // 2 ** (3 ** 2), NOT (2 ** 3) ** 2
    assertEquals(compile("2 ** 3 ** 2"), [
        "VERSION_1", "VALUE", "2", "VALUE", "3", "VALUE", "2", "POW", "POW",
    ]);
});

Deno.test("Compile - boolean operators have lowest precedence", () => {
    // a + 1 > 0 && b == 2  →  ((a + 1) > 0) && (b == 2)
    const result = compile("1 + 1 > 0 && 2 == 2");
    // Check that AND comes last
    assertEquals(result[result.length - 1], "AND");
});

// =============================================================================
// Comparison Operators
// =============================================================================

Deno.test("Compile - equal", () => {
    assertEquals(compile("1 == 2"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "EQUAL",
    ]);
});

Deno.test("Compile - not equal", () => {
    assertEquals(compile("1 != 2"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "NOT_EQUAL",
    ]);
});

Deno.test("Compile - greater than", () => {
    assertEquals(compile("5 > 3"), [
        "VERSION_1", "VALUE", "5", "VALUE", "3", "GREATER",
    ]);
});

Deno.test("Compile - greater than or equal", () => {
    assertEquals(compile("5 >= 3"), [
        "VERSION_1", "VALUE", "5", "VALUE", "3", "GREATER_EQUAL",
    ]);
});

Deno.test("Compile - less than", () => {
    assertEquals(compile("3 < 5"), [
        "VERSION_1", "VALUE", "3", "VALUE", "5", "LESSER",
    ]);
});

Deno.test("Compile - less than or equal", () => {
    assertEquals(compile("3 <= 5"), [
        "VERSION_1", "VALUE", "3", "VALUE", "5", "LESSER_EQUAL",
    ]);
});

// =============================================================================
// Logical Operators
// =============================================================================

Deno.test("Compile - AND", () => {
    assertEquals(compile("1 && 1"), [
        "VERSION_1", "VALUE", "1", "VALUE", "1", "AND",
    ]);
});

Deno.test("Compile - OR", () => {
    assertEquals(compile("0 || 1"), [
        "VERSION_1", "VALUE", "0", "VALUE", "1", "OR",
    ]);
});

Deno.test("Compile - XOR", () => {
    assertEquals(compile("1 ^ 0"), [
        "VERSION_1", "VALUE", "1", "VALUE", "0", "XOR",
    ]);
});

Deno.test("Compile - NOT", () => {
    assertEquals(compile("!1"), [
        "VERSION_1", "VALUE", "1", "NOT",
    ]);
});

Deno.test("Compile - double NOT", () => {
    assertEquals(compile("!!1"), [
        "VERSION_1", "VALUE", "1", "NOT", "NOT",
    ]);
});

// =============================================================================
// Property Access (OBJECT_ACCESS)
// =============================================================================

Deno.test("Compile - simple property access (stage.x)", () => {
    const result = compile("stage.x");
    // stage → READ_GLOBAL, then OBJECT_ACCESS with filter (key == "x")
    assertEquals(result, [
        "VERSION_1",
        "IDENTIFIER", "stage", "READ_GLOBAL",
        "OBJECT_ACCESS", "6",
        "IDENTIFIER", "key", "READ_GLOBAL",
        "IDENTIFIER", "x",
        "EQUAL",
    ]);
});

Deno.test("Compile - chained property access (stage.player.health)", () => {
    const result = compile("stage.player.health");
    // Two OBJECT_ACCESS instructions
    const objectAccessCount = result.filter(s => s === "OBJECT_ACCESS").length;
    assertEquals(objectAccessCount, 2);
});

Deno.test("Compile - implicit this (.health)", () => {
    const result = compile(".health");
    // Should start with READ_GLOBAL(this)
    assertEquals(result[1], "IDENTIFIER");
    assertEquals(result[2], "this");
    assertEquals(result[3], "READ_GLOBAL");
    assertEquals(result[4], "OBJECT_ACCESS");
});

// =============================================================================
// Array Access (ARRAY_ACCESS)
// =============================================================================

Deno.test("Compile - array index access (stage.items[0])", () => {
    const result = compile("stage.items[0]");
    assertEquals(result.includes("ARRAY_ACCESS"), true);
});

Deno.test("Compile - array access with expression (a[1 + 2])", () => {
    const result = compile("stage.items[1 + 2]");
    assertEquals(result.includes("ARRAY_ACCESS"), true);
    assertEquals(result.includes("ADD"), true);
});

// =============================================================================
// Remembered Values
// =============================================================================

Deno.test("Compile - remembered value {stage.x}", () => {
    const result = compile("{stage.x}");
    assertEquals(result.includes("REMEMBER"), true);
    // REMEMBER has a length prefix and inner bytecode
    const remIdx = result.indexOf("REMEMBER");
    const innerLen = parseInt(result[remIdx + 1], 10);
    assertEquals(innerLen > 0, true);
});

// =============================================================================
// Ternary Operator
// =============================================================================

Deno.test("Compile - simple ternary", () => {
    const result = compile('1 ? "a" : "b"');
    assertEquals(result.includes("TERNARY"), true);
    const ternaryIdx = result.indexOf("TERNARY");
    // Then-branch length
    const thenLen = parseInt(result[ternaryIdx + 1], 10);
    assertEquals(thenLen > 0, true);
    // Else-branch length
    const elseLen = parseInt(result[ternaryIdx + 2 + thenLen], 10);
    assertEquals(elseLen > 0, true);
});

Deno.test("Compile - ternary with comparison condition", () => {
    const result = compile('1 == 0 ? "yes" : "no"');
    const equalIdx = result.indexOf("EQUAL");
    const ternaryIdx = result.indexOf("TERNARY");
    assertEquals(equalIdx < ternaryIdx, true);
});

// =============================================================================
// Realistic Game Formulas
// =============================================================================

Deno.test("Compile - health check (stage.player.health == 0)", () => {
    const result = compile("stage.player.health == 0");
    assertEquals(result[0], "VERSION_1");
    assertEquals(result.includes("EQUAL"), true);
    assertEquals(result.filter(s => s === "OBJECT_ACCESS").length, 2);
});

Deno.test("Compile - coin threshold (stage.level.coins >= 10)", () => {
    const result = compile("stage.level.coins >= 10");
    assertEquals(result.includes("GREATER_EQUAL"), true);
});

Deno.test("Compile - negation (!stage.player.dead)", () => {
    const result = compile("!stage.player.dead");
    assertEquals(result.includes("NOT"), true);
    assertEquals(result.filter(s => s === "OBJECT_ACCESS").length, 2);
});

Deno.test("Compile - arithmetic on game state (stage.player.x + 100)", () => {
    const result = compile("stage.player.x + 100");
    assertEquals(result.includes("ADD"), true);
    assertEquals(result.includes("OBJECT_ACCESS"), true);
});

Deno.test("Compile - null comparison (stage.player.health != null)", () => {
    const result = compile("stage.player.health != null");
    assertEquals(result.includes("NOT_EQUAL"), true);
    assertEquals(result.includes("NULL"), true);
});

Deno.test("Compile - compound condition with AND", () => {
    const result = compile("stage.player.health > 0 && stage.level.coins >= 10");
    assertEquals(result.includes("AND"), true);
    assertEquals(result.includes("GREATER"), true);
    assertEquals(result.includes("GREATER_EQUAL"), true);
});

// =============================================================================
// Semicolons are not used for multi-statement in this DSL
// =============================================================================

// =============================================================================
// VERSION_1 header
// =============================================================================

Deno.test("Compile - always starts with VERSION_1", () => {
    assertEquals(compile("1")[0], "VERSION_1");
    assertEquals(compile("stage.x")[0], "VERSION_1");
    assertEquals(compile('"hello"')[0], "VERSION_1");
});

// =============================================================================
// Empty / edge cases
// =============================================================================

Deno.test("Compile - bare identifier returns READ_GLOBAL(this)", () => {
    // Empty expressions default to `this`
    const result = compile("this");
    assertEquals(result, ["VERSION_1", "IDENTIFIER", "this", "READ_GLOBAL"]);
});

Deno.test("Compile - hex number in expression", () => {
    const result = compile("0xFF + 1");
    assertEquals(result, ["VERSION_1", "VALUE", "0xFF", "VALUE", "1", "ADD"]);
});

Deno.test("Compile - deeply nested parentheses", () => {
    const result = compile("((((1))))");
    assertEquals(result, ["VERSION_1", "VALUE", "1"]);
});

Deno.test("Compile - string comparison", () => {
    const result = compile('"hello" == "world"');
    assertEquals(result, [
        "VERSION_1", "STRING", "hello", "STRING", "world", "EQUAL",
    ]);
});
