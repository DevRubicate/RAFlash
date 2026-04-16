/**
 * Formula DSL Lexer Tests
 *
 * Comprehensive tests for tokenization of all supported syntax.
 */

import { test, assertEqual, assertThrows } from "../../tests/framework.ts";
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

test("Lexer - integer", () => {
    assertEqual(types("42"), [TokenType.NUMBER]);
    assertEqual(values("42"), ["42"]);
});

test("Lexer - zero", () => {
    assertEqual(types("0"), [TokenType.NUMBER]);
    assertEqual(values("0"), ["0"]);
});

test("Lexer - multi-digit number", () => {
    assertEqual(values("12345"), ["12345"]);
});

test("Lexer - hex literal", () => {
    assertEqual(types("0xFF"), [TokenType.NUMBER]);
    assertEqual(values("0xFF"), ["0xFF"]);
});

test("Lexer - binary literal", () => {
    assertEqual(types("0b1010"), [TokenType.NUMBER]);
    assertEqual(values("0b1010"), ["0b1010"]);
});

test("Lexer - digit-prefixed identifier (e.g. 1MOVE)", () => {
    assertEqual(types("1MOVE"), [TokenType.IDENTIFIER]);
    assertEqual(values("1MOVE"), ["1MOVE"]);
});

// =============================================================================
// String Literals
// =============================================================================

test("Lexer - double-quoted string", () => {
    assertEqual(types('"hello"'), [TokenType.STRING]);
    assertEqual(values('"hello"'), ["hello"]);
});

test("Lexer - single-quoted string", () => {
    assertEqual(types("'world'"), [TokenType.STRING]);
    assertEqual(values("'world'"), ["world"]);
});

test("Lexer - empty string", () => {
    assertEqual(values('""'), [""]);
});

test("Lexer - string with escape sequences", () => {
    assertEqual(values('"a\\nb"'), ["a\nb"]);
    assertEqual(values('"a\\tb"'), ["a\tb"]);
    assertEqual(values('"a\\\\b"'), ["a\\b"]);
    assertEqual(values('"a\\"b"'), ['a"b']);
});

test("Lexer - single-quoted string with escaped quote", () => {
    assertEqual(values("'it\\'s'"), ["it's"]);
});

test("Lexer - unclosed string throws", () => {
    assertThrows(() => new Lexer('"hello'), Error, "Unclosed string");
});

// =============================================================================
// Identifiers and Keywords
// =============================================================================

test("Lexer - identifier", () => {
    assertEqual(types("health"), [TokenType.IDENTIFIER]);
    assertEqual(values("health"), ["health"]);
});

test("Lexer - identifier with underscore", () => {
    assertEqual(types("_foo"), [TokenType.IDENTIFIER]);
    assertEqual(values("_foo"), ["_foo"]);
});

test("Lexer - identifier with digits", () => {
    assertEqual(types("player2"), [TokenType.IDENTIFIER]);
    assertEqual(values("player2"), ["player2"]);
});

test("Lexer - null keyword", () => {
    assertEqual(types("null"), [TokenType.NULL]);
    assertEqual(values("null"), [null]);
});

test("Lexer - if keyword", () => {
    assertEqual(types("if"), [TokenType.KEYWORD]);
    assertEqual(values("if"), ["if"]);
});

test("Lexer - else keyword", () => {
    assertEqual(types("else"), [TokenType.KEYWORD]);
    assertEqual(values("else"), ["else"]);
});

test("Lexer - stage is identifier not keyword", () => {
    assertEqual(types("stage"), [TokenType.IDENTIFIER]);
});

// =============================================================================
// Arithmetic Operators
// =============================================================================

test("Lexer - plus", () => {
    assertEqual(types("1 + 2"), [TokenType.NUMBER, TokenType.PLUS, TokenType.NUMBER]);
});

test("Lexer - minus", () => {
    assertEqual(types("5 - 3"), [TokenType.NUMBER, TokenType.MINUS, TokenType.NUMBER]);
});

test("Lexer - asterisk (multiply)", () => {
    assertEqual(types("2 * 3"), [TokenType.NUMBER, TokenType.ASTERISK, TokenType.NUMBER]);
});

test("Lexer - double asterisk (exponent)", () => {
    assertEqual(types("2 ** 3"), [TokenType.NUMBER, TokenType.DOUBLE_ASTERISK, TokenType.NUMBER]);
});

test("Lexer - slash (divide)", () => {
    assertEqual(types("6 / 2"), [TokenType.NUMBER, TokenType.SLASH, TokenType.NUMBER]);
});

test("Lexer - percent (modulo)", () => {
    assertEqual(types("7 % 3"), [TokenType.NUMBER, TokenType.PERCENT, TokenType.NUMBER]);
});

// =============================================================================
// Comparison Operators
// =============================================================================

test("Lexer - equal (==)", () => {
    assertEqual(types("a == b"), [TokenType.IDENTIFIER, TokenType.EQUAL, TokenType.IDENTIFIER]);
});

