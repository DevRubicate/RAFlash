/**
 * Formula DSL End-to-End Compilation Tests
 *
 * Tests the full pipeline: source → Lexer → Parser → Builder → MnemonicGenerator → bytecode.
 * Each test verifies that a DSL expression compiles to the expected bytecode sequence.
 */

import { test, assertEqual } from "../../tests/framework.ts";
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

test("Compile - number literal", () => {
    assertEqual(compile("42"), ["VERSION_1", "VALUE", "42"]);
});

test("Compile - string literal", () => {
    assertEqual(compile('"hello"'), ["VERSION_1", "STRING", "hello"]);
});

test("Compile - null literal", () => {
    assertEqual(compile("null"), ["VERSION_1", "NULL"]);
});

test("Compile - identifier becomes READ_GLOBAL", () => {
    assertEqual(compile("stage"), ["VERSION_1", "IDENTIFIER", "stage", "READ_GLOBAL"]);
});

// =============================================================================
// Arithmetic Operators
// =============================================================================

test("Compile - addition", () => {
    assertEqual(compile("1 + 2"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "ADD",
    ]);
});

test("Compile - subtraction", () => {
    assertEqual(compile("5 - 3"), [
        "VERSION_1", "VALUE", "5", "VALUE", "3", "SUB",
    ]);
});

test("Compile - multiplication", () => {
    assertEqual(compile("2 * 3"), [
        "VERSION_1", "VALUE", "2", "VALUE", "3", "MUL",
    ]);
});

test("Compile - division", () => {
    assertEqual(compile("10 / 2"), [
        "VERSION_1", "VALUE", "10", "VALUE", "2", "DIV",
    ]);
});

test("Compile - modulo", () => {
    assertEqual(compile("10 % 3"), [
        "VERSION_1", "VALUE", "10", "VALUE", "3", "MOD",
    ]);
});

test("Compile - exponent", () => {
    assertEqual(compile("2 ** 8"), [
        "VERSION_1", "VALUE", "2", "VALUE", "8", "POW",
    ]);
});

// =============================================================================
// Operator Precedence
// =============================================================================

test("Compile - multiplication before addition (1 + 2 * 3)", () => {
    // Should be: 1 + (2 * 3), not (1 + 2) * 3
    assertEqual(compile("1 + 2 * 3"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "VALUE", "3", "MUL", "ADD",
    ]);
});

test("Compile - division before subtraction (10 - 6 / 2)", () => {
    assertEqual(compile("10 - 6 / 2"), [
        "VERSION_1", "VALUE", "10", "VALUE", "6", "VALUE", "2", "DIV", "SUB",
    ]);
});

test("Compile - exponent before multiplication (2 * 3 ** 2)", () => {
    // Should be: 2 * (3 ** 2)
    assertEqual(compile("2 * 3 ** 2"), [
        "VERSION_1", "VALUE", "2", "VALUE", "3", "VALUE", "2", "POW", "MUL",
    ]);
});

test("Compile - parentheses override precedence ((1 + 2) * 3)", () => {
    assertEqual(compile("(1 + 2) * 3"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "ADD", "VALUE", "3", "MUL",
    ]);
});

test("Compile - left associativity of addition (1 + 2 + 3)", () => {
    // (1 + 2) + 3
    assertEqual(compile("1 + 2 + 3"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "ADD", "VALUE", "3", "ADD",
    ]);
});

test("Compile - right associativity of exponent (2 ** 3 ** 2)", () => {
    // 2 ** (3 ** 2), NOT (2 ** 3) ** 2
    assertEqual(compile("2 ** 3 ** 2"), [
        "VERSION_1", "VALUE", "2", "VALUE", "3", "VALUE", "2", "POW", "POW",
    ]);
});

test("Compile - boolean operators have lowest precedence", () => {
    // a + 1 > 0 && b == 2  →  ((a + 1) > 0) && (b == 2)
    const result = compile("1 + 1 > 0 && 2 == 2");
    // Check that AND comes last
    assertEqual(result[result.length - 1], "AND");
});

