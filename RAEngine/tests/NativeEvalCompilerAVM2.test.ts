/**
 * NativeEvalCompilerAVM2 Tests
 *
 * Verifies that achievements compiled to native AVM2 bytecode produce correct
 * behavior. Uses a mini AVM2 virtual machine to execute the compiled function
 * bodies directly.
 *
 * Mirrors the AVM1 NativeEvalCompiler tests but targets the AVM2 code path.
 */

import { test, assertEqual, assertThrows } from "../../tests/framework.ts";
import { compileAchievementsSWF } from "../src/swf/NativeEvalCompilerAVM2.ts";

// =============================================================================
// ABC Constant Pool Parser
// =============================================================================

class ABCReader {
    private data: Uint8Array;
    private pos: number;

    constructor(data: Uint8Array, offset = 0) {
        this.data = data;
        this.pos = offset;
    }

    get position(): number { return this.pos; }

    readU8(): number {
        return this.data[this.pos++];
    }

    readU16(): number {
        const lo = this.data[this.pos++];
        const hi = this.data[this.pos++];
        return lo | (hi << 8);
    }

    readU30(): number {
        let result = 0;
        let shift = 0;
        for (let i = 0; i < 5; i++) {
            const byte = this.data[this.pos++];
            result |= (byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }
        return result >>> 0;
    }

    readS24(): number {
        const b0 = this.data[this.pos++];
        const b1 = this.data[this.pos++];
        const b2 = this.data[this.pos++];
        let val = b0 | (b1 << 8) | (b2 << 16);
        if (val & 0x800000) val |= 0xFF000000; // sign extend
        return val;
    }

    readF64(): number {
        const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 8);
        this.pos += 8;
        return view.getFloat64(0, true);
    }

    readBytes(len: number): Uint8Array {
        const result = this.data.slice(this.pos, this.pos + len);
        this.pos += len;
        return result;
    }
}

interface ABCPool {
    ints: number[];
    doubles: number[];
    strings: string[];
    multinames: Array<{ kind: number; data: number[] }>;
}

interface MethodBody {
    methodIdx: number;
    code: Uint8Array;
    localCount: number;
}

function parseABC(abc: Uint8Array): { pool: ABCPool; methodBodies: MethodBody[] } {
    const r = new ABCReader(abc);

    // Header
    const minor = r.readU16();
    const major = r.readU16();
    if (minor !== 16 || major !== 46) throw new Error(`Unexpected ABC version ${major}.${minor}`);

    // Ints
    const ints: number[] = [0]; // index 0 is implicit 0
    const intCount = r.readU30();
    if (intCount > 0) {
        for (let i = 1; i < intCount; i++) ints.push(r.readU30());
    }

    // UInts (not used)
    const uintCount = r.readU30();
    for (let i = 1; i < uintCount; i++) r.readU30();

    // Doubles
    const doubles: number[] = [NaN]; // index 0 is implicit NaN
    const doubleCount = r.readU30();
    if (doubleCount > 0) {
        for (let i = 1; i < doubleCount; i++) doubles.push(r.readF64());
    }

    // Strings
    const strings: string[] = [""]; // index 0 is implicit ""
    const stringCount = r.readU30();
    for (let i = 1; i < stringCount; i++) {
        const len = r.readU30();
        const bytes = r.readBytes(len);
        strings.push(new TextDecoder().decode(bytes));
    }

    // Namespaces
    const nsCount = r.readU30();
    for (let i = 1; i < nsCount; i++) {
        r.readU8(); // kind
        r.readU30(); // name
    }

    // Namespace sets
    const nsSetCount = r.readU30();
    for (let i = 1; i < nsSetCount; i++) {
        const count = r.readU30();
        for (let j = 0; j < count; j++) r.readU30();
    }

    // Multinames
    const multinames: Array<{ kind: number; data: number[] }> = [{ kind: 0, data: [] }]; // index 0
    const mnCount = r.readU30();
    for (let i = 1; i < mnCount; i++) {
        const kind = r.readU8();
        const data: number[] = [];
        switch (kind) {
            case 0x07: // QName
                data.push(r.readU30()); // ns
                data.push(r.readU30()); // name
                break;
            case 0x09: // Multiname
                data.push(r.readU30()); // name
                data.push(r.readU30()); // ns_set
                break;
            case 0x1B: // MultinameL
                data.push(r.readU30()); // ns_set
                break;
            default:
                throw new Error(`Unknown multiname kind 0x${kind.toString(16)}`);
        }
        multinames.push({ kind, data });
    }

    const pool: ABCPool = { ints, doubles, strings, multinames };

    // Method infos
    // Note: the AVM2Builder writes name field for 0-param methods but omits it
    // for 2-param methods (achievement/RP functions). We match that behavior.
    const methodCount = r.readU30();
    for (let i = 0; i < methodCount; i++) {
        const paramCount = r.readU30();
        r.readU30(); // return_type
        for (let j = 0; j < paramCount; j++) r.readU30(); // param types
        if (paramCount === 0) r.readU30(); // name (only present for 0-param methods)
        const flags = r.readU8();
        if (flags & 0x08) { // HAS_OPTIONAL
            const optCount = r.readU30();
            for (let j = 0; j < optCount; j++) { r.readU30(); r.readU8(); }
        }
        if (flags & 0x80) { // HAS_PARAM_NAMES
            for (let j = 0; j < paramCount; j++) r.readU30();
        }
    }

    // Metadata
    const metaCount = r.readU30();
    for (let i = 0; i < metaCount; i++) {
        r.readU30(); // name
        const itemCount = r.readU30();
        for (let j = 0; j < itemCount; j++) { r.readU30(); r.readU30(); }
    }

    // Classes
    const classCount = r.readU30();
    // Instance infos
    for (let i = 0; i < classCount; i++) {
        r.readU30(); // name
        r.readU30(); // super_name
        const flags = r.readU8();
        if (flags & 0x08) r.readU30(); // protectedNs
        const intfCount = r.readU30();
        for (let j = 0; j < intfCount; j++) r.readU30();
        r.readU30(); // iinit
        const traitCount = r.readU30();
        for (let j = 0; j < traitCount; j++) readTrait(r);
    }
    // Class infos
    for (let i = 0; i < classCount; i++) {
        r.readU30(); // cinit
        const traitCount = r.readU30();
        for (let j = 0; j < traitCount; j++) readTrait(r);
    }

    // Scripts
    const scriptCount = r.readU30();
    for (let i = 0; i < scriptCount; i++) {
        r.readU30(); // init
        const traitCount = r.readU30();
        for (let j = 0; j < traitCount; j++) readTrait(r);
    }

    // Method bodies
    const bodyCount = r.readU30();
    const methodBodies: MethodBody[] = [];
    for (let i = 0; i < bodyCount; i++) {
        const methodIdx = r.readU30();
        r.readU30(); // max_stack
        const localCount = r.readU30();
        r.readU30(); // init_scope_depth
        r.readU30(); // max_scope_depth
        const codeLen = r.readU30();
        const code = r.readBytes(codeLen);
        const excCount = r.readU30();
        for (let j = 0; j < excCount; j++) {
            r.readU30(); r.readU30(); r.readU30(); r.readU30(); r.readU30();
        }
        const traitCount = r.readU30();
        for (let j = 0; j < traitCount; j++) readTrait(r);
        methodBodies.push({ methodIdx, code, localCount });
    }

    return { pool, methodBodies };
}

