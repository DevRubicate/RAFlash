/**
 * Formula DSL Tests - Ternary Operator
 *
 * Tests for the ternary conditional operator (condition ? then : else)
 */

import { assertEquals, assertThrows } from "https://deno.land/std/assert/mod.ts";
import { Lexer, TokenType } from "../src/formula/Lexer.ts";
import { Parser } from "../src/formula/Parser.ts";
import { Builder } from "../src/formula/Builder.ts";
import { MnemonicGenerator } from "../src/formula/MnemonicGenerator.ts";
import { NODE_TYPE } from "../src/formula/NODE_TYPE.ts";

// Helper to get parse tree node types
function getParseTree(input: string): string[] {
    const lexer = new Lexer(input);
    const parser = new Parser(lexer.output, input);
    return parser.log;
}

// Helper to get mnemonic output
function getMnemonic(input: string): string[] {
    const lexer = new Lexer(input);
    const parser = new Parser(lexer.output, input);
    const builder = new Builder(parser.output).build();
    return new MnemonicGenerator(builder.output()).generate();
}

// =============================================================================
// Lexer Tests
// =============================================================================

Deno.test("Lexer - tokenizes ? as QUESTION", () => {
    const lexer = new Lexer("?");
    assertEquals(lexer.output[0].type, TokenType.QUESTION);
});

Deno.test("Lexer - tokenizes : as COLON", () => {
    const lexer = new Lexer(":");
    assertEquals(lexer.output[0].type, TokenType.COLON);
});

Deno.test("Lexer - tokenizes full ternary expression", () => {
    const lexer = new Lexer('1 ? "a" : "b"');
    const types = lexer.output.map(t => t.type);
    assertEquals(types, [
        TokenType.NUMBER,
        TokenType.QUESTION,
        TokenType.STRING,
        TokenType.COLON,
        TokenType.STRING,
    ]);
});

// =============================================================================
// Parser Tests - Basic
// =============================================================================

Deno.test("Parser - simple ternary with literals", () => {
    const log = getParseTree('1 ? "yes" : "no"');
    assertEquals(log.includes("    TERNARY"), true);
    assertEquals(log.includes("      VALUE"), true);
    assertEquals(log.includes("      STRING"), true);
});

Deno.test("Parser - ternary with comparison condition", () => {
    const log = getParseTree('1 == 0 ? "yes" : "no"');
    assertEquals(log.includes("    TERNARY"), true);
    assertEquals(log.includes("      EQUAL"), true);
});

Deno.test("Parser - ternary with identifier condition", () => {
    const log = getParseTree('x ? "truthy" : "falsy"');
    assertEquals(log.includes("    TERNARY"), true);
    assertEquals(log.includes("      READ_GLOBAL"), true);
});

// =============================================================================
// Parser Tests - Parentheses (regression tests for bug fixes)
// =============================================================================

Deno.test("Parser - ternary inside parentheses", () => {
    const log = getParseTree('(1 == 0 ? "yes" : "no")');
    assertEquals(log.includes("    TERNARY"), true);
    assertEquals(log.includes("      EQUAL"), true);
});

Deno.test("Parser - expression in parens before ternary", () => {
    const log = getParseTree('(1 + 2) == 3 ? "yes" : "no"');
    assertEquals(log.includes("    TERNARY"), true);
    assertEquals(log.includes("      EQUAL"), true);
    assertEquals(log.includes("        ADDITION"), true);
});

Deno.test("Parser - nested parens before ternary", () => {
    const log = getParseTree('((x)) ? "a" : "b"');
    assertEquals(log.includes("    TERNARY"), true);
});

Deno.test("Parser - binary op with ternary in parens", () => {
    // Regression test: "what" + (0 == 0 ? "yes" : "no") was failing
    const log = getParseTree('"what" + (0 == 0 ? "yes" : "no")');
    assertEquals(log.includes("    ADDITION"), true);
    assertEquals(log.includes("      STRING"), true);
    assertEquals(log.includes("      TERNARY"), true);
});

Deno.test("Parser - arithmetic in parens works", () => {
    // Regression test for LEFT_PARENTHESIS precedence barrier
    const log = getParseTree('(1 + 2)');
    assertEquals(log.includes("    ADDITION"), true);
});

