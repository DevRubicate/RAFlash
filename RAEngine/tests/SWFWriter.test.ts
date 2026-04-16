/**
 * SWFWriter Tests
 *
 * Tests for buildSWF: header structure, tag encoding, file length backfill.
 */

import { test, assertEqual } from "../../tests/framework.ts";
import { buildSWF } from "../src/swf/SWFWriter.ts";

// Helper: read UI16 little-endian from a Uint8Array
function readUI16(buf: Uint8Array, offset: number): number {
    return buf[offset] | (buf[offset + 1] << 8);
}

// Helper: read UI32 little-endian
function readUI32(buf: Uint8Array, offset: number): number {
    return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
}

// =============================================================================
// Header
// =============================================================================

test("buildSWF - starts with FWS signature", () => {
    const swf = buildSWF(new Uint8Array([0x00]));
    assertEqual(swf[0], 0x46); // F
    assertEqual(swf[1], 0x57); // W
    assertEqual(swf[2], 0x53); // S
});

test("buildSWF - default version is 7", () => {
    const swf = buildSWF(new Uint8Array([0x00]));
    assertEqual(swf[3], 7);
});

test("buildSWF - respects custom version", () => {
    const swf = buildSWF(new Uint8Array([0x00]), { version: 10 });
    assertEqual(swf[3], 10);
});

test("buildSWF - file length field matches actual length", () => {
    const swf = buildSWF(new Uint8Array([0x00]));
    const reportedLen = readUI32(swf, 4);
    assertEqual(reportedLen, swf.length);
});

test("buildSWF - respects custom frame rate", () => {
    const swf = buildSWF(new Uint8Array([0x00]), { frameRate: 30 });
    assertEqual(swf[9], 0x00);
    assertEqual(swf[10], 30);
});

// =============================================================================
// Tags
// =============================================================================

test("buildSWF - DoAction tag has correct type (12) in short form", () => {
    // Short form: action payload < 0x3F bytes
    const actions = new Uint8Array([0x00]); // 1 byte, well under 0x3F
    const swf = buildSWF(actions);
    // DoAction tag starts at offset 13 (after header)
    const tagWord = readUI16(swf, 13);
    const tagType = tagWord >> 6;
    const tagLen = tagWord & 0x3F;
    assertEqual(tagType, 12);
    assertEqual(tagLen, 1);
});

test("buildSWF - DoAction tag body contains action bytes", () => {
    const actions = new Uint8Array([0x96, 0x05, 0x00, 0x00, 0x68, 0x69, 0x00, 0x00]);
    const swf = buildSWF(actions);
    // Tag body starts at offset 15 (13 + 2 for short tag header)
    for (let i = 0; i < actions.length; i++) {
        assertEqual(swf[15 + i], actions[i]);
    }
});

test("buildSWF - long-form DoAction tag for large payloads", () => {
    // Create a payload >= 0x3F (63) bytes
    const actions = new Uint8Array(100);
    actions.fill(0x17); // fill with ActionPop opcodes
    actions[99] = 0x00; // end flag
    const swf = buildSWF(actions);

    // Long form: short tag word has length=0x3F, followed by UI32 actual length
    const tagWord = readUI16(swf, 13);
    const tagType = tagWord >> 6;
    const tagLen = tagWord & 0x3F;
    assertEqual(tagType, 12);
    assertEqual(tagLen, 0x3F); // signals long form
    const actualLen = readUI32(swf, 15);
    assertEqual(actualLen, 100);
});

test("buildSWF - ends with ShowFrame and End tags", () => {
    const actions = new Uint8Array([0x00]);
    const swf = buildSWF(actions);
    const len = swf.length;
    // End tag (type 0, length 0) = 0x0000
    assertEqual(swf[len - 2], 0x00);
    assertEqual(swf[len - 1], 0x00);
    // ShowFrame tag (type 1, length 0) = (1 << 6) | 0 = 0x0040
    assertEqual(swf[len - 4], 0x40);
    assertEqual(swf[len - 3], 0x00);
});

// =============================================================================
// File length consistency
// =============================================================================

test("buildSWF - file length correct for various payload sizes", () => {
    for (const size of [1, 10, 62, 63, 64, 100, 255]) {
        const actions = new Uint8Array(size);
        actions[size - 1] = 0x00;
        const swf = buildSWF(actions);
        assertEqual(readUI32(swf, 4), swf.length,
            `File length mismatch for payload size ${size}`);
    }
});