function readTrait(r: ABCReader): void {
    r.readU30(); // name
    const kindAttr = r.readU8();
    const kind = kindAttr & 0x0F;
    switch (kind) {
        case 0: // Slot
        case 6: // Const
            r.readU30(); // slot_id
            r.readU30(); // type_name
            { const vindex = r.readU30(); if (vindex) r.readU8(); } // vkind
            break;
        case 1: // Method
        case 2: // Getter
        case 3: // Setter
            r.readU30(); // disp_id
            r.readU30(); // method
            break;
        case 4: // Class
            r.readU30(); // slot_id
            r.readU30(); // classi
            break;
        case 5: // Function
            r.readU30(); // slot_id
            r.readU30(); // function
            break;
    }
    if (kindAttr & 0x40) { // ATTR_Metadata
        const metaCount = r.readU30();
        for (let j = 0; j < metaCount; j++) r.readU30();
    }
}

// =============================================================================
// Mini AVM2 Virtual Machine
// =============================================================================

class MiniAVM2 {
    private locals: unknown[];
    private stack: unknown[] = [];
    private code: Uint8Array;
    private pc = 0;
    private pool: ABCPool;

    constructor(code: Uint8Array, gameRoot: Record<string, unknown>, storage: Record<string, unknown>, pool: ABCPool, localCount: number) {
        this.code = code;
        this.pool = pool;
        this.locals = new Array(localCount).fill(undefined);
        this.locals[0] = {}; // this (unused scope object)
        this.locals[1] = gameRoot;
        this.locals[2] = storage;
    }