// =============================================================================
// Comparison Operators
// =============================================================================

test("Compile - equal", () => {
    assertEqual(compile("1 == 2"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "EQUAL",
    ]);
});

test("Compile - not equal", () => {
    assertEqual(compile("1 != 2"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "NOT_EQUAL",
    ]);
});

test("Compile - greater than", () => {
    assertEqual(compile("5 > 3"), [
        "VERSION_1", "VALUE", "5", "VALUE", "3", "GREATER",
    ]);
});

test("Compile - greater than or equal", () => {
    assertEqual(compile("5 >= 3"), [
        "VERSION_1", "VALUE", "5", "VALUE", "3", "GREATER_EQUAL",
    ]);
});

test("Compile - less than", () => {
    assertEqual(compile("3 < 5"), [
        "VERSION_1", "VALUE", "3", "VALUE", "5", "LESSER",
    ]);
});

test("Compile - less than or equal", () => {
    assertEqual(compile("3 <= 5"), [
        "VERSION_1", "VALUE", "3", "VALUE", "5", "LESSER_EQUAL",
    ]);
});

// =============================================================================
// Logical Operators
// =============================================================================

test("Compile - AND", () => {
    assertEqual(compile("1 && 1"), [
        "VERSION_1", "VALUE", "1", "VALUE", "1", "AND",
    ]);
});

test("Compile - OR", () => {
    assertEqual(compile("0 || 1"), [
        "VERSION_1", "VALUE", "0", "VALUE", "1", "OR",
    ]);
});

test("Compile - XOR", () => {
    assertEqual(compile("1 ^ 0"), [
        "VERSION_1", "VALUE", "1", "VALUE", "0", "XOR",
    ]);
});

test("Compile - NOT", () => {
    assertEqual(compile("!1"), [
        "VERSION_1", "VALUE", "1", "NOT",
    ]);
});

test("Compile - double NOT", () => {
    assertEqual(compile("!!1"), [
        "VERSION_1", "VALUE", "1", "NOT", "NOT",
    ]);
});

// =============================================================================
// Property Access (OBJECT_ACCESS)
// =============================================================================

test("Compile - simple property access (stage.x)", () => {
    const result = compile("stage.x");
    // stage → READ_GLOBAL, then OBJECT_ACCESS with filter (key == "x")
    assertEqual(result, [
        "VERSION_1",
        "IDENTIFIER", "stage", "READ_GLOBAL",
        "OBJECT_ACCESS", "6",
        "IDENTIFIER", "key", "READ_GLOBAL",
        "IDENTIFIER", "x",
        "EQUAL",
    ]);
});

test("Compile - chained property access (stage.player.health)", () => {
    const result = compile("stage.player.health");
    // Two OBJECT_ACCESS instructions
    const objectAccessCount = result.filter(s => s === "OBJECT_ACCESS").length;
    assertEqual(objectAccessCount, 2);
});

test("Compile - implicit this (.health)", () => {
    const result = compile(".health");
    // Should start with READ_GLOBAL(this)
    assertEqual(result[1], "IDENTIFIER");
    assertEqual(result[2], "this");
    assertEqual(result[3], "READ_GLOBAL");
    assertEqual(result[4], "OBJECT_ACCESS");
});

// =============================================================================
// Array Access (ARRAY_ACCESS)
// =============================================================================

test("Compile - array index access (stage.items[0])", () => {
    const result = compile("stage.items[0]");
    assertEqual(result.includes("ARRAY_ACCESS"), true);
});

test("Compile - array access with expression (a[1 + 2])", () => {
    const result = compile("stage.items[1 + 2]");
    assertEqual(result.includes("ARRAY_ACCESS"), true);
    assertEqual(result.includes("ADD"), true);
});

// =============================================================================
// Remembered Values
// =============================================================================

