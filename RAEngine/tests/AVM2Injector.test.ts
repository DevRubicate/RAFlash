/**
 * AVM2Injector Tests
 *
 * Tests for the AVM2 firmware injector that generates ABC bytecode
 * defining __RAFlashInjector extends MovieClip, plus SWF tags for
 * DefineSprite, SymbolClass, and PlaceObject3.
 */

import { test, assertEqual } from "../../tests/framework.ts";
import { buildInjectorTags, findMaxCharacterId } from "../src/swf/AVM2Injector.ts";

// =============================================================================
// Helpers
// =============================================================================

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

function readUI16(buf: Uint8Array, offset: number): number {
    return buf[offset] | (buf[offset + 1] << 8);
}

function readUI32(buf: Uint8Array, offset: number): number {
    return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
}

function readS24(buf: Uint8Array, offset: number): number {
    const val = buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
    return val >= 0x800000 ? val - 0x1000000 : val;
}

/** Read a UTF-8 string prefixed by U30 length from ABC data. */
function readABCString(buf: Uint8Array, offset: number): [string, number] {
    const [len, lenBytes] = readU30(buf, offset);
    const strBytes = buf.slice(offset + lenBytes, offset + lenBytes + len);
    const str = new TextDecoder().decode(strBytes);
    return [str, lenBytes + len];
}

/** Parse SWF tags from raw bytes, returns array of {type, length, dataOffset}. */
function parseTags(data: Uint8Array): { type: number; length: number; dataOffset: number; headerSize: number }[] {
    const tags: { type: number; length: number; dataOffset: number; headerSize: number }[] = [];
    let offset = 0;
    while (offset + 2 <= data.length) {
        const tcl = data[offset] | (data[offset + 1] << 8);
        const tagType = tcl >> 6;
        let tagLength = tcl & 0x3F;
        let headerSize = 2;
        if (tagLength === 0x3F) {
            if (offset + 6 > data.length) break;
            tagLength = readUI32(data, offset + 2);
            headerSize = 6;
        }
        tags.push({ type: tagType, length: tagLength, dataOffset: offset + headerSize, headerSize });
        if (tagType === 0) break;
        offset += headerSize + tagLength;
    }
    return tags;
}

/** Parse the ABC constant pool strings from ABC data starting at given offset. */
function parseABCStrings(abc: Uint8Array, offset: number): { strings: string[]; endOffset: number } {
    // Skip: int_count, uint_count, double_count
    let pos = offset;
    const [intCount, intBytes] = readU30(abc, pos); pos += intBytes;
    // Skip actual ints (int_count - 1 entries if > 1)
    for (let i = 1; i < intCount; i++) { const [, n] = readU30(abc, pos); pos += n; }
    const [uintCount, uintBytes] = readU30(abc, pos); pos += uintBytes;
    for (let i = 1; i < uintCount; i++) { const [, n] = readU30(abc, pos); pos += n; }
    const [doubleCount, doubleBytes] = readU30(abc, pos); pos += doubleBytes;
    // Skip doubles (8 bytes each, double_count - 1 entries if > 1)
    if (doubleCount > 1) pos += (doubleCount - 1) * 8;

    const [stringCount, strCountBytes] = readU30(abc, pos); pos += strCountBytes;
    const strings: string[] = [""];  // index 0 is implicit empty
    for (let i = 1; i < stringCount; i++) {
        const [str, strBytes] = readABCString(abc, pos);
        strings.push(str);
        pos += strBytes;
    }
    return { strings, endOffset: pos };
}

// =============================================================================
// buildInjectorTags — basic structure
// =============================================================================

test("AVM2Injector - returns non-empty Uint8Array", () => {
    const result = buildInjectorTags("firmware.swf", 100);
    assertEqual(result instanceof Uint8Array, true);
    assertEqual(result.length > 0, true);
});