    execute(): unknown {
        while (this.pc < this.code.length) {
            const op = this.code[this.pc++];
            switch (op) {
                // Push values
                case 0x20: this.stack.push(null); break;         // pushnull
                case 0x21: this.stack.push(undefined); break;    // pushundefined
                case 0x24: this.stack.push(this.readS8()); break; // pushbyte
                case 0x25: this.stack.push(this.readU30()); break; // pushshort
                case 0x26: this.stack.push(true); break;         // pushtrue
                case 0x27: this.stack.push(false); break;        // pushfalse
                case 0x28: this.stack.push(NaN); break;          // pushnan
                case 0x2C: this.stack.push(this.pool.strings[this.readU30()]); break; // pushstring
                case 0x2D: this.stack.push(this.pool.ints[this.readU30()]); break;    // pushint
                case 0x2F: this.stack.push(this.pool.doubles[this.readU30()]); break;  // pushdouble

                // Locals 0-3
                case 0xD0: this.stack.push(this.locals[0]); break;
                case 0xD1: this.stack.push(this.locals[1]); break;
                case 0xD2: this.stack.push(this.locals[2]); break;
                case 0xD3: this.stack.push(this.locals[3]); break;
                case 0xD4: this.locals[0] = this.stack.pop(); break;
                case 0xD5: this.locals[1] = this.stack.pop(); break;
                case 0xD6: this.locals[2] = this.stack.pop(); break;
                case 0xD7: this.locals[3] = this.stack.pop(); break;

                // getlocal / setlocal
                case 0x62: this.stack.push(this.locals[this.readU30()]); break;
                case 0x63: this.locals[this.readU30()] = this.stack.pop(); break;

                // Stack
                case 0x29: this.stack.pop(); break;              // pop
                case 0x2A: this.stack.push(this.peek()); break;  // dup
                case 0x2B: { // swap
                    const a = this.stack.pop();
                    const b = this.stack.pop();
                    this.stack.push(a, b);
                    break;
                }

                // Arithmetic
                case 0xA0: { // add (string concat if either is string)
                    const b = this.stack.pop();
                    const a = this.stack.pop();
                    if (typeof a === "string" || typeof b === "string") {
                        this.stack.push(String(a) + String(b));
                    } else {
                        this.stack.push(this.toNum(a) + this.toNum(b));
                    }
                    break;
                }
                case 0xA1: { const b = this.toNum(this.stack.pop()); const a = this.toNum(this.stack.pop()); this.stack.push(a - b); break; } // subtract
                case 0xA2: { const b = this.toNum(this.stack.pop()); const a = this.toNum(this.stack.pop()); this.stack.push(a * b); break; } // multiply
                case 0xA3: { const b = this.toNum(this.stack.pop()); const a = this.toNum(this.stack.pop()); this.stack.push(a / b); break; } // divide
                case 0xA4: { const b = this.toNum(this.stack.pop()); const a = this.toNum(this.stack.pop()); this.stack.push(a % b); break; } // modulo
                case 0x91: this.stack.push(this.toNum(this.stack.pop()) + 1); break; // increment
                case 0x93: this.stack.push(this.toNum(this.stack.pop()) - 1); break; // decrement

                // inclocal / declocal
                case 0x92: { const reg = this.readU30(); this.locals[reg] = this.toNum(this.locals[reg]) + 1; break; }
                case 0x94: { const reg = this.readU30(); this.locals[reg] = this.toNum(this.locals[reg]) - 1; break; }

                // Comparison
                case 0xAB: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a == b); break; }  // equals
                case 0xAC: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(a === b); break; } // strictequals
                case 0xAD: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(this.toNum(a) < this.toNum(b)); break; }  // lessthan
                case 0xAE: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(this.toNum(a) <= this.toNum(b)); break; } // lessequals
                case 0xAF: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(this.toNum(a) > this.toNum(b)); break; }  // greaterthan
                case 0xB0: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(this.toNum(a) >= this.toNum(b)); break; } // greaterequals

                // Logic
                case 0x96: this.stack.push(!this.toBool(this.stack.pop())); break; // not
                case 0xAA: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(this.toNum(a) ^ this.toNum(b)); break; } // bitxor

                // Branching
                case 0x10: { const off = this.readS24(); this.pc += off; break; } // jump
                case 0x11: { const off = this.readS24(); if (this.toBool(this.stack.pop())) this.pc += off; break; } // iftrue
                case 0x12: { const off = this.readS24(); if (!this.toBool(this.stack.pop())) this.pc += off; break; } // iffalse
                case 0x19: { // ifstricteq
                    const off = this.readS24();
                    const b = this.stack.pop();
                    const a = this.stack.pop();
                    if (a === b) this.pc += off;
                    break;
                }
                case 0x1A: { // ifstrictne
                    const off = this.readS24();
                    const b = this.stack.pop();
                    const a = this.stack.pop();
                    if (a !== b) this.pc += off;
                    break;
                }

                // Scope (no-ops for our purposes)
                case 0x30: this.stack.pop(); break; // pushscope
                case 0x1D: break; // popscope
                case 0x64: this.stack.push(null); break; // getglobalscope

                // Property access
                case 0x66: this.opGetProperty(); break;
                case 0x61: this.opSetProperty(); break;
                case 0x5D: this.opFindPropStrict(); break;
                case 0x60: this.opGetLex(); break;
                case 0x68: { this.readU30(); this.stack.pop(); this.stack.pop(); break; } // initproperty (no-op for us)

                // Type checking
                case 0xB3: { // istypelate
                    const type = this.stack.pop();
                    const val = this.stack.pop();
                    if (type === Array) {
                        this.stack.push(Array.isArray(val));
                    } else {
                        this.stack.push(val instanceof (type as any));
                    }
                    break;
                }

                // Calls
                case 0x46: this.opCallProperty(); break;

                // Object/Array
                case 0x56: { // newarray
                    const count = this.readU30();
                    const arr: unknown[] = [];
                    for (let i = 0; i < count; i++) arr.unshift(this.stack.pop());
                    this.stack.push(arr);
                    break;
                }
                case 0x40: { // newfunction
                    this.readU30(); // method index (skip)
                    this.stack.push(null); // placeholder
                    break;
                }
                case 0x58: { // newclass
                    this.readU30();
                    this.stack.pop();
                    this.stack.push(null);
                    break;
                }
                case 0x49: { // constructsuper
                    const argc = this.readU30();
                    for (let i = 0; i < argc; i++) this.stack.pop();
                    this.stack.pop(); // receiver
                    break;
                }

                // Enumeration
                case 0x32: this.opHasNext2(); break;
                case 0x1E: { // nextname
                    const idx = this.toNum(this.stack.pop());
                    const obj = this.stack.pop() as Record<string, unknown>;
                    const keys = obj ? Object.keys(obj) : [];
                    this.stack.push(keys[idx - 1] ?? undefined);
                    break;
                }
                case 0x23: { // nextvalue
                    const idx = this.toNum(this.stack.pop());
                    const obj = this.stack.pop() as Record<string, unknown>;
                    if (obj && typeof obj === "object") {
                        const keys = Object.keys(obj);
                        this.stack.push(obj[keys[idx - 1]]);
                    } else {
                        this.stack.push(undefined);
                    }
                    break;
                }

                // Return
                case 0x47: return undefined; // returnvoid
                case 0x48: return this.stack.pop(); // returnvalue

                // Type conversion (mostly no-ops for our purposes)
                case 0x70: this.stack.push(String(this.stack.pop())); break; // convert_s
                case 0x73: this.stack.push(this.toNum(this.stack.pop()) | 0); break; // convert_i
                case 0x74: this.stack.push(this.toNum(this.stack.pop()) >>> 0); break; // convert_u
                case 0x75: this.stack.push(this.toNum(this.stack.pop())); break; // convert_d
                case 0x76: this.stack.push(this.toBool(this.stack.pop())); break; // convert_b
                case 0x82: break; // coerce_a (no-op)
                case 0x85: this.stack.push(String(this.stack.pop())); break; // coerce_s
                case 0x95: this.stack.push(typeof this.stack.pop()); break; // typeof
                case 0xB1: { // instanceof
                    const type = this.stack.pop() as any;
                    const val = this.stack.pop();
                    this.stack.push(val instanceof type);
                    break;
                }

                default:
                    throw new Error(`Unknown AVM2 opcode 0x${op.toString(16).padStart(2, '0')} at pc=${this.pc - 1}`);
            }
        }
        return undefined;
    }

    private readU30(): number {
        let result = 0;
        let shift = 0;
        for (let i = 0; i < 5; i++) {
            const byte = this.code[this.pc++];
            result |= (byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }
        return result >>> 0;
    }

    private readS8(): number {
        const val = this.code[this.pc++];
        return val >= 128 ? val - 256 : val;
    }

    private readS24(): number {
        const b0 = this.code[this.pc++];
        const b1 = this.code[this.pc++];
        const b2 = this.code[this.pc++];
        let val = b0 | (b1 << 8) | (b2 << 16);
        if (val & 0x800000) val |= ~0xFFFFFF;
        return val;
    }

    private peek(): unknown {
        return this.stack[this.stack.length - 1];
    }

    private toNum(v: unknown): number {
        if (v === undefined || v === null) return 0;
        if (typeof v === "boolean") return v ? 1 : 0;
        if (typeof v === "number") return v;
        return Number(v) || 0;
    }

    private toBool(v: unknown): boolean {
        if (v === undefined || v === null) return false;
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0 && !isNaN(v);
        if (typeof v === "string") return v.length > 0;
        return true;
    }

    private resolveMultiname(mnIdx: number): { name: string | null; isRuntime: boolean } {
        const mn = this.pool.multinames[mnIdx];
        if (!mn) return { name: null, isRuntime: false };
        switch (mn.kind) {
            case 0x07: // QName: ns, name
                return { name: this.pool.strings[mn.data[1]], isRuntime: false };
            case 0x09: // Multiname: name, ns_set
                return { name: this.pool.strings[mn.data[0]], isRuntime: false };
            case 0x1B: // MultinameL: ns_set (name on stack)
                return { name: null, isRuntime: true };
            default:
                return { name: null, isRuntime: false };
        }
    }

    private opGetProperty(): void {
        const mnIdx = this.readU30();
        const { name, isRuntime } = this.resolveMultiname(mnIdx);
        if (isRuntime) {
            const runtimeName = this.stack.pop();
            const obj = this.stack.pop() as Record<string, unknown>;
            if (obj === null || obj === undefined) {
                this.stack.push(undefined);
            } else {
                this.stack.push(obj[String(runtimeName)]);
            }
        } else {
            const obj = this.stack.pop() as Record<string, unknown>;
            if (obj === null || obj === undefined) {
                this.stack.push(undefined);
            } else {
                this.stack.push(obj[name!]);
            }
        }
    }

    private opSetProperty(): void {
        const mnIdx = this.readU30();
        const { name, isRuntime } = this.resolveMultiname(mnIdx);
        const value = this.stack.pop();
        if (isRuntime) {
            const runtimeName = this.stack.pop();
            const obj = this.stack.pop() as Record<string, unknown>;
            if (obj !== null && obj !== undefined) {
                obj[String(runtimeName)] = value;
            }
        } else {
            const obj = this.stack.pop() as Record<string, unknown>;
            if (obj !== null && obj !== undefined) {
                obj[name!] = value;
            }
        }
    }

    private opFindPropStrict(): void {
        const mnIdx = this.readU30();
        // Return a scope proxy — the compiler only uses this for static slots
        this.stack.push({});
    }

    private opGetLex(): void {
        const mnIdx = this.readU30();
        const { name } = this.resolveMultiname(mnIdx);
        if (name === "Math") {
            this.stack.push(Math);
        } else if (name === "Array") {
            this.stack.push(Array);
        } else {
            this.stack.push(undefined);
        }
    }

    private opCallProperty(): void {
        const mnIdx = this.readU30();
        const argc = this.readU30();
        const { name } = this.resolveMultiname(mnIdx);
        const args: unknown[] = [];
        for (let i = 0; i < argc; i++) args.unshift(this.stack.pop());
        const obj = this.stack.pop() as Record<string, Function>;
        if (obj && typeof obj[name!] === "function") {
            this.stack.push(obj[name!](...args));
        } else {
            this.stack.push(undefined);
        }
    }

    private opHasNext2(): void {
        const objReg = this.readU30();
        const idxReg = this.readU30();
        const obj = this.locals[objReg] as Record<string, unknown>;
        const idx = this.toNum(this.locals[idxReg]);
        if (obj && typeof obj === "object") {
            const keys = Object.keys(obj);
            if (idx < keys.length) {
                this.locals[idxReg] = idx + 1;
                this.stack.push(true);
            } else {
                this.locals[objReg] = 0;
                this.locals[idxReg] = 0;
                this.stack.push(false);
            }
        } else {
            this.locals[objReg] = 0;
            this.locals[idxReg] = 0;
            this.stack.push(false);
        }
    }
}

