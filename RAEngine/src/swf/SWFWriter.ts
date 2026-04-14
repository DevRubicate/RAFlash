/**
 * Minimal SWF file writer for generating runtime AVM1 SWFs.
 *
 * Produces the simplest valid SWF: header, RECT, one DoAction tag, ShowFrame, End.
 * No visual content — these SWFs exist only to define and execute ActionScript.
 */

/**
 * Build a minimal SWF containing the given action bytes in a DoAction tag.
 *
 * @param actions - Raw AVM1 action bytes (should end with ActionEndFlag 0x00)
 * @param options.version - SWF version (default 7, minimum for DefineFunction2)
 * @param options.frameRate - Frame rate (default 1, irrelevant for non-visual SWFs)
 */
export function buildSWF(actions: Uint8Array, options?: { version?: number; frameRate?: number }): Uint8Array {
    const version = options?.version ?? 7;
    const frameRate = options?.frameRate ?? 1;

    const buf: number[] = [];

    // --- SWF Header ---
    buf.push(0x46, 0x57, 0x53); // "FWS" (uncompressed)
    buf.push(version);
    buf.push(0, 0, 0, 0); // FileLength placeholder (bytes 4-7)

    // --- RECT ---
    // Nbits=0 means all four fields (Xmin, Xmax, Ymin, Ymax) are 0 bits wide.
    // Encoded as: 5 bits for Nbits=0, padded to 1 byte → 0x00.
    // This gives a 0x0 stage — fine for non-visual SWFs.
    buf.push(0x00);

    // --- FrameRate (UI8.UI8 fixed-point) ---
    buf.push(0x00);                // fractional part
    buf.push(frameRate & 0xFF);    // integer part

    // --- FrameCount (UI16 LE) ---
    buf.push(0x01, 0x00);          // 1 frame

    // --- DoAction tag (tag type 12) ---
    writeTag(12, actions, buf);

    // --- ShowFrame tag (tag type 1, length 0) ---
    buf.push(0x40, 0x00);          // (1 << 6) | 0 = 0x0040

    // --- End tag (tag type 0, length 0) ---
    buf.push(0x00, 0x00);

    // Backfill FileLength (bytes 4-7, UI32 LE)
    const result = new Uint8Array(buf);
    const len = result.length;
    result[4] = len & 0xFF;
    result[5] = (len >> 8) & 0xFF;
    result[6] = (len >> 16) & 0xFF;
    result[7] = (len >> 24) & 0xFF;

    return result;
}

/** Write a SWF tag (short or long form) into the buffer. */
function writeTag(tagType: number, content: Uint8Array, buf: number[]): void {
    if (content.length < 0x3F) {
        // Short-form tag header: type in bits 6-15, length in bits 0-5
        const tcl = (tagType << 6) | content.length;
        buf.push(tcl & 0xFF, (tcl >> 8) & 0xFF);
    } else {
        // Long-form tag header: short tag with length=0x3F, then UI32 LE actual length
        const tcl = (tagType << 6) | 0x3F;
        buf.push(tcl & 0xFF, (tcl >> 8) & 0xFF);
        buf.push(content.length & 0xFF, (content.length >> 8) & 0xFF,
                 (content.length >> 16) & 0xFF, (content.length >> 24) & 0xFF);
    }
    for (const b of content) buf.push(b);
}