test("Lexer - not equal (!=)", () => {
    assertEqual(types("a != b"), [TokenType.IDENTIFIER, TokenType.NOT_EQUAL, TokenType.IDENTIFIER]);
});

test("Lexer - less than", () => {
    assertEqual(types("a < b"), [TokenType.IDENTIFIER, TokenType.LESS_THAN, TokenType.IDENTIFIER]);
});

test("Lexer - less than or equal", () => {
    assertEqual(types("a <= b"), [TokenType.IDENTIFIER, TokenType.LESS_THAN_OR_EQUAL, TokenType.IDENTIFIER]);
});

test("Lexer - greater than", () => {
    assertEqual(types("a > b"), [TokenType.IDENTIFIER, TokenType.GREATER_THAN, TokenType.IDENTIFIER]);
});

test("Lexer - greater than or equal", () => {
    assertEqual(types("a >= b"), [TokenType.IDENTIFIER, TokenType.GREATER_THAN_OR_EQUAL, TokenType.IDENTIFIER]);
});

// =============================================================================
// Logical Operators
// =============================================================================

test("Lexer - AND (&&)", () => {
    assertEqual(types("a && b"), [TokenType.IDENTIFIER, TokenType.AND, TokenType.IDENTIFIER]);
});

test("Lexer - OR (||)", () => {
    assertEqual(types("a || b"), [TokenType.IDENTIFIER, TokenType.OR, TokenType.IDENTIFIER]);
});

test("Lexer - XOR (^)", () => {
    assertEqual(types("a ^ b"), [TokenType.IDENTIFIER, TokenType.XOR, TokenType.IDENTIFIER]);
});

test("Lexer - NOT (!)", () => {
    assertEqual(types("!a"), [TokenType.NOT, TokenType.IDENTIFIER]);
});

// =============================================================================
// Delimiters and Punctuation
// =============================================================================

test("Lexer - parentheses", () => {
    assertEqual(types("(1)"), [TokenType.LPAREN, TokenType.NUMBER, TokenType.RPAREN]);
});

test("Lexer - brackets", () => {
    assertEqual(types("a[0]"), [TokenType.IDENTIFIER, TokenType.LEFT_BRACKET, TokenType.NUMBER, TokenType.RIGHT_BRACKET]);
});

test("Lexer - braces", () => {
    assertEqual(types("{a}"), [TokenType.LBRACE, TokenType.IDENTIFIER, TokenType.RBRACE]);
});

test("Lexer - dot", () => {
    assertEqual(types("a.b"), [TokenType.IDENTIFIER, TokenType.DOT, TokenType.IDENTIFIER]);
});

test("Lexer - comma", () => {
    assertEqual(types("a,b"), [TokenType.IDENTIFIER, TokenType.COMMA, TokenType.IDENTIFIER]);
});

test("Lexer - semicolon", () => {
    assertEqual(types("a;b"), [TokenType.IDENTIFIER, TokenType.SEMICOLON, TokenType.IDENTIFIER]);
});

// =============================================================================
// Error Cases
// =============================================================================

test("Lexer - bare = throws", () => {
    assertThrows(() => new Lexer("a = b"), Error, "==");
});

test("Lexer - bare & throws", () => {
    assertThrows(() => new Lexer("a & b"), Error);
});

test("Lexer - bare | throws", () => {
    assertThrows(() => new Lexer("a | b"), Error);
});

test("Lexer - unrecognized symbol throws", () => {
    assertThrows(() => new Lexer("a ~ b"), Error);
});

// =============================================================================
// Whitespace Handling
// =============================================================================

test("Lexer - tabs and spaces are equivalent", () => {
    assertEqual(types("1\t+\t2"), types("1 + 2"));
});

test("Lexer - empty input returns no tokens", () => {
    assertEqual(types(""), []);
});

test("Lexer - only whitespace returns no tokens", () => {
    assertEqual(types("   "), []);
});

// =============================================================================
// Complex Expressions
// =============================================================================

test("Lexer - stage.player.health == 0", () => {
    assertEqual(types("stage.player.health == 0"), [
        TokenType.IDENTIFIER,
        TokenType.DOT,
        TokenType.IDENTIFIER,
        TokenType.DOT,
        TokenType.IDENTIFIER,
        TokenType.EQUAL,
        TokenType.NUMBER,
    ]);
});

test("Lexer - stage.inventory[0]", () => {
    assertEqual(types("stage.inventory[0]"), [
        TokenType.IDENTIFIER,
        TokenType.DOT,
        TokenType.IDENTIFIER,
        TokenType.LEFT_BRACKET,
        TokenType.NUMBER,
        TokenType.RIGHT_BRACKET,
    ]);
});

test("Lexer - remembered value {stage.x}", () => {
    assertEqual(types("{stage.x}"), [
        TokenType.LBRACE,
        TokenType.IDENTIFIER,
        TokenType.DOT,
        TokenType.IDENTIFIER,
        TokenType.RBRACE,
    ]);
});