// =============================================================================
// Test Helpers
// =============================================================================

type VMFunction = (gameRoot: Record<string, unknown>, storage: Record<string, unknown>) => unknown;

function extractFromAVM2SWF(swf: Uint8Array, achCount: number, rpCount: number): {
    achFunctions: VMFunction[];
    rpFunctions: VMFunction[];
} {
    // Parse SWF to find DoABC2 tag
    let offset = 8; // FWS + version + fileLength
    offset += 1;    // RECT
    offset += 2;    // FrameRate
    offset += 2;    // FrameCount

    // Scan tags for DoABC2 (type 82)
    let abcData: Uint8Array | null = null;
    while (offset < swf.length) {
        const tagWord = swf[offset] | (swf[offset + 1] << 8);
        const tagType = tagWord >> 6;
        let tagLen = tagWord & 0x3F;
        offset += 2;
        if (tagLen === 0x3F) {
            tagLen = swf[offset] | (swf[offset + 1] << 8) | (swf[offset + 2] << 16) | (swf[offset + 3] << 24);
            offset += 4;
        }
        if (tagType === 0) break; // End tag
        if (tagType === 82) {
            // DoABC2: flags(4) + name(null-terminated) + ABC data
            const contentStart = offset;
            offset += 4; // flags
            while (swf[offset] !== 0) offset++; // skip name
            offset++; // null terminator
            abcData = swf.slice(offset, contentStart + tagLen);
            break;
        }
        offset += tagLen;
    }

    if (!abcData) throw new Error("No DoABC2 tag found in SWF");

    const { pool, methodBodies } = parseABC(abcData);

    // Method bodies 0=iinit, 1=cinit, 2=script init
    // Bodies 3..3+achCount-1 are achievement functions
    // Bodies 3+achCount..3+achCount+rpCount-1 are RP functions
    const makeVMFn = (body: MethodBody): VMFunction =>
        (gameRoot, storage) => new MiniAVM2(body.code, gameRoot, storage, pool, body.localCount).execute();

    const achBodies = methodBodies.filter(b => b.methodIdx >= 3 && b.methodIdx < 3 + achCount);
    const rpBodies = methodBodies.filter(b => b.methodIdx >= 3 + achCount && b.methodIdx < 3 + achCount + rpCount);

    return {
        achFunctions: achBodies.map(makeVMFn),
        rpFunctions: rpBodies.map(makeVMFn),
    };
}

function compileAndExtract(assets: unknown[]): {
    functions: VMFunction[];
    compiledIndices: number[];
    rpFunctions: VMFunction[];
    rpCompiledIndices: number[];
} {
    const result = compileAchievementsSWF(assets);
    const { achFunctions, rpFunctions } = extractFromAVM2SWF(
        result.swf, result.compiledIndices.length, result.rpCompiledIndices.length
    );
    return {
        functions: achFunctions,
        compiledIndices: result.compiledIndices,
        rpFunctions,
        rpCompiledIndices: result.rpCompiledIndices,
    };
}

function makeAsset(
    groups: Array<{
        type?: string;
        requirements: Array<{
            addressA?: string;
            addressB?: string;
            cmp?: string;
            maxHits?: number;
            flag?: string;
            typeA?: string;
            typeB?: string;
        }>;
    }>,
): Record<string, unknown> {
    return {
        groups: groups.map(g => ({
            type: g.type || "CORE",
            requirements: g.requirements.map(r => ({
                addressA: r.addressA ?? "0",
                addressB: r.addressB ?? "0",
                cmp: r.cmp ?? "==",
                maxHits: r.maxHits ?? 0,
                flag: r.flag ?? "",
                typeA: r.typeA ?? "",
                typeB: r.typeB ?? "",
            })),
        })),
    };
}

function simpleAsset(
    reqs: Array<{
        addressA?: string;
        addressB?: string;
        cmp?: string;
        maxHits?: number;
        flag?: string;
        typeA?: string;
        typeB?: string;
    }>,
): Record<string, unknown> {
    return makeAsset([{ requirements: reqs }]);
}

function compileSingle(asset: Record<string, unknown>): VMFunction {
    const { functions } = compileAndExtract([asset]);
    return functions[0];
}

// =============================================================================
// Compilation smoke tests
// =============================================================================

test("NativeEvalAVM2 - compiles empty requirement list throws", () => {
    assertThrows(() => {
        compileAchievementsSWF([{ groups: [] }]);
    });
});

test("NativeEvalAVM2 - compiles single requirement", () => {
    const asset = simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "==" }]);
    const { functions, compiledIndices } = compileAndExtract([asset]);
    assertEqual(functions.length, 1);
    assertEqual(compiledIndices, [0]);
});

