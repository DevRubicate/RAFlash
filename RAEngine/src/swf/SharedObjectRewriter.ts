/**
 * AVM2 SharedObject interception via SWF rewrite.
 *
 * Hooks game saves by retargeting `flash.net::SharedObject` references to
 * a user-defined class `flash.net::__RAShim_S0_` that we inject into the
 * game's SWF. The shim wraps a real native SharedObject (so the game's
 * save still persists exactly as before) and additionally invokes a
 * static relay callback on every flush — RAEngine installs the callback
 * after the game loads, then mirrors the data into RACache/SaveFiles.
 *
 * Two operations on each game SWF:
 *
 *   1. In every DoABC2/DoABC tag's strings pool, find the entry whose
 *      bytes are exactly "SharedObject" (12 bytes) and overwrite them
 *      with "__RAShim_S0_" (12 bytes). Same length means no offsets in
 *      the file shift — method bodies, class signatures, multiname
 *      indices, exception PCs all stay valid bit-for-bit. AVM2 verifies
 *      classes by QName, not by the static class object identity, so
 *      `flash.net::__RAShim_S0_` (a non-colliding QName, accepted by the
 *      verifier even though it's in `flash.net`) cleanly takes the place
 *      of the native.
 *
 *   2. Inject the shim's DoABC tag(s) into the game SWF before the End
 *      tag. The shim is precompiled once via Haxe (see Makefile target
 *      `avm2-shim-build`) and we just lift its DoABC tags verbatim. The
 *      shim's class registers in the game's own ApplicationDomain, so
 *      lookups resolve regardless of parent/child firmware mode.
 *
 * Step 1 must run before step 2: the shim's own DoABC contains literal
 * `"SharedObject"` references (it wraps the real native), and we don't
 * want those redirected back at ourselves.
 */

import * as pako from "npm:pako";

// "SharedObject" → "__RAShim_S0_" (both 12 bytes; in-place swap)
const TARGET     = new TextEncoder().encode("SharedObject");
const REPLACEMENT = new TextEncoder().encode("__RAShim_S0_");
if (TARGET.length !== REPLACEMENT.length) {
    throw new Error("rewriter: target/replacement byte length mismatch");
}

const TAG_END     = 0;
const TAG_DOABC   = 72; // legacy: body = abc bytes
const TAG_DOABC2  = 82; // body = flags(u32) + name(cstring) + abc

function readU16LE(data: Uint8Array, pos: number): number {
    return data[pos] | (data[pos + 1] << 8);
}
function readU32LE(data: Uint8Array, pos: number): number {
    return (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24)) >>> 0;
}

/** Read AVM2 variable-length u30. Returns [value, newPos]. */
function readU30(data: Uint8Array, pos: number): [number, number] {
    let val = 0, shift = 0;
    for (let i = 0; i < 5; i++) {
        const b = data[pos++];
        val |= (b & 0x7F) << shift;
        if ((b & 0x80) === 0) return [val, pos];
        shift += 7;
    }
    return [val, pos];
}

/**
 * Walk an ABC's constants-pool string entries and overwrite any whose
 * bytes exactly match TARGET with REPLACEMENT bytes. Returns count of
 * patches applied.
 */
function patchAbcStringsInPlace(abc: Uint8Array): number {
    let pos = 4; // skip minor_version + major_version (u16 each)
    let n: number;
    [n, pos] = readU30(abc, pos);
    for (let i = 0; i < Math.max(0, n - 1); i++) { [, pos] = readU30(abc, pos); }
    [n, pos] = readU30(abc, pos);
    for (let i = 0; i < Math.max(0, n - 1); i++) { [, pos] = readU30(abc, pos); }
    [n, pos] = readU30(abc, pos);
    pos += Math.max(0, n - 1) * 8;
    [n, pos] = readU30(abc, pos);
    let patches = 0;
    for (let i = 0; i < Math.max(0, n - 1); i++) {
        const [size, newPos] = readU30(abc, pos);
        pos = newPos;
        if (size === TARGET.length) {
            let match = true;
            for (let j = 0; j < size; j++) {
                if (abc[pos + j] !== TARGET[j]) { match = false; break; }
            }
            if (match) {
                for (let j = 0; j < size; j++) abc[pos + j] = REPLACEMENT[j];
                patches++;
            }
        }
        pos += size;
    }
    return patches;
}

function decompressSwf(swf: Uint8Array): { header: Uint8Array; body: Uint8Array; sig: string } {
    const sig = String.fromCharCode(swf[0], swf[1], swf[2]);
    if (sig === "CWS") {
        return { header: swf.slice(0, 8), body: pako.inflate(swf.slice(8)), sig };
    } else if (sig === "FWS") {
        return { header: swf.slice(0, 8), body: swf.slice(8), sig };
    }
    throw new Error(`Unsupported SWF signature: ${sig}`);
}

function recompressSwf(header: Uint8Array, body: Uint8Array, originalSig: string): Uint8Array {
    // Update fileLength field (bytes 4-7) — uncompressed total length.
    const totalLen = body.length + 8;
    const newHeader = new Uint8Array(header);
    newHeader[4] = totalLen & 0xFF;
    newHeader[5] = (totalLen >> 8) & 0xFF;
    newHeader[6] = (totalLen >> 16) & 0xFF;
    newHeader[7] = (totalLen >> 24) & 0xFF;
    if (originalSig === "CWS") {
        const compressed = pako.deflate(body, { level: 9 });
        const out = new Uint8Array(8 + compressed.length);
        out.set(newHeader);
        out.set(compressed, 8);
        return out;
    }
    const out = new Uint8Array(8 + body.length);
    out.set(newHeader);
    out.set(body, 8);
    return out;
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
    if (needle.length === 0 || haystack.length < needle.length) return false;
    outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return true;
    }
    return false;
}

