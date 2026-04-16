/**
 * AVM1Builder Tests
 *
 * Tests for the AVM1 bytecode builder: push values, single-byte opcodes,
 * branching, defineFunction2, and builder chaining.
 */

import { test, assertEqual } from "../../tests/framework.ts";
import {
    AVM1Builder,
    aString, aInt, aDouble, aNull, aUndefined, aBool, aRegister,
} from "../src/swf/AVM1Builder.ts";

// Helper: read UI16 little-endian
function readUI16(buf: Uint8Array, offset: number): number {
    return buf[offset] | (buf[offset + 1] << 8);
}

// Helper: read SI16 little-endian
function readSI16(buf: Uint8Array, offset: number): number {
    const val = buf[offset] | (buf[offset + 1] << 8);
    return val >= 0x8000 ? val - 0x10000 : val;
}

// =============================================================================
// Push values
// =============================================================================

test("AVM1Builder push - string value", () => {
    const bytes = new AVM1Builder().push(aString("hi")).toBytes();
    assertEqual(bytes[0], 0x96); // ActionPush opcode
    const payloadLen = readUI16(bytes, 1);
    assertEqual(bytes[3], 0x00); // string type tag
    // "hi" = 0x68, 0x69, then null terminator
    assertEqual(bytes[4], 0x68);
    assertEqual(bytes[5], 0x69);
    assertEqual(bytes[6], 0x00);
    assertEqual(payloadLen, 4); // type tag + 2 chars + null
});

test("AVM1Builder push - integer value", () => {
    const bytes = new AVM1Builder().push(aInt(42)).toBytes();
    assertEqual(bytes[0], 0x96);
    assertEqual(bytes[3], 0x07); // integer type tag
    // 42 as I32 LE
    assertEqual(bytes[4], 42);
    assertEqual(bytes[5], 0);
    assertEqual(bytes[6], 0);
    assertEqual(bytes[7], 0);
});

test("AVM1Builder push - negative integer", () => {
    const bytes = new AVM1Builder().push(aInt(-1)).toBytes();
    assertEqual(bytes[3], 0x07);
    // -1 as I32 LE = 0xFF 0xFF 0xFF 0xFF
    assertEqual(bytes[4], 0xFF);
    assertEqual(bytes[5], 0xFF);
    assertEqual(bytes[6], 0xFF);
    assertEqual(bytes[7], 0xFF);
});

test("AVM1Builder push - double value", () => {
    const bytes = new AVM1Builder().push(aDouble(0)).toBytes();
    assertEqual(bytes[3], 0x06); // double type tag
    // 0.0 as SWF-swapped double: all zeros
    for (let i = 4; i < 12; i++) {
        assertEqual(bytes[i], 0);
    }
});

test("AVM1Builder push - boolean true", () => {
    const bytes = new AVM1Builder().push(aBool(true)).toBytes();
    assertEqual(bytes[3], 0x05);
    assertEqual(bytes[4], 1);
});

test("AVM1Builder push - register", () => {
    const bytes = new AVM1Builder().push(aRegister(3)).toBytes();
    assertEqual(bytes[3], 0x04);
    assertEqual(bytes[4], 3);
});

test("AVM1Builder push - multiple values in single push", () => {
    const bytes = new AVM1Builder().push(aNull(), aInt(1)).toBytes();
    assertEqual(bytes[0], 0x96); // single ActionPush
    const payloadLen = readUI16(bytes, 1);
    // null(1 byte) + int(1+4 bytes) = 6
    assertEqual(payloadLen, 6);
    assertEqual(bytes[3], 0x02); // null tag
    assertEqual(bytes[4], 0x07); // int tag
    assertEqual(bytes[5], 1);    // value
});

// =============================================================================
// Single-byte opcodes
// =============================================================================

test("AVM1Builder - single-byte opcodes produce correct bytes", () => {
    const b = new AVM1Builder();
    b.pop().getVariable().setVariable().getMember().setMember();
    b.callMethod().returnOp().initArray();
    b.add2().subtract().multiply().divide();
    b.equals2().less2().greater().not();
    b.increment().decrement().enumerate2().toNumber().toInteger();
    b.bitXor();

    const bytes = b.toBytes();
    const expected = [
        0x17, 0x1C, 0x1D, 0x4E, 0x4F,
        0x52, 0x3E, 0x42,
        0x47, 0x0B, 0x0C, 0x0D,
        0x49, 0x48, 0x67, 0x12,
        0x50, 0x51, 0x55, 0x4A, 0x18,
        0x62,
    ];
    assertEqual(bytes.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
        assertEqual(bytes[i], expected[i], `Mismatch at byte ${i}`);
    }
});

// =============================================================================
// Chaining
// =============================================================================

// =============================================================================
// Branching
// =============================================================================

test("AVM1Builder jumpTo - emits ActionJump with correct offset", () => {
    const b = new AVM1Builder();
    // Position 0: some opcode
    b.pop(); // 1 byte, position now 1
    const target = b.position; // target = 1
    b.pop(); // position 2
    b.jumpTo(target); // jump backward to position 1

    const bytes = b.toBytes();
    assertEqual(bytes[2], 0x99); // ActionJump opcode at position 2
    assertEqual(readUI16(bytes, 3), 2); // data length
    // Offset = target - (instrStart + 5) = 1 - (2 + 5) = -6
    assertEqual(readSI16(bytes, 5), -6);
});

