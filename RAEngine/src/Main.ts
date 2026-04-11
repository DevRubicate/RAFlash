/**
 * RAFlash Main Entry Point
 *
 * Unified Deno server that handles both AS2 (AVM1) and AS3 (AVM2) games.
 * Auto-detects the SWF version after file selection and launches the
 * appropriate firmware.
 *
 * Features:
 * - File picker for selecting game SWF
 * - Auto-detection of AS2 vs AS3 games (SWF version byte)
 * - F12 opens devtools menu
 * - Full devtools support (memory inspector, asset list, asset editor)
 * - Commands forwarded to firmware via XMLSocket (AVM1) or Socket (AVM2)
 *
 * Usage: deno run --allow-net --allow-run --allow-read --allow-write --allow-env Main.ts
 */

import { HTMLWindow } from "./HTMLWindow.ts";
import { JSONDiff, type Diff } from "./JSONDiff.ts";
import { Formula } from "./formula/Formula.ts";
import { AppData } from "./AppData.ts";
import { UserProfile } from "./UserProfile.ts";
import { WindowManager } from "./WindowManager.ts";
import type { Requirement } from "./types.ts";
import { join, SEPARATOR } from "https://deno.land/std/path/mod.ts";
import { Buffer } from "node:buffer";
import { PNG } from "npm:pngjs";
import jpeg from "npm:jpeg-js";
// @deno-types="npm:@types/pako"
import * as pako from "npm:pako";
import { unzipSync } from "npm:fflate";
import { startSitelockProxy, stopSitelockProxy } from "./SitelockProxy.ts";

const VERSION = "0.0.5";

// Compile a formula and emit an error log if compilation fails
function compileFormula(input: string): unknown[] {
    const compiled = Formula.compile(input);
    if (compiled.length === 3 && compiled[2] === 'ERROR') {
        emitLog("engine", "error", `Formula compilation failed: ${input}`);
    }
    return compiled;
}

// Detect common formula patterns and return a compact fast-path descriptor,
// or null if the bytecode doesn't match any known pattern.
// Pattern IDs: 0=literal num, 1=literal str, 2=null, 3=prop1, 4=prop2, 5=prop3, 6=array filter eq
function detectPattern(bytecode: unknown[]): unknown[] | null {
    const len = bytecode.length;
    const b = bytecode as string[];

    // Pattern 0: Literal number — VERSION_1, VALUE, <n>
    if (len === 3 && b[1] === 'VALUE')
        return [0, parseInt(b[2], 10)];

    // Pattern 1: Literal string — VERSION_1, STRING, <s>
    if (len === 3 && b[1] === 'STRING')
        return [1, b[2]];

    // Pattern 2: Literal null — VERSION_1, NULL
    if (len === 2 && b[1] === 'NULL')
        return [2];

    // Helper: check for simple OBJECT_ACCESS pattern at offset
    // Pattern: OBJECT_ACCESS, 6, IDENTIFIER, key, READ_GLOBAL, IDENTIFIER, <prop>, EQUAL
    function isSimpleObjAccess(offset: number): string | null {
        if (b[offset] === 'OBJECT_ACCESS' && b[offset + 1] === '6' &&
            b[offset + 2] === 'IDENTIFIER' && b[offset + 3] === 'key' &&
            b[offset + 4] === 'READ_GLOBAL' && b[offset + 5] === 'IDENTIFIER' &&
            b[offset + 7] === 'EQUAL')
            return b[offset + 6];
        return null;
    }

    // All remaining patterns start with: IDENTIFIER, this|stage, READ_GLOBAL
    if (len >= 12 && b[1] === 'IDENTIFIER' && (b[2] === 'this' || b[2] === 'stage') && b[3] === 'READ_GLOBAL') {
        const p1 = isSimpleObjAccess(4);
        if (p1 === null) return null;

        // Pattern 3: 1-deep property — len 12
        if (len === 12) return [3, p1];

        if (len >= 20) {
            const p2 = isSimpleObjAccess(12);
            if (p2 !== null) {
                // Pattern 4: 2-deep property — len 20
                if (len === 20) return [4, p1, p2];

                // Pattern 5: 3-deep property — len 28
                if (len === 28) {
                    const p3 = isSimpleObjAccess(20);
                    if (p3 !== null) return [5, p1, p2, p3];
                }
            }

            // Pattern 6: 1-deep prop + array filter eq — len 20
            // ARRAY_ACCESS, 6, IDENTIFIER, this, READ_GLOBAL, STRING, <match>, EQUAL
            if (len === 20 && b[12] === 'ARRAY_ACCESS' && b[13] === '6' &&
                b[14] === 'IDENTIFIER' && b[15] === 'this' &&
                b[16] === 'READ_GLOBAL' && b[17] === 'STRING' &&
                b[19] === 'EQUAL')
                return [6, p1, b[18]];
        }
    }

    return null;
}

// Stamp a whole-requirement fast-path when both sides have known patterns,
// neither side is DELTA, and A is a property lookup (3-5) with B a literal (0-2).
// Format: [cmpId, aType, ...aParams, bValue]
const CMP_IDS: Record<string, number> = { '==': 0, '!=': 1, '>': 2, '>=': 3, '<': 4, '<=': 5 };

function stampFastReq(req: Requirement): void {
    req.fastReq = null;
    const fa = req.fastA, fb = req.fastB;
    if (!fa || !fb) return;
    if (req.typeA === 'DELTA' || req.typeB === 'DELTA') return;
    const cmpId = CMP_IDS[req.cmp];
    if (cmpId === undefined) return;

    const aType = fa[0] as number;
    if (aType < 3 || aType > 5) return; // A must be property pattern
    const bType = fb[0] as number;
    if (bType > 2) return; // B must be literal

    const bValue = bType === 2 ? null : fb[1];
    if (aType === 3) req.fastReq = [cmpId, 3, fa[1], bValue];
    else if (aType === 4) req.fastReq = [cmpId, 4, fa[1], fa[2], bValue];
    else if (aType === 5) req.fastReq = [cmpId, 5, fa[1], fa[2], fa[3], bValue];
}

// Helper to compile a requirement field based on its type
function compileRequirementField(req: Requirement, field: 'A' | 'B'): unknown[] {
    const address = (field === 'A' ? req.addressA : req.addressB) || '';

    // Always compile address as formula - this handles:
    // - Numeric literals like "50" → compiles to VALUE bytecode
    // - String literals like '"hello"' → compiles to STRING bytecode
    // - Formula expressions like "stage.player.health" → compiles to formula bytecode
    // Use '0' for empty to avoid unbalanced formula
    const compiled = compileFormula(address || '0');

    // Detect and store fast-path pattern
    const fast = detectPattern(compiled);
    if (field === 'A') req.fastA = fast;
    else req.fastB = fast;

    // Re-evaluate whole-requirement fast-path
    stampFastReq(req);

    return compiled;
}

// Register watchers to compile formulas when addressA/addressB or typeA/typeB change
JSONDiff.watch(
    'assets/*/groups/*/requirements/*/addressA',
    (segments) => {
        const req = segments[segments.length - 2] as Requirement;
        req.compiledA = compileRequirementField(req, 'A');
    }
);

JSONDiff.watch(
    'assets/*/groups/*/requirements/*/addressB',
    (segments) => {
        const req = segments[segments.length - 2] as Requirement;
        req.compiledB = compileRequirementField(req, 'B');
    }
);

JSONDiff.watch(
    'assets/*/groups/*/requirements/*/typeA',
    (segments) => {
        const req = segments[segments.length - 2] as Requirement;
        req.compiledA = compileRequirementField(req, 'A');
    }
);

JSONDiff.watch(
    'assets/*/groups/*/requirements/*/typeB',
    (segments) => {
        const req = segments[segments.length - 2] as Requirement;
        req.compiledB = compileRequirementField(req, 'B');
    }
);

// Re-stamp whole-requirement fast-path when comparison operator changes
JSONDiff.watch(
    'assets/*/groups/*/requirements/*/cmp',
    (segments) => {
        const req = segments[segments.length - 2] as Requirement;
        stampFastReq(req);
    }
);

// Compile Rich Presence formula when it changes
JSONDiff.watch(
    'assets/*/formula',
    (segments) => {
        const asset = segments[segments.length - 2];
        if (asset && typeof asset === 'object' && !Array.isArray(asset)) {
            const rec = asset as Record<string, unknown>;
            if (rec.type === 'RICH_PRESENCE') {
                rec.compiledFormula = compileFormula(String(rec.formula ?? '""'));
            }
        }
    }
);

const HTTP_PORT = 18080;
const FLASH_PORT = 18081;
const PROXY_PORT = 18082;
const RAFLASH_DOMAIN = "raflash.local"; // Fake domain for proxy routing (127.0.0.1 bypasses WinInet proxy)

// Global settings (persisted to RACache/settings.json)
interface Settings {
    // Which firmware approach to use for the AVM1 game launch:
    //   "child"  — Flash Player loads the game directly. RAEngine injects
    //              bytecode at frame 1 that loads the firmware as a child
    //              clip of the game's _root. The game is the true _level0.
    //              Default; eliminates compatibility hacks needed by parent.
    //   "parent" — Flash Player loads the firmware (via AVM1Wrapper) which
    //              then loads the game into a child clip. The firmware is
    //              the host. Older approach; reliable fallback.
    //   "none"   — Flash Player loads the game directly, with no injection
    //              and no firmware involvement at all. Used for debugging
    //              and side-by-side comparison. Devtools (RADisplay) won't
    //              be able to connect since there's nothing to talk to.
    // For AVM2 games, "child" silently falls back to "parent" (no AVM2 child
    // mode yet); "none" is honored.
    firmwareMode: "parent" | "child" | "none";
    fixTextFieldBindings: boolean;     // parent-mode only
    fixSoundAttach: boolean;            // parent-mode only
    benchmarkingEnabled: boolean;
}
const defaultSettings: Settings = {
    firmwareMode: "child",
    fixTextFieldBindings: true,
    fixSoundAttach: true,
    benchmarkingEnabled: false,
};
let settings: Settings = { ...defaultSettings };

async function loadSettings(): Promise<void> {
    try {
        const text = await Deno.readTextFile("RACache/settings.json");
        const saved = JSON.parse(text);
        settings = { ...defaultSettings, ...saved };
    } catch {
        // File doesn't exist or invalid — use defaults
    }
}

async function saveSettings(newSettings: Settings): Promise<void> {
    settings = { ...defaultSettings, ...newSettings };
    await Deno.mkdir("RACache", { recursive: true });
    await Deno.writeTextFile("RACache/settings.json", JSON.stringify(settings, null, 2));
}

// AVM mode configuration - set after game SWF is selected and version detected
interface AVMConfig {
    mode: "AVM1" | "AVM2";
    firmwareUrl: string; // URL path Flash Player loads (e.g. "/avm1-wrapper.swf")
    firmwareSwf: string;
    innerFirmwareSwf?: string; // AVM1 firmware loaded by AVM2 wrapper
    messageTerminator: string;
    patchFirmware: boolean;
    convertPngToJpeg: boolean;
}
let avmConfig: AVMConfig;

