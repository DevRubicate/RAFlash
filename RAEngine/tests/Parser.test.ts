/**
 * Parser Tests - Parse Tree Structure
 *
 * Tests for operator nodes, property access, precedence, and error handling.
 * Complements Formula.test.ts which focuses on ternary.
 */

import { test, assertEqual, assertThrows } from "../../tests/framework.ts";
import { Lexer } from "../src/formula/Lexer.ts";
import { Parser } from "../src/formula/Parser.ts";

function getParseTree(input: string): string[] {
    const lexer = new Lexer(input);
    const parser = new Parser(lexer.output, input);
    return parser.log;
}

// =============================================================================
// Arithmetic Operators
// =============================================================================

test("Parser - addition node", () => {
    const log = getParseTree("1 + 2");
    assertEqual(log.includes("    ADDITION"), true);
    assertEqual(log.includes("      VALUE"), true);
});

test("Parser - subtraction node", () => {
    const log = getParseTree("1 - 2");
    assertEqual(log.includes("    SUBTRACTION"), true);
    assertEqual(log.includes("      VALUE"), true);
});

test("Parser - multiplication node", () => {
    const log = getParseTree("1 * 2");
    assertEqual(log.includes("    MULTIPLICATION"), true);
    assertEqual(log.includes("      VALUE"), true);
});

test("Parser - division node", () => {
    const log = getParseTree("1 / 2");
    assertEqual(log.includes("    DIVISION"), true);
    assertEqual(log.includes("      VALUE"), true);
});

test("Parser - modulo node", () => {
    const log = getParseTree("1 % 2");
    assertEqual(log.includes("    MODULO"), true);
    assertEqual(log.includes("      VALUE"), true);
});

test("Parser - exponent node", () => {
    const log = getParseTree("2 ** 3");
    assertEqual(log.includes("    EXPONENT"), true);
    assertEqual(log.includes("      VALUE"), true);
});

// =============================================================================
// Comparison Operators
// =============================================================================

test("Parser - equal node", () => {
    const log = getParseTree("1 == 2");
    assertEqual(log.includes("    EQUAL"), true);
});

test("Parser - not equal node", () => {
    const log = getParseTree("1 != 2");
    assertEqual(log.includes("    NOT_EQUAL"), true);
});

test("Parser - greater than node", () => {
    const log = getParseTree("1 > 2");
    assertEqual(log.includes("    GREATER_THAN"), true);
});

test("Parser - greater than or equal node", () => {
    const log = getParseTree("1 >= 2");
    assertEqual(log.includes("    GREATER_THAN_OR_EQUAL"), true);
});

test("Parser - less than node", () => {
    const log = getParseTree("1 < 2");
    assertEqual(log.includes("    LESS_THAN"), true);
});

test("Parser - less than or equal node", () => {
    const log = getParseTree("1 <= 2");
    assertEqual(log.includes("    LESS_THAN_OR_EQUAL"), true);
});

// =============================================================================
// Logical Operators
// =============================================================================

test("Parser - AND node", () => {
    const log = getParseTree("1 && 2");
    assertEqual(log.includes("    AND"), true);
    assertEqual(log.includes("      VALUE"), true);
});

test("Parser - OR node", () => {
    const log = getParseTree("1 || 2");
    assertEqual(log.includes("    OR"), true);
    assertEqual(log.includes("      VALUE"), true);
});

test("Parser - XOR node", () => {
    const log = getParseTree("1 ^ 2");
    assertEqual(log.includes("    XOR"), true);
    assertEqual(log.includes("      VALUE"), true);
});

test("Parser - NOT node", () => {
    const log = getParseTree("!x");
    assertEqual(log.includes("    NOT"), true);
    assertEqual(log.includes("      READ_GLOBAL"), true);
});

// =============================================================================
// Property Access
// =============================================================================

test("Parser - simple property access produces OBJECT_ACCESS_EXPRESSION", () => {
    const log = getParseTree("stage.x");
    assertEqual(log.includes("    OBJECT_ACCESS_EXPRESSION"), true);
    assertEqual(log.includes("      READ_GLOBAL"), true);
});

test("Parser - chained property access has nested OBJECT_ACCESS_EXPRESSION", () => {
    const log = getParseTree("stage.player.health");
    // Outer access
    assertEqual(log.includes("    OBJECT_ACCESS_EXPRESSION"), true);
    // Inner nested access
    assertEqual(log.includes("      OBJECT_ACCESS_EXPRESSION"), true);
});

test("Parser - deep property chain has multiple OBJECT_ACCESS_EXPRESSION nodes", () => {
    const log = getParseTree("stage.gameWorld.entities.position.x");
    const accessCount = log.filter(line => line.trim() === "OBJECT_ACCESS_EXPRESSION").length;
    assertEqual(accessCount, 4);
});

// =============================================================================
// Array Access
// =============================================================================

test("Parser - array access produces ARRAY_ACCESS node", () => {
    const log = getParseTree("a[0]");
    assertEqual(log.includes("    ARRAY_ACCESS"), true);
    assertEqual(log.includes("      READ_GLOBAL"), true);
    assertEqual(log.includes("      VALUE"), true);
});

