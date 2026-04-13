/**
 * Formula DSL Lexer Tests
 *
 * Comprehensive tests for tokenization of all supported syntax.
 */

import { assertEquals, assertThrows } from "https://deno.land/std/assert/mod.ts";
import { Lexer, TokenType } from "../src/formula/Lexer.ts";

// Helper: get token types from input
function types(input: string): TokenType[] {
    return new Lexer(input).output.map(t => t.type);
}

// Helper: get token values from input
function values(input: string): (string | null)[] {
    return new Lexer(input).output.map(t => t.value);
}

// =============================================================================
// Number Literals
// =============================================================================

Deno.test("Lexer - integer", () => {
    assertEquals(types("42"), [TokenType.NUMBER]);
    assertEquals(values("42"), ["42"]);
});

Deno.test("Lexer - zero", () => {
    assertEquals(types("0"), [TokenType.NUMBER]);
    assertEquals(values("0"), ["0"]);
});

Deno.test("Lexer - multi-digit number", () => {
    assertEquals(values("12345"), ["12345"]);
});

Deno.test("Lexer - hex literal", () => {
    assertEquals(types("0xFF"), [TokenType.NUMBER]);
    assertEquals(values("0xFF"), ["0xFF"]);
});

Deno.test("Lexer - binary literal", () => {
    assertEquals(types("0b1010"), [TokenType.NUMBER]);
    assertEquals(values("0b1010"), ["0b1010"]);
});

Deno.test("Lexer - digit-prefixed identifier (e.g. 1MOVE)", () => {
    assertEquals(types("1MOVE"), [TokenType.IDENTIFIER]);
    assertEquals(values("1MOVE"), ["1MOVE"]);
});

// =============================================================================
// String Literals
// =============================================================================

Deno.test("Lexer - double-quoted string", () => {
    assertEquals(types('"hello"'), [TokenType.STRING]);
    assertEquals(values('"hello"'), ["hello"]);
});

Deno.test("Lexer - single-quoted string", () => {
    assertEquals(types("'world'"), [TokenType.STRING]);
    assertEquals(values("'world'"), ["world"]);
});

Deno.test("Lexer - empty string", () => {
    assertEquals(values('""'), [""]);
});

Deno.test("Lexer - string with escape sequences", () => {
    assertEquals(values('"a\\nb"'), ["a\nb"]);
    assertEquals(values('"a\\tb"'), ["a\tb"]);
    assertEquals(values('"a\\\\b"'), ["a\\b"]);
    assertEquals(values('"a\\"b"'), ['a"b']);
});

Deno.test("Lexer - single-quoted string with escaped quote", () => {
    assertEquals(values("'it\\'s'"), ["it's"]);
});

Deno.test("Lexer - unclosed string throws", () => {
    assertThrows(() => new Lexer('"hello'), Error, "Unclosed string");
});

// =============================================================================
// Identifiers and Keywords
// =============================================================================

Deno.test("Lexer - identifier", () => {
    assertEquals(types("health"), [TokenType.IDENTIFIER]);
    assertEquals(values("health"), ["health"]);
});

Deno.test("Lexer - identifier with underscore", () => {
    assertEquals(types("_foo"), [TokenType.IDENTIFIER]);
    assertEquals(values("_foo"), ["_foo"]);
});

Deno.test("Lexer - identifier with digits", () => {
    assertEquals(types("player2"), [TokenType.IDENTIFIER]);
    assertEquals(values("player2"), ["player2"]);
});

Deno.test("Lexer - null keyword", () => {
    assertEquals(types("null"), [TokenType.NULL]);
    assertEquals(values("null"), [null]);
});

Deno.test("Lexer - if keyword", () => {
    assertEquals(types("if"), [TokenType.KEYWORD]);
    assertEquals(values("if"), ["if"]);
});

Deno.test("Lexer - else keyword", () => {
    assertEquals(types("else"), [TokenType.KEYWORD]);
    assertEquals(values("else"), ["else"]);
});

Deno.test("Lexer - stage is identifier not keyword", () => {
    assertEquals(types("stage"), [TokenType.IDENTIFIER]);
});

// =============================================================================
// Arithmetic Operators
// =============================================================================

Deno.test("Lexer - plus", () => {
    assertEquals(types("1 + 2"), [TokenType.NUMBER, TokenType.PLUS, TokenType.NUMBER]);
});

Deno.test("Lexer - minus", () => {
    assertEquals(types("5 - 3"), [TokenType.NUMBER, TokenType.MINUS, TokenType.NUMBER]);
});

Deno.test("Lexer - asterisk (multiply)", () => {
    assertEquals(types("2 * 3"), [TokenType.NUMBER, TokenType.ASTERISK, TokenType.NUMBER]);
});

Deno.test("Lexer - double asterisk (exponent)", () => {
    assertEquals(types("2 ** 3"), [TokenType.NUMBER, TokenType.DOUBLE_ASTERISK, TokenType.NUMBER]);
});

Deno.test("Lexer - slash (divide)", () => {
    assertEquals(types("6 / 2"), [TokenType.NUMBER, TokenType.SLASH, TokenType.NUMBER]);
});

Deno.test("Lexer - percent (modulo)", () => {
    assertEquals(types("7 % 3"), [TokenType.NUMBER, TokenType.PERCENT, TokenType.NUMBER]);
});

// =============================================================================
// Comparison Operators
// =============================================================================

Deno.test("Lexer - equal (==)", () => {
    assertEquals(types("a == b"), [TokenType.IDENTIFIER, TokenType.EQUAL, TokenType.IDENTIFIER]);
});

Deno.test("Lexer - not equal (!=)", () => {
    assertEquals(types("a != b"), [TokenType.IDENTIFIER, TokenType.NOT_EQUAL, TokenType.IDENTIFIER]);
});