test("NativeEvalAVM2 - separates RICH_PRESENCE and achievement assets", () => {
    const assets = [
        { type: "RICH_PRESENCE", formula: '"Hello"', groups: [] },
        simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "==" }]),
    ];
    const { functions, compiledIndices, rpFunctions, rpCompiledIndices } = compileAndExtract(assets);
    assertEqual(functions.length, 1);
    assertEqual(compiledIndices, [1]);
    assertEqual(rpFunctions.length, 1);
    assertEqual(rpCompiledIndices, [0]);
});

test("NativeEvalAVM2 - throws on unknown flag", () => {
    assertThrows(() => {
        compileAchievementsSWF([simpleAsset([{ addressA: "0", addressB: "0", cmp: "==", flag: "UNKNOWN_FLAG" }])]);
    });
});

test("NativeEvalAVM2 - throws on unknown group type", () => {
    assertThrows(() => {
        compileAchievementsSWF([makeAsset([{ type: "UNKNOWN", requirements: [{ addressA: "0", addressB: "0", cmp: "==" }] }])]);
    });
});

// =============================================================================
// Basic comparisons
// =============================================================================

test("NativeEvalAVM2 - equal true", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "==" }]));
    assertEqual(fn({ x: 10 }, {}), 1);
});

test("NativeEvalAVM2 - equal false", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "==" }]));
    assertEqual(fn({ x: 5 }, {}), 0);
});

test("NativeEvalAVM2 - not equal true", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "!=" }]));
    assertEqual(fn({ x: 5 }, {}), 1);
});

test("NativeEvalAVM2 - not equal false", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "!=" }]));
    assertEqual(fn({ x: 10 }, {}), 0);
});

test("NativeEvalAVM2 - greater true", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: ">" }]));
    assertEqual(fn({ x: 15 }, {}), 1);
});

test("NativeEvalAVM2 - greater false", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: ">" }]));
    assertEqual(fn({ x: 10 }, {}), 0);
});

test("NativeEvalAVM2 - greater_equal true at boundary", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: ">=" }]));
    assertEqual(fn({ x: 10 }, {}), 1);
});

test("NativeEvalAVM2 - greater_equal false", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: ">=" }]));
    assertEqual(fn({ x: 9 }, {}), 0);
});

test("NativeEvalAVM2 - less true", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "<" }]));
    assertEqual(fn({ x: 5 }, {}), 1);
});

test("NativeEvalAVM2 - less false", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "<" }]));
    assertEqual(fn({ x: 10 }, {}), 0);
});

test("NativeEvalAVM2 - less_equal true at boundary", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "<=" }]));
    assertEqual(fn({ x: 10 }, {}), 1);
});

test("NativeEvalAVM2 - less_equal false", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "<=" }]));
    assertEqual(fn({ x: 11 }, {}), 0);
});

// =============================================================================
// Multiple requirements (all must pass)
// =============================================================================

test("NativeEvalAVM2 - two requirements both pass", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "10", cmp: ">=" },
        { addressA: "stage.y", addressB: "5", cmp: "<" },
    ]));
    assertEqual(fn({ x: 15, y: 3 }, {}), 1);
});

test("NativeEvalAVM2 - two requirements one fails", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "10", cmp: ">=" },
        { addressA: "stage.y", addressB: "5", cmp: "<" },
    ]));
    assertEqual(fn({ x: 15, y: 6 }, {}), 0);
});

// =============================================================================
// Hit tracking
// =============================================================================

test("NativeEvalAVM2 - hit tracking increments on pass", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 3 },
    ]));
    const storage: Record<string, unknown> = {};
    assertEqual(fn({ x: 1 }, storage), 0);
    assertEqual(storage["h0_0"], 1);
    assertEqual(fn({ x: 1 }, storage), 0);
    assertEqual(storage["h0_0"], 2);
    assertEqual(fn({ x: 1 }, storage), 1);
    assertEqual(storage["h0_0"], 3);
});

test("NativeEvalAVM2 - hit tracking does not increment on fail", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 3 },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 1 }, storage);
    assertEqual(storage["h0_0"], 1);
    fn({ x: 0 }, storage);
    assertEqual(storage["h0_0"], 1); // unchanged
});

test("NativeEvalAVM2 - hit tracking caps at maxHits", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 2 },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 1 }, storage);
    fn({ x: 1 }, storage);
    fn({ x: 1 }, storage);
    assertEqual(storage["h0_0"], 2); // capped
});

test("NativeEvalAVM2 - locked true with multiple requirements", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 1 },
        { addressA: "stage.y", addressB: "1", cmp: "==" },
    ]));
    const storage: Record<string, unknown> = {};
    assertEqual(fn({ x: 1, y: 0 }, storage), 0);
    assertEqual(storage["h0_0"], 1);
    assertEqual(fn({ x: 0, y: 1 }, storage), 1);
});

// =============================================================================
// Delta values
// =============================================================================

test("NativeEvalAVM2 - delta first frame not initialized", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "0", cmp: ">", typeA: "DELTA" },
    ]));
    const storage: Record<string, unknown> = {};
    assertEqual(fn({ x: 10 }, storage), 0);
    assertEqual(fn({ x: 20 }, storage), 1);
});

test("NativeEvalAVM2 - delta uses previous frame value", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "10", cmp: "==", typeA: "DELTA" },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 10 }, storage);
    assertEqual(fn({ x: 15 }, storage), 1);
});

test("NativeEvalAVM2 - delta on B side", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "5", addressB: "stage.x", cmp: "==", typeB: "DELTA" },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 5 }, storage);
    assertEqual(fn({ x: 10 }, storage), 1);
    assertEqual(fn({ x: 10 }, storage), 0);
});

// =============================================================================
// PAUSE_IF
// =============================================================================

test("NativeEvalAVM2 - PAUSE_IF transient pauses when true", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.paused", addressB: "1", cmp: "==", flag: "PAUSE_IF" },
        { addressA: "stage.x", addressB: "1", cmp: "==" },
    ]));
    assertEqual(fn({ paused: 1, x: 1 }, {}), 0);
    assertEqual(fn({ paused: 0, x: 1 }, {}), 1);
});

test("NativeEvalAVM2 - PAUSE_IF threshold pauses after hits", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.flag", addressB: "1", cmp: "==", flag: "PAUSE_IF", maxHits: 2 },
        { addressA: "stage.x", addressB: "1", cmp: "==" },
    ]));
    const storage: Record<string, unknown> = {};
    assertEqual(fn({ flag: 1, x: 1 }, storage), 1);
    assertEqual(fn({ flag: 1, x: 1 }, storage), 0);
    assertEqual(fn({ flag: 0, x: 1 }, storage), 0);
});

// =============================================================================
// RESET_IF
// =============================================================================

