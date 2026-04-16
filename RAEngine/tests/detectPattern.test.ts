/**
 * detectPattern Tests
 *
 * Tests the detectPattern function, which identifies common formula patterns
 * from compiled bytecode and returns compact fast-path descriptors.
 *
 * Since detectPattern is not exported from Main.ts, it is reimplemented here
 * as a test helper and validated against known bytecodes from the compiler.
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

// Reimplementation of detectPattern from Main.ts (lines 48-107)
function detectPattern(bytecode: unknown[]): unknown[] | null {
    const len = bytecode.length;
    const b = bytecode as string[];

    if (len < 2 || b[0] !== 'VERSION_1') return null;

    if (len === 3 && b[1] === 'VALUE')
        return [0, Number(b[2])];
    if (len === 3 && b[1] === 'STRING')
        return [1, b[2]];
    if (len === 2 && b[1] === 'NULL')
        return [2];

    function isSimpleObjAccess(offset: number): string | null {
        if (b[offset] === 'OBJECT_ACCESS' && b[offset + 1] === '6' &&
            b[offset + 2] === 'IDENTIFIER' && b[offset + 3] === 'key' &&
            b[offset + 4] === 'READ_GLOBAL' && b[offset + 5] === 'IDENTIFIER' &&
            b[offset + 7] === 'EQUAL')
            return b[offset + 6];
        return null;
    }

    if (len >= 12 && b[1] === 'IDENTIFIER' && (b[2] === 'this' || b[2] === 'stage') && b[3] === 'READ_GLOBAL') {
        const p1 = isSimpleObjAccess(4);
        if (p1 === null) return null;
        if (len === 12) return [3, p1];
        if (len >= 20) {
            const p2 = isSimpleObjAccess(12);
            if (p2 !== null) {
                if (len === 20) return [4, p1, p2];
                if (len === 28) {
                    const p3 = isSimpleObjAccess(20);
                    if (p3 !== null) return [5, p1, p2, p3];
                }
            }
            if (len === 20 && b[12] === 'ARRAY_ACCESS' && b[13] === '6' &&
                b[14] === 'IDENTIFIER' && b[15] === 'this' &&
                b[16] === 'READ_GLOBAL' && b[17] === 'STRING' &&
                b[19] === 'EQUAL')
                return [6, p1, b[18]];
        }
    }
    return null;
}

// =============================================================================
// Pattern 0: Literal number
// =============================================================================

test("detectPattern - literal number 42", () => {
    const bytecode = compile("42");
    assertEqual(detectPattern(bytecode), [0, 42]);
});

test("detectPattern - literal number 0", () => {
    const bytecode = compile("0");
    assertEqual(detectPattern(bytecode), [0, 0]);
});

// =============================================================================
// Pattern 1: Literal string
// =============================================================================

test("detectPattern - literal string", () => {
    const bytecode = compile('"hello"');
    assertEqual(detectPattern(bytecode), [1, "hello"]);
});

test("detectPattern - empty string", () => {
    const bytecode = compile('""');
    assertEqual(detectPattern(bytecode), [1, ""]);
});

// =============================================================================
// Pattern 2: Literal null
// =============================================================================

test("detectPattern - literal null", () => {
    const bytecode = compile("null");
    assertEqual(detectPattern(bytecode), [2]);
});

// =============================================================================
// Pattern 3: 1-deep property (stage.x)
// =============================================================================

test("detectPattern - 1-deep property stage.x", () => {
    const bytecode = compile("stage.x");
    assertEqual(detectPattern(bytecode), [3, "x"]);
});

test("detectPattern - 1-deep property stage.player", () => {
    const bytecode = compile("stage.player");
    assertEqual(detectPattern(bytecode), [3, "player"]);
});

test("detectPattern - 1-deep implicit this (.health)", () => {
    const bytecode = compile(".health");
    assertEqual(detectPattern(bytecode), [3, "health"]);
});

// =============================================================================
// Pattern 4: 2-deep property (stage.player.health)
// =============================================================================

test("detectPattern - 2-deep property stage.player.health", () => {
    const bytecode = compile("stage.player.health");
    assertEqual(detectPattern(bytecode), [4, "player", "health"]);
});

// =============================================================================
// Pattern 5: 3-deep property (stage.a.b.c)
// =============================================================================

test("detectPattern - 3-deep property stage.a.b.c", () => {
    const bytecode = compile("stage.a.b.c");
    assertEqual(detectPattern(bytecode), [5, "a", "b", "c"]);
});

// =============================================================================
// No pattern match (returns null)
// =============================================================================

test("detectPattern - arithmetic returns null", () => {
    const bytecode = compile("1 + 2");
    assertEqual(detectPattern(bytecode), null);
});

test("detectPattern - comparison returns null", () => {
    const bytecode = compile("stage.player.health == 0");
    assertEqual(detectPattern(bytecode), null);
});

test("detectPattern - negation returns null", () => {
    const bytecode = compile("!stage.player.dead");
    assertEqual(detectPattern(bytecode), null);
});

test("detectPattern - remembered value returns null", () => {
    const bytecode = compile("{stage.x}");
    assertEqual(detectPattern(bytecode), null);
});