test("AVM2Injector - contains exactly 4 SWF tags", () => {
    const tags = parseTags(buildInjectorTags("firmware.swf", 100));
    assertEqual(tags.length, 4);
});

test("AVM2Injector - tag types are DoABC2, DefineSprite, SymbolClass, PlaceObject3", () => {
    const tags = parseTags(buildInjectorTags("firmware.swf", 100));
    assertEqual(tags[0].type, 82);  // DoABC2
    assertEqual(tags[1].type, 39);  // DefineSprite
    assertEqual(tags[2].type, 76);  // SymbolClass
    assertEqual(tags[3].type, 70);  // PlaceObject3
});

// =============================================================================
// DoABC2 tag
// =============================================================================

test("AVM2Injector - DoABC2 has lazy-init flag", () => {
    const data = buildInjectorTags("firmware.swf", 100);
    const tags = parseTags(data);
    const doABC = tags[0];
    // First 4 bytes of DoABC2 content are flags
    const flags = readUI32(data, doABC.dataOffset);
    assertEqual(flags, 1);  // kDoAbcLazyInitializeFlag
});

test("AVM2Injector - DoABC2 contains class name __RAFlashInjector", () => {
    const data = buildInjectorTags("firmware.swf", 100);
    const tags = parseTags(data);
    const doABC = tags[0];
    // After 4-byte flags comes null-terminated name string
    let pos = doABC.dataOffset + 4;
    let name = "";
    while (data[pos] !== 0) { name += String.fromCharCode(data[pos++]); }
    assertEqual(name, "__RAFlashInjector");
});

test("AVM2Injector - ABC version is 16.46", () => {
    const data = buildInjectorTags("firmware.swf", 100);
    const tags = parseTags(data);
    const doABC = tags[0];
    // Skip flags (4 bytes) + null-terminated name
    let pos = doABC.dataOffset + 4;
    while (data[pos] !== 0) pos++;
    pos++; // skip null terminator
    // ABC minor.major versions
    const minor = readUI16(data, pos);
    const major = readUI16(data, pos + 2);
    assertEqual(minor, 16);
    assertEqual(major, 46);
});

// =============================================================================
// ABC constant pool — strings
// =============================================================================

function getABCOffset(data: Uint8Array): number {
    const tags = parseTags(data);
    const doABC = tags[0];
    let pos = doABC.dataOffset + 4; // skip flags
    while (data[pos] !== 0) pos++;
    pos++; // skip null terminator
    return pos; // start of ABC data
}

test("AVM2Injector - ABC string pool contains firmware URL", () => {
    const url = "http://localhost:9876/firmware.swf";
    const data = buildInjectorTags(url, 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    // Skip version (4 bytes)
    const { strings } = parseABCStrings(abc, 4);
    assertEqual(strings.includes(url), true);
});

test("AVM2Injector - ABC string pool contains expected class/property names", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const { strings } = parseABCStrings(abc, 4);
    // Key strings that must be present
    const expected = [
        "", "flash.display", "MovieClip", "Loader",
        "flash.net", "URLRequest", "__RAFlashInjector",
        "visible", "root", "getChildByName", "__raflash",
        "name", "addChild", "load", "fw.swf",
        "flash.system", "LoaderContext", "ApplicationDomain",
    ];
    for (const s of expected) {
        assertEqual(strings.includes(s), true);
    }
});

test("AVM2Injector - ABC string pool has 19 entries (including implicit index 0)", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const { strings } = parseABCStrings(abc, 4);
    assertEqual(strings.length, 19);
});

// =============================================================================
// ABC structure — namespaces and multinames
// =============================================================================

test("AVM2Injector - ABC has 5 namespaces (including implicit 0)", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const { endOffset } = parseABCStrings(abc, 4);
    const [nsCount] = readU30(abc, endOffset);
    assertEqual(nsCount, 5);
});