test("NativeEvalAVM2 - RESET_IF transient clears hits", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 3 },
        { addressA: "stage.reset", addressB: "1", cmp: "==", flag: "RESET_IF" },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 1, reset: 0 }, storage);
    fn({ x: 1, reset: 0 }, storage);
    assertEqual(storage["h0_0"], 2);
    assertEqual(fn({ x: 1, reset: 1 }, storage), 0);
    assertEqual(storage["h0_0"], 0);
});

test("NativeEvalAVM2 - RESET_IF returns 0 even if all met", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==" },
        { addressA: "stage.x", addressB: "1", cmp: "==", flag: "RESET_IF" },
    ]));
    assertEqual(fn({ x: 1 }, {}), 0);
});

// =============================================================================
// RESET_NEXT_IF
// =============================================================================

test("NativeEvalAVM2 - RESET_NEXT_IF clears next requirement hits", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.reset", addressB: "1", cmp: "==", flag: "RESET_NEXT_IF" },
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 5 },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ reset: 0, x: 1 }, storage);
    fn({ reset: 0, x: 1 }, storage);
    assertEqual(storage["h0_1"], 2);
    fn({ reset: 1, x: 1 }, storage);
    assertEqual(storage["h0_1"], 0);
});

// =============================================================================
// AND_NEXT / OR_NEXT chains
// =============================================================================

test("NativeEvalAVM2 - AND_NEXT both pass", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", flag: "AND_NEXT" },
        { addressA: "stage.y", addressB: "1", cmp: "==" },
    ]));
    assertEqual(fn({ x: 1, y: 1 }, {}), 1);
});

test("NativeEvalAVM2 - AND_NEXT first fails", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", flag: "AND_NEXT" },
        { addressA: "stage.y", addressB: "1", cmp: "==" },
    ]));
    assertEqual(fn({ x: 0, y: 1 }, {}), 0);
});

test("NativeEvalAVM2 - OR_NEXT either passes", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", flag: "OR_NEXT" },
        { addressA: "stage.y", addressB: "1", cmp: "==" },
    ]));
    assertEqual(fn({ x: 0, y: 1 }, {}), 1);
    assertEqual(fn({ x: 1, y: 0 }, {}), 1);
});

test("NativeEvalAVM2 - OR_NEXT both fail", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", flag: "OR_NEXT" },
        { addressA: "stage.y", addressB: "1", cmp: "==" },
    ]));
    assertEqual(fn({ x: 0, y: 0 }, {}), 0);
});

test("NativeEvalAVM2 - multi-step AND chain", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.a", addressB: "1", cmp: "==", flag: "AND_NEXT" },
        { addressA: "stage.b", addressB: "1", cmp: "==", flag: "AND_NEXT" },
        { addressA: "stage.c", addressB: "1", cmp: "==" },
    ]));
    assertEqual(fn({ a: 1, b: 1, c: 1 }, {}), 1);
    assertEqual(fn({ a: 1, b: 0, c: 1 }, {}), 0);
});

// =============================================================================
// ADD_HITS / SUB_HITS
// =============================================================================

test("NativeEvalAVM2 - ADD_HITS contributes to terminal", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.bonus", addressB: "1", cmp: "==", flag: "ADD_HITS" },
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 3 },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ bonus: 1, x: 1 }, storage);
    assertEqual(storage["h0_1"], 1);
    assertEqual(storage["h0_0"], 1);
    assertEqual(fn({ bonus: 1, x: 1 }, storage), 1);
});

test("NativeEvalAVM2 - SUB_HITS reduces effective hits", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.penalty", addressB: "1", cmp: "==", flag: "SUB_HITS" },
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 5 },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ penalty: 0, x: 1 }, storage);
    fn({ penalty: 0, x: 1 }, storage);
    fn({ penalty: 0, x: 1 }, storage);
    fn({ penalty: 1, x: 1 }, storage);
    assertEqual(storage["h0_1"], 4);
    assertEqual(storage["h0_0"], 1);
});

// =============================================================================
// ADD_SOURCE / SUB_SOURCE
// =============================================================================

test("NativeEvalAVM2 - ADD_SOURCE adds to next requirement formula A", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.bonus", addressB: "0", cmp: "==", flag: "ADD_SOURCE" },
        { addressA: "stage.base", addressB: "15", cmp: ">=" },
    ]));
    assertEqual(fn({ bonus: 5, base: 10 }, {}), 1);
    assertEqual(fn({ bonus: 4, base: 10 }, {}), 0);
});

test("NativeEvalAVM2 - SUB_SOURCE subtracts from next requirement formula A", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.penalty", addressB: "0", cmp: "==", flag: "SUB_SOURCE" },
        { addressA: "stage.base", addressB: "5", cmp: ">=" },
    ]));
    assertEqual(fn({ penalty: 3, base: 10 }, {}), 1);
    assertEqual(fn({ penalty: 6, base: 10 }, {}), 0);
});

// =============================================================================
// TRIGGER / primed state
// =============================================================================

test("NativeEvalAVM2 - TRIGGER sets primed when non-trigger met but trigger not", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==" },
        { addressA: "stage.boss", addressB: "1", cmp: "==", flag: "TRIGGER" },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 1, boss: 0 }, storage);
    assertEqual(!!storage["_primed"], true);
    assertEqual(fn({ x: 1, boss: 0 }, storage), 0);
});

test("NativeEvalAVM2 - TRIGGER triggers when all met", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==" },
        { addressA: "stage.boss", addressB: "1", cmp: "==", flag: "TRIGGER" },
    ]));
    assertEqual(fn({ x: 1, boss: 1 }, {}), 1);
});

test("NativeEvalAVM2 - TRIGGER not primed when non-trigger not met", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==" },
        { addressA: "stage.boss", addressB: "1", cmp: "==", flag: "TRIGGER" },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 0, boss: 0 }, storage);
    // In AVM2, primed is boolean; false when not primed
    assertEqual(!!storage["_primed"], false);
});

// =============================================================================
// MEASURED
// =============================================================================

test("NativeEvalAVM2 - MEASURED hit-count mode stores current and target", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 10, flag: "MEASURED" },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 1 }, storage);
    assertEqual(storage["_mCur"], 1);
    assertEqual(storage["_mTgt"], 10);
    fn({ x: 1 }, storage);
    assertEqual(storage["_mCur"], 2);
});

test("NativeEvalAVM2 - MEASURED value mode stores formula results", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.score", addressB: "100", cmp: ">=", flag: "MEASURED" },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ score: 50 }, storage);
    assertEqual(storage["_mCur"], 50);
    assertEqual(storage["_mTgt"], 100);
});

// =============================================================================
// Multiple groups (CORE + ALT)
// =============================================================================