test("Lexer - ternary expression", () => {
    assertEqual(types('a ? "yes" : "no"'), [
        TokenType.IDENTIFIER,
        TokenType.QUESTION,
        TokenType.STRING,
        TokenType.COLON,
        TokenType.STRING,
    ]);
});

test("Lexer - complex boolean expression", () => {
    assertEqual(types("a > 0 && b < 10 || !c"), [
        TokenType.IDENTIFIER, TokenType.GREATER_THAN, TokenType.NUMBER,
        TokenType.AND,
        TokenType.IDENTIFIER, TokenType.LESS_THAN, TokenType.NUMBER,
        TokenType.OR,
        TokenType.NOT, TokenType.IDENTIFIER,
    ]);
});

// =============================================================================
// Float Literals
// =============================================================================

test("Lexer - simple float", () => {
    assertEqual(types("3.14"), [TokenType.NUMBER]);
    assertEqual(values("3.14"), ["3.14"]);
});

test("Lexer - float with leading zero", () => {
    assertEqual(types("0.5"), [TokenType.NUMBER]);
    assertEqual(values("0.5"), ["0.5"]);
});

test("Lexer - float in expression", () => {
    assertEqual(types("1 + 0.5"), [TokenType.NUMBER, TokenType.PLUS, TokenType.NUMBER]);
    assertEqual(values("1 + 0.5"), ["1", null, "0.5"]);
});

test("Lexer - number followed by dot identifier is not float", () => {
    // "stage.0" should be IDENTIFIER DOT NUMBER, not a float
    assertEqual(types("stage.0"), [TokenType.IDENTIFIER, TokenType.DOT, TokenType.NUMBER]);
});

test("Lexer - 0.1 is a single float token", () => {
    assertEqual(types("0.1"), [TokenType.NUMBER]);
    assertEqual(values("0.1"), ["0.1"]);
});

// =============================================================================
// Bare Prefix Rejection
// =============================================================================

test("Lexer - bare 0x throws", () => {
    assertThrows(() => new Lexer("0x"), Error, "no digits after prefix");
});

test("Lexer - bare 0b throws", () => {
    assertThrows(() => new Lexer("0b"), Error, "no digits after prefix");
});

// =============================================================================
// Newline Handling
// =============================================================================

test("Lexer - newline acts as whitespace", () => {
    assertEqual(types("1\n+\n2"), [TokenType.NUMBER, TokenType.PLUS, TokenType.NUMBER]);
});

test("Lexer - newline in complex expression", () => {
    assertEqual(types("stage\n.player"), [
        TokenType.IDENTIFIER, TokenType.DOT, TokenType.IDENTIFIER,
    ]);
});

// =============================================================================
// String Escape Edge Cases
// =============================================================================

test("Lexer - default escape passes through character", () => {
    // \z is not a recognized escape, so it becomes just "z"
    assertEqual(values('"a\\zb"'), ["azb"]);
});

test("Lexer - single-quoted string with \\n escape", () => {
    assertEqual(values("'line1\\nline2'"), ["line1\nline2"]);
});

test("Lexer - string ending with lone backslash throws", () => {
    assertThrows(() => new Lexer('"hello\\'), Error, "Unclosed string");
});

// =============================================================================
// Carriage Return Rejection
// =============================================================================

test("Lexer - carriage return normalized to newline", () => {
    // \r and \r\n are normalized to \n before lexing
    const lexer = new Lexer("a\rb");
    const tokens = lexer.tokenize();
    assertEqual(tokens[0].value, "a");
    assertEqual(tokens[1].value, "b");
});

// =============================================================================
// Additional Unrecognized Symbols
// =============================================================================

test("Lexer - @ throws", () => {
    assertThrows(() => new Lexer("@"), Error, "Unrecognized symbol");
});

test("Lexer - # throws", () => {
    assertThrows(() => new Lexer("#"), Error, "Unrecognized symbol");
});

test("Lexer - $ throws", () => {
    assertThrows(() => new Lexer("$"), Error, "Unrecognized symbol");
});

test("Lexer - backtick throws", () => {
    assertThrows(() => new Lexer("`"), Error, "Unrecognized symbol");
});

// =============================================================================
// Question, Colon, Ternary Tokens
// =============================================================================

test("Lexer - question mark token", () => {
    assertEqual(types("a ? b : c"), [
        TokenType.IDENTIFIER, TokenType.QUESTION, TokenType.IDENTIFIER,
        TokenType.COLON, TokenType.IDENTIFIER,
    ]);
});

// =============================================================================
// Digit-Prefixed Identifiers
// =============================================================================

test("Lexer - bare 0x followed by non-hex letters throws", () => {
    // 0xGG still fails bare-prefix check because G is not a hex digit
    assertThrows(() => new Lexer("0xGG"), Error, "no digits after prefix");
});

test("Lexer - number followed by letters", () => {
    assertEqual(types("42abc"), [TokenType.IDENTIFIER]);
    assertEqual(values("42abc"), ["42abc"]);
});
