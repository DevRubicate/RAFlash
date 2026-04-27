/**
 * AVM1 bytecode builder. Produces raw action bytes for embedding in SWF DoAction tags.
 *
 * Each AVM1 action is either:
 * - Single-byte (opcode < 0x80): just the opcode
 * - With data (opcode >= 0x80): opcode + UI16 LE length + data bytes
 *
 * DefineFunction2 (0x8E) is special: its length field covers the metadata
 * (name through codeSize), and the function body follows immediately after.
 */

const textEncoder = new TextEncoder();

// --- Value types for ActionPush ---

export type AVM1Value =
    | { type: "string"; value: string }
    | { type: "int"; value: number }
    | { type: "double"; value: number }
    | { type: "null" }
    | { type: "undefined" }
    | { type: "boolean"; value: boolean }
    | { type: "register"; value: number };

export function aString(value: string): AVM1Value { return { type: "string", value }; }
export function aInt(value: number): AVM1Value { return { type: "int", value }; }
export function aDouble(value: number): AVM1Value { return { type: "double", value }; }
export function aNull(): AVM1Value { return { type: "null" }; }
export function aUndefined(): AVM1Value { return { type: "undefined" }; }
export function aBool(value: boolean): AVM1Value { return { type: "boolean", value }; }
export function aRegister(value: number): AVM1Value { return { type: "register", value }; }

// --- Builder ---

export class AVM1Builder {
    private buf: number[] = [];

    /** Emit ActionPush (0x96) with one or more typed values in a single action. */
    push(...values: AVM1Value[]): this {
        const payload: number[] = [];
        for (const v of values) {
            switch (v.type) {
                case "string": {
                    const encoded = textEncoder.encode(v.value);
                    payload.push(0x00); // string type tag
                    for (const b of encoded) payload.push(b);
                    payload.push(0x00); // null terminator
                    break;
                }
                case "int":
                    payload.push(0x07); // integer type tag
                    pushI32(v.value, payload);
                    break;
                case "double":
                    payload.push(0x06); // double type tag
                    pushF64(v.value, payload);
                    break;
                case "null":
                    payload.push(0x02);
                    break;
                case "undefined":
                    payload.push(0x03);
                    break;
                case "boolean":
                    payload.push(0x05); // boolean type tag
                    payload.push(v.value ? 1 : 0);
                    break;
                case "register":
                    payload.push(0x04); // register type tag
                    payload.push(v.value & 0xFF);
                    break;
            }
        }
        this.buf.push(0x96);
        pushUI16(payload.length, this.buf);
        for (const b of payload) this.buf.push(b);
        return this;
    }

    // --- Single-byte opcodes (no data) ---

    pop(): this { this.buf.push(0x17); return this; }
    getVariable(): this { this.buf.push(0x1C); return this; }
    setVariable(): this { this.buf.push(0x1D); return this; }
    getMember(): this { this.buf.push(0x4E); return this; }
    setMember(): this { this.buf.push(0x4F); return this; }
    callMethod(): this { this.buf.push(0x52); return this; }
    callFunction(): this { this.buf.push(0x3D); return this; }
    returnOp(): this { this.buf.push(0x3E); return this; }
    initArray(): this { this.buf.push(0x42); return this; }
    add2(): this { this.buf.push(0x47); return this; }
    subtract(): this { this.buf.push(0x0B); return this; }
    multiply(): this { this.buf.push(0x0C); return this; }
    divide(): this { this.buf.push(0x0D); return this; }
    equals2(): this { this.buf.push(0x49); return this; }
    less2(): this { this.buf.push(0x48); return this; }
    greater(): this { this.buf.push(0x67); return this; }
    not(): this { this.buf.push(0x12); return this; }
    increment(): this { this.buf.push(0x50); return this; }
    decrement(): this { this.buf.push(0x51); return this; }
    enumerate2(): this { this.buf.push(0x55); return this; }
    toNumber(): this { this.buf.push(0x4A); return this; }
    toInteger(): this { this.buf.push(0x18); return this; }
    bitXor(): this { this.buf.push(0x62); return this; }
    instanceOf(): this { this.buf.push(0x54); return this; }

    // --- Branching ---

    /** Get current byte offset in the buffer (for jump target calculation). */
    get position(): number { return this.buf.length; }

    /**
     * Emit ActionJump (0x99) targeting an absolute byte position.
     * Offset is calculated relative to the end of this instruction.
     */
    jumpTo(targetPosition: number): this {
        const instrStart = this.buf.length;
        this.buf.push(0x99);
        pushUI16(2, this.buf); // data length = 2
        const offset = targetPosition - (instrStart + 5);
        pushSI16(offset, this.buf);
        return this;
    }

    /**
     * Emit ActionIf (0x9D) targeting an absolute byte position.
     * Pops boolean from stack; branches if true.
     */
    jumpIfTo(targetPosition: number): this {
        const instrStart = this.buf.length;
        this.buf.push(0x9D);
        pushUI16(2, this.buf);
        const offset = targetPosition - (instrStart + 5);
        pushSI16(offset, this.buf);
        return this;
    }