/**
 * Resolve which firmware approach to use for the current game launch.
 *
 * "none" is honored regardless of AVM version — it's the user explicitly
 * asking for a raw game launch with no firmware involvement.
 *
 * "child" is honored only for AVM1; AVM2 games silently fall back to
 * "parent" because the AVM2 firmware doesn't have a child-mode equivalent
 * yet. AVM2 games launched in "parent" still get full devtools support.
 *
 * "parent" is the fallback for everything else.
 */
function resolveFirmwareMode(): "parent" | "child" | "none" {
    if (settings.firmwareMode === "none") return "none";
    if (avmConfig?.mode === "AVM2") return "parent";
    return settings.firmwareMode === "child" ? "child" : "parent";
}

/**
 * Patch a firmware SWF's header with target frameRate and background color.
 * This allows games to run at their intended speed with correct colors.
 *
 * @param firmwareBytes - The firmware SWF bytes
 * @param targetFrameRate - The desired frame rate (e.g., 30)
 * @param targetBgColor - The background color as hex string (e.g., "#FFFFFF") or null to skip
 * @returns Patched SWF bytes (uncompressed)
 */
function patchFirmwareSwf(
    firmwareBytes: Uint8Array,
    targetFrameRate: number,
    targetBgColor: string | null,
    targetWidth: number,
    targetHeight: number,
    gameHidesMenuBar: boolean
): Uint8Array {
    // 1. Check if compressed (CWS = zlib, ZWS = lzma)
    const signature = String.fromCharCode(firmwareBytes[0], firmwareBytes[1], firmwareBytes[2]);

    if (signature === "ZWS") {
        console.warn("LZMA-compressed SWFs (ZWS) are not supported for patching");
        return firmwareBytes;
    }

    // 2. Get uncompressed data
    let data: Uint8Array;
    const isCompressed = signature === "CWS";

    if (isCompressed) {
        // Decompress: first 8 bytes are header, everything after is zlib-compressed
        const compressed = firmwareBytes.slice(8);
        const decompressed = pako.inflate(compressed);

        // Build uncompressed SWF: change CWS to FWS and combine
        data = new Uint8Array(8 + decompressed.length);
        data.set(firmwareBytes.slice(0, 8)); // Copy original header
        data[0] = 0x46; // 'F' - change CWS to FWS
        data.set(decompressed, 8);
    } else {
        data = new Uint8Array(firmwareBytes);
    }

    // 3. Rewrite RECT structure with game dimensions
    // Compensate for Flash Player's menu bar (20px) which fscommand("showmenu","false") removes.
    // Games that already hide the menu bar themselves don't need compensation.
    const menuBarCompensation = gameHidesMenuBar ? 0 : 20;
    // RECT format: [Nbits:5][Xmin:N][Xmax:N][Ymin:N][Ymax:N] (bit-packed)
    const xMaxTwips = targetWidth * 20;
    const yMaxTwips = (targetHeight - menuBarCompensation) * 20;
    // Nbits must hold the largest value (unsigned) plus a sign bit
    const maxVal = Math.max(xMaxTwips, yMaxTwips);
    const newNbits = maxVal > 0 ? Math.ceil(Math.log2(maxVal + 1)) + 1 : 1;

    // Parse old RECT to find where it ends
    const oldNbits = (data[8] >> 3) & 0x1F;
    const oldRectTotalBits = 5 + oldNbits * 4;
    const oldRectBytes = Math.ceil(oldRectTotalBits / 8);

    // Build new RECT bytes
    const newRectTotalBits = 5 + newNbits * 4;
    const newRectBytes = Math.ceil(newRectTotalBits / 8);
    const newRect = new Uint8Array(newRectBytes);

    // Helper to write bits into newRect
    const writeBits = (startBit: number, numBits: number, value: number) => {
        for (let i = 0; i < numBits; i++) {
            const bit = (value >> (numBits - 1 - i)) & 1;
            if (bit) {
                const byteIdx = Math.floor((startBit + i) / 8);
                const bitIdx = 7 - ((startBit + i) % 8);
                newRect[byteIdx] |= (1 << bitIdx);
            }
        }
    };

    writeBits(0, 5, newNbits);        // Nbits
    writeBits(5, newNbits, 0);        // Xmin = 0
    writeBits(5 + newNbits, newNbits, xMaxTwips);    // Xmax
    writeBits(5 + newNbits * 2, newNbits, 0);        // Ymin = 0
    writeBits(5 + newNbits * 3, newNbits, yMaxTwips); // Ymax

    // Rebuild data if RECT size changed
    const afterOldRect = 8 + oldRectBytes;
    const newData = new Uint8Array(8 + newRectBytes + (data.length - afterOldRect));
    newData.set(data.slice(0, 8));          // SWF header (signature + version + length)
    newData.set(newRect, 8);                // New RECT
    newData.set(data.slice(afterOldRect), 8 + newRectBytes); // Rest of SWF (frameRate, tags, etc.)

    // Update file length in header (bytes 4-7, little-endian)
    const newLength = newData.length;
    newData[4] = newLength & 0xFF;
    newData[5] = (newLength >> 8) & 0xFF;
    newData[6] = (newLength >> 16) & 0xFF;
    newData[7] = (newLength >> 24) & 0xFF;

    data = newData;
    const frameRateOffset = 8 + newRectBytes;

    // 4. Patch frameRate (8.8 fixed-point, little-endian)
    // Low byte = fraction (usually 0), high byte = integer part
    data[frameRateOffset] = 0; // fraction
    data[frameRateOffset + 1] = targetFrameRate; // integer

    // 5. Find and patch SetBackgroundColor tag (type 9) if color provided
    if (targetBgColor) {
        // Parse hex color: "#RRGGBB" or "RRGGBB"
        const colorHex = targetBgColor.replace('#', '');
        const r = parseInt(colorHex.substring(0, 2), 16);
        const g = parseInt(colorHex.substring(2, 4), 16);
        const b = parseInt(colorHex.substring(4, 6), 16);

        // Tags start after header: frameRate (2 bytes) + frameCount (2 bytes)
        const tagsOffset = frameRateOffset + 4;

        // Search for SetBackgroundColor tag (type 9)
        let offset = tagsOffset;
        while (offset < data.length - 2) {
            const tagCodeAndLength = data[offset] | (data[offset + 1] << 8);
            const tagType = tagCodeAndLength >> 6;
            let tagLength = tagCodeAndLength & 0x3F;

            // Extended length?
            let headerSize = 2;
            if (tagLength === 0x3F) {
                // Extended: next 4 bytes are the length
                tagLength = data[offset + 2] | (data[offset + 3] << 8) |
                           (data[offset + 4] << 16) | (data[offset + 5] << 24);
                headerSize = 6;
            }

            if (tagType === 9) {
                // SetBackgroundColor tag found! RGB follows the header
                data[offset + headerSize] = r;
                data[offset + headerSize + 1] = g;
                data[offset + headerSize + 2] = b;
                break;
            }

            if (tagType === 0) {
                // End tag - stop searching
                break;
            }

            offset += headerSize + tagLength;
        }
    }

    return data;
}

/**
 * Check if a SWF contains fscommand("showmenu") by scanning for the string.
 * Games that hide the menu bar themselves don't need menu bar height compensation.
 */
function swfHidesMenuBar(swfBytes: Uint8Array): boolean {
    // Decompress if needed to search actual content
    let data: Uint8Array;
    const sig = String.fromCharCode(swfBytes[0], swfBytes[1], swfBytes[2]);
    if (sig === "CWS") {
        try {
            const decompressed = pako.inflate(swfBytes.slice(8));
            data = new Uint8Array(8 + decompressed.length);
            data.set(swfBytes.slice(0, 8));
            data.set(decompressed, 8);
        } catch {
            data = swfBytes;
        }
    } else {
        data = swfBytes;
    }

    // Search for "FSCommand:showMenu" — the compiled form of fscommand("showmenu").
    // Case-insensitive on the "showMenu" part since Flash accepts any casing.
    const prefix = new TextEncoder().encode("FSCommand:");
    const suffix = [115, 104, 111, 119, 109, 101, 110, 117]; // "showmenu" lowercase
    const needleLen = prefix.length + suffix.length;
    for (let i = 0; i <= data.length - needleLen; i++) {
        let match = true;
        for (let j = 0; j < prefix.length; j++) {
            if (data[i + j] !== prefix[j]) { match = false; break; }
        }
        if (!match) continue;
        match = true;
        for (let j = 0; j < suffix.length; j++) {
            if ((data[i + prefix.length + j] | 0x20) !== suffix[j]) { match = false; break; }
        }
        if (match) return true;
    }
    return false;
}

/**
 * Parse SWF header to extract frameRate, backgroundColor, width, and height.
 * Handles both compressed (CWS) and uncompressed (FWS) SWFs.
 */