test("AVM2Injector - ABC has 13 multinames (including implicit 0)", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const { endOffset: strEnd } = parseABCStrings(abc, 4);
    // Skip namespaces
    let pos = strEnd;
    const [nsCount, nsBytes] = readU30(abc, pos); pos += nsBytes;
    for (let i = 1; i < nsCount; i++) {
        pos += 1; // kind byte
        const [, n] = readU30(abc, pos); pos += n; // name index
    }
    // Skip namespace sets
    const [nsSetCount, nsSetBytes] = readU30(abc, pos); pos += nsSetBytes;
    for (let i = 1; i < nsSetCount; i++) {
        const [count, cb] = readU30(abc, pos); pos += cb;
        for (let j = 0; j < count; j++) { const [, n] = readU30(abc, pos); pos += n; }
    }
    // Multiname count
    const [mnCount] = readU30(abc, pos);
    assertEqual(mnCount, 13);
});

// =============================================================================
// ABC structure — methods and classes
// =============================================================================

test("AVM2Injector - ABC has 3 method_infos", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    // We need to skip to method_count. Parse through constant pool.
    let pos = 4; // skip version

    // Skip constant pool: ints
    let [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) { const [, n] = readU30(abc, pos); pos += n; }
    // uints
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) { const [, n] = readU30(abc, pos); pos += n; }
    // doubles
    [count, bytes] = readU30(abc, pos); pos += bytes;
    if (count > 1) pos += (count - 1) * 8;
    // strings
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) {
        const [len, lb] = readU30(abc, pos); pos += lb + len;
    }
    // namespaces
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) { pos++; const [, n] = readU30(abc, pos); pos += n; }
    // namespace sets
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) {
        const [c, cb] = readU30(abc, pos); pos += cb;
        for (let j = 0; j < c; j++) { const [, n] = readU30(abc, pos); pos += n; }
    }
    // multinames
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) {
        const kind = abc[pos++];
        if (kind === 0x07) { // QName
            const [, n1] = readU30(abc, pos); pos += n1;
            const [, n2] = readU30(abc, pos); pos += n2;
        } else if (kind === 0x09) { // Multiname
            const [, n1] = readU30(abc, pos); pos += n1;
            const [, n2] = readU30(abc, pos); pos += n2;
        }
    }

    // Now at method_count
    const [methodCount] = readU30(abc, pos);
    assertEqual(methodCount, 3);
});

test("AVM2Injector - ABC has 1 class", () => {
    // Verify by checking class_count after methods+metadata
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    // Skip to methods (reuse the full-skip logic)
    let pos = skipToMethods(abc);
    // Skip 3 methods (each: param_count, return_type, name, flags — all U30 except flags is byte)
    const [methodCount, mb] = readU30(abc, pos); pos += mb;
    for (let i = 0; i < methodCount; i++) {
        const [paramCount, pb] = readU30(abc, pos); pos += pb;
        const [, rb] = readU30(abc, pos); pos += rb; // return type
        for (let j = 0; j < paramCount; j++) { const [, n] = readU30(abc, pos); pos += n; }
        const [, nb] = readU30(abc, pos); pos += nb; // name
        pos++; // flags
    }
    // metadata_count
    const [metaCount, metaBytes] = readU30(abc, pos); pos += metaBytes;
    assertEqual(metaCount, 0);
    // class_count
    const [classCount] = readU30(abc, pos);
    assertEqual(classCount, 1);
});

