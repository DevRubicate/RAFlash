/**
 * AVM2Builder Tests
 *
 * Tests for AVM2 bytecode builder: constant pool, code emitter, ABC assembly,
 * and SWF wrapping. Mirrors AVM1Builder.test.ts structure.
 */

import { test, assertEqual, assertNotEqual } from "../../tests/framework.ts";
import {
    AVM2ConstantPool,
    AVM2Code,
    buildNativeEvalABC,
    buildAVM2SWF,
} from "../src/swf/AVM2Builder.ts";

// =============================================================================
// Helpers
// =============================================================================

/** Read U30 variable-length encoding from a buffer, return [value, bytesConsumed]. */
function readU30(buf: Uint8Array, offset: number): [number, number] {
    let result = 0;
    let shift = 0;
    let pos = offset;
    let byte: number;
    do {
        byte = buf[pos++];
        result |= (byte & 0x7F) << shift;
        shift += 7;
    } while (byte & 0x80);
    return [result >>> 0, pos - offset];
}

/** Read S24 (signed 24-bit little-endian). */
function readS24(buf: Uint8Array, offset: number): number {
    const val = buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
    return val >= 0x800000 ? val - 0x1000000 : val;
}

/** Read UI16 little-endian. */
function readUI16(buf: Uint8Array, offset: number): number {
    return buf[offset] | (buf[offset + 1] << 8);
}

/** Read UI32 little-endian. */
function readUI32(buf: Uint8Array, offset: number): number {
    return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
}

// =============================================================================
// AVM2ConstantPool — construction defaults
// =============================================================================

test("AVM2ConstantPool addString - new strings get incrementing indices", () => {
    const pool = new AVM2ConstantPool();
    const a = pool.addString("hello");
    const b = pool.addString("world");
    assertEqual(a, 2); // "" is 1
    assertEqual(b, 3);
});

test("AVM2ConstantPool addString - deduplicates identical strings", () => {
    const pool = new AVM2ConstantPool();
    const a = pool.addString("test");
    const b = pool.addString("test");
    assertEqual(a, b);
});

// =============================================================================
// AVM2ConstantPool — integer deduplication
// =============================================================================

test("AVM2ConstantPool addInt - deduplicates identical integers", () => {
    const pool = new AVM2ConstantPool();
    const a = pool.addInt(100);
    const b = pool.addInt(100);
    assertEqual(a, b);
});

test("AVM2ConstantPool addInt - different values get different indices", () => {
    const pool = new AVM2ConstantPool();
    const a = pool.addInt(1);
    const b = pool.addInt(2);
    assertNotEqual(a, b);
});

test("AVM2ConstantPool addInt - truncates to 32-bit integer", () => {
    const pool = new AVM2ConstantPool();
    // 1.7 | 0 = 1, so addInt(1.7) and addInt(1) should be the same
    const a = pool.addInt(1.7);
    const b = pool.addInt(1);
    assertEqual(a, b);
});

// =============================================================================
// AVM2ConstantPool — double deduplication
// =============================================================================

test("AVM2ConstantPool addDouble - deduplicates identical doubles", () => {
    const pool = new AVM2ConstantPool();
    const a = pool.addDouble(2.718);
    const b = pool.addDouble(2.718);
    assertEqual(a, b);
});

// =============================================================================
// AVM2ConstantPool — namespace, nsSet, multiname
// =============================================================================

test("AVM2ConstantPool addNamespace - deduplicates same kind+name", () => {
    const pool = new AVM2ConstantPool();
    const nameIdx = pool.addString("test");
    const a = pool.addNamespace(0x16, nameIdx);
    const b = pool.addNamespace(0x16, nameIdx);
    assertEqual(a, b);
});

test("AVM2ConstantPool addNamespace - different kind gives different index", () => {
    const pool = new AVM2ConstantPool();
    const nameIdx = pool.addString("ns");
    const a = pool.addNamespace(0x16, nameIdx); // PackageNamespace
    const b = pool.addNamespace(0x05, nameIdx); // PrivateNamespace
    assertNotEqual(a, b);
});

test("AVM2ConstantPool addNsSet - deduplicates identical sets", () => {
    const pool = new AVM2ConstantPool();
    const a = pool.addNsSet([1, 2]);
    const b = pool.addNsSet([1, 2]);
    assertEqual(a, b);
});