    /**
     * Emit ActionJump with a placeholder offset. Returns the buffer position
     * of the offset field for later patching with patchJumpHere().
     */
    jumpForward(): number {
        this.buf.push(0x99);
        pushUI16(2, this.buf);
        const patchPos = this.buf.length;
        this.buf.push(0, 0); // placeholder
        return patchPos;
    }

    /**
     * Emit ActionIf with a placeholder offset. Returns the buffer position
     * of the offset field for later patching with patchJumpHere().
     */
    jumpIfForward(): number {
        this.buf.push(0x9D);
        pushUI16(2, this.buf);
        const patchPos = this.buf.length;
        this.buf.push(0, 0); // placeholder
        return patchPos;
    }

    /** Patch a forward jump (from jumpForward/jumpIfForward) to target the current position. */
    patchJumpHere(patchPos: number): void {
        const offset = this.buf.length - (patchPos + 2); // +2 for the SI16 field itself
        // SWF jumps are SI16-encoded — overflowing silently produces
        // garbage opcodes. Surface as a hard failure so a runaway shim
        // body fails at build time instead of corrupting the game.
        if (offset < -32768 || offset > 32767) {
            throw new Error(`AVM1Builder.patchJumpHere: forward jump offset ${offset} out of SI16 range (-32768..32767)`);
        }
        this.buf[patchPos] = offset & 0xFF;
        this.buf[patchPos + 1] = (offset >> 8) & 0xFF;
    }

    // --- Opcodes with data ---

    storeRegister(reg: number): this {
        this.buf.push(0x87);
        pushUI16(1, this.buf);
        this.buf.push(reg & 0xFF);
        return this;
    }

    /**
     * Emit DefineFunction2 (0x8E).
     *
     * The body is a pre-built Uint8Array from another AVM1Builder.
     * metadataLength covers name through codeSize; body bytes follow after.
     */
    defineFunction2(config: {
        name?: string;
        params?: Array<{ register: number; name: string }>;
        registerCount: number;
        flags?: number;
        body: Uint8Array;
    }): this {
        const name = config.name ?? "";
        const params = config.params ?? [];
        const flags = config.flags ?? 0;
        const body = config.body;

        // Build metadata (everything between the action length field and the body)
        const meta: number[] = [];

        // Function name (null-terminated)
        const nameBytes = textEncoder.encode(name);
        for (const b of nameBytes) meta.push(b);
        meta.push(0x00);

        // NumParams (UI16)
        pushUI16(params.length, meta);

        // RegisterCount (UI8)
        meta.push(config.registerCount & 0xFF);

        // Flags (UI16) — bit layout:
        //   bit 0: PreloadParent    bit 1: PreloadRoot
        //   bit 2: SuppressSuper    bit 3: PreloadSuper
        //   bit 4: SuppressArguments bit 5: PreloadArguments
        //   bit 6: SuppressThis     bit 7: PreloadThis
        //   bits 8-14: reserved     bit 15: PreloadGlobal (SWF7+)
        pushUI16(flags, meta);

        // Parameters: register (UI8) + name (null-terminated string) each
        for (const p of params) {
            meta.push(p.register & 0xFF);
            const pBytes = textEncoder.encode(p.name);
            for (const b of pBytes) meta.push(b);
            meta.push(0x00);
        }

        // CodeSize (UI16) — byte length of the function body
        pushUI16(body.length, meta);

        // Emit: opcode + metadataLength + metadata + body
        this.buf.push(0x8E);
        pushUI16(meta.length, this.buf);
        for (const b of meta) this.buf.push(b);
        for (const b of body) this.buf.push(b);

        return this;
    }

    /** Append pre-built bytecode bytes directly (for inlining compiled fragments). */
    rawBytes(bytes: Uint8Array): this {
        for (const b of bytes) this.buf.push(b);
        return this;
    }

    /** ActionEndFlag — terminates the action block in a DoAction tag. */
    end(): this { this.buf.push(0x00); return this; }

    /** Finalize to a Uint8Array. */
    toBytes(): Uint8Array {
        return new Uint8Array(this.buf);
    }

    /** Current byte length of the buffer. */
    get length(): number {
        return this.buf.length;
    }
}

// --- Internal helpers ---

function pushUI16(n: number, out: number[]): void {
    out.push(n & 0xFF, (n >>> 8) & 0xFF);
}

function pushSI16(n: number, out: number[]): void {
    // Signed 16-bit: negative values use two's complement. Bounds-check
    // so an oversize jump fails loudly instead of being silently truncated.
    if (n < -32768 || n > 32767) {
        throw new Error(`pushSI16: value ${n} out of range (-32768..32767)`);
    }
    out.push(n & 0xFF, (n >> 8) & 0xFF);
}

function pushI32(n: number, out: number[]): void {
    out.push(n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF);
}

function pushF64(n: number, out: number[]): void {
    // SWF DOUBLE format: the two 32-bit halves are swapped relative to
    // standard IEEE 754 little-endian. Bytes 4-7 come first, then 0-3.
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, n, true); // standard little-endian
    // Emit swapped: high word first (bytes 4-7), then low word (bytes 0-3)
    for (let i = 4; i < 8; i++) out.push(view.getUint8(i));
    for (let i = 0; i < 4; i++) out.push(view.getUint8(i));
}
