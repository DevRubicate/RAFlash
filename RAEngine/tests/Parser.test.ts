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
// Logical Operators
// =============================================================================

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

test("Parser - unclosed parenthesis throws error", () => {
    assertThrows(
        () => getParseTree("(1 + 2"),
        Error,
    );
});

// =============================================================================
// Function Call
// =============================================================================

test("Parser - function call produces FUNCTION_CALL node", () => {
    const log = getParseTree("len(stage)");
    assertEqual(log.includes("    FUNCTION_CALL"), true);
});

test("Parser - function call with property chain", () => {
    const log = getParseTree("len(stage.enemies)");
    assertEqual(log.includes("    FUNCTION_CALL"), true);
    assertEqual(log.includes("      OBJECT_ACCESS_EXPRESSION"), true);
});

test("Parser - nested function call", () => {
    const log = getParseTree("len(len(stage))");
    const funcCallCount = log.filter(line => line.trim() === "FUNCTION_CALL").length;
    assertEqual(funcCallCount, 2);
});

// =============================================================================
// Ternary
// =============================================================================

test("Parser - ternary produces TERNARY node", () => {
    const log = getParseTree("x > 0 ? 1 : 0");
    assertEqual(log.includes("    TERNARY"), true);
    // Condition should be GREATER_THAN
    assertEqual(log.includes("      GREATER_THAN"), true);
});

test("Parser - nested ternary", () => {
    const log = getParseTree("a > 0 ? a > 5 ? 2 : 1 : 0");
    const ternaryCount = log.filter(line => line.trim() === "TERNARY").length;
    assertEqual(ternaryCount, 2);
});

// =============================================================================
// Unary Negation
// =============================================================================

test("Parser - unary negation inserts implicit zero", () => {
    const log = getParseTree("-x");
    // -x becomes (0 - x), so SUBTRACTION node with VALUE child
    assertEqual(log.includes("    SUBTRACTION"), true);
    assertEqual(log.includes("      VALUE"), true);
    assertEqual(log.includes("      READ_GLOBAL"), true);
});

test("Parser - unary negation of number", () => {
    const log = getParseTree("-5");
    assertEqual(log.includes("    SUBTRACTION"), true);
});

// =============================================================================
// Implicit This (Leading Dot)
// =============================================================================

test("Parser - leading dot produces READ_GLOBAL this with OBJECT_ACCESS_EXPRESSION", () => {
    const log = getParseTree(".health");
    assertEqual(log.includes("    OBJECT_ACCESS_EXPRESSION"), true);
    assertEqual(log.includes("      READ_GLOBAL"), true);
});

// =============================================================================
// Keyword Error Cases
// =============================================================================

test("Parser - if keyword throws unimplemented", () => {
    assertThrows(
        () => getParseTree("if"),
        Error,
    );
});

test("Parser - else keyword throws unimplemented", () => {
    assertThrows(
        () => getParseTree("else"),
        Error,
    );
});

// =============================================================================
// Multi-dimensional Array Access
// =============================================================================

test("Parser - multi-dimensional array access", () => {
    const log = getParseTree("a[0][1]");
    const arrayAccessCount = log.filter(line => line.trim() === "ARRAY_ACCESS").length;
    assertEqual(arrayAccessCount, 2);
});

// =============================================================================
// Remembered Value
// =============================================================================

test("Parser - remembered with property chain", () => {
    const log = getParseTree("{stage.player.health}");
    assertEqual(log.includes("    REMEMBERED"), true);
    const accessCount = log.filter(line => line.trim() === "OBJECT_ACCESS_EXPRESSION").length;
    assertEqual(accessCount, 2);
});