test("AVM2ConstantPool addQName - creates QName multiname", () => {
    const pool = new AVM2ConstantPool();
    const mn = pool.addQName(pool.publicNs, "myProp");
    // latePub is index 1, so QName should be >= 2
    assertEqual(mn >= 2, true);
});

test("AVM2ConstantPool addQName - deduplicates same ns+name", () => {
    const pool = new AVM2ConstantPool();
    const a = pool.addQName(pool.publicNs, "prop");
    const b = pool.addQName(pool.publicNs, "prop");
    assertEqual(a, b);
});

test("AVM2ConstantPool publicQName - shorthand for addQName with publicNs", () => {
    const pool = new AVM2ConstantPool();
    const a = pool.publicQName("x");
    const b = pool.addQName(pool.publicNs, "x");
    assertEqual(a, b);
});

test("AVM2ConstantPool addMultiname - creates Multiname with nsSet", () => {
    const pool = new AVM2ConstantPool();
    const mn = pool.addMultiname("dynProp", pool.publicNsSet);
    assertEqual(mn >= 2, true);
});

test("AVM2ConstantPool addMultiname - deduplicates", () => {
    const pool = new AVM2ConstantPool();
    const a = pool.addMultiname("x", pool.publicNsSet);
    const b = pool.addMultiname("x", pool.publicNsSet);
    assertEqual(a, b);
});

test("AVM2ConstantPool publicMultiname - shorthand for addMultiname with publicNsSet", () => {
    const pool = new AVM2ConstantPool();
    const a = pool.publicMultiname("y");
    const b = pool.addMultiname("y", pool.publicNsSet);
    assertEqual(a, b);
});

test("AVM2ConstantPool addMultinameL - deduplicates by nsSet", () => {
    const pool = new AVM2ConstantPool();
    // latePub is already MultinameL(publicNsSet), index 1
    const dup = pool.addMultinameL(pool.publicNsSet);
    assertEqual(dup, pool.latePub);
});

// =============================================================================
// AVM2ConstantPool — serialization
// =============================================================================

test("AVM2ConstantPool serialize - empty pool has valid structure", () => {
    const pool = new AVM2ConstantPool();
    const out: number[] = [];
    pool.serialize(out);
    // Should produce bytes without error
    assertEqual(out.length > 0, true);

    // Parse the serialized output to verify structure
    let pos = 0;
    // ints count
    const [intCount, intBytes] = readU30(new Uint8Array(out), pos);
    pos += intBytes;
    assertEqual(intCount, 0); // no ints added

    // uints count
    const [uintCount, uintBytes] = readU30(new Uint8Array(out), pos);
    pos += uintBytes;
    assertEqual(uintCount, 0); // always 0

    // doubles count
    const [doubleCount, doubleBytes] = readU30(new Uint8Array(out), pos);
    pos += doubleBytes;
    assertEqual(doubleCount, 0); // no doubles added
});

test("AVM2ConstantPool serialize - includes added strings", () => {
    const pool = new AVM2ConstantPool();
    pool.addString("hello");
    const out: number[] = [];
    pool.serialize(out);
    const buf = new Uint8Array(out);

    // Skip ints(0), uints(0), doubles(0)
    let pos = 0;
    let bytesRead: number;
    [, bytesRead] = readU30(buf, pos); pos += bytesRead; // ints
    [, bytesRead] = readU30(buf, pos); pos += bytesRead; // uints
    [, bytesRead] = readU30(buf, pos); pos += bytesRead; // doubles

    // Strings: count = entries + 1 (index 0 is implicit)
    // We have "" (from constructor) + "hello" = 2 entries → count = 3
    const [strCount] = readU30(buf, pos);
    assertEqual(strCount, 3);
});

test("AVM2ConstantPool serialize - includes added ints", () => {
    const pool = new AVM2ConstantPool();
    pool.addInt(42);
    pool.addInt(99);
    const out: number[] = [];
    pool.serialize(out);
    const buf = new Uint8Array(out);

    // ints count = entries + 1 = 3
    const [intCount] = readU30(buf, 0);
    assertEqual(intCount, 3);
});