function parseSwfMetadata(swfBytes: Uint8Array): { frameRate: number; backgroundColor: string; width: number; height: number; useAS3: boolean; exportedSounds: string[] } {
    // Default values
    let frameRate = 30;
    let backgroundColor = "#FFFFFF";
    let width = 800;
    let height = 600;
    let useAS3 = false;
    const exportedSounds: string[] = [];

    try {
        // Check signature
        const signature = String.fromCharCode(swfBytes[0], swfBytes[1], swfBytes[2]);

        let data: Uint8Array;
        if (signature === "CWS") {
            // Decompress zlib data (everything after byte 8)
            const compressed = swfBytes.slice(8);
            const decompressed = pako.inflate(compressed);
            // Build full uncompressed data (header + decompressed)
            data = new Uint8Array(8 + decompressed.length);
            data.set(swfBytes.slice(0, 8));
            data.set(decompressed, 8);
        } else if (signature === "FWS") {
            data = swfBytes;
        } else {
            console.warn(`Unknown SWF signature: ${signature}`);
            return { frameRate, backgroundColor, width, height, useAS3, exportedSounds };
        }

        // Parse RECT structure (bit-packed)
        // RECT starts at byte 8, first 5 bits = Nbits
        const rectNBits = (data[8] >> 3) & 0x1F;

        // Helper to read bits from byte array
        const readBits = (startBit: number, numBits: number): number => {
            let value = 0;
            for (let i = 0; i < numBits; i++) {
                const bitPos = startBit + i;
                const byteIndex = 8 + Math.floor(bitPos / 8);
                const bitIndex = 7 - (bitPos % 8);
                if (data[byteIndex] & (1 << bitIndex)) {
                    value |= (1 << (numBits - 1 - i));
                }
            }
            // Handle signed values (twips can be negative)
            if (numBits > 0 && (value & (1 << (numBits - 1)))) {
                value -= (1 << numBits);
            }
            return value;
        };

        // Read RECT values: Xmin, Xmax, Ymin, Ymax (each rectNBits bits, starting after 5-bit Nbits field)
        const xMin = readBits(5, rectNBits);
        const xMax = readBits(5 + rectNBits, rectNBits);
        const yMin = readBits(5 + rectNBits * 2, rectNBits);
        const yMax = readBits(5 + rectNBits * 3, rectNBits);

        // Convert from twips to pixels (20 twips = 1 pixel)
        width = Math.round((xMax - xMin) / 20);
        height = Math.round((yMax - yMin) / 20);

        const rectTotalBits = 5 + rectNBits * 4;
        const rectBytes = Math.ceil(rectTotalBits / 8);
        const frameRateOffset = 8 + rectBytes;

        // FrameRate is 8.8 fixed-point (2 bytes, little-endian)
        // Low byte = fraction, high byte = integer
        frameRate = data[frameRateOffset + 1]; // Just use integer part

        // Parse SWF tags for metadata, sound exports, etc.
        const tagsOffset = frameRateOffset + 4; // +2 frameRate, +2 frameCount
        let offset = tagsOffset;
        const soundCharacterIds = new Set<number>();
        const exportAssets: { charId: number; name: string }[] = [];

        while (offset < data.length - 2) {
            const tagCodeAndLength = data[offset] | (data[offset + 1] << 8);
            const tagType = tagCodeAndLength >> 6;
            let tagLength = tagCodeAndLength & 0x3F;

            let headerSize = 2;
            if (tagLength === 0x3F) {
                tagLength = data[offset + 2] | (data[offset + 3] << 8) |
                           (data[offset + 4] << 16) | (data[offset + 5] << 24);
                headerSize = 6;
            }

            if (tagType === 69 && tagLength >= 4) {
                // FileAttributes tag: bit 3 of the flags byte = UseAS3
                const flags = data[offset + headerSize];
                useAS3 = (flags & 0x08) !== 0;
            }

            if (tagType === 9 && tagLength >= 3) {
                // SetBackgroundColor: RGB
                const r = data[offset + headerSize];
                const g = data[offset + headerSize + 1];
                const b = data[offset + headerSize + 2];
                backgroundColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
            }

            if (tagType === 14) {
                // DefineSound: character ID at first 2 bytes of tag data
                const soundId = data[offset + headerSize] | (data[offset + headerSize + 1] << 8);
                soundCharacterIds.add(soundId);
            }

            if (tagType === 56 && tagLength >= 2) {
                // ExportAssets: count (UI16), then pairs of (UI16 charId, string name)
                let eaOffset = offset + headerSize;
                const count = data[eaOffset] | (data[eaOffset + 1] << 8);
                eaOffset += 2;
                for (let ei = 0; ei < count; ei++) {
                    if (eaOffset + 2 > offset + headerSize + tagLength) break;
                    const charId = data[eaOffset] | (data[eaOffset + 1] << 8);
                    eaOffset += 2;
                    // Read null-terminated string
                    let name = "";
                    while (eaOffset < offset + headerSize + tagLength && data[eaOffset] !== 0) {
                        name += String.fromCharCode(data[eaOffset]);
                        eaOffset++;
                    }
                    eaOffset++; // skip null terminator
                    exportAssets.push({ charId, name });
                }
            }

            if (tagType === 0) break; // End tag
            offset += headerSize + tagLength;
        }

        // Build exported sounds list: ExportAssets entries whose charId is a DefineSound
        for (const ea of exportAssets) {
            if (soundCharacterIds.has(ea.charId)) {
                exportedSounds.push(ea.name);
            }
        }
    } catch (err) {
        console.error(`parseSwfMetadata error: ${err}`);
    }

    return { frameRate, backgroundColor, width, height, useAS3, exportedSounds };
}

/**
 * Splice a DoAction tag at the start of frame 1 of a game SWF that performs
 * the equivalent of:
 *
 *     if (typeof _root.__raflash == "undefined") {
 *         _root.createEmptyMovieClip("__raflash", 1048575);
 *         _root.__raflash.loadMovie(firmwareUrl);
 *     }
 *
 * Used by child-mode firmware to inject the AVM1 firmware as a child clip of
 * the game's _root. The injection runs before the game's own frame 1 actions
 * so by the time the game starts doing anything the firmware is already
 * being loaded into the child clip. The game itself remains the true _level0
 * root movie.
 *
 * The firmware URL is passed in (rather than hardcoded) so the caller can
 * match it to the game's effective domain — for sitelocked games served via
 * originUrl spoofing, the firmware MUST be loaded from the same domain as
 * the game or AS2's cross-domain security will block the firmware from
 * enumerating the game's tree (for-in returns 0 children, _parent is null,
 * etc.). RAEngine's HTTP proxy serves /avm1-firmware.swf regardless of the
 * Host header, so any domain works as long as the path matches.
 *
 * The idempotency guard is necessary because many AS2 games loop their
 * frame 1 (preloader → menu transitions, etc.); without it the createEmpty
 * + loadMovie would re-fire each loop and pull the firmware twice.
 *
 * If the input SWF is compressed (CWS) it is decompressed and re-emitted as
 * uncompressed FWS. The new tag is inserted immediately before the first
 * ShowFrame tag, and the FileLength header is updated.
 */
function injectFirmwareLoader(swfBytes: Uint8Array, firmwareUrl: string): Uint8Array {
    const sig = String.fromCharCode(swfBytes[0], swfBytes[1], swfBytes[2]);
    let data: Uint8Array;
    if (sig === "CWS") {
        const decompressed = pako.inflate(swfBytes.slice(8));
        data = new Uint8Array(8 + decompressed.length);
        data.set(swfBytes.slice(0, 8));
        data.set(decompressed, 8);
        data[0] = 0x46; // 'F' — convert CWS → FWS signature
    } else if (sig === "FWS") {
        data = new Uint8Array(swfBytes);
    } else {
        console.warn(`injectFirmwareLoader: unsupported signature ${sig}, returning unmodified`);
        return swfBytes;
    }

    // Skip RECT (variable width) + frameRate (2) + frameCount (2) to reach the tag stream
    const rectNBits = (data[8] >> 3) & 0x1F;
    const rectBytes = Math.ceil((5 + rectNBits * 4) / 8);
    const tagsOffset = 8 + rectBytes + 4;

    // Find the offset of the first ShowFrame tag (tag type 1)
    let offset = tagsOffset;
    let insertOffset = -1;
    while (offset < data.length - 2) {
        const tcl = data[offset] | (data[offset + 1] << 8);
        const tagType = tcl >> 6;
        let tagLength = tcl & 0x3F;
        let headerSize = 2;
        if (tagLength === 0x3F) {
            tagLength = data[offset + 2] | (data[offset + 3] << 8) |
                       (data[offset + 4] << 16) | (data[offset + 5] << 24);
            headerSize = 6;
        }
        if (tagType === 1) { insertOffset = offset; break; }
        if (tagType === 0) break;
        offset += headerSize + tagLength;
    }
    if (insertOffset === -1) {
        console.warn("injectFirmwareLoader: no ShowFrame tag found, returning unmodified");
        return swfBytes;
    }

    // ----- Build the action stream -----
    //
    // Hand-rolled AS2 bytecode patterned after MTASC's compilation of method
    // calls (verified against MTASC dumps in the prior POC). Push order for
    // a method call: args (REVERSE of call order — last arg first), then
    // num_args, then object name, then GetVariable, then method name, then
    // CallMethod, then Pop (discard return).
    //
    // Action opcodes used:
    //   0x96 ActionPush         — header is opcode + UI16 length, then values
    //   0x07 (in payload)       — int32 type tag, followed by 4 LE bytes
    //   0x00 (in payload)       — string type tag, followed by null-terminated bytes
    //   0x1C ActionGetVariable  — pop name string, push variable value
    //   0x4E ActionGetMember    — pop member name, pop object, push object[member]
    //   0x9D ActionIf           — pop boolean, branch by signed UI16 if true
    //   0x52 ActionCallMethod   — pop method name, pop object, pop num_args, pop args, call
    //   0x17 ActionPop          — discard top of stack
    //   0x00 ActionEndFlag      — terminate action stream

    const enc = new TextEncoder();
    const CHILD_NAME = "__raflash";
    const CHILD_DEPTH = 1048575;
    const urlBytes = enc.encode(firmwareUrl);
    const childNameBytes = enc.encode(CHILD_NAME);
    const rootBytes = enc.encode("_root");
    const createMethodBytes = enc.encode("createEmptyMovieClip");
    const loadMethodBytes = enc.encode("loadMovie");

    // Helpers to build push payloads piecewise
    const pushInt32 = (n: number, out: number[]) => {
        out.push(0x07);
        out.push(n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF);
    };
    const pushString = (b: Uint8Array, out: number[]) => {
        out.push(0x00);
        for (const x of b) out.push(x);
        out.push(0x00);
    };
    const writePushAction = (payload: number[], out: number[]) => {
        out.push(0x96);
        out.push(payload.length & 0xFF, (payload.length >>> 8) & 0xFF);
        for (const x of payload) out.push(x);
    };

    // Build the create+load body as a separate stream so we can compute its
    // byte length and use it as the ActionIf branch offset for the guard.
    const body: number[] = [];

    // ----- Call 1: _root.createEmptyMovieClip("__raflash", 1048575) -----
    {
        const payload: number[] = [];
        pushInt32(CHILD_DEPTH, payload);
        pushString(childNameBytes, payload);
        pushInt32(2, payload);
        pushString(rootBytes, payload);
        writePushAction(payload, body);
    }
    body.push(0x1C); // GetVariable: _root → MovieClip
    {
        const payload: number[] = [];
        pushString(createMethodBytes, payload);
        writePushAction(payload, body);
    }
    body.push(0x52); // CallMethod
    body.push(0x17); // Pop (discard returned MovieClip)

    // ----- Call 2: _root.__raflash.loadMovie(firmwareUrl) -----
    {
        const payload: number[] = [];
        pushString(urlBytes, payload);
        pushInt32(1, payload);
        pushString(rootBytes, payload);
        writePushAction(payload, body);
    }
    body.push(0x1C); // GetVariable: _root → MovieClip
    {
        const payload: number[] = [];
        pushString(childNameBytes, payload);
        writePushAction(payload, body);
    }
    body.push(0x4E); // GetMember: _root.__raflash → MovieClip
    {
        const payload: number[] = [];
        pushString(loadMethodBytes, payload);
        writePushAction(payload, body);
    }
    body.push(0x52); // CallMethod
    body.push(0x17); // Pop

    // ----- Idempotency guard wrapping the body -----
    //
    // Compute _root.__raflash, ActionIf branches when truthy (clip exists)
    // past the body. ActionGetMember pushes undefined when the member doesn't
    // exist, which AS1's ActionIf treats as false → fall through to body.
    const stream: number[] = [];
    {
        const payload: number[] = [];
        pushString(rootBytes, payload);
        writePushAction(payload, stream);
    }
    stream.push(0x1C); // GetVariable → _root
    {
        const payload: number[] = [];
        pushString(childNameBytes, payload);
        writePushAction(payload, stream);
    }
    stream.push(0x4E); // GetMember → _root.__raflash (or undefined)
    // ActionIf: opcode + UI16 length=2 + signed UI16 branch offset.
    // Offset is measured from the END of the ActionIf instruction. To skip
    // the body we branch by exactly body.length bytes.
    stream.push(0x9D);
    stream.push(0x02, 0x00);
    stream.push(body.length & 0xFF, (body.length >>> 8) & 0xFF);

    // Body: create+load (skipped if guard branched)
    for (const x of body) stream.push(x);

    stream.push(0x00); // ActionEndFlag

    const tagContent = new Uint8Array(stream);

    // ----- Wrap in a DoAction (tag type 12) tag header -----
    let inserted: Uint8Array;
    if (tagContent.length < 0x3F) {
        const tagCodeAndLength = (12 << 6) | tagContent.length;
        inserted = new Uint8Array(2 + tagContent.length);
        inserted[0] = tagCodeAndLength & 0xFF;
        inserted[1] = (tagCodeAndLength >> 8) & 0xFF;
        inserted.set(tagContent, 2);
    } else {
        // Extended header: short tag = (12 << 6) | 0x3F, then UI32 length
        const shortTag = (12 << 6) | 0x3F;
        inserted = new Uint8Array(6 + tagContent.length);
        inserted[0] = shortTag & 0xFF;
        inserted[1] = (shortTag >> 8) & 0xFF;
        inserted[2] = tagContent.length & 0xFF;
        inserted[3] = (tagContent.length >> 8) & 0xFF;
        inserted[4] = (tagContent.length >> 16) & 0xFF;
        inserted[5] = (tagContent.length >> 24) & 0xFF;
        inserted.set(tagContent, 6);
    }

    // Splice into the SWF
    const result = new Uint8Array(data.length + inserted.length);
    result.set(data.subarray(0, insertOffset), 0);
    result.set(inserted, insertOffset);
    result.set(data.subarray(insertOffset), insertOffset + inserted.length);

    // Update FileLength header (bytes 4..7, UI32 LE)
    const newLen = result.length;
    result[4] = newLen & 0xFF;
    result[5] = (newLen >> 8) & 0xFF;
    result[6] = (newLen >> 16) & 0xFF;
    result[7] = (newLen >> 24) & 0xFF;

    return result;
}

