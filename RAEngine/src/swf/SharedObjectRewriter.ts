/**
 * AVM2 SharedObject interception via SWF rewrite.
 *
 * Hooks game saves by retargeting `flash.net::SharedObject` references to
 * a user-defined class `flash.net::__RAShim_S0_` that we inject into the
 * game's SWF. The shim wraps a real native SharedObject (so the game's
 * save still persists exactly as before) and additionally invokes a
 * static relay callback on every flush — RAEngine installs the callback
 * after the game loads, then mirrors the data into saves/<hash>/slots/<slot>/.
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
const FLASH_NET  = new TextEncoder().encode("flash.net");
if (TARGET.length !== REPLACEMENT.length) {
    throw new Error("rewriter: target/replacement byte length mismatch");
}

// AVM2 namespace kinds (avmplus/abc spec).
const NS_PACKAGE = 0x16;
// AVM2 multiname kinds.
const MN_QNAME    = 0x07;
const MN_QNAMEA   = 0x0D;
const MN_RTQNAME  = 0x0F;
const MN_RTQNAMEA = 0x10;
const MN_RTQNAMEL  = 0x11;
const MN_RTQNAMELA = 0x12;
const MN_MULTINAME  = 0x09;
const MN_MULTINAMEA = 0x0E;
const MN_MULTINAMEL  = 0x1B;
const MN_MULTINAMELA = 0x1C;
const MN_TYPENAME    = 0x1D;

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

/** Compare a slice of bytes against a fixed Uint8Array. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/**
 * Parse the constants-pool sections we need to make a QName-aware rename
 * decision. Returns null if the ABC is malformed (we then bail out the
 * caller into "no rename" rather than corrupting the SWF).
 */
type AbcPools = {
    /** Byte position + size of each string entry (index 0 unused). */
    strings: Array<{ pos: number; size: number }>;
    /** Each namespace's kind + name string-index (index 0 unused). */
    namespaces: Array<{ kind: number; nameIdx: number }>;
    /** Each multiname's kind + decoded ns/name indices (index 0 unused). */
    multinames: Array<{ kind: number; nsIdx: number; nameIdx: number }>;
};

function parseAbcPools(abc: Uint8Array): AbcPools | null {
    try {
        let pos = 4; // skip minor_version + major_version
        let n: number;

        // ints, uints — variable-length. Skip values, we don't need them.
        [n, pos] = readU30(abc, pos);
        for (let i = 1; i < n; i++) { [, pos] = readU30(abc, pos); }
        [n, pos] = readU30(abc, pos);
        for (let i = 1; i < n; i++) { [, pos] = readU30(abc, pos); }

        // doubles — 8 bytes each.
        [n, pos] = readU30(abc, pos);
        if (n > 0) pos += (n - 1) * 8;

        // strings.
        [n, pos] = readU30(abc, pos);
        const strings: Array<{ pos: number; size: number }> = [{ pos: 0, size: 0 }];
        for (let i = 1; i < n; i++) {
            const [size, p] = readU30(abc, pos);
            pos = p;
            strings.push({ pos, size });
            pos += size;
        }

        // namespaces.
        [n, pos] = readU30(abc, pos);
        const namespaces: Array<{ kind: number; nameIdx: number }> = [{ kind: 0, nameIdx: 0 }];
        for (let i = 1; i < n; i++) {
            const kind = abc[pos++];
            const [nameIdx, p] = readU30(abc, pos);
            pos = p;
            namespaces.push({ kind, nameIdx });
        }

        // ns_sets — skip; we don't need their internals.
        [n, pos] = readU30(abc, pos);
        for (let i = 1; i < n; i++) {
            const [count, p] = readU30(abc, pos);
            pos = p;
            for (let j = 0; j < count; j++) [, pos] = readU30(abc, pos);
        }

        // multinames.
        [n, pos] = readU30(abc, pos);
        const multinames: Array<{ kind: number; nsIdx: number; nameIdx: number }> = [
            { kind: 0, nsIdx: 0, nameIdx: 0 },
        ];
        for (let i = 1; i < n; i++) {
            const kind = abc[pos++];
            let nsIdx = 0, nameIdx = 0;
            switch (kind) {
                case MN_QNAME:
                case MN_QNAMEA:
                    [nsIdx, pos] = readU30(abc, pos);
                    [nameIdx, pos] = readU30(abc, pos);
                    break;
                case MN_RTQNAME:
                case MN_RTQNAMEA:
                    [nameIdx, pos] = readU30(abc, pos);
                    break;
                case MN_RTQNAMEL:
                case MN_RTQNAMELA:
                    break;
                case MN_MULTINAME:
                case MN_MULTINAMEA:
                    [nameIdx, pos] = readU30(abc, pos);
                    [, pos] = readU30(abc, pos); // ns_set
                    break;
                case MN_MULTINAMEL:
                case MN_MULTINAMELA:
                    [, pos] = readU30(abc, pos); // ns_set
                    break;
                case MN_TYPENAME: {
                    [nameIdx, pos] = readU30(abc, pos);
                    const [paramCount, p] = readU30(abc, pos);
                    pos = p;
                    for (let j = 0; j < paramCount; j++) [, pos] = readU30(abc, pos);
                    break;
                }
                default:
                    return null; // unknown kind — bail
            }
            multinames.push({ kind, nsIdx, nameIdx });
        }

        return { strings, namespaces, multinames };
    } catch {
        return null;
    }
}