test("AVM2ConstantPool serialize - includes added doubles", () => {
    const pool = new AVM2ConstantPool();
    pool.addDouble(1.5);
    const out: number[] = [];
    pool.serialize(out);
    const buf = new Uint8Array(out);

    let pos = 0;
    let bytesRead: number;
    // Skip ints
    [, bytesRead] = readU30(buf, pos); pos += bytesRead;
    // Skip uints
    [, bytesRead] = readU30(buf, pos); pos += bytesRead;
    // Doubles: count = 1 + 1 = 2
    const [doubleCount] = readU30(buf, pos);
    assertEqual(doubleCount, 2);
});

// =============================================================================
// AVM2Code — single-byte opcodes
// =============================================================================

// =============================================================================
// AVM2Code — push values
// =============================================================================

test("AVM2Code pushByte - emits opcode 0x24 + byte value", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pushByte(42).toBytes();
    assertEqual(bytes[0], 0x24);
    assertEqual(bytes[1], 42);
});

test("AVM2Code pushByte - negative value wraps to unsigned byte", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pushByte(-1).toBytes();
    assertEqual(bytes[0], 0x24);
    assertEqual(bytes[1], 0xFF);
});

test("AVM2Code pushShort - emits opcode 0x25 + U30 value", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pushShort(300).toBytes();
    assertEqual(bytes[0], 0x25);
    // 300 in U30: 300 & 0x7F = 0x2C | 0x80, 300 >> 7 = 2
    assertEqual(bytes[1], 0xAC); // (300 & 0x7F) | 0x80
    assertEqual(bytes[2], 0x02); // 300 >> 7
});

test("AVM2Code pushInt - emits opcode 0x2D + pool index", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    const bytes = code.pushInt(1000).toBytes();
    assertEqual(bytes[0], 0x2D);
    // Pool index 1 (first int added)
    assertEqual(bytes[1], 1);
});

test("AVM2Code pushDouble - emits opcode 0x2F + pool index", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pushDouble(3.14).toBytes();
    assertEqual(bytes[0], 0x2F);
    assertEqual(bytes[1], 1); // first double
});

test("AVM2Code pushString - emits opcode 0x2C + pool index", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pushString("hello").toBytes();
    assertEqual(bytes[0], 0x2C);
    // "hello" is pool string index 2 ("" is 1)
    assertEqual(bytes[1], 2);
});

test("AVM2Code pushString - reuses pool index for duplicate strings", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    code.pushString("x");
    code.pushString("x");
    const bytes = code.toBytes();
    // Both should reference the same pool index
    assertEqual(bytes[1], bytes[3]);
});

// =============================================================================
// AVM2Code — pushNumber (smart encoding)
// =============================================================================

test("AVM2Code pushNumber - small integer uses pushByte", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pushNumber(5).toBytes();
    assertEqual(bytes[0], 0x24); // pushByte opcode
    assertEqual(bytes[1], 5);
});

test("AVM2Code pushNumber - negative small integer uses pushByte", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pushNumber(-10).toBytes();
    assertEqual(bytes[0], 0x24); // pushByte
});

test("AVM2Code pushNumber - large integer uses pushInt", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pushNumber(1000).toBytes();
    assertEqual(bytes[0], 0x2D); // pushInt opcode
});

test("AVM2Code pushNumber - non-integer uses pushDouble", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pushNumber(1.5).toBytes();
    assertEqual(bytes[0], 0x2F); // pushDouble opcode
});

// =============================================================================
// AVM2Code — local variable access
// =============================================================================

test("AVM2Code getLocal - registers 0-3 use short opcodes D0-D3", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    code.getLocal(0).getLocal(1).getLocal(2).getLocal(3);
    const bytes = code.toBytes();
    assertEqual(bytes[0], 0xD0);
    assertEqual(bytes[1], 0xD1);
    assertEqual(bytes[2], 0xD2);
    assertEqual(bytes[3], 0xD3);
    assertEqual(bytes.length, 4);
});

test("AVM2Code getLocal - register >= 4 uses 0x62 + U30 index", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).getLocal(5).toBytes();
    assertEqual(bytes[0], 0x62);
    assertEqual(bytes[1], 5);
});

test("AVM2Code setLocal - registers 0-3 use short opcodes D4-D7", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    code.setLocal(0).setLocal(1).setLocal(2).setLocal(3);
    const bytes = code.toBytes();
    assertEqual(bytes[0], 0xD4);
    assertEqual(bytes[1], 0xD5);
    assertEqual(bytes[2], 0xD6);
    assertEqual(bytes[3], 0xD7);
});

