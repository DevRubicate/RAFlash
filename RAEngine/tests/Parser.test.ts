/**
 * Parser Tests - Parse Tree Structure
 *
 * Tests for operator nodes, property access, precedence, and error handling.
 * Complements Formula.test.ts which focuses on ternary.
 */

import { assertEquals, assertThrows } from "https://deno.land/std/assert/mod.ts";
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

Deno.test("Parser - addition node", () => {
    const log = getParseTree("1 + 2");
    assertEquals(log.includes("    ADDITION"), true);
    assertEquals(log.includes("      VALUE"), true);
});

Deno.test("Parser - subtraction node", () => {
    const log = getParseTree("1 - 2");
    assertEquals(log.includes("    SUBTRACTION"), true);
    assertEquals(log.includes("      VALUE"), true);
});

Deno.test("Parser - multiplication node", () => {
    const log = getParseTree("1 * 2");
    assertEquals(log.includes("    MULTIPLICATION"), true);
    assertEquals(log.includes("      VALUE"), true);
});

Deno.test("Parser - division node", () => {
    const log = getParseTree("1 / 2");
    assertEquals(log.includes("    DIVISION"), true);
    assertEquals(log.includes("      VALUE"), true);
});

Deno.test("Parser - modulo node", () => {
    const log = getParseTree("1 % 2");
    assertEquals(log.includes("    MODULO"), true);
    assertEquals(log.includes("      VALUE"), true);
});

Deno.test("Parser - exponent node", () => {
    const log = getParseTree("2 ** 3");
    assertEquals(log.includes("    EXPONENT"), true);
    assertEquals(log.includes("      VALUE"), true);
});

// =============================================================================
// Comparison Operators
// =============================================================================

Deno.test("Parser - equal node", () => {
    const log = getParseTree("1 == 2");
    assertEquals(log.includes("    EQUAL"), true);
});

Deno.test("Parser - not equal node", () => {
    const log = getParseTree("1 != 2");
    assertEquals(log.includes("    NOT_EQUAL"), true);
});

Deno.test("Parser - greater than node", () => {
    const log = getParseTree("1 > 2");
    assertEquals(log.includes("    GREATER_THAN"), true);
});

Deno.test("Parser - greater than or equal node", () => {
    const log = getParseTree("1 >= 2");
    assertEquals(log.includes("    GREATER_THAN_OR_EQUAL"), true);
});

Deno.test("Parser - less than node", () => {
    const log = getParseTree("1 < 2");
    assertEquals(log.includes("    LESS_THAN"), true);
});

Deno.test("Parser - less than or equal node", () => {
    const log = getParseTree("1 <= 2");
    assertEquals(log.includes("    LESS_THAN_OR_EQUAL"), true);
});

// =============================================================================
// Logical Operators
// =============================================================================

Deno.test("Parser - AND node", () => {
    const log = getParseTree("1 && 2");
    assertEquals(log.includes("    AND"), true);
    assertEquals(log.includes("      VALUE"), true);
});

Deno.test("Parser - OR node", () => {
    const log = getParseTree("1 || 2");
    assertEquals(log.includes("    OR"), true);
    assertEquals(log.includes("      VALUE"), true);
});

Deno.test("Parser - XOR node", () => {
    const log = getParseTree("1 ^ 2");
    assertEquals(log.includes("    XOR"), true);
    assertEquals(log.includes("      VALUE"), true);
});

Deno.test("Parser - NOT node", () => {
    const log = getParseTree("!x");
    assertEquals(log.includes("    NOT"), true);
    assertEquals(log.includes("      READ_GLOBAL"), true);
});

// =============================================================================
// Property Access
// =============================================================================

Deno.test("Parser - simple property access produces OBJECT_ACCESS_EXPRESSION", () => {
    const log = getParseTree("stage.x");
    assertEquals(log.includes("    OBJECT_ACCESS_EXPRESSION"), true);
    assertEquals(log.includes("      READ_GLOBAL"), true);
});

Deno.test("Parser - chained property access has nested OBJECT_ACCESS_EXPRESSION", () => {
    const log = getParseTree("stage.player.health");
    // Outer access
    assertEquals(log.includes("    OBJECT_ACCESS_EXPRESSION"), true);
    // Inner nested access
    assertEquals(log.includes("      OBJECT_ACCESS_EXPRESSION"), true);
});

Deno.test("Parser - deep property chain has multiple OBJECT_ACCESS_EXPRESSION nodes", () => {
    const log = getParseTree("stage.gameWorld.entities.position.x");
    const accessCount = log.filter(line => line.trim() === "OBJECT_ACCESS_EXPRESSION").length;
    assertEquals(accessCount, 4);
});

// =============================================================================
// Array Access
// =============================================================================

Deno.test("Parser - array access produces ARRAY_ACCESS node", () => {
    const log = getParseTree("a[0]");
    assertEquals(log.includes("    ARRAY_ACCESS"), true);
    assertEquals(log.includes("      READ_GLOBAL"), true);
    assertEquals(log.includes("      VALUE"), true);
});