/**
 * QName-aware rename of `flash.net::SharedObject` → `flash.net::__RAShim_S0_`.
 *
 * The previous implementation renamed any 12-byte "SharedObject" entry in
 * the strings pool. ABC pools deduplicate strings, so a game with its own
 * class/method/property named `SharedObject` would have the SAME pool
 * entry referenced both by the flash.net QName and by the game's
 * QName(*::SharedObject) — a blind rename retargets the game's class to
 * the shim and breaks `is SharedObject` checks, reflection, etc.
 *
 * Strategy:
 *   1. Scan multinames. If ANY non-flash.net multiname references the
 *      "SharedObject" string, the rename is unsafe — log a warning and
 *      skip this ABC entirely. The game saves still go through the
 *      native path, just without our JSON mirror.
 *   2. Otherwise, every "SharedObject" reference IS a flash.net QName,
 *      so renaming the underlying string is safe. Rewrite all matching
 *      string entries in place.
 *
 * Returns the number of string entries patched (0 means no rename
 * happened — either no SharedObject references found, or skipped due to
 * collateral risk).
 */
function patchAbcStringsInPlace(abc: Uint8Array): number {
    const pools = parseAbcPools(abc);
    if (!pools) return 0;

    const isString = (idx: number, target: Uint8Array): boolean => {
        if (idx <= 0 || idx >= pools.strings.length) return false;
        const s = pools.strings[idx];
        if (s.size !== target.length) return false;
        return bytesEqual(abc.subarray(s.pos, s.pos + s.size), target);
    };

    // String indices that hold "SharedObject" / "flash.net".
    const sharedObjectIdx = new Set<number>();
    const flashNetIdx = new Set<number>();
    for (let i = 1; i < pools.strings.length; i++) {
        if (isString(i, TARGET)) sharedObjectIdx.add(i);
        if (isString(i, FLASH_NET)) flashNetIdx.add(i);
    }
    if (sharedObjectIdx.size === 0) return 0;

    // Namespace indices that are PackageNamespace("flash.net").
    const flashNetNsIdx = new Set<number>();
    for (let i = 1; i < pools.namespaces.length; i++) {
        const ns = pools.namespaces[i];
        if (ns.kind === NS_PACKAGE && flashNetIdx.has(ns.nameIdx)) flashNetNsIdx.add(i);
    }

    // Walk every multiname referencing the "SharedObject" string. If any
    // are not QNames in flash.net, abort — the rename would clobber a
    // game-side identifier that happens to share the pooled string.
    for (let i = 1; i < pools.multinames.length; i++) {
        const mn = pools.multinames[i];
        if (!sharedObjectIdx.has(mn.nameIdx)) continue;
        const isFlashNetQName =
            (mn.kind === MN_QNAME || mn.kind === MN_QNAMEA) && flashNetNsIdx.has(mn.nsIdx);
        if (!isFlashNetQName) {
            console.warn(
                `SharedObjectRewriter: skipping rename — game ABC has a non-flash.net reference to "SharedObject" ` +
                `(multiname kind 0x${mn.kind.toString(16).padStart(2, "0")}), in-place rename would clobber it. ` +
                `Saves will still persist through the native path, but the JSON mirror won't fire.`,
            );
            return 0;
        }
    }

    // Safe: every "SharedObject" reference is the flash.net QName. Rewrite
    // each pooled string entry in place. Same length → no offsets shift.
    let patches = 0;
    for (const idx of sharedObjectIdx) {
        const s = pools.strings[idx];
        if (s.size === REPLACEMENT.length) {
            for (let j = 0; j < s.size; j++) abc[s.pos + j] = REPLACEMENT[j];
            patches++;
        }
    }
    return patches;
}