/** Skip constant pool, return position of method_count. */
function skipToMethods(abc: Uint8Array): number {
    let pos = 4;
    let count: number, bytes: number;
    // ints
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) { const [, n] = readU30(abc, pos); pos += n; }
    // uints
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) { const [, n] = readU30(abc, pos); pos += n; }
    // doubles
    [count, bytes] = readU30(abc, pos); pos += bytes;
    if (count > 1) pos += (count - 1) * 8;
    // strings
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) {
        const [len, lb] = readU30(abc, pos); pos += lb + len;
    }
    // namespaces
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) { pos++; const [, n] = readU30(abc, pos); pos += n; }
    // ns sets
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) {
        const [c, cb] = readU30(abc, pos); pos += cb;
        for (let j = 0; j < c; j++) { const [, n] = readU30(abc, pos); pos += n; }
    }
    // multinames
    [count, bytes] = readU30(abc, pos); pos += bytes;
    for (let i = 1; i < count; i++) {
        const kind = abc[pos++];
        if (kind === 0x07 || kind === 0x09) {
            const [, n1] = readU30(abc, pos); pos += n1;
            const [, n2] = readU30(abc, pos); pos += n2;
        }
    }
    return pos;
}

// =============================================================================
// DefineSprite tag
// =============================================================================

test("AVM2Injector - DefineSprite uses the given character ID", () => {
    const charId = 42;
    const data = buildInjectorTags("fw.swf", charId);
    const tags = parseTags(data);
    const sprite = tags[1]; // DefineSprite
    const spriteCharId = readUI16(data, sprite.dataOffset);
    assertEqual(spriteCharId, charId);
});

test("AVM2Injector - DefineSprite has 1 frame", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const tags = parseTags(data);
    const sprite = tags[1];
    const frameCount = readUI16(data, sprite.dataOffset + 2);
    assertEqual(frameCount, 1);
});

test("AVM2Injector - DefineSprite contains ShowFrame + End tags", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const tags = parseTags(data);
    const sprite = tags[1];
    // After charId (2) + frameCount (2), the nested tags begin
    const innerOffset = sprite.dataOffset + 4;
    // ShowFrame = tag type 1, length 0 → 0x0040
    const showFrame = readUI16(data, innerOffset);
    assertEqual(showFrame >> 6, 1);  // tag type 1
    assertEqual(showFrame & 0x3F, 0); // length 0
    // End = tag type 0
    const end = readUI16(data, innerOffset + 2);
    assertEqual(end, 0);
});

// =============================================================================
// SymbolClass tag
// =============================================================================

test("AVM2Injector - SymbolClass maps character ID to __RAFlashInjector", () => {
    const charId = 55;
    const data = buildInjectorTags("fw.swf", charId);
    const tags = parseTags(data);
    const sym = tags[2];
    // NumSymbols
    const numSymbols = readUI16(data, sym.dataOffset);
    assertEqual(numSymbols, 1);
    // Tag (character ID)
    const symCharId = readUI16(data, sym.dataOffset + 2);
    assertEqual(symCharId, charId);
    // Name (null-terminated)
    let nameOffset = sym.dataOffset + 4;
    let name = "";
    while (data[nameOffset] !== 0) { name += String.fromCharCode(data[nameOffset++]); }
    assertEqual(name, "__RAFlashInjector");
});

// =============================================================================
// PlaceObject3 tag
// =============================================================================

test("AVM2Injector - PlaceObject3 places on depth 0x3FFF with character ID", () => {
    const charId = 200;
    const data = buildInjectorTags("fw.swf", charId);
    const tags = parseTags(data);
    const place = tags[3];
    // Flags byte 0x02 = HasCharacter
    assertEqual(data[place.dataOffset], 0x02);
    // Depth
    const depth = readUI16(data, place.dataOffset + 2);
    assertEqual(depth, 0x3FFF);
    // Character ID
    const placeCharId = readUI16(data, place.dataOffset + 4);
    assertEqual(placeCharId, charId);
});

// =============================================================================
// Character ID variations
// =============================================================================

test("AVM2Injector - character ID 1 appears in all three referencing tags", () => {
    const charId = 1;
    const data = buildInjectorTags("fw.swf", charId);
    const tags = parseTags(data);
    assertEqual(readUI16(data, tags[1].dataOffset), charId);     // DefineSprite
    assertEqual(readUI16(data, tags[2].dataOffset + 2), charId); // SymbolClass
    assertEqual(readUI16(data, tags[3].dataOffset + 4), charId); // PlaceObject3
});