test("NativeEvalAVM2 - CORE only passes when CORE passes", () => {
    const fn = compileSingle(makeAsset([
        { type: "CORE", requirements: [{ addressA: "stage.x", addressB: "1", cmp: "==" }] },
        { type: "ALT", requirements: [{ addressA: "stage.a", addressB: "1", cmp: "==" }] },
        { type: "ALT", requirements: [{ addressA: "stage.b", addressB: "1", cmp: "==" }] },
    ]));
    assertEqual(fn({ x: 0, a: 1, b: 1 }, {}), 0);
});

test("NativeEvalAVM2 - CORE + any ALT triggers", () => {
    const fn = compileSingle(makeAsset([
        { type: "CORE", requirements: [{ addressA: "stage.x", addressB: "1", cmp: "==" }] },
        { type: "ALT", requirements: [{ addressA: "stage.a", addressB: "1", cmp: "==" }] },
        { type: "ALT", requirements: [{ addressA: "stage.b", addressB: "1", cmp: "==" }] },
    ]));
    assertEqual(fn({ x: 1, a: 1, b: 0 }, {}), 1);
    assertEqual(fn({ x: 1, a: 0, b: 1 }, {}), 1);
});

test("NativeEvalAVM2 - CORE + no ALT fails", () => {
    const fn = compileSingle(makeAsset([
        { type: "CORE", requirements: [{ addressA: "stage.x", addressB: "1", cmp: "==" }] },
        { type: "ALT", requirements: [{ addressA: "stage.a", addressB: "1", cmp: "==" }] },
        { type: "ALT", requirements: [{ addressA: "stage.b", addressB: "1", cmp: "==" }] },
    ]));
    assertEqual(fn({ x: 1, a: 0, b: 0 }, {}), 0);
});

// =============================================================================
// Nested property access
// =============================================================================

test("NativeEvalAVM2 - two-level property access", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.player.health", addressB: "0", cmp: "==" },
    ]));
    assertEqual(fn({ player: { health: 0 } }, {}), 1);
    assertEqual(fn({ player: { health: 5 } }, {}), 0);
});

test("NativeEvalAVM2 - three-level property access", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.world.player.hp", addressB: "100", cmp: ">=" },
    ]));
    assertEqual(fn({ world: { player: { hp: 100 } } }, {}), 1);
    assertEqual(fn({ world: { player: { hp: 99 } } }, {}), 0);
});

// =============================================================================
// Arithmetic in formulas
// =============================================================================

test("NativeEvalAVM2 - formula with addition", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x + stage.y", addressB: "10", cmp: "==" },
    ]));
    assertEqual(fn({ x: 3, y: 7 }, {}), 1);
    assertEqual(fn({ x: 3, y: 6 }, {}), 0);
});

test("NativeEvalAVM2 - formula with multiplication", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x * 2", addressB: "10", cmp: "==" },
    ]));
    assertEqual(fn({ x: 5 }, {}), 1);
    assertEqual(fn({ x: 4 }, {}), 0);
});

// =============================================================================
// Edge cases
// =============================================================================

test("NativeEvalAVM2 - constant true (0 == 0)", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "0", addressB: "0", cmp: "==" }]));
    assertEqual(fn({}, {}), 1);
});

test("NativeEvalAVM2 - constant false (0 == 1)", () => {
    const fn = compileSingle(simpleAsset([{ addressA: "0", addressB: "1", cmp: "==" }]));
    assertEqual(fn({}, {}), 0);
});

test("NativeEvalAVM2 - multiple assets compiled together", () => {
    const assets = [
        simpleAsset([{ addressA: "stage.a", addressB: "1", cmp: "==" }]),
        simpleAsset([{ addressA: "stage.b", addressB: "1", cmp: "==" }]),
        simpleAsset([{ addressA: "stage.c", addressB: "1", cmp: "==" }]),
    ];
    const { functions, compiledIndices } = compileAndExtract(assets);
    assertEqual(functions.length, 3);
    assertEqual(compiledIndices, [0, 1, 2]);
    assertEqual(functions[0]({ a: 1 }, {}), 1);
    assertEqual(functions[1]({ b: 1 }, {}), 1);
    assertEqual(functions[2]({ c: 0 }, {}), 0);
});

test("NativeEvalAVM2 - storage isolation between achievements", () => {
    const assets = [
        simpleAsset([{ addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 2 }]),
        simpleAsset([{ addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 3 }]),
    ];
    const { functions } = compileAndExtract(assets);
    const storage0: Record<string, unknown> = {};
    const storage1: Record<string, unknown> = {};
    functions[0]({ x: 1 }, storage0);
    assertEqual(storage0["h0_0"], 1);
    assertEqual(storage1["h0_0"], undefined);
});

// =============================================================================
// REMEMBER (cached values)
// =============================================================================

test("NativeEvalAVM2 - REMEMBER caches last value", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "{stage.x}", addressB: "5", cmp: "==" },
    ]));
    const storage: Record<string, unknown> = {};
    assertEqual(fn({ x: 5 }, storage), 1);
    assertEqual(fn({}, storage), 1);
});

// =============================================================================
// Both sides are stage properties
// =============================================================================

test("NativeEvalAVM2 - both sides are stage properties", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.health", addressB: "stage.maxHealth", cmp: "==" },
    ]));
    assertEqual(fn({ health: 100, maxHealth: 100 }, {}), 1);
    assertEqual(fn({ health: 50, maxHealth: 100 }, {}), 0);
});

// =============================================================================
// Rich Presence compilation tests
// =============================================================================

function compileRP(formula: string): VMFunction {
    const assets = [{ type: "RICH_PRESENCE", formula, groups: [] }];
    const { rpFunctions } = compileAndExtract(assets);
    assertEqual(rpFunctions.length, 1);
    return rpFunctions[0];
}

test("RP AVM2 - string literal", () => {
    const fn = compileRP('"Hello World"');
    assertEqual(fn({}, {}), "Hello World");
});

test("RP AVM2 - property access as string", () => {
    const fn = compileRP('"Level: " + stage.level');
    assertEqual(fn({ level: 5 }, {}), "Level: 5");
});

test("RP AVM2 - nested property access", () => {
    const fn = compileRP('"HP: " + stage.player.health');
    assertEqual(fn({ player: { health: 100 } }, {}), "HP: 100");
});

test("RP AVM2 - ternary expression", () => {
    const fn = compileRP('stage.alive ? "Alive" : "Dead"');
    assertEqual(fn({ alive: 1 }, {}), "Alive");
    assertEqual(fn({ alive: 0 }, {}), "Dead");
});

test("RP AVM2 - pure numeric formula", () => {
    const fn = compileRP("stage.x * 2 + 1");
    assertEqual(fn({ x: 5 }, {}), 11);
});

