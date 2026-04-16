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
// Multiline Formulas
// =============================================================================

test("Compile - multiline formula with newline", () => {
    const result = compile("stage.player\n.health");
    assertEqual(result[0], "VERSION_1");
    assertEqual(result.filter(s => s === "OBJECT_ACCESS").length, 2);
});

test("Compile - newlines as whitespace in arithmetic", () => {
    assertEqual(compile("1\n+\n2"), [
        "VERSION_1", "VALUE", "1", "VALUE", "2", "ADD",
    ]);
});

test("Compile - newline between comparison operands", () => {
    const result = compile("stage.x\n==\n0");
    assertEqual(result.includes("EQUAL"), true);
    assertEqual(result.includes("OBJECT_ACCESS"), true);
});

// =============================================================================
// Globals
// =============================================================================

test("Compile - stage_frame global", () => {
    const result = compile("stage_frame");
    assertEqual(result, ["VERSION_1", "IDENTIFIER", "stage_frame", "READ_GLOBAL"]);
});

test("Compile - stage_frame in comparison", () => {
    const result = compile("stage_frame > 100");
    assertEqual(result, [
        "VERSION_1", "IDENTIFIER", "stage_frame", "READ_GLOBAL",
        "VALUE", "100", "GREATER",
    ]);
});

test("Compile - key global", () => {
    const result = compile("key");
    assertEqual(result, ["VERSION_1", "IDENTIFIER", "key", "READ_GLOBAL"]);
});

test("Compile - this global", () => {
    const result = compile("this");
    assertEqual(result, ["VERSION_1", "IDENTIFIER", "this", "READ_GLOBAL"]);
});

// =============================================================================
// VERSION_1 header
// =============================================================================

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

// =============================================================================
// Bytecode Length Prefixes
// =============================================================================

test("Compile - OBJECT_ACCESS includes correct length prefix", () => {
    const result = compile("stage.x");
    const oaIdx = result.indexOf("OBJECT_ACCESS");
    assertEqual(oaIdx >= 0, true);
    // Filter is: IDENTIFIER key, READ_GLOBAL, IDENTIFIER x, EQUAL → 6 elements
    // But the length prefix says how many bytecodes follow as filter
    const len = parseInt(result[oaIdx + 1], 10);
    assertEqual(len, 6);
    // Verify the filter contents
    assertEqual(result[oaIdx + 2], "IDENTIFIER");
    assertEqual(result[oaIdx + 3], "key");
    assertEqual(result[oaIdx + 4], "READ_GLOBAL");
    assertEqual(result[oaIdx + 5], "IDENTIFIER");
    assertEqual(result[oaIdx + 6], "x");
    assertEqual(result[oaIdx + 7], "EQUAL");
});

test("Compile - REMEMBER includes correct length prefix", () => {
    const result = compile("{stage}");
    const remIdx = result.indexOf("REMEMBER");
    assertEqual(remIdx >= 0, true);
    const len = parseInt(result[remIdx + 1], 10);
    // Inner: IDENTIFIER stage, READ_GLOBAL → 3 elements
    assertEqual(len, 3);
    assertEqual(result[remIdx + 2], "IDENTIFIER");
    assertEqual(result[remIdx + 3], "stage");
    assertEqual(result[remIdx + 4], "READ_GLOBAL");
});

test("Compile - TERNARY includes correct branch length prefixes", () => {
    const result = compile('1 ? "a" : "b"');
    const tIdx = result.indexOf("TERNARY");
    assertEqual(tIdx >= 0, true);
    // Then-branch length
    const thenLen = parseInt(result[tIdx + 1], 10);
    assertEqual(thenLen, 2); // STRING "a"
    assertEqual(result[tIdx + 2], "STRING");
    assertEqual(result[tIdx + 3], "a");
    // Else-branch length
    const elseLen = parseInt(result[tIdx + 2 + thenLen], 10);
    assertEqual(elseLen, 2); // STRING "b"
    assertEqual(result[tIdx + 3 + thenLen], "STRING");
    assertEqual(result[tIdx + 4 + thenLen], "b");
});

test("Compile - ARRAY_ACCESS includes correct length prefix", () => {
    const result = compile("stage.items[0]");
    const aaIdx = result.indexOf("ARRAY_ACCESS");
    assertEqual(aaIdx >= 0, true);
    const len = parseInt(result[aaIdx + 1], 10);
    // Inner: VALUE 0 → 2 elements
    assertEqual(len, 2);
    assertEqual(result[aaIdx + 2], "VALUE");
    assertEqual(result[aaIdx + 3], "0");
});

// =============================================================================
// Multi-dimensional Array Access
// =============================================================================

test("Compile - multi-dimensional array access a[0][1]", () => {
    const result = compile("a[0][1]");
    assertEqual(result[0], "VERSION_1");
    const aaCount = result.filter(s => s === "ARRAY_ACCESS").length;
    assertEqual(aaCount, 2);
});

// =============================================================================
// Unary Negation Exact Bytecode
// =============================================================================

test("Compile - unary negation exact bytecode", () => {
    assertEqual(compile("-5"), [
        "VERSION_1", "VALUE", "0", "VALUE", "5", "SUB",
    ]);
});

test("Compile - unary negation of identifier", () => {
    const result = compile("-x");
    assertEqual(result[0], "VERSION_1");
    assertEqual(result[1], "VALUE");
    assertEqual(result[2], "0");
    assertEqual(result.includes("SUB"), true);
    assertEqual(result.includes("READ_GLOBAL"), true);
});

// =============================================================================
// NOT Exact Bytecode
// =============================================================================

test("Compile - NOT of identifier", () => {
    assertEqual(compile("!x"), [
        "VERSION_1", "IDENTIFIER", "x", "READ_GLOBAL", "NOT",
    ]);
});

// =============================================================================
// LEN Exact Bytecode
// =============================================================================

test("Compile - len() exact bytecode with identifier", () => {
    assertEqual(compile("len(stage)"), [
        "VERSION_1", "IDENTIFIER", "stage", "READ_GLOBAL", "LEN",
    ]);
});

// =============================================================================
// Implicit This Exact Bytecode
// =============================================================================

test("Compile - leading dot exact bytecode", () => {
    const result = compile(".x");
    assertEqual(result[0], "VERSION_1");
    assertEqual(result[1], "IDENTIFIER");
    assertEqual(result[2], "this");
    assertEqual(result[3], "READ_GLOBAL");
    assertEqual(result[4], "OBJECT_ACCESS");
});

// =============================================================================
// Float Exact Bytecode
// =============================================================================

test("Compile - float literal exact bytecode", () => {
    assertEqual(compile("3.14"), ["VERSION_1", "VALUE", "3.14"]);
});

test("Compile - float arithmetic", () => {
    assertEqual(compile("1.5 + 2.5"), [
        "VERSION_1", "VALUE", "1.5", "VALUE", "2.5", "ADD",
    ]);
});