/**
 * True iff any DoABC/DoABC2 tag's strings pool contains the byte sequence
 * `__RAShim_S0_`. Used as the idempotency check — far more precise than
 * a whole-body scan, which produced false positives whenever those bytes
 * happened to land inside an embedded JPEG/MP3/font table and silently
 * skipped a SWF that had never been rewritten.
 */
function abcStringsContain(abc: Uint8Array, needle: Uint8Array): boolean {
    let pos = 4; // skip minor_version + major_version
    let n: number;
    [n, pos] = readU30(abc, pos);
    for (let i = 0; i < Math.max(0, n - 1); i++) { [, pos] = readU30(abc, pos); }
    [n, pos] = readU30(abc, pos);
    for (let i = 0; i < Math.max(0, n - 1); i++) { [, pos] = readU30(abc, pos); }
    [n, pos] = readU30(abc, pos);
    pos += Math.max(0, n - 1) * 8;
    [n, pos] = readU30(abc, pos);
    for (let i = 0; i < Math.max(0, n - 1); i++) {
        const [size, newPos] = readU30(abc, pos);
        pos = newPos;
        if (size === needle.length) {
            let match = true;
            for (let j = 0; j < size; j++) {
                if (abc[pos + j] !== needle[j]) { match = false; break; }
            }
            if (match) return true;
        }
        pos += size;
    }
    return false;
}

/**
 * Walk a SWF body's tag stream and run `check` against the ABC payload of
 * every DoABC/DoABC2 tag. Returns true on the first hit. Bounds-check on
 * truncated/malformed tag streams returns false.
 */
function anyAbcMatches(body: Uint8Array, check: (abc: Uint8Array) => boolean): boolean {
    let pos = findTagsStart(body);
    while (pos + 2 <= body.length) {
        const tagHeader = readU16LE(body, pos);
        const code = tagHeader >> 6;
        let lenField = tagHeader & 0x3F;
        let bodyOffset = pos + 2;
        if (lenField === 0x3F) {
            if (pos + 6 > body.length) return false;
            lenField = readU32LE(body, pos + 2);
            bodyOffset = pos + 6;
        }
        const next = bodyOffset + lenField;
        if (next < bodyOffset || next > body.length) return false;
        if (code === TAG_DOABC2) {
            // DoABC2 prefixes a flags(u32) + null-terminated name; skip past those.
            let abcStart = bodyOffset + 4;
            while (abcStart < next && body[abcStart] !== 0) abcStart++;
            abcStart++; // past the name's null terminator
            if (abcStart < next && check(body.subarray(abcStart, next))) return true;
        } else if (code === TAG_DOABC) {
            if (check(body.subarray(bodyOffset, next))) return true;
        } else if (code === TAG_END) {
            return false;
        }
        pos = next;
    }
    return false;
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

    // Idempotency: scan only DoABC string pools for the shim's class
    // identifier. A whole-body scan was overbroad — the byte sequence
    // can land inside embedded JPEG/MP3/font tables and falsely trigger
    // the skip on a SWF that's never been rewritten. Running the pass
    // twice on a real rewrite would otherwise redirect the shim's own
    // SharedObject references at itself and recurse infinitely on flush.
    if (anyAbcMatches(mutBody, (abc) => abcStringsContain(abc, REPLACEMENT))) {
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