test("AVM2Injector - high character ID (1000) is encoded correctly", () => {
    const charId = 1000;
    const data = buildInjectorTags("fw.swf", charId);
    const tags = parseTags(data);
    assertEqual(readUI16(data, tags[1].dataOffset), charId);
    assertEqual(readUI16(data, tags[2].dataOffset + 2), charId);
    assertEqual(readUI16(data, tags[3].dataOffset + 4), charId);
});

// =============================================================================
// Firmware URL variations
// =============================================================================

test("AVM2Injector - short firmware URL is encoded", () => {
    const url = "a.swf";
    const data = buildInjectorTags(url, 1);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const { strings } = parseABCStrings(abc, 4);
    assertEqual(strings[15], url); // S_FIRMWARE_URL = index 15
});

test("AVM2Injector - long firmware URL with special characters", () => {
    const url = "http://localhost:9999/path/to/AVM2Firmware.swf?v=1&t=2";
    const data = buildInjectorTags(url, 1);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const { strings } = parseABCStrings(abc, 4);
    assertEqual(strings[15], url);
});

// =============================================================================
// Constructor bytecode validation
// =============================================================================

test("AVM2Injector - constructor body starts with getlocal_0 + pushscope", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    // Navigate to method body 0
    const bodyCode = extractMethodBody(abc, 0);
    assertEqual(bodyCode[0], 0xD0); // getlocal_0
    assertEqual(bodyCode[1], 0x30); // pushscope
});

test("AVM2Injector - constructor body calls constructsuper with 0 args", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const bodyCode = extractMethodBody(abc, 0);
    // getlocal_0, pushscope, getlocal_0, constructsuper, U30(0)
    assertEqual(bodyCode[2], 0xD0); // getlocal_0
    assertEqual(bodyCode[3], 0x49); // constructsuper
    assertEqual(bodyCode[4], 0x00); // 0 args
});

test("AVM2Injector - constructor body ends with returnvoid", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const bodyCode = extractMethodBody(abc, 0);
    assertEqual(bodyCode[bodyCode.length - 1], 0x47); // returnvoid
});

test("AVM2Injector - constructor sets visible = false", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const bodyCode = extractMethodBody(abc, 0);
    // After constructsuper: getlocal_0, pushfalse, setproperty(MN_VISIBLE=4)
    assertEqual(bodyCode[5], 0xD0); // getlocal_0
    assertEqual(bodyCode[6], 0x27); // pushfalse
    assertEqual(bodyCode[7], 0x61); // setproperty
    assertEqual(bodyCode[8], 0x04); // MN_VISIBLE (U30 encoding of 4)
});

test("AVM2Injector - constructor has branch offsets that target returnvoid", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const bodyCode = extractMethodBody(abc, 0);
    // Find ifstricteq (0x19) and ifstrictne (0x1A) opcodes
    const returnVoidIdx = bodyCode.length - 1;
    for (let i = 0; i < bodyCode.length; i++) {
        if (bodyCode[i] === 0x19 || bodyCode[i] === 0x1A) {
            const offset = readS24(bodyCode, i + 1);
            const target = i + 4 + offset; // S24 is 3 bytes, so next instruction is i+4
            assertEqual(target, returnVoidIdx);
        }
    }
});

// =============================================================================
// cinit body (method body 1)
// =============================================================================

test("AVM2Injector - cinit is just returnvoid", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const bodyCode = extractMethodBody(abc, 1);
    assertEqual(bodyCode.length, 1);
    assertEqual(bodyCode[0], 0x47); // returnvoid
});

// =============================================================================
// Script init body (method body 2)
// =============================================================================

test("AVM2Injector - script init uses newclass opcode", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const bodyCode = extractMethodBody(abc, 2);
    let foundNewclass = false;
    for (const b of bodyCode) {
        if (b === 0x58) { foundNewclass = true; break; }
    }
    assertEqual(foundNewclass, true);
});

