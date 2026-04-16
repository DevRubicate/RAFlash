/**
 * Lexer Edge Case Tests (v0.0.19 release coverage)
 *
 * Tests for bugs fixed since v0.0.18:
 *   - Bare 0x/0b prefix without digits (was silently producing NaN)
 *   - Floating-point number literals
 *   - Numeric property names after dot
 */

import { assertEquals, assertThrows } from "https://deno.land/std/assert/mod.ts";
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

Deno.test("Lexer - bare 0x throws error", () => {
    assertThrows(() => new Lexer("0x"), Error, "no digits after prefix");
});

Deno.test("Lexer - bare 0b throws error", () => {
    assertThrows(() => new Lexer("0b"), Error, "no digits after prefix");
});

Deno.test("Lexer - 0x followed by non-hex throws error", () => {
    assertThrows(() => new Lexer("0xGG"), Error, "no digits after prefix");
});

Deno.test("Lexer - 0b followed by non-binary throws error", () => {
    assertThrows(() => new Lexer("0b2"), Error, "no digits after prefix");
});

Deno.test("Lexer - valid hex still works after fix", () => {
    assertEquals(types("0xFF"), [TokenType.NUMBER]);
    assertEquals(values("0xFF"), ["0xFF"]);
});

Deno.test("Lexer - valid binary still works after fix", () => {
    assertEquals(types("0b1010"), [TokenType.NUMBER]);
    assertEquals(values("0b1010"), ["0b1010"]);
});

Deno.test("Lexer - 0x with single digit", () => {
    assertEquals(values("0xA"), ["0xA"]);
});

Deno.test("Lexer - 0b with single digit", () => {
    assertEquals(values("0b1"), ["0b1"]);
});

// =============================================================================
// Floating-point number literals
// =============================================================================

Deno.test("Lexer - simple float", () => {
    assertEquals(types("3.14"), [TokenType.NUMBER]);
    assertEquals(values("3.14"), ["3.14"]);
});

Deno.test("Lexer - float with leading zero", () => {
    assertEquals(types("0.5"), [TokenType.NUMBER]);
    assertEquals(values("0.5"), ["0.5"]);
});

Deno.test("Lexer - float with many decimals", () => {
    assertEquals(values("1.23456"), ["1.23456"]);
});

Deno.test("Lexer - float zero point zero", () => {
    assertEquals(values("0.0"), ["0.0"]);
});

Deno.test("Lexer - integer followed by dot and identifier is NOT a float", () => {
    // "5.health" should be NUMBER DOT IDENTIFIER, not a float
    assertEquals(types("5.health"), [TokenType.NUMBER, TokenType.DOT, TokenType.IDENTIFIER]);
    assertEquals(values("5.health"), ["5", null, "health"]);
});

Deno.test("Lexer - float in expression", () => {
    assertEquals(types("1.5 + 2.3"), [
        TokenType.NUMBER, TokenType.PLUS, TokenType.NUMBER
    ]);
    assertEquals(values("1.5 + 2.3"), ["1.5", null, "2.3"]);
});

Deno.test("Lexer - float in comparison", () => {
    assertEquals(types("x > 3.14"), [
        TokenType.IDENTIFIER, TokenType.GREATER_THAN, TokenType.NUMBER
    ]);
});

Deno.test("Lexer - dot without following digit is DOT operator, not float", () => {
    // "42." followed by nothing should be NUMBER DOT (not a float)
    // "42.foo" should be NUMBER DOT IDENTIFIER
    assertEquals(types("42.foo"), [TokenType.NUMBER, TokenType.DOT, TokenType.IDENTIFIER]);
});

// =============================================================================
// Floating-point doesn't break hex
// =============================================================================

Deno.test("Lexer - hex literal not affected by float parsing", () => {
    // 0xFF should not try to parse the 'F' as decimal continuation
    assertEquals(values("0xFF"), ["0xFF"]);
    assertEquals(types("0xFF"), [TokenType.NUMBER]);
});

Deno.test("Lexer - hex with dots after", () => {
    // "0xFF.foo" = hex number, dot, identifier
    assertEquals(types("0xFF.foo"), [TokenType.NUMBER, TokenType.DOT, TokenType.IDENTIFIER]);
});