/** Byte offset of the first SWF tag (after rect + frame_rate + frame_count). */
function findTagsStart(body: Uint8Array): number {
    const nbits = body[0] >> 3;
    const rectBits = 5 + 4 * nbits;
    return Math.ceil(rectBits / 8) + 4;
}

/** Pull every DoABC/DoABC2 tag (header + body) out of a SWF. */
export function extractAbcTags(swf: Uint8Array): Uint8Array[] {
    const { body } = decompressSwf(swf);
    const tags: Uint8Array[] = [];
    let pos = findTagsStart(body);
    while (pos < body.length) {
        const tagHeader = readU16LE(body, pos);
        const code = tagHeader >> 6;
        let lenField = tagHeader & 0x3F;
        let bodyOffset = pos + 2;
        if (lenField === 0x3F) {
            lenField = readU32LE(body, pos + 2);
            bodyOffset = pos + 6;
        }
        const fullLen = (bodyOffset - pos) + lenField;
        if (code === TAG_DOABC || code === TAG_DOABC2) {
            tags.push(body.slice(pos, pos + fullLen));
        }
        pos = bodyOffset + lenField;
        if (code === TAG_END) break;
    }
    return tags;
}

/**
 * Rewrite a game SWF for SharedObject interception. Idempotent: on a SWF
 * that has already been rewritten the rename finds nothing and the shim
 * tags are appended again. To avoid duplicate-class issues, callers
 * should cache the rewritten SWF rather than rewrite repeatedly.
 */
export function rewriteGameForSharedObjectShim(
    swf: Uint8Array,
    shimAbcTags: Uint8Array[],
): Uint8Array {
    if (swf.length < 8) return swf;
    const sig = String.fromCharCode(swf[0], swf[1], swf[2]);
    if (sig !== "CWS" && sig !== "FWS") {
        // ZWS (LZMA) not yet supported; fall through unmodified rather than crash.
        console.warn(`SharedObjectRewriter: unsupported SWF signature ${sig}, returning unmodified`);
        return swf;
    }

    const { header, body, sig: originalSig } = decompressSwf(swf);
    const mutBody = new Uint8Array(body);

    // Idempotency: if the body already contains the shim class identifier,
    // someone's already rewritten this SWF — running the pass again would
    // redirect the shim's internal references to native SharedObject back
    // at itself, causing infinite recursion at flush time.
    if (containsBytes(mutBody, REPLACEMENT)) {
        return swf;
    }

    // Step 1: rename SharedObject → __RAShim_S0_ in every game DoABC's strings pool.
    // Also remember where the FIRST DoABC starts — we want to splice the shim
    // ABC tags in BEFORE the first game DoABC so the verifier sees the shim's
    // class definition before encountering the game's references to it.
    let firstDoAbcPos = -1;
    let pos = findTagsStart(mutBody);
    let endTagPos = -1;
    while (pos < mutBody.length) {
        const tagHeader = readU16LE(mutBody, pos);
        const code = tagHeader >> 6;
        let lenField = tagHeader & 0x3F;
        let bodyOffset = pos + 2;
        if (lenField === 0x3F) {
            lenField = readU32LE(mutBody, pos + 2);
            bodyOffset = pos + 6;
        }
        if (code === TAG_DOABC2) {
            if (firstDoAbcPos < 0) firstDoAbcPos = pos;
            let abcStart = bodyOffset + 4; // skip flags
            while (abcStart < bodyOffset + lenField && mutBody[abcStart] !== 0) abcStart++;
            abcStart++; // past null terminator of name
            patchAbcStringsInPlace(mutBody.subarray(abcStart, bodyOffset + lenField));
        } else if (code === TAG_DOABC) {
            if (firstDoAbcPos < 0) firstDoAbcPos = pos;
            patchAbcStringsInPlace(mutBody.subarray(bodyOffset, bodyOffset + lenField));
        } else if (code === TAG_END) {
            endTagPos = pos;
            break;
        }
        pos = bodyOffset + lenField;
    }
    if (endTagPos < 0) {
        console.warn("SharedObjectRewriter: no End tag found, returning unmodified");
        return swf;
    }

    // Step 2: splice shim DoABC tags in just before the FIRST game DoABC tag,
    // so the verifier registers the shim class before encountering the game's
    // references to it. (Falling back to before the End tag if the SWF
    // somehow has no DoABC tags — but then there'd be nothing to rewrite.)
    const insertionPoint = firstDoAbcPos >= 0 ? firstDoAbcPos : endTagPos;
    const shimBytes = shimAbcTags.reduce((sum, t) => sum + t.length, 0);
    const newBody = new Uint8Array(mutBody.length + shimBytes);
    newBody.set(mutBody.subarray(0, insertionPoint));
    let writeOffset = insertionPoint;
    for (const t of shimAbcTags) {
        newBody.set(t, writeOffset);
        writeOffset += t.length;
    }
    newBody.set(mutBody.subarray(insertionPoint), writeOffset);

    return recompressSwf(header, newBody, originalSig);
}