Deno.test("Lexer - less than", () => {
    assertEquals(types("a < b"), [TokenType.IDENTIFIER, TokenType.LESS_THAN, TokenType.IDENTIFIER]);
});

Deno.test("Lexer - less than or equal", () => {
    assertEquals(types("a <= b"), [TokenType.IDENTIFIER, TokenType.LESS_THAN_OR_EQUAL, TokenType.IDENTIFIER]);
});

Deno.test("Lexer - greater than", () => {
    assertEquals(types("a > b"), [TokenType.IDENTIFIER, TokenType.GREATER_THAN, TokenType.IDENTIFIER]);
});

Deno.test("Lexer - greater than or equal", () => {
    assertEquals(types("a >= b"), [TokenType.IDENTIFIER, TokenType.GREATER_THAN_OR_EQUAL, TokenType.IDENTIFIER]);
});

// =============================================================================
// Logical Operators
// =============================================================================

Deno.test("Lexer - AND (&&)", () => {
    assertEquals(types("a && b"), [TokenType.IDENTIFIER, TokenType.AND, TokenType.IDENTIFIER]);
});

Deno.test("Lexer - OR (||)", () => {
    assertEquals(types("a || b"), [TokenType.IDENTIFIER, TokenType.OR, TokenType.IDENTIFIER]);
});

Deno.test("Lexer - XOR (^)", () => {
    assertEquals(types("a ^ b"), [TokenType.IDENTIFIER, TokenType.XOR, TokenType.IDENTIFIER]);
});

Deno.test("Lexer - NOT (!)", () => {
    assertEquals(types("!a"), [TokenType.NOT, TokenType.IDENTIFIER]);
});

// =============================================================================
// Delimiters and Punctuation
// =============================================================================

Deno.test("Lexer - parentheses", () => {
    assertEquals(types("(1)"), [TokenType.LPAREN, TokenType.NUMBER, TokenType.RPAREN]);
});

Deno.test("Lexer - brackets", () => {
    assertEquals(types("a[0]"), [TokenType.IDENTIFIER, TokenType.LEFT_BRACKET, TokenType.NUMBER, TokenType.RIGHT_BRACKET]);
});

Deno.test("Lexer - braces", () => {
    assertEquals(types("{a}"), [TokenType.LBRACE, TokenType.IDENTIFIER, TokenType.RBRACE]);
});

Deno.test("Lexer - dot", () => {
    assertEquals(types("a.b"), [TokenType.IDENTIFIER, TokenType.DOT, TokenType.IDENTIFIER]);
});

Deno.test("Lexer - comma", () => {
    assertEquals(types("a,b"), [TokenType.IDENTIFIER, TokenType.COMMA, TokenType.IDENTIFIER]);
});

Deno.test("Lexer - semicolon", () => {
    assertEquals(types("a;b"), [TokenType.IDENTIFIER, TokenType.SEMICOLON, TokenType.IDENTIFIER]);
});

// =============================================================================
// Error Cases
// =============================================================================

Deno.test("Lexer - bare = throws", () => {
    assertThrows(() => new Lexer("a = b"), Error, "==");
});

Deno.test("Lexer - bare & throws", () => {
    assertThrows(() => new Lexer("a & b"), Error);
});

Deno.test("Lexer - bare | throws", () => {
    assertThrows(() => new Lexer("a | b"), Error);
});

Deno.test("Lexer - unrecognized symbol throws", () => {
    assertThrows(() => new Lexer("a ~ b"), Error);
});

// =============================================================================
// Whitespace Handling
// =============================================================================

Deno.test("Lexer - tabs and spaces are equivalent", () => {
    assertEquals(types("1\t+\t2"), types("1 + 2"));
});

Deno.test("Lexer - empty input returns no tokens", () => {
    assertEquals(types(""), []);
});

Deno.test("Lexer - only whitespace returns no tokens", () => {
    assertEquals(types("   "), []);
});

// =============================================================================
// Complex Expressions
// =============================================================================

Deno.test("Lexer - stage.player.health == 0", () => {
    assertEquals(types("stage.player.health == 0"), [
        TokenType.IDENTIFIER,
        TokenType.DOT,
        TokenType.IDENTIFIER,
        TokenType.DOT,
        TokenType.IDENTIFIER,
        TokenType.EQUAL,
        TokenType.NUMBER,
    ]);
});

Deno.test("Lexer - stage.inventory[0]", () => {
    assertEquals(types("stage.inventory[0]"), [
        TokenType.IDENTIFIER,
        TokenType.DOT,
        TokenType.IDENTIFIER,
        TokenType.LEFT_BRACKET,
        TokenType.NUMBER,
        TokenType.RIGHT_BRACKET,
    ]);
});

Deno.test("Lexer - remembered value {stage.x}", () => {
    assertEquals(types("{stage.x}"), [
        TokenType.LBRACE,
        TokenType.IDENTIFIER,
        TokenType.DOT,
        TokenType.IDENTIFIER,
        TokenType.RBRACE,
    ]);
});

Deno.test("Lexer - ternary expression", () => {
    assertEquals(types('a ? "yes" : "no"'), [
        TokenType.IDENTIFIER,
        TokenType.QUESTION,
        TokenType.STRING,
        TokenType.COLON,
        TokenType.STRING,
    ]);
});

Deno.test("Lexer - complex boolean expression", () => {
    assertEquals(types("a > 0 && b < 10 || !c"), [
        TokenType.IDENTIFIER, TokenType.GREATER_THAN, TokenType.NUMBER,
        TokenType.AND,
        TokenType.IDENTIFIER, TokenType.LESS_THAN, TokenType.NUMBER,
        TokenType.OR,
        TokenType.NOT, TokenType.IDENTIFIER,
    ]);
});