test("RP AVM2 - REMEMBER caches last non-empty", () => {
    const fn = compileRP("{stage.status}");
    const storage: Record<string, unknown> = {};
    assertEqual(fn({ status: "Playing" }, storage), "Playing");
    assertEqual(fn({}, storage), "Playing");
    assertEqual(fn({ status: "Menu" }, storage), "Menu");
});

test("RP AVM2 - empty formula returns empty string", () => {
    const fn = compileRP('""');
    assertEqual(fn({}, {}), "");
});

// =============================================================================
// len() function
// =============================================================================

test("RP AVM2 - len() returns array length", () => {
    const fn = compileRP("len(stage.items)");
    assertEqual(fn({ items: [1, 2, 3] }, {}), 3);
    assertEqual(fn({ items: [] }, {}), 0);
});

test("NativeEvalAVM2 - len() in achievement condition", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "len(stage.enemies)", addressB: "3", cmp: ">=" },
    ]));
    assertEqual(fn({ enemies: [1, 2, 3] }, {}), 1);
    assertEqual(fn({ enemies: [1, 2] }, {}), 0);
});

test("NativeEvalAVM2 - len() on non-array returns 1", () => {
    const fn = compileRP("len(stage.player)");
    assertEqual(fn({ player: { hp: 100 } }, {}), 1);
});

// =============================================================================
// AND_NEXT chain ending in PAUSE_IF
// =============================================================================

test("NativeEvalAVM2 - AND_NEXT chain ending in PAUSE_IF", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.flag1", addressB: "1", cmp: "==", flag: "AND_NEXT" },
        { addressA: "stage.flag2", addressB: "1", cmp: "==", flag: "PAUSE_IF" },
        { addressA: "stage.x", addressB: "1", cmp: "==" },
    ]));
    assertEqual(fn({ flag1: 1, flag2: 1, x: 1 }, {}), 0);
    assertEqual(fn({ flag1: 0, flag2: 1, x: 1 }, {}), 1);
});

// =============================================================================
// Complex multi-feature
// =============================================================================

test("NativeEvalAVM2 - hit tracking + RESET_IF together", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 3 },
        { addressA: "stage.dead", addressB: "1", cmp: "==", flag: "RESET_IF" },
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 1, dead: 0 }, storage);
    fn({ x: 1, dead: 0 }, storage);
    assertEqual(storage["h0_0"], 2);
    fn({ x: 1, dead: 1 }, storage);
    assertEqual(storage["h0_0"], 0);
    fn({ x: 1, dead: 0 }, storage);
    fn({ x: 1, dead: 0 }, storage);
    fn({ x: 1, dead: 0 }, storage);
    assertEqual(fn({ x: 1, dead: 0 }, storage), 1);
});

test("NativeEvalAVM2 - multi-group with RESET_IF in CORE", () => {
    const fn = compileSingle(makeAsset([
        { type: "CORE", requirements: [
            { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 2 },
            { addressA: "stage.dead", addressB: "1", cmp: "==", flag: "RESET_IF" },
        ]},
        { type: "ALT", requirements: [
            { addressA: "stage.path", addressB: "1", cmp: "==" },
        ]},
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 1, dead: 0, path: 1 }, storage);
    fn({ x: 1, dead: 0, path: 1 }, storage);
    assertEqual(fn({ x: 1, dead: 0, path: 1 }, storage), 1);
});

// =============================================================================
// Mixed achievements and RP in same compilation
// =============================================================================

test("NativeEvalAVM2 - mixed achievements and RP", () => {
    const assets = [
        simpleAsset([{ addressA: "stage.x", addressB: "10", cmp: "==" }]),
        { type: "RICH_PRESENCE", formula: '"Level " + stage.level', groups: [] },
        simpleAsset([{ addressA: "stage.y", addressB: "5", cmp: ">=" }]),
    ];
    const { functions, compiledIndices, rpFunctions, rpCompiledIndices } = compileAndExtract(assets);
    assertEqual(functions.length, 2);
    assertEqual(compiledIndices, [0, 2]);
    assertEqual(rpFunctions.length, 1);
    assertEqual(rpCompiledIndices, [1]);
    assertEqual(functions[0]({ x: 10 }, {}), 1);
    assertEqual(rpFunctions[0]({ level: 3 }, {}), "Level 3");
});

// =============================================================================
// MEASURED_IF gate
// =============================================================================

test("NativeEvalAVM2 - MEASURED_IF gates MEASURED output", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.gate", addressB: "1", cmp: "==", flag: "MEASURED_IF" },
        { addressA: "stage.score", addressB: "100", cmp: ">=", flag: "MEASURED" },
    ]));
    const storage: Record<string, unknown> = {};
    // Gate passes, score measured
    fn({ gate: 1, score: 50 }, storage);
    assertEqual(storage["_mCur"], 50);
    // Gate fails, measured current should be 0
    fn({ gate: 0, score: 75 }, storage);
    assertEqual(storage["_mCur"], 0);
});

// =============================================================================
// RESET_IF clears ALL groups' hits
// =============================================================================

test("NativeEvalAVM2 - RESET_IF in CORE clears ALT group hits too", () => {
    const fn = compileSingle(makeAsset([
        { type: "CORE", requirements: [
            { addressA: "stage.x", addressB: "1", cmp: "==" },
            { addressA: "stage.dead", addressB: "1", cmp: "==", flag: "RESET_IF" },
        ]},
        { type: "ALT", requirements: [
            { addressA: "stage.a", addressB: "1", cmp: "==", maxHits: 3 },
        ]},
    ]));
    const storage: Record<string, unknown> = {};
    fn({ x: 1, dead: 0, a: 1 }, storage);
    fn({ x: 1, dead: 0, a: 1 }, storage);
    assertEqual(storage["h1_0"], 2);
    fn({ x: 1, dead: 1, a: 1 }, storage);
    assertEqual(storage["h1_0"], 0);
});

// =============================================================================
// Multi-frame hit tracking sequence
// =============================================================================

test("NativeEvalAVM2 - 10-frame hit tracking sequence", () => {
    const fn = compileSingle(simpleAsset([
        { addressA: "stage.x", addressB: "1", cmp: "==", maxHits: 5 },
        { addressA: "stage.y", addressB: "1", cmp: "==", maxHits: 3 },
    ]));
    const storage: Record<string, unknown> = {};
    const frames: Array<{ x: number; y: number }> = [
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: 1, y: 0 },
    ];
    for (let i = 0; i < frames.length - 1; i++) {
        assertEqual(fn(frames[i], storage), 0, `frame ${i} should not trigger`);
    }
    assertEqual(fn(frames[frames.length - 1], storage), 1, "final frame should trigger");
    assertEqual(storage["h0_0"], 5);
    assertEqual(storage["h0_1"], 3);
});