// =============================================================================
// Remembered Value
// =============================================================================

Deno.test("Parser - remembered value produces REMEMBERED node", () => {
    const log = getParseTree("{stage.x}");
    assertEquals(log.includes("    REMEMBERED"), true);
    assertEquals(log.includes("      OBJECT_ACCESS_EXPRESSION"), true);
});

// =============================================================================
// Read Global
// =============================================================================

Deno.test("Parser - bare identifier produces READ_GLOBAL", () => {
    const log = getParseTree("stage");
    assertEquals(log.includes("    READ_GLOBAL"), true);
    assertEquals(log.includes("      IDENTIFIER"), true);
});

// =============================================================================
// Precedence
// =============================================================================

Deno.test("Parser - multiplication has higher precedence than addition", () => {
    const log = getParseTree("1 + 2 * 3");
    // ADDITION at top, MULTIPLICATION nested inside it
    const addIdx = log.indexOf("    ADDITION");
    const mulIdx = log.indexOf("      MULTIPLICATION");
    assertEquals(addIdx >= 0, true);
    assertEquals(mulIdx >= 0, true);
    assertEquals(mulIdx > addIdx, true);
});

Deno.test("Parser - parentheses override precedence", () => {
    const log = getParseTree("(1 + 2) * 3");
    // MULTIPLICATION at top, ADDITION nested inside it
    const mulIdx = log.indexOf("    MULTIPLICATION");
    const addIdx = log.indexOf("      ADDITION");
    assertEquals(mulIdx >= 0, true);
    assertEquals(addIdx >= 0, true);
    assertEquals(addIdx > mulIdx, true);
});

Deno.test("Parser - logical AND has lower precedence than comparison", () => {
    const log = getParseTree("1 > 2 && 3 < 4");
    const andIdx = log.indexOf("    AND");
    assertEquals(andIdx >= 0, true);
    // GREATER_THAN and LESS_THAN should be children of AND
    assertEquals(log.includes("      GREATER_THAN"), true);
    assertEquals(log.includes("      LESS_THAN"), true);
});

// =============================================================================
// NOT Applied to Expressions
// =============================================================================

Deno.test("Parser - NOT applied to property chain", () => {
    const log = getParseTree("!stage.player.dead");
    assertEquals(log.includes("    NOT"), true);
    assertEquals(log.includes("      OBJECT_ACCESS_EXPRESSION"), true);
});

// =============================================================================
// Complex Expressions
// =============================================================================

Deno.test("Parser - compound boolean with comparisons", () => {
    const log = getParseTree("stage.player.health > 0 && stage.level.coins >= 10");
    assertEquals(log.includes("    AND"), true);
    assertEquals(log.includes("      GREATER_THAN"), true);
    assertEquals(log.includes("      GREATER_THAN_OR_EQUAL"), true);
    // Both sides access properties
    const accessCount = log.filter(line => line.trim() === "OBJECT_ACCESS_EXPRESSION").length;
    assertEquals(accessCount >= 4, true);
});

Deno.test("Parser - arithmetic combined with property access", () => {
    const log = getParseTree("stage.player.x + 100");
    assertEquals(log.includes("    ADDITION"), true);
    assertEquals(log.includes("      OBJECT_ACCESS_EXPRESSION"), true);
    assertEquals(log.includes("      VALUE"), true);
});

// =============================================================================
// Literal Types
// =============================================================================

Deno.test("Parser - number literal produces VALUE", () => {
    const log = getParseTree("42");
    assertEquals(log.includes("    VALUE"), true);
});

Deno.test("Parser - string literal produces STRING", () => {
    const log = getParseTree('"hello"');
    assertEquals(log.includes("    STRING"), true);
});

Deno.test("Parser - null literal produces NULL", () => {
    const log = getParseTree("null");
    assertEquals(log.includes("    NULL"), true);
});

// =============================================================================
// Empty Input
// =============================================================================

Deno.test("Parser - empty string produces READ_GLOBAL this", () => {
    const log = getParseTree("");
    assertEquals(log.includes("  READ_GLOBAL"), true);
    assertEquals(log.includes("    IDENTIFIER"), true);
});

// =============================================================================
// Error Cases
// =============================================================================

Deno.test("Parser - bare = throws error", () => {
    assertThrows(
        () => getParseTree("="),
        Error,
    );
});

Deno.test("Parser - unclosed parenthesis throws error", () => {
    assertThrows(
        () => getParseTree("(1 + 2"),
        Error,
    );
});

Deno.test("Parser - unclosed string throws error", () => {
    assertThrows(
        () => getParseTree('"unclosed'),
        Error,
    );
});

Deno.test("Parser - triple equals throws error", () => {
    assertThrows(
        () => getParseTree("1 === 2"),
        Error,
    );
});

Deno.test("Parser - lone ampersand throws error", () => {
    assertThrows(
        () => getParseTree("1 & 2"),
        Error,
    );
});

Deno.test("Parser - lone pipe throws error", () => {
    assertThrows(
        () => getParseTree("1 | 2"),
        Error,
    );
});