// Application state
enum AppState {
    FILE_PICKER,
    GAME_RUNNING,
}

let appState = AppState.FILE_PICKER;
let selectedGamePath: string | null = null;
let gameWindowWidth = 800;  // Will be updated from game SWF metadata
let gameWindowHeight = 600; // Will be updated from game SWF metadata
let fileSelectedResolver: ((result: { gamePath: string; user: string }) => void) | null = null;
let selectedUserName: string | null = null;
let httpServer: Deno.HttpServer | null = null;

// Flash socket connection and communication
let firmwareWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
let firmwareConnected = false;
let firmwareMessageBuffer = "";
const pendingRequests = new Map<string, (response: Record<string, unknown>) => void>();
let requestIdCounter = 0;

// Connected devtools WebSocket clients
const devtoolsClients: Set<WebSocket> = new Set();

// Map watcherId to the socket that started it (for routing watchResults)
const watcherSockets = new Map<string, WebSocket>();


// Window-specific params (for popup windows like asset-editor)
const windowParams = new Map<number, Record<string, unknown>>();

// Flash Player window management
let flashPlayerPid: number | null = null;
let flashProcess: Deno.ChildProcess | null = null;

// Rich Presence title updates
let lastRichPresenceTime = 0;
let richPresenceCheckInterval: number | null = null;

/**
 * Reset all game-specific state between sessions.
 * Called after a game closes before showing the file picker again.
 */
function resetGameState(): void {
    firmwareWriter = null;
    firmwareConnected = false;
    pendingRequests.clear();
    requestIdCounter = 0;
    watcherSockets.clear();
    windowParams.clear();
    flashPlayerPid = null;
    flashProcess = null;
    lastRichPresenceTime = 0;
    selectedGamePath = null;
    selectedUserName = null;
    appState = AppState.FILE_PICKER;
    AppData.data = { assets: [], codeNotes: [], gameConfig: { title: '', originUrl: '', badgeImage: '' } };
    AppData.gamePath = null;
    AppData.stateFilePath = null;
    AppData.gameHash = null;
    UserProfile.reset();
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
    return `req_${++requestIdCounter}_${Date.now()}`;
}

/**
 * Send a command to the firmware and wait for response
 */
async function sendToFirmware(command: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!firmwareWriter || !firmwareConnected) {
        return { success: false, error: "Firmware not connected" };
    }

    const id = generateRequestId();
    const message = JSON.stringify(["REQUEST", id, { command, params }]) + avmConfig.messageTerminator;

    return new Promise((resolve) => {
        // Set up timeout
        const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            resolve({ success: false, error: "Request timed out" });
        }, 30000);

        // Store resolver
        pendingRequests.set(id, (response) => {
            clearTimeout(timeout);
            pendingRequests.delete(id);
            resolve(response);
        });

        // Send request
        const encoder = new TextEncoder();
        firmwareWriter!.write(encoder.encode(message)).catch(() => {
            clearTimeout(timeout);
            pendingRequests.delete(id);
            resolve({ success: false, error: "Failed to send to firmware" });
        });
    });
}

/**
 * Send a message to a specific devtools client
 */
function sendToDevtools(client: WebSocket, type: string, data: Record<string, unknown> | Diff): void {
    if (client.readyState === WebSocket.OPEN) {
        try {
            client.send(JSON.stringify(["EVENT", type, data]) + "\n");
        } catch (e) {
            console.error("Failed to send to devtools client:", e);
        }
    }
}

/**
 * Broadcast a message to all connected devtools clients, optionally excluding one
 */
function broadcastToDevtools(type: string, data: Record<string, unknown> | Diff, excludeClient?: WebSocket): void {
    const message = JSON.stringify(["EVENT", type, data]) + "\n";
    for (const client of devtoolsClients) {
        if (client === excludeClient) continue;
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch {
                // Client disconnected
            }
        }
    }
}

/**
 * Broadcast a log event to any open Event Log windows
 */
function emitLog(source: string, level: string, message: string): void {
    broadcastToDevtools("logEvent", { source, level, message, timestamp: Date.now() });
}

/**
 * Open the devtools menu window
 */
async function openDevtoolsMenu(): Promise<void> {
    const windowId = Math.floor(Math.random() * 0xFFFFFF);
    await HTMLWindow.create("menu.html", 300, 600, windowId, undefined, 0, 0);
}

/**
 * Update Flash Player window title with Rich Presence
 */
function updateFlashPlayerTitle(richPresence: string): void {
    if (!flashPlayerPid) return;
    const title = richPresence ? `RAFlash - ${richPresence}` : "RAFlash";
    WindowManager.setWindowTitle(flashPlayerPid, title);
}

/**
 * Start the HTTP server for file picker, devtools UI, and WebSocket.
 * Retries on port conflict (e.g. after self-update, old instance may still be releasing ports).
 */