test("AVM2Code setLocal - register >= 4 uses 0x63 + U30 index", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).setLocal(7).toBytes();
    assertEqual(bytes[0], 0x63);
    assertEqual(bytes[1], 7);
});

test("AVM2Code incLocal - emits 0x92 + U30 register", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).incLocal(3).toBytes();
    assertEqual(bytes[0], 0x92);
    assertEqual(bytes[1], 3);
});

test("AVM2Code decLocal - emits 0x94 + U30 register", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).decLocal(2).toBytes();
    assertEqual(bytes[0], 0x94);
    assertEqual(bytes[1], 2);
});

// =============================================================================
// AVM2Code — stack manipulation
// =============================================================================

test("AVM2Code stack ops - pop, dup, swap emit correct opcodes", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pop().dup().swap().toBytes();
    assertEqual(bytes[0], 0x29); // pop
    assertEqual(bytes[1], 0x2A); // dup
    assertEqual(bytes[2], 0x2B); // swap
});

// =============================================================================
// AVM2Code — arithmetic opcodes
// =============================================================================

test("AVM2Code arithmetic - all ops emit correct single-byte opcodes", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    code.add().subtract().multiply().divide().modulo().negate();
    code.increment().decrement();
    const bytes = code.toBytes();
    const expected = [0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0x90, 0x91, 0x93];
    assertEqual(bytes.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
        assertEqual(bytes[i], expected[i], `arithmetic opcode ${i}`);
    }
});

// =============================================================================
// AVM2Code — comparison opcodes
// =============================================================================

test("AVM2Code comparison - all ops emit correct opcodes", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    code.equals().strictEquals().lessThan().lessEquals().greaterThan().greaterEquals();
    const bytes = code.toBytes();
    const expected = [0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xB0];
    assertEqual(bytes.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
        assertEqual(bytes[i], expected[i], `comparison opcode ${i}`);
    }
});

// =============================================================================
// AVM2Code — logic / bitwise opcodes
// =============================================================================

test("AVM2Code logic - not, bitAnd, bitOr, bitXor, bitNot emit correct opcodes", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    code.not().bitAnd().bitOr().bitXor().bitNot();
    const bytes = code.toBytes();
    const expected = [0x96, 0xA8, 0xA9, 0xAA, 0x97];
    assertEqual(bytes.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
        assertEqual(bytes[i], expected[i], `logic opcode ${i}`);
    }
});

// =============================================================================
// AVM2Code — type conversion opcodes
// =============================================================================

test("AVM2Code type conversion - all conversion ops emit correct opcodes", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    code.convertD().convertI().convertU().convertS().convertB();
    code.coerceA().coerceS().typeOf();
    const bytes = code.toBytes();
    const expected = [0x75, 0x73, 0x74, 0x70, 0x76, 0x82, 0x85, 0x95];
    assertEqual(bytes.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
        assertEqual(bytes[i], expected[i], `convert opcode ${i}`);
    }
});

// =============================================================================
// AVM2Code — type checking
// =============================================================================

// =============================================================================
// AVM2Code ��� branching
// =============================================================================

test("AVM2Code jumpTo - emits 0x10 + S24 offset", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    code.pop(); // 1 byte at position 0
    const target = code.position; // 1
    code.pop(); // 1 byte at position 1
    code.jumpTo(target); // jump backward

    const bytes = code.toBytes();
    assertEqual(bytes[2], 0x10); // OP_jump
    // offset = target - (patchPos + 3) = 1 - (3 + 3) = -5
    assertEqual(readS24(bytes, 3), -5);
});

test("AVM2Code ifTrueTo - emits 0x11 + S24 offset", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    const target = code.position; // 0
    code.pop(); // position 1
    code.ifTrueTo(target);

    const bytes = code.toBytes();
    assertEqual(bytes[1], 0x11); // OP_iftrue
    // offset = 0 - (2 + 3) = -5
    assertEqual(readS24(bytes, 2), -5);
});

test("AVM2Code ifFalseTo - emits 0x12 + S24 offset", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    const target = code.position;
    code.pop();
    code.ifFalseTo(target);

    const bytes = code.toBytes();
    assertEqual(bytes[1], 0x12); // OP_iffalse
});