test("Compile - remembered value {stage.x}", () => {
    const result = compile("{stage.x}");
    assertEqual(result.includes("REMEMBER"), true);
    // REMEMBER has a length prefix and inner bytecode
    const remIdx = result.indexOf("REMEMBER");
    const innerLen = parseInt(result[remIdx + 1], 10);
    assertEqual(innerLen > 0, true);
});

// =============================================================================
// Ternary Operator
// =============================================================================

test("Compile - simple ternary", () => {
    const result = compile('1 ? "a" : "b"');
    assertEqual(result.includes("TERNARY"), true);
    const ternaryIdx = result.indexOf("TERNARY");
    // Then-branch length
    const thenLen = parseInt(result[ternaryIdx + 1], 10);
    assertEqual(thenLen > 0, true);
    // Else-branch length
    const elseLen = parseInt(result[ternaryIdx + 2 + thenLen], 10);
    assertEqual(elseLen > 0, true);
});

test("Compile - ternary with comparison condition", () => {
    const result = compile('1 == 0 ? "yes" : "no"');
    const equalIdx = result.indexOf("EQUAL");
    const ternaryIdx = result.indexOf("TERNARY");
    assertEqual(equalIdx < ternaryIdx, true);
});

// =============================================================================
// Realistic Game Formulas
// =============================================================================

test("Compile - health check (stage.player.health == 0)", () => {
    const result = compile("stage.player.health == 0");
    assertEqual(result[0], "VERSION_1");
    assertEqual(result.includes("EQUAL"), true);
    assertEqual(result.filter(s => s === "OBJECT_ACCESS").length, 2);
});

test("Compile - coin threshold (stage.level.coins >= 10)", () => {
    const result = compile("stage.level.coins >= 10");
    assertEqual(result.includes("GREATER_EQUAL"), true);
});

test("Compile - negation (!stage.player.dead)", () => {
    const result = compile("!stage.player.dead");
    assertEqual(result.includes("NOT"), true);
    assertEqual(result.filter(s => s === "OBJECT_ACCESS").length, 2);
});

test("Compile - arithmetic on game state (stage.player.x + 100)", () => {
    const result = compile("stage.player.x + 100");
    assertEqual(result.includes("ADD"), true);
    assertEqual(result.includes("OBJECT_ACCESS"), true);
});

test("Compile - null comparison (stage.player.health != null)", () => {
    const result = compile("stage.player.health != null");
    assertEqual(result.includes("NOT_EQUAL"), true);
    assertEqual(result.includes("NULL"), true);
});

test("Compile - compound condition with AND", () => {
    const result = compile("stage.player.health > 0 && stage.level.coins >= 10");
    assertEqual(result.includes("AND"), true);
    assertEqual(result.includes("GREATER"), true);
    assertEqual(result.includes("GREATER_EQUAL"), true);
});

// =============================================================================
// Semicolons are not used for multi-statement in this DSL
// =============================================================================

// =============================================================================
// VERSION_1 header
// =============================================================================

test("Compile - always starts with VERSION_1", () => {
    assertEqual(compile("1")[0], "VERSION_1");
    assertEqual(compile("stage.x")[0], "VERSION_1");
    assertEqual(compile('"hello"')[0], "VERSION_1");
});

// =============================================================================
// Empty / edge cases
// =============================================================================

test("Compile - bare identifier returns READ_GLOBAL(this)", () => {
    // Empty expressions default to `this`
    const result = compile("this");
    assertEqual(result, ["VERSION_1", "IDENTIFIER", "this", "READ_GLOBAL"]);
});

test("Compile - hex number in expression", () => {
    const result = compile("0xFF + 1");
    assertEqual(result, ["VERSION_1", "VALUE", "0xFF", "VALUE", "1", "ADD"]);
});

test("Compile - deeply nested parentheses", () => {
    const result = compile("((((1))))");
    assertEqual(result, ["VERSION_1", "VALUE", "1"]);
});

test("Compile - string comparison", () => {
    const result = compile('"hello" == "world"');
    assertEqual(result, [
        "VERSION_1", "STRING", "hello", "STRING", "world", "EQUAL",
    ]);
});