test("AVM2Injector - script init uses initproperty for class registration", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const bodyCode = extractMethodBody(abc, 2);
    let foundInitprop = false;
    for (const b of bodyCode) {
        if (b === 0x68) { foundInitprop = true; break; }
    }
    assertEqual(foundInitprop, true);
});

test("AVM2Injector - script init ends with returnvoid", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const abcStart = getABCOffset(data);
    const abc = data.slice(abcStart);
    const bodyCode = extractMethodBody(abc, 2);
    assertEqual(bodyCode[bodyCode.length - 1], 0x47);
});

// =============================================================================
// Method body helper
// =============================================================================

/** Extract the raw bytecode of method body at the given index. */
function extractMethodBody(abc: Uint8Array, bodyIndex: number): Uint8Array {
    let pos = skipToMethods(abc);

    // Skip method_infos
    const [methodCount, mb] = readU30(abc, pos); pos += mb;
    for (let i = 0; i < methodCount; i++) {
        const [paramCount, pb] = readU30(abc, pos); pos += pb;
        const [, rb] = readU30(abc, pos); pos += rb; // return type
        for (let j = 0; j < paramCount; j++) { const [, n] = readU30(abc, pos); pos += n; }
        const [, nb] = readU30(abc, pos); pos += nb; // name
        pos++; // flags
    }

    // Skip metadata
    const [metaCount, metaBytes] = readU30(abc, pos); pos += metaBytes;
    for (let i = 0; i < metaCount; i++) {
        const [, nb] = readU30(abc, pos); pos += nb; // name
        const [itemCount, ib] = readU30(abc, pos); pos += ib;
        for (let j = 0; j < itemCount; j++) {
            const [, k] = readU30(abc, pos); pos += k;
            const [, v] = readU30(abc, pos); pos += v;
        }
    }

    // Skip classes (instance_info + class_info)
    const [classCount, cb] = readU30(abc, pos); pos += cb;
    // instance_infos
    for (let i = 0; i < classCount; i++) {
        const [, n1] = readU30(abc, pos); pos += n1; // name
        const [, n2] = readU30(abc, pos); pos += n2; // super_name
        const flags = abc[pos++]; // flags
        if (flags & 0x08) { const [, n] = readU30(abc, pos); pos += n; } // protectedNs
        const [intfCount, ib] = readU30(abc, pos); pos += ib;
        for (let j = 0; j < intfCount; j++) { const [, n] = readU30(abc, pos); pos += n; }
        const [, iinit] = readU30(abc, pos); pos += iinit; // iinit
        const [traitCount, tb] = readU30(abc, pos); pos += tb;
        for (let j = 0; j < traitCount; j++) { pos = skipTrait(abc, pos); }
    }
    // class_infos
    for (let i = 0; i < classCount; i++) {
        const [, ci] = readU30(abc, pos); pos += ci; // cinit
        const [traitCount, tb] = readU30(abc, pos); pos += tb;
        for (let j = 0; j < traitCount; j++) { pos = skipTrait(abc, pos); }
    }

    // Skip scripts
    const [scriptCount, sb] = readU30(abc, pos); pos += sb;
    for (let i = 0; i < scriptCount; i++) {
        const [, si] = readU30(abc, pos); pos += si; // init
        const [traitCount, tb] = readU30(abc, pos); pos += tb;
        for (let j = 0; j < traitCount; j++) { pos = skipTrait(abc, pos); }
    }

    // Method bodies
    const [bodyCount, bb] = readU30(abc, pos); pos += bb;
    for (let i = 0; i < bodyCount; i++) {
        const [, mi] = readU30(abc, pos); pos += mi; // method
        const [, maxStack] = readU30(abc, pos); pos += maxStack;
        const [, localCount] = readU30(abc, pos); pos += localCount;
        const [, initScope] = readU30(abc, pos); pos += initScope;
        const [, maxScope] = readU30(abc, pos); pos += maxScope;
        const [codeLen, clb] = readU30(abc, pos); pos += clb;

        if (i === bodyIndex) {
            return abc.slice(pos, pos + codeLen);
        }

        pos += codeLen;
        // Skip exception handlers
        const [excCount, eb] = readU30(abc, pos); pos += eb;
        for (let j = 0; j < excCount; j++) {
            const [, a] = readU30(abc, pos); pos += a;
            const [, b] = readU30(abc, pos); pos += b;
            const [, c] = readU30(abc, pos); pos += c;
            const [, d] = readU30(abc, pos); pos += d;
            const [, e] = readU30(abc, pos); pos += e;
        }
        // Skip traits
        const [traitCount, tb] = readU30(abc, pos); pos += tb;
        for (let j = 0; j < traitCount; j++) { pos = skipTrait(abc, pos); }
    }

    throw new Error(`Method body ${bodyIndex} not found`);
}