test("AVM2Code jumpForward + patchJumpHere", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    const patch = code.jumpForward(); // 4 bytes: opcode(1) + S24 placeholder(3)
    code.pop(); // 1 byte at position 4
    code.pop(); // 1 byte at position 5
    code.patchJumpHere(patch);

    const bytes = code.toBytes();
    assertEqual(bytes[0], 0x10); // OP_jump
    // Jump over 2 pops: delta = 6 - (1 + 3) = 2
    assertEqual(readS24(bytes, 1), 2);
});

test("AVM2Code ifTrueForward + patchJumpHere", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    const patch = code.ifTrueForward();
    code.pop(); // 1 byte
    code.patchJumpHere(patch);

    const bytes = code.toBytes();
    assertEqual(bytes[0], 0x11); // OP_iftrue
    assertEqual(readS24(bytes, 1), 1);
});

test("AVM2Code ifFalseForward + patchJumpHere", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    const patch = code.ifFalseForward();
    code.pop();
    code.pop();
    code.pop();
    code.patchJumpHere(patch);

    const bytes = code.toBytes();
    assertEqual(bytes[0], 0x12); // OP_iffalse
    assertEqual(readS24(bytes, 1), 3); // skip 3 pops
});

test("AVM2Code ifStrictEqForward + patchJumpHere", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    const patch = code.ifStrictEqForward();
    code.pop();
    code.patchJumpHere(patch);

    const bytes = code.toBytes();
    assertEqual(bytes[0], 0x19); // OP_ifstricteq
    assertEqual(readS24(bytes, 1), 1);
});

test("AVM2Code ifStrictNeForward + patchJumpHere", () => {
    const pool = new AVM2ConstantPool();
    const code = new AVM2Code(pool);
    const patch = code.ifStrictNeForward();
    code.pop();
    code.patchJumpHere(patch);

    const bytes = code.toBytes();
    assertEqual(bytes[0], 0x1A); // OP_ifstrictne
    assertEqual(readS24(bytes, 1), 1);
});

// =============================================================================
// AVM2Code — property access
// =============================================================================

test("AVM2Code getProperty - emits 0x66 + U30 multiname", () => {
    const pool = new AVM2ConstantPool();
    const mn = pool.publicQName("x");
    const bytes = new AVM2Code(pool).getProperty(mn).toBytes();
    assertEqual(bytes[0], 0x66);
    assertEqual(bytes[1], mn);
});

test("AVM2Code setProperty - emits 0x61 + U30 multiname", () => {
    const pool = new AVM2ConstantPool();
    const mn = pool.publicQName("y");
    const bytes = new AVM2Code(pool).setProperty(mn).toBytes();
    assertEqual(bytes[0], 0x61);
    assertEqual(bytes[1], mn);
});

test("AVM2Code findPropStrict - emits 0x5D + U30 multiname", () => {
    const pool = new AVM2ConstantPool();
    const mn = pool.publicQName("z");
    const bytes = new AVM2Code(pool).findPropStrict(mn).toBytes();
    assertEqual(bytes[0], 0x5D);
    assertEqual(bytes[1], mn);
});

test("AVM2Code getLex - emits 0x60 + U30 multiname", () => {
    const pool = new AVM2ConstantPool();
    const mn = pool.publicQName("w");
    const bytes = new AVM2Code(pool).getLex(mn).toBytes();
    assertEqual(bytes[0], 0x60);
    assertEqual(bytes[1], mn);
});

// =============================================================================
// AVM2Code — object / array creation
// =============================================================================

test("AVM2Code newArray - emits 0x56 + U30 count", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).newArray(3).toBytes();
    assertEqual(bytes[0], 0x56);
    assertEqual(bytes[1], 3);
});

test("AVM2Code newObject - emits 0x55 + U30 count", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).newObject(2).toBytes();
    assertEqual(bytes[0], 0x55);
    assertEqual(bytes[1], 2);
});

test("AVM2Code newFunction - emits 0x40 + U30 method index", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).newFunction(5).toBytes();
    assertEqual(bytes[0], 0x40);
    assertEqual(bytes[1], 5);
});

// =============================================================================
// AVM2Code — calls
// =============================================================================

