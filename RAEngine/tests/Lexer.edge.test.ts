/**
 * Lexer Edge Case Tests (v0.0.19 release coverage)
 *
 * Tests for bugs fixed since v0.0.18:
 *   - Bare 0x/0b prefix without digits (was silently producing NaN)
 *   - Floating-point number literals
 *   - Numeric property names after dot
 */

import { test, assertEqual, assertThrows } from "../../tests/framework.ts";
import { Lexer, TokenType } from "../src/formula/Lexer.ts";

function types(input: string): TokenType[] {
    return new Lexer(input).output.map(t => t.type);
}

function values(input: string): (string | null)[] {
    return new Lexer(input).output.map(t => t.value);
}

// =============================================================================
// Bare 0x/0b prefix without digits (bug fix: was silently producing NaN)
// =============================================================================

test("Lexer - bare 0x throws error", () => {
    assertThrows(() => new Lexer("0x"), Error, "no digits after prefix");
});

test("Lexer - bare 0b throws error", () => {
    assertThrows(() => new Lexer("0b"), Error, "no digits after prefix");
});

test("Lexer - 0x followed by non-hex throws error", () => {
    assertThrows(() => new Lexer("0xGG"), Error, "no digits after prefix");
});

test("Lexer - 0b followed by non-binary throws error", () => {
    assertThrows(() => new Lexer("0b2"), Error, "no digits after prefix");
});

test("Lexer - valid hex still works after fix", () => {
    assertEqual(types("0xFF"), [TokenType.NUMBER]);
    assertEqual(values("0xFF"), ["0xFF"]);
});

test("Lexer - valid binary still works after fix", () => {
    assertEqual(types("0b1010"), [TokenType.NUMBER]);
    assertEqual(values("0b1010"), ["0b1010"]);
});

test("Lexer - 0x with single digit", () => {
    assertEqual(values("0xA"), ["0xA"]);
});

test("Lexer - 0b with single digit", () => {
    assertEqual(values("0b1"), ["0b1"]);
});

// =============================================================================
// Floating-point number literals
// =============================================================================

test("Lexer - simple float", () => {
    assertEqual(types("3.14"), [TokenType.NUMBER]);
    assertEqual(values("3.14"), ["3.14"]);
});

test("Lexer - float with leading zero", () => {
    assertEqual(types("0.5"), [TokenType.NUMBER]);
    assertEqual(values("0.5"), ["0.5"]);
});

test("Lexer - float with many decimals", () => {
    assertEqual(values("1.23456"), ["1.23456"]);
});

test("Lexer - float zero point zero", () => {
    assertEqual(values("0.0"), ["0.0"]);
});

test("Lexer - integer followed by dot and identifier is NOT a float", () => {
    // "5.health" should be NUMBER DOT IDENTIFIER, not a float
    assertEqual(types("5.health"), [TokenType.NUMBER, TokenType.DOT, TokenType.IDENTIFIER]);
    assertEqual(values("5.health"), ["5", null, "health"]);
});

test("Lexer - float in expression", () => {
    assertEqual(types("1.5 + 2.3"), [
        TokenType.NUMBER, TokenType.PLUS, TokenType.NUMBER
    ]);
    assertEqual(values("1.5 + 2.3"), ["1.5", null, "2.3"]);
});

test("Lexer - float in comparison", () => {
    assertEqual(types("x > 3.14"), [
        TokenType.IDENTIFIER, TokenType.GREATER_THAN, TokenType.NUMBER
    ]);
});

test("Lexer - dot without following digit is DOT operator, not float", () => {
    // "42." followed by nothing should be NUMBER DOT (not a float)
    // "42.foo" should be NUMBER DOT IDENTIFIER
    assertEqual(types("42.foo"), [TokenType.NUMBER, TokenType.DOT, TokenType.IDENTIFIER]);
});

// =============================================================================
// Floating-point doesn't break hex
// =============================================================================

test("Lexer - hex literal not affected by float parsing", () => {
    // 0xFF should not try to parse the 'F' as decimal continuation
    assertEqual(values("0xFF"), ["0xFF"]);
    assertEqual(types("0xFF"), [TokenType.NUMBER]);
});

test("Lexer - hex with dots after", () => {
    // "0xFF.foo" = hex number, dot, identifier
    assertEqual(types("0xFF.foo"), [TokenType.NUMBER, TokenType.DOT, TokenType.IDENTIFIER]);
});