/** Skip a single trait entry, return new position. */
function skipTrait(abc: Uint8Array, pos: number): number {
    const [, nb] = readU30(abc, pos); pos += nb; // name
    const kind = abc[pos++];
    const tag = kind & 0x0F;
    if (tag === 0 || tag === 6) { // Trait_Slot / Trait_Const
        const [, s] = readU30(abc, pos); pos += s; // slot_id
        const [, t] = readU30(abc, pos); pos += t; // type_name
        const [vindex, v] = readU30(abc, pos); pos += v;
        if (vindex !== 0) pos++; // vkind
    } else if (tag === 4) { // Trait_Class
        const [, s] = readU30(abc, pos); pos += s; // slot_id
        const [, c] = readU30(abc, pos); pos += c; // classi
    } else if (tag === 5) { // Trait_Function
        const [, s] = readU30(abc, pos); pos += s; // slot_id
        const [, f] = readU30(abc, pos); pos += f; // function
    } else { // Trait_Method, Trait_Getter, Trait_Setter (1,2,3)
        const [, d] = readU30(abc, pos); pos += d; // disp_id
        const [, m] = readU30(abc, pos); pos += m; // method
    }
    if (kind & 0x40) { // ATTR_Metadata
        const [metaCount, mb] = readU30(abc, pos); pos += mb;
        for (let j = 0; j < metaCount; j++) { const [, m] = readU30(abc, pos); pos += m; }
    }
    return pos;
}

// =============================================================================
// Long tag encoding
// =============================================================================

test("AVM2Injector - DoABC2 uses long tag header (content >= 63 bytes)", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const tags = parseTags(data);
    // DoABC2 content is well over 63 bytes, so it must use long form
    assertEqual(tags[0].headerSize, 6);
});

test("AVM2Injector - short tags use 2-byte header", () => {
    const data = buildInjectorTags("fw.swf", 100);
    const tags = parseTags(data);
    // DefineSprite (8 bytes content), SymbolClass (~21 bytes), PlaceObject3 (6 bytes)
    // All under 63 bytes → short header
    assertEqual(tags[1].headerSize, 2); // DefineSprite
    assertEqual(tags[3].headerSize, 2); // PlaceObject3
});

// =============================================================================
// findMaxCharacterId
// =============================================================================

test("findMaxCharacterId - empty tag stream returns 0", () => {
    // End tag: type 0, length 0 → 0x0000
    const data = new Uint8Array([0x00, 0x00]);
    assertEqual(findMaxCharacterId(data, 0), 0);
});

test("findMaxCharacterId - single DefineShape tag", () => {
    // DefineShape (type 2): tag header = (2 << 6) | 4 = 0x84
    // Content: charId=5 (LE) + 2 dummy bytes
    const data = new Uint8Array([
        0x84, 0x00,       // tag header: type=2, length=4
        0x05, 0x00,       // charId = 5
        0x00, 0x00,       // dummy shape data
        0x00, 0x00,       // End tag
    ]);
    assertEqual(findMaxCharacterId(data, 0), 5);
});