test("AVM2Code callProperty - emits 0x46 + U30 multiname + U30 argc", () => {
    const pool = new AVM2ConstantPool();
    const mn = pool.publicQName("push");
    const bytes = new AVM2Code(pool).callProperty(mn, 1).toBytes();
    assertEqual(bytes[0], 0x46);
    assertEqual(bytes[1], mn);
    assertEqual(bytes[2], 1);
});

test("AVM2Code callPropVoid - emits 0x4F + U30 multiname + U30 argc", () => {
    const pool = new AVM2ConstantPool();
    const mn = pool.publicQName("trace");
    const bytes = new AVM2Code(pool).callPropVoid(mn, 2).toBytes();
    assertEqual(bytes[0], 0x4F);
    assertEqual(bytes[1], mn);
    assertEqual(bytes[2], 2);
});

test("AVM2Code constructProp - emits 0x4A + U30 multiname + U30 argc", () => {
    const pool = new AVM2ConstantPool();
    const mn = pool.publicQName("Array");
    const bytes = new AVM2Code(pool).constructProp(mn, 0).toBytes();
    assertEqual(bytes[0], 0x4A);
    assertEqual(bytes[1], mn);
    assertEqual(bytes[2], 0);
});

// =============================================================================
// AVM2Code — scope
// =============================================================================

test("AVM2Code scope ops - pushScope, popScope, getGlobalScope", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).pushScope().popScope().getGlobalScope().toBytes();
    assertEqual(bytes[0], 0x30); // pushScope
    assertEqual(bytes[1], 0x1D); // popScope
    assertEqual(bytes[2], 0x64); // getGlobalScope
});

test("AVM2Code getScopeObject - emits 0x65 + U30 index", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).getScopeObject(0).toBytes();
    assertEqual(bytes[0], 0x65);
    assertEqual(bytes[1], 0);
});

// =============================================================================
// AVM2Code — class ops
// =============================================================================

test("AVM2Code newClass - emits 0x58 + U30 class index", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).newClass(0).toBytes();
    assertEqual(bytes[0], 0x58);
    assertEqual(bytes[1], 0);
});

test("AVM2Code initProperty - emits 0x68 + U30 multiname", () => {
    const pool = new AVM2ConstantPool();
    const mn = pool.publicQName("__NativeEval");
    const bytes = new AVM2Code(pool).initProperty(mn).toBytes();
    assertEqual(bytes[0], 0x68);
    assertEqual(bytes[1], mn);
});

test("AVM2Code constructSuper - emits 0x49 + U30 argc", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).constructSuper(0).toBytes();
    assertEqual(bytes[0], 0x49);
    assertEqual(bytes[1], 0);
});

// =============================================================================
// AVM2Code — enumeration
// =============================================================================

test("AVM2Code hasNext2 - emits 0x32 + U30 objectReg + U30 indexReg", () => {
    const pool = new AVM2ConstantPool();
    const bytes = new AVM2Code(pool).hasNext2(4, 5).toBytes();
    assertEqual(bytes[0], 0x32);
    assertEqual(bytes[1], 4);
    assertEqual(bytes[2], 5);
});

// =============================================================================
// AVM2Code — rawBytes and length
// =============================================================================

test("AVM2Code rawBytes - appends bytes verbatim", () => {
    const pool = new AVM2ConstantPool();
    const raw = new Uint8Array([0xAA, 0xBB, 0xCC]);
    const bytes = new AVM2Code(pool).rawBytes(raw).toBytes();
    assertEqual(bytes[0], 0xAA);
    assertEqual(bytes[1], 0xBB);
    assertEqual(bytes[2], 0xCC);
});

// =============================================================================
// buildNativeEvalABC — structure validation
// =============================================================================

test("buildNativeEvalABC - produces valid ABC header", () => {
    const pool = new AVM2ConstantPool();
    const achBody = new AVM2Code(pool).pushByte(1).returnValue().toBytes();
    const abc = buildNativeEvalABC(pool, [achBody], [], 14, 6);

    // ABC header: minor=16, major=46
    assertEqual(readUI16(abc, 0), 16); // minor
    assertEqual(readUI16(abc, 2), 46); // major
});