Deno.test("Parser - nested arithmetic in parens", () => {
    const log = getParseTree('((1 + 2) * 3)');
    assertEquals(log.includes("    MULTIPLICATION"), true);
    assertEquals(log.includes("      ADDITION"), true);
});

// =============================================================================
// Parser Tests - Nested Ternary
// =============================================================================

Deno.test("Parser - nested ternary is right associative", () => {
    // a ? b : c ? d : e should parse as a ? b : (c ? d : e)
    const log = getParseTree('a ? "b" : c ? "d" : "e"');
    // Should have TERNARY containing another TERNARY in else branch
    const ternaryCount = log.filter(line => line.includes("TERNARY")).length;
    assertEquals(ternaryCount, 2);
});

Deno.test("Parser - chained ternary for class mapping", () => {
    const log = getParseTree('x == 0 ? "Warrior" : x == 1 ? "Mage" : "Unknown"');
    assertEquals(log.includes("    TERNARY"), true);
    const ternaryCount = log.filter(line => line.includes("TERNARY")).length;
    assertEquals(ternaryCount, 2);
});

// =============================================================================
// Builder Tests
// =============================================================================

Deno.test("Builder - TernaryUnit has 3 children", () => {
    const lexer = new Lexer('1 ? "yes" : "no"');
    const parser = new Parser(lexer.output, '1 ? "yes" : "no"');
    const builder = new Builder(parser.output).build();
    const log = builder.log;

    // Should contain TernaryUnit
    assertEquals(log.some(line => line.includes("TernaryUnit")), true);

    // TernaryUnit should have 3 children: ValueUnit (condition), StringUnit (then), StringUnit (else)
    // Log structure: TernaryUnit at index 2, children at 3, 4, 5
    const ternaryIdx = log.findIndex(line => line.includes("TernaryUnit"));
    assertEquals(ternaryIdx >= 0, true);

    // Check the 3 children exist after TernaryUnit
    assertEquals(log[ternaryIdx + 1].includes("ValueUnit"), true);
    assertEquals(log[ternaryIdx + 2].includes("StringUnit"), true);
    assertEquals(log[ternaryIdx + 3].includes("StringUnit"), true);
});

// =============================================================================
// Mnemonic Generation Tests
// =============================================================================

Deno.test("Mnemonic - simple ternary bytecode structure", () => {
    const mnemonic = getMnemonic('1 ? "yes" : "no"');

    // Should contain TERNARY instruction
    assertEquals(mnemonic.includes("TERNARY"), true);

    // Find TERNARY position
    const ternaryIdx = mnemonic.indexOf("TERNARY");

    // Next value should be then-branch length
    const thenLen = parseInt(mnemonic[ternaryIdx + 1], 10);
    assertEquals(typeof thenLen, "number");
    assertEquals(thenLen > 0, true);

    // After then-branch, should have else-branch length
    const elseLen = parseInt(mnemonic[ternaryIdx + 2 + thenLen], 10);
    assertEquals(typeof elseLen, "number");
    assertEquals(elseLen > 0, true);
});

Deno.test("Mnemonic - ternary with comparison", () => {
    const mnemonic = getMnemonic('1 == 0 ? "yes" : "no"');

    // Should have comparison before TERNARY
    assertEquals(mnemonic.includes("EQUAL"), true);
    assertEquals(mnemonic.includes("TERNARY"), true);

    // EQUAL should come before TERNARY
    const equalIdx = mnemonic.indexOf("EQUAL");
    const ternaryIdx = mnemonic.indexOf("TERNARY");
    assertEquals(equalIdx < ternaryIdx, true);
});

Deno.test("Mnemonic - starts with VERSION_1", () => {
    const mnemonic = getMnemonic('1 ? "a" : "b"');
    assertEquals(mnemonic[0], "VERSION_1");
});

// =============================================================================
// Error Cases
// =============================================================================

Deno.test("Parser - missing colon throws error", () => {
    assertThrows(
        () => {
            const lexer = new Lexer('1 ? "yes"');
            new Parser(lexer.output, '1 ? "yes"');
        },
        Error,
        "Expected :"
    );
});

Deno.test("Parser - missing else expression throws error", () => {
    assertThrows(
        () => {
            const lexer = new Lexer('1 ? "yes" :');
            new Parser(lexer.output, '1 ? "yes" :');
        },
        Error
    );
});