async function startHttpServer() {
    for (let attempt = 0; ; attempt++) {
        try {
            return startHttpServerInner();
        } catch (e) {
            if (attempt >= 10) throw e;
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

function startHttpServerInner() {
    httpServer = Deno.serve(
        {
            port: HTTP_PORT,
            onListen() {},
        },
        async (req: Request): Promise<Response> => {
            const url = new URL(req.url);

            // WebSocket upgrade
            if (url.pathname === "/ws") {
                const { socket, response } = Deno.upgradeWebSocket(req);

                socket.onopen = () => {
                    // Register as devtools client
                    devtoolsClients.add(socket);

                    // Send initial setup
                    const setupData: Record<string, unknown> = {
                        state: appState === AppState.GAME_RUNNING ? "game" : "picker",
                        appData: AppData.data,
                    };
                    socket.send(JSON.stringify(["SETUP", setupData]) + "\n");
                };

                socket.onclose = () => {
                    devtoolsClients.delete(socket);
                };

                socket.onmessage = async (event) => {
                    const segments = event.data.split("\n");
                    for (const segment of segments) {
                        if (!segment) continue;
                        try {
                            const data = JSON.parse(segment);
                            if (data[0] === "SETUP") {
                                continue;
                            }
                            if (data[0] === "REQUEST") {
                                const [, id, message] = data;
                                const response = await handleApiRequest(message, socket);
                                if (response && response.success === false) {
                                    emitLog("engine", "error", `Command "${message?.command}" failed: ${response.error || "unknown"}`);
                                }
                                socket.send(JSON.stringify(["RESPONSE", id, response]) + "\n");
                            }
                        } catch (e) {
                            console.error("WebSocket message error:", e);
                        }
                    }
                };

                return response;
            }

            // Serve files
            try {
                // Special handling for firmware SWF - optionally patch with game settings
                if (avmConfig && url.pathname === avmConfig.firmwareUrl && selectedGamePath) {
                    if (avmConfig.patchFirmware) {
                        const gameSwfBuffer = await Deno.readFile(selectedGamePath);
                        const gameMetadata = parseSwfMetadata(gameSwfBuffer);
                        const firmwareBytes = await Deno.readFile(avmConfig.firmwareSwf);
                        const patchedFirmware = patchFirmwareSwf(
                            firmwareBytes,
                            gameMetadata.frameRate,
                            gameMetadata.backgroundColor,
                            gameMetadata.width,
                            gameMetadata.height,
                            swfHidesMenuBar(gameSwfBuffer)
                        );
                        return new Response(new Uint8Array(patchedFirmware) as BodyInit, {
                            status: 200,
                            headers: { "Content-Type": "application/x-shockwave-flash" },
                        });
                    } else {
                        const firmwareBytes = await Deno.readFile(avmConfig.firmwareSwf);
                        return new Response(firmwareBytes, {
                            status: 200,
                            headers: { "Content-Type": "application/x-shockwave-flash" },
                        });
                    }
                }

                // Serve inner AVM1 firmware (loaded by AVM1Wrapper in parent
                // mode, or by injected loader bytecode in child mode).
                if (url.pathname === "/avm1-firmware.swf" && avmConfig?.innerFirmwareSwf && selectedGamePath) {
                    if (resolveFirmwareMode() === "child") {
                        // Child mode: serve unpatched. The firmware doesn't own
                        // the player chrome, so dimension/framerate patching
                        // would just stomp on the game's stage.
                        const firmwareBytes = await Deno.readFile(avmConfig.innerFirmwareSwf);
                        return new Response(firmwareBytes, {
                            status: 200,
                            headers: { "Content-Type": "application/x-shockwave-flash" },
                        });
                    }
                    const gameSwfBuffer = await Deno.readFile(selectedGamePath);
                    const gameMetadata = parseSwfMetadata(gameSwfBuffer);
                    const firmwareBytes = await Deno.readFile(avmConfig.innerFirmwareSwf);
                    const patchedFirmware = patchFirmwareSwf(
                        firmwareBytes,
                        gameMetadata.frameRate,
                        gameMetadata.backgroundColor,
                        gameMetadata.width,
                        gameMetadata.height,
                        swfHidesMenuBar(gameSwfBuffer)
                    );
                    return new Response(new Uint8Array(patchedFirmware) as BodyInit, {
                        status: 200,
                        headers: { "Content-Type": "application/x-shockwave-flash" },
                    });
                }

                // Serve favicon from assets directory
                if (url.pathname === "/favicon.png") {
                    const icon = await Deno.readFile("assets/icon.png");
                    return new Response(icon, {
                        status: 200,
                        headers: { "Content-Type": "image/png" },
                    });
                }

                let filePath = "";

                if (avmConfig && url.pathname === avmConfig.firmwareUrl) {
                    filePath = avmConfig.firmwareSwf;
                } else if (url.pathname === "/game.swf" && selectedGamePath) {
                    filePath = selectedGamePath;
                } else {
                    // Serve from assets directory for UI
                    filePath = join("internals", "assets", url.pathname.substring(1));
                }

                const rawFile = await Deno.readFile(filePath);
                let file: Uint8Array<ArrayBuffer> = rawFile;
                if (filePath === selectedGamePath && resolveFirmwareMode() === "child") {
                    // Build the firmware URL using the same domain the game is
                    // served from (sitelock-spoofed origin if applicable) so the
                    // firmware ends up in the same security sandbox as the game
                    // and can enumerate its tree without cross-domain blocks.
                    const originUrl = AppData.data.gameConfig.originUrl;
                    const fwDomain = originUrl ? new URL(originUrl).host : RAFLASH_DOMAIN;
                    const fwUrl = `http://${fwDomain}/avm1-firmware.swf`;
                    file = injectFirmwareLoader(rawFile, fwUrl) as Uint8Array<ArrayBuffer>;
                }
                const extension = filePath.split(".").pop() || "";
                const mimeTypes: Record<string, string> = {
                    html: "text/html",
                    css: "text/css",
                    js: "application/javascript",
                    swf: "application/x-shockwave-flash",
                    json: "application/json",
                    png: "image/png",
                    jpg: "image/jpeg",
                };
                const contentType = mimeTypes[extension] || "application/octet-stream";

                return new Response(file, {
                    status: 200,
                    headers: { "Content-Type": contentType },
                });
            } catch (error) {
                if (error instanceof Deno.errors.NotFound) {
                    return new Response("File not found", { status: 404 });
                }
                console.error("HTTP error:", error);
                return new Response("Internal Server Error", { status: 500 });
            }
        }
    );
}

/**
 * Handle API requests from file picker and devtools
 */
async function handleApiRequest(
    input: { command: string; params: Record<string, unknown> },
    senderSocket: WebSocket
): Promise<Record<string, unknown>> {
    switch (input.command) {
        // File picker commands
        case "getDirectoryInfo": {
            return {
                success: true,
                params: { currentDirectory: Deno.cwd().split(SEPARATOR) },
            };
        }
        case "readDirectory": {
            const path = String(input.params.path || ".");
            try {
                const entries = Array.from(Deno.readDirSync(path)).map((entry: Deno.DirEntry) => ({
                    name: entry.name,
                    type: entry.isDirectory ? "directory" : "file",
                }));
                return { success: true, params: entries };
            } catch (e) {
                console.error("readDirectory error:", e);
                return { success: false, error: "Failed to read directory" };
            }
        }
        case "selectFile": {
            const path = String(input.params.path);
            const user = String(input.params.user || "");
            selectedGamePath = path;
            emitLog("engine", "info", `Game selected: ${path}`);
            if (fileSelectedResolver) {
                fileSelectedResolver({ gamePath: path, user });
            }
            return { success: true };
        }
        case "listUsers": {
            const users = await UserProfile.listUsers();
            return { success: true, params: { users } };
        }
        case "createUser": {
            const name = String(input.params.name || "");
            await UserProfile.createUser(name);
            return { success: true };
        }
        case "getSettings": {
            return { success: true, params: { ...settings, version: VERSION } };
        }
        case "saveSettings": {
            const oldBenchmarking = settings.benchmarkingEnabled;
            await saveSettings(input.params.settings as Settings);
            if (settings.benchmarkingEnabled !== oldBenchmarking) {
                sendToFirmware("setRuntimeSetting", {
                    key: "benchmarkingEnabled",
                    value: settings.benchmarkingEnabled
                }).catch(() => {});
            }
            return { success: true };
        }
        case "syncAssets": {
            try {
                // List all files in the RAFlash-Assets repo's games/ directory
                const res = await fetch("https://api.github.com/repos/DevRubicate/RAFlash-Assets/contents/games");
                if (!res.ok) return { success: false, error: "Failed to fetch asset list" };
                const files = await res.json() as Array<{ name: string; download_url: string }>;
                const jsonFiles = files.filter(f => f.name.endsWith(".json"));

                await Deno.mkdir("RACache/games", { recursive: true });
                let downloaded = 0;
                for (const file of jsonFiles) {
                    const dlRes = await fetch(file.download_url);
                    if (!dlRes.ok) continue;
                    const content = await dlRes.text();
                    await Deno.writeTextFile(join("RACache", "games", file.name), content);
                    downloaded++;
                }
                return { success: true, params: { downloaded, total: jsonFiles.length } };
            } catch {
                return { success: false, error: "Failed to sync assets" };
            }
        }
        case "checkForUpdates": {
            try {
                const res = await fetch("https://api.github.com/repos/DevRubicate/RAFlash/releases/latest");
                if (!res.ok) return { success: false, error: "Failed to check for updates" };
                const release = await res.json();
                const latest = release.tag_name.replace(/^v/, "");
                const isNewer = latest !== VERSION;
                const asset = release.assets?.find((a: Record<string, unknown>) => (a.name as string).endsWith(".zip"));
                return {
                    success: true,
                    params: {
                        currentVersion: VERSION,
                        latestVersion: latest,
                        updateAvailable: isNewer,
                        downloadUrl: asset?.browser_download_url || null,
                        releaseNotes: release.body || "",
                        releaseName: release.name || "",
                    }
                };
            } catch {
                return { success: false, error: "Failed to check for updates" };
            }
        }
        case "applyUpdate": {
            try {
                const url = String(input.params.downloadUrl);
                const res = await fetch(url);
                if (!res.ok) return { success: false, error: "Download failed" };
                const zipData = new Uint8Array(await res.arrayBuffer());
                const exePath = Deno.execPath();
                const installDir = exePath.replace(/[/\\][^/\\]+$/, "");

                // Extract zip in memory
                const files = unzipSync(zipData);

                // Known app paths to update (everything else is left untouched)
                const appPaths = ["vendor/", "firmware/", "internals/", "assets/"];

                for (const [rawPath, content] of Object.entries(files)) {
                    // Normalize backslashes and strip the top-level "RAFlash/" folder
                    const normalized = rawPath.replace(/\\/g, "/");
                    const relative = normalized.replace(/^RAFlash\//, "");
                    if (!relative) continue;

                    // Only copy known app paths
                    const isAppFile = relative === "RAFlash.exe" || appPaths.some(p => relative.startsWith(p));
                    if (!isAppFile) continue;

                    const destPath = join(installDir, relative);

                    // Directory entries end with /
                    if (normalized.endsWith("/")) {
                        await Deno.mkdir(destPath, { recursive: true });
                        continue;
                    }

                    // For the exe: can't overwrite while running, so rename current one out
                    if (relative === "RAFlash.exe") {
                        try { await Deno.remove(join(installDir, "RAFlash.exe.old")); } catch { /* */ }
                        await Deno.rename(exePath, join(installDir, "RAFlash.exe.old"));
                    }

                    await Deno.mkdir(destPath.replace(/[/\\][^/\\]+$/, ""), { recursive: true });
                    await Deno.writeFile(destPath, content);
                }

                // Relaunch via bat — cmd window flashes briefly, but this is the most reliable approach
                const newExe = join(installDir, "RAFlash.exe");
                const batPath = join(installDir, "relaunch.bat");
                await Deno.writeTextFile(batPath, `@echo off\r\ncd /d "${installDir}"\r\nstart "" "${newExe}"\r\ndel "%~f0"\r\n`);
                new Deno.Command("cmd.exe", {
                    args: ["/c", batPath],
                    cwd: installDir,
                    stdout: "null", stderr: "null", stdin: "null",
                }).spawn();

                // Close all browser windows immediately so the user isn't staring at a stale UI
                for (const client of devtoolsClients) {
                    try { client.close(); } catch { /* */ }
                }

                setTimeout(() => Deno.exit(0), 3000);
                return { success: true };
            } catch (e) {
                return { success: false, error: `Update failed: ${e}` };
            }
        }

        // Devtools commands - forward to firmware
        case "evaluate": {
            const rawInput = String(input.params.input || "");
            const compiled = compileFormula(rawInput);
            const response = await sendToFirmware("evaluate", { formula: compiled });
            return { success: response.success, params: response };
        }
        case "evaluateMultiple": {
            // Compile all input strings to bytecode
            const inputs = (input.params.inputs || []) as string[];
            const compiled = inputs.map(inp => compileFormula(inp || ""));
            const response = await sendToFirmware("evaluateMultiple", { formulas: compiled });
            return { success: response.success, params: response };
        }
        case "getRichPresenceResult": {
            const response = await sendToFirmware("getRichPresenceResult", {
                assetId: input.params.assetId
            });
            return { success: response.success, params: response };
        }
        case "searchTargetForValue": {
            const pathString = String(input.params.path || "");
            const compiledPath = pathString ? compileFormula(pathString) : null;
            const response = await sendToFirmware("searchTargetForValue", {
                value: input.params.value,
                pathFormula: compiledPath,
                pathString: pathString,
                searchMode: input.params.searchMode || "value"
            });
            // Wrap firmware response in params to match frontend expectations
            return { success: response.success, params: response };
        }
        case "editData": {
            // Apply changes and trigger watchers (e.g., formula compilation)
            if (input.params) {
                const incomingDiff = input.params as Diff;
                const { fullDiff, derivedDiff } = JSONDiff.processIncomingDiff(AppData.data, incomingDiff);

                // Update _modified flags for affected saved assets and track changes
                const assets = AppData.data.assets;
                const modifiedFlagChanges: Array<[string, unknown]> = [];
                for (let i = 0; i < assets.length; i++) {
                    const asset = assets[i];
                    if (asset._saved) {
                        const oldModified = asset._modified;
                        AppData.updateModifiedFlag(asset);
                        if (asset._modified !== oldModified) {
                            modifiedFlagChanges.push([`assets/${i}/_modified`, asset._modified]);
                        }
                    }
                }

                // Broadcast fullDiff to OTHER devtools clients (not the sender) - do this FIRST for instant UI updates
                broadcastToDevtools("editData", fullDiff, senderSocket);

                // Forward the full diff (including watcher-generated changes) to firmware (don't await - let it process async)
                sendToFirmware("editData", { changes: fullDiff });

                // Broadcast _modified flag changes to ALL clients (including sender)
                if (modifiedFlagChanges.length > 0) {
                    broadcastToDevtools("editData", { edited: modifiedFlagChanges });
                }

                // Send derivedDiff (watcher changes only) back to the sender
                if (derivedDiff.edited && derivedDiff.edited.length > 0) {
                    sendToDevtools(senderSocket, "editData", derivedDiff);
                }

                // Auto-save for Code Notes and Game Config
                const hasCodeNotesChanges = incomingDiff.edited?.some(
                    ([path]) => path.startsWith('codeNotes')
                );
                const hasGameConfigChanges = incomingDiff.edited?.some(
                    ([path]) => path.startsWith('gameConfig')
                );
                if (hasCodeNotesChanges || hasGameConfigChanges) {
                    await AppData.saveData();
                }

                // NOTE: Asset changes are NOT auto-saved. Use saveAssets command for explicit saves.

                return { success: true };
            }

            return { success: true };
        }
        case "setup": {
            // Devtools requesting current app data
            const currentData = AppData.data;
            const windowId = input.params.windowId as number;
            const storedParams = windowParams.get(windowId) || {};

            return {
                success: true,
                params: {
                    data: currentData,
                    params: storedParams,
                },
            };
        }
        case "initializeData": {
            // Send current app data to firmware
            const originUrl = AppData.data.gameConfig.originUrl;
            const gameUrl = originUrl ? originUrl + "/game.swf" : null;
            const response = await sendToFirmware("setup", { data: AppData.data, gameUrl, settings });
            return response;
        }
        case "getData": {
            const response = await sendToFirmware("getData", {});
            return response;
        }
        case "ping": {
            const response = await sendToFirmware("ping", {});
            return response;
        }
        case "showToast": {
            const response = await sendToFirmware("showToast", {
                title: input.params.title,
                description: input.params.description,
                label: input.params.label,
                align: input.params.align,
            });
            return response;
        }
        case "showMeasure": {
            const response = await sendToFirmware("showMeasure", {
                title: input.params.title || "",
                description: input.params.description || "",
                progress: input.params.progress || "1/5",
                imageUrl: input.params.imageUrl || "",
            });
            return response;
        }

        // Window management
        case "openWindow": {
            const windowName = String(input.params.name);
            const width = Number(input.params.width) || 800;
            const height = Number(input.params.height) || 600;
            const windowId = Math.floor(Math.random() * 0xFFFFFF);
            const parentWindowId = input.params.parentWindowId as number | undefined;
            await HTMLWindow.create(`${windowName}.html`, width, height, windowId, parentWindowId);
            return { success: true };
        }
        case "showPopup": {
            const url = String(input.params.url);
            const width = Number(input.params.width) || 800;
            const height = Number(input.params.height) || 600;
            const windowId = Math.floor(Math.random() * 0xFFFFFF);
            const parentWindowId = input.params.parentWindowId as number | undefined;

            // Store params for this window (e.g., selectedAssetId for asset-editor)
            if (input.params.params) {
                const params = input.params.params;
                windowParams.set(windowId, (typeof params === 'object' && params !== null) ? params as Record<string, unknown> : {});
            }

            // Extract just the HTML filename from the URL path
            const htmlFile = url.split("/").pop() || url;
            await HTMLWindow.create(htmlFile, width, height, windowId, parentWindowId);

            // Event Log survives between games
            if (htmlFile === "event-log.html") {
                const win = HTMLWindow.instances.find(w => w.windowId === windowId);
                if (win) win.persistent = true;
            }
            return { success: true };
        }

        // Asset persistence commands
        case "saveAssets": {
            const ids = input.params?.ids as number[] | undefined;
            const savedIds = await AppData.saveAssets(ids);

            // Broadcast updated _saved/_modified flags to all clients
            const assets = AppData.data.assets;
            const flagUpdates: Array<[string, unknown]> = [];
            for (let i = 0; i < assets.length; i++) {
                const asset = assets[i];
                if (savedIds.includes(asset.id)) {
                    flagUpdates.push([`assets/${i}[]/_saved`, asset._saved]);
                    flagUpdates.push([`assets/${i}[]/_modified`, asset._modified]);
                }
            }

            if (flagUpdates.length > 0) {
                const diff = { edited: flagUpdates };
                await sendToFirmware("editData", { changes: diff });
                broadcastToDevtools("editData", diff);
            }

            return { success: true, params: { savedIds } };
        }

        case "resetAssets": {
            const ids = input.params?.ids as number[];
            if (!ids || ids.length === 0) {
                return { success: false, error: "No asset IDs provided" };
            }

            const { resetIds, restoredAssets } = await AppData.resetAssets(ids);

            if (resetIds.length > 0) {
                // Build diff to broadcast the restored assets
                const assets = AppData.data.assets;
                const resetDiff: Array<[string, unknown]> = [];

                for (const restoredAsset of restoredAssets) {
                    const idx = assets.findIndex(a => a.id === restoredAsset.id);
                    if (idx !== -1) {
                        resetDiff.push([`assets/${idx}[]`, restoredAsset]);
                    }
                }

                if (resetDiff.length > 0) {
                    const diff = { edited: resetDiff };
                    await sendToFirmware("editData", { changes: diff });
                    broadcastToDevtools("editData", diff);
                }
            }

            return { success: true, params: { resetIds } };
        }

        case "deleteAssets": {
            const ids = input.params?.ids as number[];
            if (!ids || ids.length === 0) {
                return { success: false, error: "No asset IDs provided" };
            }

            const { deletedIds } = await AppData.deleteAssets(ids);

            if (deletedIds.length > 0) {
                // Broadcast the deletion - send the new assets array
                const diff: Diff = { edited: [["assets", AppData.data.assets]] };
                await sendToFirmware("editData", { changes: diff });
                broadcastToDevtools("editData", diff);
            }

            return { success: true, params: { deletedIds } };
        }

        case "setRuntimeSetting": {
            // Forward runtime settings to firmware (keepActive, processingActive)
            await sendToFirmware("setRuntimeSetting", input.params);
            return { success: true };
        }

        case "setValue": {
            const fullPath = String(input.params.path || "");
            const value = String(input.params.value ?? "");
            // Split path into parent path + property name
            const lastDot = fullPath.lastIndexOf(".");
            const lastBracket = fullPath.lastIndexOf("[");
            const splitPos = Math.max(lastDot, lastBracket);
            if (splitPos < 0) return { success: false, error: "Invalid path" };
            let parentPath: string;
            let property: string;
            if (lastBracket > lastDot) {
                parentPath = fullPath.substring(0, lastBracket);
                property = fullPath.substring(lastBracket + 1, fullPath.length - 1);
            } else {
                parentPath = fullPath.substring(0, lastDot);
                property = fullPath.substring(lastDot + 1);
            }
            // Empty parent path = implicit stage root (e.g. ".dayNow" → set on stage)
            if (parentPath === "") parentPath = "stage";
            const compiled = compileFormula(parentPath);
            const response = await sendToFirmware("setValue", {
                pathFormula: compiled, property, value
            });
            return response;
        }

        case "resetGame": {
            const originUrl = AppData.data.gameConfig.originUrl;
            const gameUrl = originUrl ? originUrl + "/game.swf" : null;
            emitLog("engine", "info", "Resetting game...");

            // Clear accumulated runtime state on every asset so the new run
            // starts from a clean slate. Without this, achievements with
            // partially-accumulated hits would falsely trigger on frame 1 of
            // the fresh game when their conditions evaluate against the old
            // hit counts.
            const resetEdits: Array<[string, unknown]> = [];
            const assets = AppData.data.assets;
            for (let i = 0; i < assets.length; i++) {
                const asset = assets[i];
                if (asset._primed) {
                    asset._primed = false;
                    resetEdits.push([`assets/${i}/_primed`, false]);
                }
                const groups = asset.groups ?? [];
                for (let g = 0; g < groups.length; g++) {
                    const reqs = groups[g].requirements ?? [];
                    for (let r = 0; r < reqs.length; r++) {
                        const req = reqs[r];
                        if (req && (req.hits ?? 0) !== 0) {
                            req.hits = 0;
                            resetEdits.push([`assets/${i}/groups/${g}/requirements/${r}/hits`, 0]);
                        }
                    }
                }
            }

            if (resetEdits.length > 0) {
                const resetDiff: Diff = { edited: resetEdits };
                // Push to devtools clients so the editor reflects the cleared state
                broadcastToDevtools("editData", resetDiff);
                // Push to firmware so its in-memory copy matches (matters for
                // parent mode where the firmware persists across the reset; in
                // child mode the firmware is destroyed and resyncs from engine
                // on reconnect anyway, but sending is harmless).
                sendToFirmware("editData", { changes: resetDiff }).catch(() => {});
            }

            const response = await sendToFirmware("resetGame", { gameUrl });
            emitLog("engine", "info", "Game reset complete");
            return response;
        }

        // Memory Watch commands
        case "startWatch": {
            const watcherId = String(input.params.watcherId);
            const formula = String(input.params.formula || "");
            const compiled = compileFormula(formula);

            // Track which socket started this watcher
            watcherSockets.set(watcherId, senderSocket);

            // Forward to firmware
            await sendToFirmware("startWatch", { watcherId, bytecode: compiled });
            return { success: true };
        }

        case "stopWatch": {
            const watcherId = String(input.params.watcherId);

            // Remove socket tracking
            watcherSockets.delete(watcherId);

            // Forward to firmware
            await sendToFirmware("stopWatch", { watcherId });
            return { success: true };
        }

        default:
            return { success: false, error: `Unknown command: ${input.command}` };
    }
}

/**
 * Show file picker and wait for selection.
 * Returns null if the user closes the window without selecting a file.
 */
async function showFilePicker(): Promise<{ gamePath: string; user: string } | null> {
    const windowId = Math.floor(Math.random() * 0xFFFFFF);
    await HTMLWindow.create("file-picker.html", 800, 500, windowId);

    const result = await Promise.race([
        new Promise<{ gamePath: string; user: string }>((resolve) => { fileSelectedResolver = resolve; }),
        HTMLWindow.waitForAnyClose().then(() => null)
    ]);

    // Close just the file picker, not other windows (e.g. Event Log)
    const pickerWindow = HTMLWindow.instances.find(w => w.windowId === windowId);
    if (pickerWindow) await pickerWindow.close();

    return result;
}

/**
 * Start the Flash socket server (XMLSocket for AVM1, Socket for AVM2)
 */
async function startFlashServer(): Promise<void> {
    const listener = Deno.listen({ port: FLASH_PORT });

    // Flash socket policy file
    const POLICY_FILE = '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\0';

    // Serve policy on port 843 (Flash's default policy port) to avoid ~3s timeout
    try {
        const policyListener = Deno.listen({ port: 843 });
        const encoder = new TextEncoder();
        (async () => {
            for await (const conn of policyListener) {
                try {
                    const writer = conn.writable.getWriter();
                    await writer.write(encoder.encode(POLICY_FILE));
                    writer.releaseLock();
                    conn.close();
                } catch { /* connection closed before write */ }
            }
        })();
    } catch {
        // Port 843 unavailable (e.g. needs elevated privileges) — Flash falls back to target port
    }

    for await (const conn of listener) {
        handleFlashConnection(conn, POLICY_FILE);
    }
}

/**
 * Handle a Flash connection
 */
async function handleFlashConnection(conn: Deno.Conn, policyFile: string): Promise<void> {
    // Disable Nagle's algorithm for immediate message delivery
    if ("setNoDelay" in conn) {
        (conn as Deno.TcpConn).setNoDelay(true);
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let httpBuffer = "";
    let isXMLSocket = false;

    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();

    try {
        const { done, value } = await reader.read();
        if (done) return;

        httpBuffer = decoder.decode(value);
        // HTTP request for firmware SWF
        if (httpBuffer.startsWith(`GET ${avmConfig.firmwareUrl}`)) {
            let swfData: Uint8Array;
            if (avmConfig.patchFirmware) {
                const gameSwfBuffer = await Deno.readFile(selectedGamePath!);
                const gameMetadata = parseSwfMetadata(gameSwfBuffer);
                const firmwareBytes = await Deno.readFile(avmConfig.firmwareSwf);
                swfData = patchFirmwareSwf(firmwareBytes, gameMetadata.frameRate, gameMetadata.backgroundColor, gameMetadata.width, gameMetadata.height, swfHidesMenuBar(gameSwfBuffer));
            } else {
                swfData = await Deno.readFile(avmConfig.firmwareSwf);
            }

            const response = [
                "HTTP/1.1 200 OK",
                "Content-Type: application/x-shockwave-flash",
                `Content-Length: ${swfData.length}`,
                "Connection: close",
                "",
                "",
            ].join("\r\n");
            await writer.write(encoder.encode(response));
            await writer.write(swfData);
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return;
        }

        // HTTP request for inner AVM1 firmware (loaded by AVM1Wrapper in
        // parent mode, or by injected loader bytecode in child mode)
        if (httpBuffer.startsWith("GET /avm1-firmware.swf") && avmConfig.innerFirmwareSwf) {
            let swfData: Uint8Array;
            if (resolveFirmwareMode() === "child") {
                // Child mode: serve unpatched (firmware doesn't own player chrome)
                swfData = await Deno.readFile(avmConfig.innerFirmwareSwf);
            } else {
                const gameSwfBuffer = await Deno.readFile(selectedGamePath!);
                const gameMetadata = parseSwfMetadata(gameSwfBuffer);
                const firmwareBytes = await Deno.readFile(avmConfig.innerFirmwareSwf);
                swfData = patchFirmwareSwf(firmwareBytes, gameMetadata.frameRate, gameMetadata.backgroundColor, gameMetadata.width, gameMetadata.height, swfHidesMenuBar(gameSwfBuffer));
            }

            const response = [
                "HTTP/1.1 200 OK",
                "Content-Type: application/x-shockwave-flash",
                `Content-Length: ${swfData.length}`,
                "Connection: close",
                "",
                "",
            ].join("\r\n");
            await writer.write(encoder.encode(response));
            await writer.write(swfData);
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return;
        }

        // HTTP request for game SWF — inject firmware loader bytecode in
        // child mode so the firmware loads as a child of the game's _root.
        if (httpBuffer.startsWith("GET /game.swf")) {
            const rawSwfData = await Deno.readFile(selectedGamePath!);
            let swfData: Uint8Array = rawSwfData;
            if (resolveFirmwareMode() === "child") {
                const rsOriginUrl = AppData.data.gameConfig.originUrl;
                const rsDomain = rsOriginUrl ? new URL(rsOriginUrl).host : RAFLASH_DOMAIN;
                const rsFirmwareUrl = `http://${rsDomain}/avm1-firmware.swf`;
                swfData = injectFirmwareLoader(rawSwfData, rsFirmwareUrl);
            }
            const response = [
                "HTTP/1.1 200 OK",
                "Content-Type: application/x-shockwave-flash",
                `Content-Length: ${swfData.length}`,
                "Connection: close",
                "",
                "",
            ].join("\r\n");
            await writer.write(encoder.encode(response));
            await writer.write(swfData);
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return;
        }

        // HTTP request for asset badge image
        if (httpBuffer.startsWith("GET /asset-image/")) {
            const match = httpBuffer.match(/GET \/asset-image\/(-?\d+)/);
            if (match) {
                const assetId = parseInt(match[1], 10);
                const assets = AppData.data.assets as Array<Record<string, unknown>>;
                const asset = assets.find(a => a.id === assetId);

                if (asset?.badgeImage) {
                    // badgeImage is "data:image/png;base64,..." or "data:image/jpeg;base64,..."
                    const dataUri = asset.badgeImage as string;
                    const mimeMatch = dataUri.match(/^data:([^;]+);base64,/);
                    let mimeType = mimeMatch ? mimeMatch[1] : "image/png";
                    const base64Data = dataUri.split(',')[1];

                    // Decode base64 using Deno's standard decoding
                    const binaryString = atob(base64Data);
                    let imageBytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        imageBytes[i] = binaryString.charCodeAt(i);
                    }

                    // Convert PNG to JPEG for AVM1 Flash compatibility
                    // Flash AS2 MovieClipLoader has issues with certain PNG formats
                    if (avmConfig.convertPngToJpeg && mimeType === "image/png") {
                        try {
                            const png = PNG.sync.read(Buffer.from(imageBytes));

                            // PNG may have alpha channel - composite onto white background
                            const rgbData = new Uint8Array(png.width * png.height * 4);
                            for (let i = 0; i < png.width * png.height; i++) {
                                const srcIdx = i * 4;
                                const alpha = png.data[srcIdx + 3] / 255;
                                // Composite onto white background
                                rgbData[srcIdx] = Math.round(png.data[srcIdx] * alpha + 255 * (1 - alpha));
                                rgbData[srcIdx + 1] = Math.round(png.data[srcIdx + 1] * alpha + 255 * (1 - alpha));
                                rgbData[srcIdx + 2] = Math.round(png.data[srcIdx + 2] * alpha + 255 * (1 - alpha));
                                rgbData[srcIdx + 3] = 255;
                            }

                            const jpegData = jpeg.encode({
                                data: rgbData,
                                width: png.width,
                                height: png.height
                            }, 90);

                            imageBytes = new Uint8Array(jpegData.data);
                            mimeType = "image/jpeg";
                        } catch (e) {
                            console.error("PNG to JPEG conversion failed:", e);
                            // Fall back to serving original PNG
                        }
                    }

                    const response = [
                        "HTTP/1.1 200 OK",
                        `Content-Type: ${mimeType}`,
                        `Content-Length: ${imageBytes.length}`,
                        "Connection: close",
                        "",
                        "",
                    ].join("\r\n");
                    await writer.write(encoder.encode(response));
                    await writer.write(imageBytes);
                } else {
                    await writer.write(encoder.encode("HTTP/1.1 404 Not Found\r\n\r\n"));
                }
                writer.releaseLock();
                reader.releaseLock();
                conn.close();
                return;
            }
        }

        // HTTP request for game badge image
        if (httpBuffer.startsWith("GET /game-image")) {
            const gameConfig = AppData.data.gameConfig;
            if (gameConfig?.badgeImage) {
                const dataUri = gameConfig.badgeImage as string;
                const mimeMatch = dataUri.match(/^data:([^;]+);base64,/);
                let mimeType = mimeMatch ? mimeMatch[1] : "image/png";
                const base64Data = dataUri.split(',')[1];

                const binaryString = atob(base64Data);
                let imageBytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    imageBytes[i] = binaryString.charCodeAt(i);
                }

                if (avmConfig.convertPngToJpeg && mimeType === "image/png") {
                    try {
                        const png = PNG.sync.read(Buffer.from(imageBytes));
                        const rgbData = new Uint8Array(png.width * png.height * 4);
                        for (let i = 0; i < png.width * png.height; i++) {
                            const srcIdx = i * 4;
                            const alpha = png.data[srcIdx + 3] / 255;
                            rgbData[srcIdx] = Math.round(png.data[srcIdx] * alpha + 255 * (1 - alpha));
                            rgbData[srcIdx + 1] = Math.round(png.data[srcIdx + 1] * alpha + 255 * (1 - alpha));
                            rgbData[srcIdx + 2] = Math.round(png.data[srcIdx + 2] * alpha + 255 * (1 - alpha));
                            rgbData[srcIdx + 3] = 255;
                        }
                        const jpegData = jpeg.encode({ data: rgbData, width: png.width, height: png.height }, 90);
                        imageBytes = new Uint8Array(jpegData.data);
                        mimeType = "image/jpeg";
                    } catch (e) {
                        console.error("PNG to JPEG conversion failed:", e);
                    }
                }

                const response = [
                    "HTTP/1.1 200 OK",
                    `Content-Type: ${mimeType}`,
                    `Content-Length: ${imageBytes.length}`,
                    "Connection: close",
                    "",
                    "",
                ].join("\r\n");
                await writer.write(encoder.encode(response));
                await writer.write(imageBytes);
            } else {
                await writer.write(encoder.encode("HTTP/1.1 404 Not Found\r\n\r\n"));
            }
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return;
        }

        // Policy file request
        if (httpBuffer.includes("<policy-file-request/>")) {
            await writer.write(encoder.encode(policyFile));
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return;
        }

        // Socket connection from firmware
        isXMLSocket = true;
        firmwareWriter = writer;
        firmwareConnected = true;
        emitLog("engine", "info", "Firmware connected");
        // Send app data to firmware (don't await - would deadlock before read loop starts)
        const originUrl = AppData.data.gameConfig.originUrl;
        const gameUrl = originUrl ? originUrl + "/game.swf" : null;
        sendToFirmware("setup", { data: AppData.data, gameUrl, settings }).catch(() => {});

        // Process initial data
        if (httpBuffer.trim()) {
            handleFirmwareData(httpBuffer);
        }

        // Read messages
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const data = decoder.decode(value);
            handleFirmwareData(data);
        }
    } catch (e) {
        if (isXMLSocket) {
            console.error(`XMLSocket error: ${e}`);
        }
    } finally {
        if (isXMLSocket) {
            emitLog("engine", "warn", "Firmware disconnected");
            firmwareConnected = false;
            firmwareWriter = null;
            firmwareMessageBuffer = "";
            // Clear any in-flight requests so their promises don't dangle when
            // the firmware reconnects (e.g. after a child-mode resetGame).
            for (const [, resolver] of pendingRequests) {
                resolver({ success: false, error: "Firmware disconnected" });
            }
            pendingRequests.clear();
        }
        try {
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
        } catch {
            // Already closed
        }
    }
}

/**
 * Handle incoming data from firmware
 */
function handleFirmwareData(data: string): void {
    firmwareMessageBuffer += data;
    const messages = firmwareMessageBuffer.split(avmConfig.messageTerminator);
    firmwareMessageBuffer = messages.pop()!; // Keep incomplete trailing data for next read
    for (const msg of messages) {
        if (!msg.trim()) continue;
        try {
            const parsed = JSON.parse(msg);

            // Handle response to our requests
            if (Array.isArray(parsed) && parsed[0] === "RESPONSE") {
                const [, id, response] = parsed;
                const resolver = pendingRequests.get(id);
                if (resolver) {
                    resolver((typeof response === 'object' && response !== null) ? response as Record<string, unknown> : { raw: response });
                }
                continue;
            }

            // Handle unsolicited messages from firmware
            if (parsed.type === "log") {
                // Firmware log message
                const fwMsg = parsed.data?.message || JSON.stringify(parsed.data);
                emitLog("firmware", "info", fwMsg);
            } else if (parsed.type === "gameLoaded") {
                emitLog("engine", "info", "Game loaded");
                // Show welcome toast with game info
                const gameTitle = AppData.data.gameConfig?.title || "Game Loaded";
                const assetCount = AppData.data.assets.length;
                let description: string;
                if (UserProfile.currentName && AppData.gameHash) {
                    const unlocked = UserProfile.getUnlockedIds(AppData.gameHash).length;
                    description = assetCount === 0 ? "No achievements" : `${unlocked} of ${assetCount} achievements unlocked`;
                } else {
                    description = assetCount === 0 ? "No achievements" : `${assetCount} achievement${assetCount === 1 ? "" : "s"}`;
                }
                const imageUrl = AppData.data.gameConfig?.badgeImage ? "http://raflash.local/game-image" : "";
                sendToFirmware("showToast", {
                    title: gameTitle,
                    description,
                    label: "",
                    align: "right",
                    imageUrl,
                }).catch(() => {});
            } else if (parsed.type === "keypress") {
                // F12 key pressed - open devtools
                if (parsed.data?.keyCode === 123) {
                    openDevtoolsMenu();
                }
            } else if (parsed.type === "editData") {
                // Process firmware changes and propagate to all devtools
                const changes = parsed.data?.changes || parsed.data;
                if (changes) {
                    const { fullDiff, derivedDiff } = JSONDiff.processIncomingDiff(AppData.data, changes as Diff);

                    // Record achievement unlocks to user profile
                    if (UserProfile.currentName && AppData.gameHash && fullDiff.edited) {
                        for (const [path, value] of fullDiff.edited) {
                            const match = path.match(/^assets\/(\d+)\/state$/);
                            if (match && value === "TRIGGERED") {
                                const index = parseInt(match[1]);
                                const asset = AppData.data.assets[index];
                                if (asset) {
                                    emitLog("achievement", "info", `Achievement unlocked: ${asset.name || "Unnamed"} (ID: ${asset.id})`);
                                    UserProfile.recordUnlock(AppData.gameHash, asset.id);
                                }
                            }
                        }
                        UserProfile.saveUser();
                    }

                    // Broadcast fullDiff to all devtools clients
                    broadcastToDevtools("editData", fullDiff);

                    // Send derivedDiff (watcher changes only) back to firmware
                    if (derivedDiff.edited && derivedDiff.edited.length > 0) {
                        sendToFirmware("editData", { changes: derivedDiff }).catch(() => {});
                    }

                    // Persist changes to disk
                    AppData.saveData();
                }
            } else if (parsed.type === "syncState") {
                // Firmware reconnected - its state is authoritative
                const firmwareData = parsed.data?.appData;
                if (firmwareData) {
                    const diff = JSONDiff.getDataDiff(AppData.data, firmwareData);
                    if (!JSONDiff.isPointlessDiff(diff)) {
                        JSONDiff.applyDataDiff(AppData.data, diff);
                        broadcastToDevtools("editData", diff);
                        AppData.saveData();
                    }
                    emitLog("firmware", "info", "State synced after reconnect");
                }
            } else if (parsed.type === "watchResults") {
                // Forward watch results to the socket that started the watcher
                const watcherId = String(parsed.data?.watcherId);
                const socket = watcherSockets.get(watcherId);
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify(["EVENT", "watchResults", parsed.data]) + "\n");
                }
            } else if (parsed.type === "richPresenceUpdate") {
                // Update Flash Player window title with Rich Presence result
                const result = (parsed.data?.result as string) ?? "";
                lastRichPresenceTime = Date.now();
                updateFlashPlayerTitle(result);
            } else if (parsed.type === "profiling") {
                // Print profiling data from firmware
                const profData = parsed.data as {
                    achievements: Record<string, { name: string; totalMs: number; evalCount: number }>;
                    stage: { directProps: number; movieClips: number; totalProps: number };
                    optimization: { objAccessOptimized: number; objAccessGeneric: number; arrAccessOptimized: number; arrAccessGeneric: number };
                    timing: { totalFrameTimeMs: number; diffOpsTimeMs: number; stageCountTimeMs: number; frameCount: number };
                };

                console.log("\n=== Achievement Profiling (last 5s) ===");
                const t = profData.timing;
                console.log(`Frames: ${t.frameCount} | Total: ${t.totalFrameTimeMs}ms | Diff: ${t.diffOpsTimeMs}ms | StageCount: ${t.stageCountTimeMs}ms`);
                console.log(`Stage: ${profData.stage.directProps} direct props, ${profData.stage.movieClips} MovieClips, ${profData.stage.totalProps} total props (depth 3)`);
                const opt = profData.optimization;
                console.log(`ObjAccess: ${opt.objAccessOptimized} optimized, ${opt.objAccessGeneric} generic | ArrAccess: ${opt.arrAccessOptimized} optimized, ${opt.arrAccessGeneric} generic`);
                console.log("---");
                for (const [id, info] of Object.entries(profData.achievements)) {
                    const avgMs = info.totalMs / info.evalCount;
                    console.log(`  ${info.name}: ${info.totalMs.toFixed(1)}ms total, ${info.evalCount} evals, ${avgMs.toFixed(2)}ms avg`);
                }
                console.log("");
            } else if (parsed.type === "benchmark") {
                broadcastToDevtools("benchmark", parsed.data as Record<string, unknown>);
            }
            // Other message types ignored
        } catch (e) {
            emitLog("engine", "error", `Failed to parse firmware message: ${e} (starts: ${msg.substring(0, 80)})`);
        }
    }
}

