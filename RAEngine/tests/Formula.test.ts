/**
 * Formula DSL Tests - Ternary Operator
 *
 * Tests for the ternary conditional operator (condition ? then : else)
 */

import { test, assertEqual, assertThrows } from "../../tests/framework.ts";
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

test("Lexer - tokenizes ? as QUESTION", () => {
    const lexer = new Lexer("?");
    assertEqual(lexer.output[0].type, TokenType.QUESTION);
});

test("Lexer - tokenizes : as COLON", () => {
    const lexer = new Lexer(":");
    assertEqual(lexer.output[0].type, TokenType.COLON);
});

test("Lexer - tokenizes full ternary expression", () => {
    const lexer = new Lexer('1 ? "a" : "b"');
    const types = lexer.output.map(t => t.type);
    assertEqual(types, [
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

test("Parser - simple ternary with literals", () => {
    const log = getParseTree('1 ? "yes" : "no"');
    assertEqual(log.includes("    TERNARY"), true);
    assertEqual(log.includes("      VALUE"), true);
    assertEqual(log.includes("      STRING"), true);
});

test("Parser - ternary with comparison condition", () => {
    const log = getParseTree('1 == 0 ? "yes" : "no"');
    assertEqual(log.includes("    TERNARY"), true);
    assertEqual(log.includes("      EQUAL"), true);
});

test("Parser - ternary with identifier condition", () => {
    const log = getParseTree('x ? "truthy" : "falsy"');
    assertEqual(log.includes("    TERNARY"), true);
    assertEqual(log.includes("      READ_GLOBAL"), true);
});

// =============================================================================
// Parser Tests - Parentheses (regression tests for bug fixes)
// =============================================================================

test("Parser - ternary inside parentheses", () => {
    const log = getParseTree('(1 == 0 ? "yes" : "no")');
    assertEqual(log.includes("    TERNARY"), true);
    assertEqual(log.includes("      EQUAL"), true);
});

test("Parser - expression in parens before ternary", () => {
    const log = getParseTree('(1 + 2) == 3 ? "yes" : "no"');
    assertEqual(log.includes("    TERNARY"), true);
    assertEqual(log.includes("      EQUAL"), true);
    assertEqual(log.includes("        ADDITION"), true);
});

test("Parser - nested parens before ternary", () => {
    const log = getParseTree('((x)) ? "a" : "b"');
    assertEqual(log.includes("    TERNARY"), true);
});

test("Parser - binary op with ternary in parens", () => {
    // Regression test: "what" + (0 == 0 ? "yes" : "no") was failing
    const log = getParseTree('"what" + (0 == 0 ? "yes" : "no")');
    assertEqual(log.includes("    ADDITION"), true);
    assertEqual(log.includes("      STRING"), true);
    assertEqual(log.includes("      TERNARY"), true);
});

test("Parser - arithmetic in parens works", () => {
    // Regression test for LEFT_PARENTHESIS precedence barrier
    const log = getParseTree('(1 + 2)');
    assertEqual(log.includes("    ADDITION"), true);
});

test("Parser - nested arithmetic in parens", () => {
    const log = getParseTree('((1 + 2) * 3)');
    assertEqual(log.includes("    MULTIPLICATION"), true);
    assertEqual(log.includes("      ADDITION"), true);
});

// =============================================================================
// Parser Tests - Nested Ternary
// =============================================================================

test("Parser - nested ternary is right associative", () => {
    // a ? b : c ? d : e should parse as a ? b : (c ? d : e)
    const log = getParseTree('a ? "b" : c ? "d" : "e"');
    // Should have TERNARY containing another TERNARY in else branch
    const ternaryCount = log.filter(line => line.includes("TERNARY")).length;
    assertEqual(ternaryCount, 2);
});

test("Parser - chained ternary for class mapping", () => {
    const log = getParseTree('x == 0 ? "Warrior" : x == 1 ? "Mage" : "Unknown"');
    assertEqual(log.includes("    TERNARY"), true);
    const ternaryCount = log.filter(line => line.includes("TERNARY")).length;
    assertEqual(ternaryCount, 2);
});

// =============================================================================
// Builder Tests
// =============================================================================

test("Builder - TernaryUnit has 3 children", () => {
    const lexer = new Lexer('1 ? "yes" : "no"');
    const parser = new Parser(lexer.output, '1 ? "yes" : "no"');
    const builder = new Builder(parser.output).build();
    const log = builder.log;

    // Should contain TernaryUnit
    assertEqual(log.some(line => line.includes("TernaryUnit")), true);

    // TernaryUnit should have 3 children: ValueUnit (condition), StringUnit (then), StringUnit (else)
    // Log structure: TernaryUnit at index 2, children at 3, 4, 5
    const ternaryIdx = log.findIndex(line => line.includes("TernaryUnit"));
    assertEqual(ternaryIdx >= 0, true);

    // Check the 3 children exist after TernaryUnit
    assertEqual(log[ternaryIdx + 1].includes("ValueUnit"), true);
    assertEqual(log[ternaryIdx + 2].includes("StringUnit"), true);
    assertEqual(log[ternaryIdx + 3].includes("StringUnit"), true);
});

// =============================================================================
// Mnemonic Generation Tests
// =============================================================================

test("Mnemonic - simple ternary bytecode structure", () => {
    const mnemonic = getMnemonic('1 ? "yes" : "no"');

    // Should contain TERNARY instruction
    assertEqual(mnemonic.includes("TERNARY"), true);

    // Find TERNARY position
    const ternaryIdx = mnemonic.indexOf("TERNARY");

    // Next value should be then-branch length
    const thenLen = parseInt(mnemonic[ternaryIdx + 1], 10);
    assertEqual(typeof thenLen, "number");
    assertEqual(thenLen > 0, true);

    // After then-branch, should have else-branch length
    const elseLen = parseInt(mnemonic[ternaryIdx + 2 + thenLen], 10);
    assertEqual(typeof elseLen, "number");
    assertEqual(elseLen > 0, true);
});

test("Mnemonic - ternary with comparison", () => {
    const mnemonic = getMnemonic('1 == 0 ? "yes" : "no"');

    // Should have comparison before TERNARY
    assertEqual(mnemonic.includes("EQUAL"), true);
    assertEqual(mnemonic.includes("TERNARY"), true);

    // EQUAL should come before TERNARY
    const equalIdx = mnemonic.indexOf("EQUAL");
    const ternaryIdx = mnemonic.indexOf("TERNARY");
    assertEqual(equalIdx < ternaryIdx, true);
});

test("Mnemonic - starts with VERSION_1", () => {
    const mnemonic = getMnemonic('1 ? "a" : "b"');
    assertEqual(mnemonic[0], "VERSION_1");
});

// =============================================================================
// Error Cases
// =============================================================================

test("Parser - missing colon throws error", () => {
    assertThrows(
        () => {
            const lexer = new Lexer('1 ? "yes"');
            new Parser(lexer.output, '1 ? "yes"');
        },
        Error,
        "Expected :"
    );
});

test("Parser - missing else expression throws error", () => {
    assertThrows(
        () => {
            const lexer = new Lexer('1 ? "yes" :');
            new Parser(lexer.output, '1 ? "yes" :');
        },
        Error
    );
});