test("findMaxCharacterId - multiple defining tags returns max", () => {
    // DefineShape (type 2) with charId=3, then DefineSprite (type 39) with charId=10
    const data = new Uint8Array([
        // DefineShape: type=2, length=4 → (2<<6)|4 = 0x84
        0x84, 0x00, 0x03, 0x00, 0x00, 0x00,
        // DefineSprite: type=39, length=8 → (39<<6)|8 = 0x9C8 = short
        0xC8, 0x09, 0x0A, 0x00, 0x01, 0x00, 0x40, 0x00, 0x00, 0x00,
        // End tag
        0x00, 0x00,
    ]);
    assertEqual(findMaxCharacterId(data, 0), 10);
});

test("findMaxCharacterId - non-defining tags are ignored", () => {
    // ShowFrame (type 1, length 0) is not a character-defining tag
    // SetBackgroundColor (type 9, length 3) is not character-defining
    const data = new Uint8Array([
        0x40, 0x00,                   // ShowFrame: (1<<6)|0 = 0x40
        0x43, 0x02, 0xFF, 0xFF, 0xFF, // SetBackgroundColor: (9<<6)|3 = 0x243
        0x00, 0x00,                   // End
    ]);
    assertEqual(findMaxCharacterId(data, 0), 0);
});

test("findMaxCharacterId - respects tagsOffset parameter", () => {
    // 4 bytes of junk before tags start
    const data = new Uint8Array([
        0xFF, 0xFF, 0xFF, 0xFF,  // junk
        0x84, 0x00, 0x07, 0x00, 0x00, 0x00,  // DefineShape with charId=7
        0x00, 0x00,  // End
    ]);
    assertEqual(findMaxCharacterId(data, 4), 7);
    // Without offset, parsing junk would give wrong results
});

test("findMaxCharacterId - long tag header (length >= 63)", () => {
    // DefineShape (type 2) with long header
    // Short header with 0x3F indicates long form
    const contentLen = 100;
    const data = new Uint8Array(2 + 4 + contentLen + 2);
    // Tag header: (2 << 6) | 0x3F = 0xBF
    data[0] = 0xBF; data[1] = 0x00;
    // Long length (U32 LE)
    data[2] = contentLen; data[3] = 0; data[4] = 0; data[5] = 0;
    // Content: charId = 42
    data[6] = 42; data[7] = 0;
    // End tag at offset 6 + contentLen
    // (rest is zeros, which is the End tag)
    assertEqual(findMaxCharacterId(data, 0), 42);
});

test("findMaxCharacterId - handles truncated data gracefully", () => {
    // Data too short for a complete tag
    const data = new Uint8Array([0x84]);
    assertEqual(findMaxCharacterId(data, 0), 0);
});

test("findMaxCharacterId - offset beyond data returns 0", () => {
    const data = new Uint8Array([0x00, 0x00]);
    assertEqual(findMaxCharacterId(data, 10), 0);
});

// =============================================================================
// Round-trip: output is parseable
// =============================================================================

test("AVM2Injector - output bytes are fully consumed by tag parser", () => {
    const data = buildInjectorTags("firmware.swf", 50);
    const tags = parseTags(data);
    // Sum of all tag sizes should equal total length
    let consumed = 0;
    for (const tag of tags) {
        consumed += tag.headerSize + tag.length;
    }
    assertEqual(consumed, data.length);
});

test("AVM2Injector - different firmware URLs produce different output sizes", () => {
    const short = buildInjectorTags("a.swf", 1);
    const long = buildInjectorTags("http://example.com/very/long/path/firmware.swf", 1);
    assertEqual(long.length > short.length, true);
});