/**
 * Launch Flash Player with the appropriate initial movie for the resolved
 * firmware mode:
 *   - parent: load the AVM1Wrapper (existing behavior); the wrapper loads
 *             the firmware which loads the game into a child clip.
 *   - child:  load /game.swf directly; RAEngine's /game.swf handler injects
 *             bytecode that loads the firmware as a child of the game.
 *   - none:   load /game.swf directly with no injection — raw game for
 *             debugging/comparison.
 */
function launchFlashPlayer(): Deno.ChildProcess {
    const fpPath = `${Deno.cwd()}/vendor/adobe/fp-32.0.0.380.exe`;
    // Note: cwd is .build/ during development (make run) and the exe's directory when distributed
    const originUrl = AppData.data.gameConfig.originUrl;
    const domain = originUrl ? new URL(originUrl).host : RAFLASH_DOMAIN;
    const mode = resolveFirmwareMode();
    const launchUrl = (mode === "child" || mode === "none")
        ? `http://${domain}/game.swf`
        : `http://${domain}${avmConfig.firmwareUrl}`;

    const command = new Deno.Command(fpPath, {
        args: [launchUrl],
        cwd: Deno.cwd(),
    });
    return command.spawn();
}

/**
 * Main entry point
 */
async function main(): Promise<void> {

    // Verify both firmwares exist (we don't know which we'll need until game is selected)
    for (const fw of ["firmware/AVM1.swf", "firmware/AVM2.swf"]) {
        try {
            await Deno.stat(fw);
        } catch {
            console.error(`ERROR: Firmware SWF not found: ${fw}`);
            console.error("Run 'make' first to build both firmwares");
            Deno.exit(1);
        }
    }

    // Clean up leftover from self-update (delay to let old process fully exit)
    const oldExe = Deno.execPath() + ".old";
    try {
        await Deno.stat(oldExe);
        // File exists — retry deletion a few times in case old process is still exiting
        for (let i = 0; i < 10; i++) {
            try { await Deno.remove(oldExe); break; } catch { await new Promise(r => setTimeout(r, 500)); }
        }
    } catch { /* no .old file, nothing to clean */ }

    // Load persistent settings
    await loadSettings();

    // 1. Start HTTP server (persists across game sessions, retries port on startup after self-update)
    await startHttpServer();

    // 2. Start Flash socket server in background (persists across game sessions)
    startFlashServer();

    // 3. Handle Ctrl+C (registered once, references module-level state)
    Deno.addSignalListener("SIGINT", async () => {
        if (richPresenceCheckInterval) {
            clearInterval(richPresenceCheckInterval);
        }
        stopSitelockProxy();
        try {
            flashProcess?.kill();
        } catch {
            // Already exited
        }
        await HTMLWindow.shutdown(true);
        Deno.exit(0);
    });

    // 4. Game loop: file picker → game → cleanup → repeat
    while (true) {
        const pickerResult = await showFilePicker();

        // User closed file picker without selecting → exit
        if (!pickerResult) {
            await HTMLWindow.shutdown(true);
            Deno.exit(0);
        }

        const { gamePath, user } = pickerResult;

        // Close non-persistent windows (e.g. Settings) before launching the game
        await HTMLWindow.shutdown();

        // Resolve the game path (handle relative paths)
        let resolvedGamePath = gamePath;
        if (gamePath.startsWith("./") || gamePath.startsWith(".\\")) {
            resolvedGamePath = join(Deno.cwd(), gamePath.substring(2));
        } else if (!gamePath.includes(":") && !gamePath.startsWith("/")) {
            resolvedGamePath = join(Deno.cwd(), gamePath);
        }

        // Verify game file exists
        try {
            await Deno.stat(resolvedGamePath);
        } catch {
            console.error(`ERROR: Game SWF not found: ${resolvedGamePath}`);
            continue; // Back to file picker
        }

        selectedGamePath = resolvedGamePath;

        // Parse game SWF to get window dimensions and detect AVM version
        const gameSwfBuffer = await Deno.readFile(resolvedGamePath);
        const gameMetadata = parseSwfMetadata(gameSwfBuffer);
        gameWindowWidth = gameMetadata.width;
        gameWindowHeight = gameMetadata.height;

        avmConfig = gameMetadata.useAS3
            ? { mode: "AVM2", firmwareUrl: "/avm2-firmware.swf", firmwareSwf: "firmware/AVM2.swf", messageTerminator: "\n", patchFirmware: true, convertPngToJpeg: false }
            : { mode: "AVM1", firmwareUrl: "/avm1-wrapper.swf", firmwareSwf: "firmware/AVM1Wrapper.swf", innerFirmwareSwf: "firmware/AVM1.swf", messageTerminator: "\0", patchFirmware: true, convertPngToJpeg: true };

        // Load game-specific state (identified by MD5 hash of SWF)
        await AppData.setGamePath(resolvedGamePath);
        await AppData.loadData();

        // Load user and apply previously unlocked achievements
        selectedUserName = user;
        await UserProfile.loadUser(user);
        const unlockedIds = UserProfile.getUnlockedIds(AppData.gameHash!);
        for (const asset of AppData.data.assets) {
            if (unlockedIds.includes(asset.id)) {
                asset.state = "TRIGGERED";
            }
        }

        // Start sitelock proxy
        await Deno.writeTextFile(join(Deno.cwd(), "proxy.txt"), "1");
        await Deno.writeTextFile(join(Deno.cwd(), "port.txt"), String(PROXY_PORT));
        const sitelockOrigin = AppData.data.gameConfig.originUrl;
        const sitelockDomain = sitelockOrigin ? new URL(sitelockOrigin).hostname : null;
        startSitelockProxy({
            port: PROXY_PORT,
            flashPort: FLASH_PORT,
            gameDomain: sitelockDomain,
            onRequest: (method, url, status) => {
                emitLog("network", "info", `${status} ${method} ${url}`);
            },
        });

        // Switch to game running state
        appState = AppState.GAME_RUNNING;

        // Launch Flash Player
        flashProcess = launchFlashPlayer();
        flashPlayerPid = flashProcess.pid;

        // Resize and center Flash Player to match game dimensions (Windows only)
        if (Deno.build.os === "windows") {
            const icoPath = join(Deno.cwd(), "assets", "icon.ico");
            WindowManager.removeWindowChrome(flashProcess.pid, gameWindowWidth, gameWindowHeight, "RAFlash", 50, 10);
            WindowManager.setProcessIcon(flashProcess.pid, icoPath);
        }

        // Start Rich Presence timeout checker
        richPresenceCheckInterval = setInterval(() => {
            if (lastRichPresenceTime > 0 && Date.now() - lastRichPresenceTime >= 4000) {
                updateFlashPlayerTitle("");
            }
        }, 1000);

        // Wait for Flash Player to close
        await flashProcess.status;

        // Cleanup between games
        if (richPresenceCheckInterval) {
            clearInterval(richPresenceCheckInterval);
            richPresenceCheckInterval = null;
        }
        stopSitelockProxy();

        // Flush user profile before cleanup
        await UserProfile.saveUser();

        // Close all devtools WebSocket connections and windows
        for (const ws of devtoolsClients) {
            try { ws.close(); } catch { /* already closed */ }
        }
        devtoolsClients.clear();
        await HTMLWindow.shutdown();

        // Reset state for next game
        resetGameState();
    }
}

main();