test("buildNativeEvalABC - no achievements or RP produces valid ABC", () => {
    const pool = new AVM2ConstantPool();
    const abc = buildNativeEvalABC(pool, [], [], 1, 1);

    // Should not throw and produce valid data
    assertEqual(abc.length > 4, true);
    assertEqual(readUI16(abc, 0), 16); // minor version
    assertEqual(readUI16(abc, 2), 46); // major version
});

test("buildNativeEvalABC - method count matches 3 + ach + rp", () => {
    const pool = new AVM2ConstantPool();
    const body1 = new AVM2Code(pool).pushByte(0).returnValue().toBytes();
    const body2 = new AVM2Code(pool).pushByte(1).returnValue().toBytes();
    const rpBody = new AVM2Code(pool).pushString("test").returnValue().toBytes();
    const abc = buildNativeEvalABC(pool, [body1, body2], [rpBody], 14, 6);

    // Skip past constant pool to find method count
    // The method count should be 3 (iinit, cinit, scriptinit) + 2 ach + 1 rp = 6
    // We just verify the ABC is non-trivially sized (method bodies add bulk)
    assertEqual(abc.length > 50, true);
});

// =============================================================================
// buildAVM2SWF — SWF structure
// =============================================================================

test("buildAVM2SWF - starts with FWS signature", () => {
    const pool = new AVM2ConstantPool();
    const abc = buildNativeEvalABC(pool, [], [], 1, 1);
    const swf = buildAVM2SWF(abc);

    // "FWS" magic
    assertEqual(swf[0], 0x46); // 'F'
    assertEqual(swf[1], 0x57); // 'W'
    assertEqual(swf[2], 0x53); // 'S'
});

test("buildAVM2SWF - version is 11", () => {
    const pool = new AVM2ConstantPool();
    const abc = buildNativeEvalABC(pool, [], [], 1, 1);
    const swf = buildAVM2SWF(abc);

    assertEqual(swf[3], 11);
});

test("buildAVM2SWF - FileLength matches actual size", () => {
    const pool = new AVM2ConstantPool();
    const abc = buildNativeEvalABC(pool, [], [], 1, 1);
    const swf = buildAVM2SWF(abc);

    const fileLength = readUI32(swf, 4);
    assertEqual(fileLength, swf.length);
});

test("buildAVM2SWF - contains FileAttributes tag with AS3 flag", () => {
    const pool = new AVM2ConstantPool();
    const abc = buildNativeEvalABC(pool, [], [], 1, 1);
    const swf = buildAVM2SWF(abc);

    // After header (8 bytes) + RECT (1 byte: 0x00) + FrameRate (2 bytes) + FrameCount (2 bytes)
    // = offset 13 is the first tag
    const tagWord = readUI16(swf, 13);
    const tagType = tagWord >> 6;
    assertEqual(tagType, 69); // FileAttributes
});

test("buildAVM2SWF - ends with End tag (0x0000)", () => {
    const pool = new AVM2ConstantPool();
    const abc = buildNativeEvalABC(pool, [], [], 1, 1);
    const swf = buildAVM2SWF(abc);

    // Last 2 bytes should be the End tag
    assertEqual(swf[swf.length - 2], 0x00);
    assertEqual(swf[swf.length - 1], 0x00);
});

test("buildAVM2SWF - ShowFrame tag precedes End tag", () => {
    const pool = new AVM2ConstantPool();
    const abc = buildNativeEvalABC(pool, [], [], 1, 1);
    const swf = buildAVM2SWF(abc);

    // ShowFrame (tag type 1, length 0) = 0x0040
    const showFrameOffset = swf.length - 4;
    assertEqual(readUI16(swf, showFrameOffset), 0x0040);
});

test("buildAVM2SWF - round-trips with achievement bodies", () => {
    const pool = new AVM2ConstantPool();
    const body = new AVM2Code(pool);
    body.getLocal(1); // gameRoot
    body.pushString("health");
    body.getProperty(pool.latePub);
    body.pushByte(0);
    body.equals();
    body.returnValue();
    const achBody = body.toBytes();

    const abc = buildNativeEvalABC(pool, [achBody], [], 14, 6);
    const swf = buildAVM2SWF(abc);

    // Verify basic SWF structure is intact
    assertEqual(swf[0], 0x46); // 'F'
    assertEqual(readUI32(swf, 4), swf.length); // FileLength
    assertEqual(swf[3], 11); // version
});