// =============================================================================
// Remembered Value
// =============================================================================

test("Parser - remembered value produces REMEMBERED node", () => {
    const log = getParseTree("{stage.x}");
    assertEqual(log.includes("    REMEMBERED"), true);
    assertEqual(log.includes("      OBJECT_ACCESS_EXPRESSION"), true);
});

// =============================================================================
// Read Global
// =============================================================================

test("Parser - bare identifier produces READ_GLOBAL", () => {
    const log = getParseTree("stage");
    assertEqual(log.includes("    READ_GLOBAL"), true);
    assertEqual(log.includes("      IDENTIFIER"), true);
});

// =============================================================================
// Precedence
// =============================================================================

test("Parser - multiplication has higher precedence than addition", () => {
    const log = getParseTree("1 + 2 * 3");
    // ADDITION at top, MULTIPLICATION nested inside it
    const addIdx = log.indexOf("    ADDITION");
    const mulIdx = log.indexOf("      MULTIPLICATION");
    assertEqual(addIdx >= 0, true);
    assertEqual(mulIdx >= 0, true);
    assertEqual(mulIdx > addIdx, true);
});

test("Parser - parentheses override precedence", () => {
    const log = getParseTree("(1 + 2) * 3");
    // MULTIPLICATION at top, ADDITION nested inside it
    const mulIdx = log.indexOf("    MULTIPLICATION");
    const addIdx = log.indexOf("      ADDITION");
    assertEqual(mulIdx >= 0, true);
    assertEqual(addIdx >= 0, true);
    assertEqual(addIdx > mulIdx, true);
});

test("Parser - logical AND has lower precedence than comparison", () => {
    const log = getParseTree("1 > 2 && 3 < 4");
    const andIdx = log.indexOf("    AND");
    assertEqual(andIdx >= 0, true);
    // GREATER_THAN and LESS_THAN should be children of AND
    assertEqual(log.includes("      GREATER_THAN"), true);
    assertEqual(log.includes("      LESS_THAN"), true);
});

// =============================================================================
// NOT Applied to Expressions
// =============================================================================

test("Parser - NOT applied to property chain", () => {
    const log = getParseTree("!stage.player.dead");
    assertEqual(log.includes("    NOT"), true);
    assertEqual(log.includes("      OBJECT_ACCESS_EXPRESSION"), true);
});

// =============================================================================
// Complex Expressions
// =============================================================================

test("Parser - compound boolean with comparisons", () => {
    const log = getParseTree("stage.player.health > 0 && stage.level.coins >= 10");
    assertEqual(log.includes("    AND"), true);
    assertEqual(log.includes("      GREATER_THAN"), true);
    assertEqual(log.includes("      GREATER_THAN_OR_EQUAL"), true);
    // Both sides access properties
    const accessCount = log.filter(line => line.trim() === "OBJECT_ACCESS_EXPRESSION").length;
    assertEqual(accessCount >= 4, true);
});

test("Parser - arithmetic combined with property access", () => {
    const log = getParseTree("stage.player.x + 100");
    assertEqual(log.includes("    ADDITION"), true);
    assertEqual(log.includes("      OBJECT_ACCESS_EXPRESSION"), true);
    assertEqual(log.includes("      VALUE"), true);
});

// =============================================================================
// Literal Types
// =============================================================================

test("Parser - number literal produces VALUE", () => {
    const log = getParseTree("42");
    assertEqual(log.includes("    VALUE"), true);
});

test("Parser - string literal produces STRING", () => {
    const log = getParseTree('"hello"');
    assertEqual(log.includes("    STRING"), true);
});

test("Parser - null literal produces NULL", () => {
    const log = getParseTree("null");
    assertEqual(log.includes("    NULL"), true);
});

// =============================================================================
// Empty Input
// =============================================================================

test("Parser - empty string produces READ_GLOBAL this", () => {
    const log = getParseTree("");
    assertEqual(log.includes("  READ_GLOBAL"), true);
    assertEqual(log.includes("    IDENTIFIER"), true);
});

// =============================================================================
// Error Cases
// =============================================================================

test("Parser - bare = throws error", () => {
    assertThrows(
        () => getParseTree("="),
        Error,
    );
});

test("Parser - unclosed parenthesis throws error", () => {
    assertThrows(
        () => getParseTree("(1 + 2"),
        Error,
    );
});

test("Parser - unclosed string throws error", () => {
    assertThrows(
        () => getParseTree('"unclosed'),
        Error,
    );
});

test("Parser - triple equals throws error", () => {
    assertThrows(
        () => getParseTree("1 === 2"),
        Error,
    );
});

test("Parser - lone ampersand throws error", () => {
    assertThrows(
        () => getParseTree("1 & 2"),
        Error,
    );
});

test("Parser - lone pipe throws error", () => {
    assertThrows(
        () => getParseTree("1 | 2"),
        Error,
    );
});