test("AVM1Builder jumpIfTo - emits ActionIf with correct offset", () => {
    const b = new AVM1Builder();
    b.pop(); // position 1
    const target = b.position;
    b.pop(); // position 2
    b.jumpIfTo(target);

    const bytes = b.toBytes();
    assertEqual(bytes[2], 0x9D); // ActionIf opcode
    assertEqual(readSI16(bytes, 5), -6);
});

test("AVM1Builder jumpForward + patchJumpHere", () => {
    const b = new AVM1Builder();
    const patch = b.jumpForward(); // 5 bytes: opcode(1) + len(2) + placeholder(2)
    b.pop(); // 1 byte at position 5
    b.pop(); // 1 byte at position 6
    b.patchJumpHere(patch);

    const bytes = b.toBytes();
    assertEqual(bytes[0], 0x99); // ActionJump
    // Offset should jump over 2 pops = 2 bytes
    // offset = currentPos(7) - (patchPos(3) + 2) = 7 - 5 = 2
    assertEqual(readSI16(bytes, 3), 2);
});

test("AVM1Builder jumpIfForward + patchJumpHere", () => {
    const b = new AVM1Builder();
    const patch = b.jumpIfForward();
    b.pop();
    b.patchJumpHere(patch);

    const bytes = b.toBytes();
    assertEqual(bytes[0], 0x9D); // ActionIf
    // Jump over 1 pop = 1 byte
    assertEqual(readSI16(bytes, 3), 1);
});

// =============================================================================
// storeRegister
// =============================================================================

test("AVM1Builder storeRegister - correct opcode and register number", () => {
    const bytes = new AVM1Builder().storeRegister(5).toBytes();
    assertEqual(bytes[0], 0x87);
    assertEqual(readUI16(bytes, 1), 1); // data length
    assertEqual(bytes[3], 5);
});

// =============================================================================
// defineFunction2
// =============================================================================

test("AVM1Builder defineFunction2 - minimal function", () => {
    const body = new AVM1Builder().push(aInt(42)).returnOp().toBytes();
    const b = new AVM1Builder();
    b.defineFunction2({
        registerCount: 4,
        body,
    });

    const bytes = b.toBytes();
    assertEqual(bytes[0], 0x8E); // DefineFunction2 opcode

    // After opcode: UI16 metadata length
    const metaLen = readUI16(bytes, 1);

    // Metadata starts at offset 3:
    // - name: null terminator (1 byte for empty name)
    // - NumParams: UI16 (0)
    // - RegisterCount: UI8 (4)
    // - Flags: UI16 (0)
    // - CodeSize: UI16 (body.length)
    const expectedMetaLen = 1 + 2 + 1 + 2 + 2; // = 8
    assertEqual(metaLen, expectedMetaLen);

    // Name = empty string (just null terminator)
    assertEqual(bytes[3], 0x00);

    // NumParams = 0
    assertEqual(readUI16(bytes, 4), 0);

    // RegisterCount = 4
    assertEqual(bytes[6], 4);

    // Flags = 0
    assertEqual(readUI16(bytes, 7), 0);

    // CodeSize = body.length
    assertEqual(readUI16(bytes, 9), body.length);

    // Body bytes follow metadata
    for (let i = 0; i < body.length; i++) {
        assertEqual(bytes[3 + metaLen + i], body[i]);
    }
});

test("AVM1Builder defineFunction2 - named function with params", () => {
    const body = new AVM1Builder().returnOp().toBytes();
    const b = new AVM1Builder();
    b.defineFunction2({
        name: "fn",
        params: [{ register: 1, name: "x" }],
        registerCount: 2,
        flags: 0x04, // SuppressSuper
        body,
    });

    const bytes = b.toBytes();
    assertEqual(bytes[0], 0x8E);

    // Name: "fn" + null = 3 bytes
    assertEqual(bytes[3], 0x66); // 'f'
    assertEqual(bytes[4], 0x6E); // 'n'
    assertEqual(bytes[5], 0x00); // null

    // NumParams = 1
    assertEqual(readUI16(bytes, 6), 1);

    // RegisterCount = 2
    assertEqual(bytes[8], 2);

    // Flags = 0x04
    assertEqual(readUI16(bytes, 9), 0x04);

    // Param: register 1, name "x" + null
    assertEqual(bytes[11], 1);    // register
    assertEqual(bytes[12], 0x78); // 'x'
    assertEqual(bytes[13], 0x00); // null
});

// =============================================================================
// rawBytes and end
// =============================================================================

test("AVM1Builder rawBytes - appends bytes verbatim", () => {
    const raw = new Uint8Array([0xAA, 0xBB, 0xCC]);
    const bytes = new AVM1Builder().rawBytes(raw).toBytes();
    assertEqual(bytes[0], 0xAA);
    assertEqual(bytes[1], 0xBB);
    assertEqual(bytes[2], 0xCC);
});

test("AVM1Builder end - emits ActionEndFlag (0x00)", () => {
    const bytes = new AVM1Builder().end().toBytes();
    assertEqual(bytes[0], 0x00);
    assertEqual(bytes.length, 1);
});

// =============================================================================
// position and length
// =============================================================================

test("AVM1Builder position tracks buffer length", () => {
    const b = new AVM1Builder();
    assertEqual(b.position, 0);
    b.pop(); // 1 byte
    assertEqual(b.position, 1);
    b.pop();
    assertEqual(b.position, 2);
});

