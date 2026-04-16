/**
 * AVM2 bytecode builder for generating native compiled achievement/RP functions.
 *
 * Produces ABC (ActionScript Byte Code) data for embedding in AVM2 SWF files.
 * Each achievement/RP becomes a native function that runs at Flash VM speed
 * instead of being interpreted token-by-token.
 *
 * Architecture mirrors AVM1Builder.ts but targets the AVM2 instruction set:
 * - AVM2ConstantPool: manages deduplicated constant pool entries
 * - AVM2Code: emits method body bytecodes referencing the shared pool
 * - buildNativeEvalABC/SWF: assembles everything into ABC/SWF format
 */

const textEncoder = new TextEncoder();

// ─── Encoding helpers ────────────────────────────────────────────────────────

function encodeU30(value: number, out: number[]): void {
    value >>>= 0;
    do {
        let byte = value & 0x7F;
        value >>>= 7;
        if (value > 0) byte |= 0x80;
        out.push(byte);
    } while (value > 0);
}

function encodeS24(value: number, out: number[]): void {
    out.push(value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF);
}

function writeU16(value: number, out: number[]): void {
    out.push(value & 0xFF, (value >> 8) & 0xFF);
}

function writeU32(value: number, out: number[]): void {
    out.push(value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >> 24) & 0xFF);
}

function writeString(s: string, out: number[]): void {
    const bytes = textEncoder.encode(s);
    encodeU30(bytes.length, out);
    for (const b of bytes) out.push(b);
}

function writeF64(n: number, out: number[]): void {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, n, true); // standard little-endian (no SWF word-swap for AVM2)
    for (let i = 0; i < 8; i++) out.push(view.getUint8(i));
}

// ─── Constant Pool ──────────────────────────────────────────────────────────

/**
 * Manages the ABC constant pool with automatic deduplication.
 * Index 0 is implicit for all pool sections (default/any value).
 */
export class AVM2ConstantPool {
    private _ints: number[] = [];
    private _intMap = new Map<number, number>();

    private _doubles: number[] = [];
    private _doubleMap = new Map<number, number>();

    private _strings: string[] = [];
    private _stringMap = new Map<string, number>();

    private _namespaces: Array<[number, number]> = []; // [kind, nameStringIdx]
    private _nsMap = new Map<string, number>();

    private _nsSets: Array<number[]> = [];
    private _nsSetMap = new Map<string, number>();

    private _multinames: Array<{ kind: number; data: number[] }> = [];
    private _mnMap = new Map<string, number>();

    /** Public namespace index (PackageNamespace("")) — always 1. */
    readonly publicNs: number;
    /** Namespace set {public} — always 1. */
    readonly publicNsSet: number;
    /** MultinameL with public ns set — for dynamic property access with name on stack. */
    readonly latePub: number;

    constructor() {
        // String[1] = "" (explicit empty, required for public namespace name)
        this._strings.push("");
        this._stringMap.set("", 1);

        // Namespace[1] = PackageNamespace("") = public
        this._namespaces.push([0x16, 1]);
        this._nsMap.set("0x16:1", 1);
        this.publicNs = 1;

        // NsSet[1] = {public}
        this._nsSets.push([1]);
        this._nsSetMap.set("1", 1);
        this.publicNsSet = 1;

        // Multiname[1] = MultinameL({public}) — late-bound name, public namespace
        this._multinames.push({ kind: 0x1B, data: [1] });
        this._mnMap.set("ML:1", 1);
        this.latePub = 1;
    }

    addString(s: string): number {
        const existing = this._stringMap.get(s);
        if (existing !== undefined) return existing;
        this._strings.push(s);
        const idx = this._strings.length; // 1-based (index 0 is implicit)
        this._stringMap.set(s, idx);
        return idx;
    }

    addInt(n: number): number {
        n = n | 0; // ensure integer
        const existing = this._intMap.get(n);
        if (existing !== undefined) return existing;
        this._ints.push(n);
        const idx = this._ints.length;
        this._intMap.set(n, idx);
        return idx;
    }

    addDouble(n: number): number {
        const existing = this._doubleMap.get(n);
        if (existing !== undefined) return existing;
        this._doubles.push(n);
        const idx = this._doubles.length;
        this._doubleMap.set(n, idx);
        return idx;
    }

    addNamespace(kind: number, nameStringIdx: number): number {
        const key = `${kind}:${nameStringIdx}`;
        const existing = this._nsMap.get(key);
        if (existing !== undefined) return existing;
        this._namespaces.push([kind, nameStringIdx]);
        const idx = this._namespaces.length;
        this._nsMap.set(key, idx);
        return idx;
    }

    addNsSet(nsIndices: number[]): number {
        const key = nsIndices.join(",");
        const existing = this._nsSetMap.get(key);
        if (existing !== undefined) return existing;
        this._nsSets.push([...nsIndices]);
        const idx = this._nsSets.length;
        this._nsSetMap.set(key, idx);
        return idx;
    }

    /** Add QName multiname: specific namespace + specific name string. */
    addQName(nsIdx: number, nameStr: string): number {
        const nameIdx = this.addString(nameStr);
        const key = `Q:${nsIdx}:${nameIdx}`;
        const existing = this._mnMap.get(key);
        if (existing !== undefined) return existing;
        this._multinames.push({ kind: 0x07, data: [nsIdx, nameIdx] });
        const idx = this._multinames.length;
        this._mnMap.set(key, idx);
        return idx;
    }

    /** Add Multiname: name string + namespace set (for untyped/dynamic lookup). */
    addMultiname(nameStr: string, nsSetIdx: number): number {
        const nameIdx = this.addString(nameStr);
        const key = `M:${nameIdx}:${nsSetIdx}`;
        const existing = this._mnMap.get(key);
        if (existing !== undefined) return existing;
        this._multinames.push({ kind: 0x09, data: [nameIdx, nsSetIdx] });
        const idx = this._multinames.length;
        this._mnMap.set(key, idx);
        return idx;
    }

    /** Add MultinameL: late-bound name (popped from stack) + namespace set. */
    addMultinameL(nsSetIdx: number): number {
        const key = `ML:${nsSetIdx}`;
        const existing = this._mnMap.get(key);
        if (existing !== undefined) return existing;
        this._multinames.push({ kind: 0x1B, data: [nsSetIdx] });
        const idx = this._multinames.length;
        this._mnMap.set(key, idx);
        return idx;
    }

    /** Convenience: QName in the public namespace. */
    publicQName(name: string): number {
        return this.addQName(this.publicNs, name);
    }

    /** Convenience: Multiname with public namespace set (for property access on untyped objects). */
    publicMultiname(name: string): number {
        return this.addMultiname(name, this.publicNsSet);
    }

    /** Serialize the constant pool to ABC format. */
    serialize(out: number[]): void {
        // Ints: count = entries + 1 (index 0 is implicit 0)
        encodeU30(this._ints.length > 0 ? this._ints.length + 1 : 0, out);
        for (const n of this._ints) encodeU30(n, out); // S32 encoded as U30

        // UInts: not used
        encodeU30(0, out);

        // Doubles: count = entries + 1 (index 0 is implicit NaN)
        encodeU30(this._doubles.length > 0 ? this._doubles.length + 1 : 0, out);
        for (const n of this._doubles) writeF64(n, out);

        // Strings: count = entries + 1 (index 0 is implicit "")
        encodeU30(this._strings.length + 1, out);
        for (const s of this._strings) writeString(s, out);

        // Namespaces: count = entries + 1 (index 0 is implicit any/*)
        encodeU30(this._namespaces.length + 1, out);
        for (const [kind, nameIdx] of this._namespaces) {
            out.push(kind);
            encodeU30(nameIdx, out);
        }

        // Namespace sets: count = entries + 1
        encodeU30(this._nsSets.length + 1, out);
        for (const ns of this._nsSets) {
            encodeU30(ns.length, out);
            for (const idx of ns) encodeU30(idx, out);
        }

        // Multinames: count = entries + 1 (index 0 is implicit *)
        encodeU30(this._multinames.length + 1, out);
        for (const mn of this._multinames) {
            out.push(mn.kind);
            for (const d of mn.data) encodeU30(d, out);
        }
    }
}

// ─── Bytecode Emitter ───────────────────────────────────────────────────────

/**
 * Emits AVM2 bytecodes for a single method body. References the shared
 * constant pool for string/int/double/multiname indices.
 *
 * Usage mirrors AVM1Builder: create instance, emit opcodes, call toBytes().
 * For values that need pool entries (pushString, pushInt, etc.), the pool
 * is updated automatically.
 */
export class AVM2Code {
    private buf: number[] = [];

    constructor(private pool: AVM2ConstantPool) {}

    // ── Push values ──

    pushNull(): this { this.buf.push(0x20); return this; }
    pushUndefined(): this { this.buf.push(0x21); return this; }
    pushTrue(): this { this.buf.push(0x26); return this; }
    pushFalse(): this { this.buf.push(0x27); return this; }
    pushNaN(): this { this.buf.push(0x28); return this; }

    /** Push signed byte (-128..127). Most efficient for small integers. */
    pushByte(n: number): this {
        this.buf.push(0x24);
        this.buf.push(n & 0xFF);
        return this;
    }

    /** Push short integer via U30 encoding (sign-extended to 32 bits). */
    pushShort(n: number): this {
        this.buf.push(0x25);
        encodeU30(n & 0xFFFF, this.buf); // U30 encoding, interpreted as signed
        return this;
    }

    /** Push integer from constant pool. */
    pushInt(n: number): this {
        this.buf.push(0x2D);
        encodeU30(this.pool.addInt(n), this.buf);
        return this;
    }

    /** Push double from constant pool. */
    pushDouble(n: number): this {
        this.buf.push(0x2F);
        encodeU30(this.pool.addDouble(n), this.buf);
        return this;
    }

    /** Push string from constant pool. */
    pushString(s: string): this {
        this.buf.push(0x2C);
        encodeU30(this.pool.addString(s), this.buf);
        return this;
    }

    /** Push an integer using the most compact encoding available. */
    pushNumber(n: number): this {
        if (Number.isInteger(n)) {
            if (n >= -128 && n <= 127) return this.pushByte(n);
            return this.pushInt(n);
        }
        return this.pushDouble(n);
    }

    // ── Local variable access ──

    getLocal(n: number): this {
        if (n <= 3) { this.buf.push(0xD0 + n); return this; }
        this.buf.push(0x62); encodeU30(n, this.buf);
        return this;
    }

    setLocal(n: number): this {
        if (n <= 3) { this.buf.push(0xD4 + n); return this; }
        this.buf.push(0x63); encodeU30(n, this.buf);
        return this;
    }

    /** Increment local register in place (no stack change). */
    incLocal(n: number): this {
        this.buf.push(0x92); encodeU30(n, this.buf);
        return this;
    }

    /** Decrement local register in place (no stack change). */
    decLocal(n: number): this {
        this.buf.push(0x94); encodeU30(n, this.buf);
        return this;
    }

    // ── Stack manipulation ──

    pop(): this { this.buf.push(0x29); return this; }
    dup(): this { this.buf.push(0x2A); return this; }
    swap(): this { this.buf.push(0x2B); return this; }

    // ── Arithmetic ──
    // All: pop b, pop a, push result

    add(): this { this.buf.push(0xA0); return this; }
    subtract(): this { this.buf.push(0xA1); return this; }
    multiply(): this { this.buf.push(0xA2); return this; }
    divide(): this { this.buf.push(0xA3); return this; }
    modulo(): this { this.buf.push(0xA4); return this; }
    negate(): this { this.buf.push(0x90); return this; }
    increment(): this { this.buf.push(0x91); return this; }
    decrement(): this { this.buf.push(0x93); return this; }

    // ── Comparison ──
    // All: pop b, pop a, push Boolean result

    equals(): this { this.buf.push(0xAB); return this; }
    strictEquals(): this { this.buf.push(0xAC); return this; }
    lessThan(): this { this.buf.push(0xAD); return this; }
    lessEquals(): this { this.buf.push(0xAE); return this; }
    greaterThan(): this { this.buf.push(0xAF); return this; }
    greaterEquals(): this { this.buf.push(0xB0); return this; }

    // ── Logic / Bitwise ──

    not(): this { this.buf.push(0x96); return this; }
    bitAnd(): this { this.buf.push(0xA8); return this; }
    bitOr(): this { this.buf.push(0xA9); return this; }
    bitXor(): this { this.buf.push(0xAA); return this; }
    bitNot(): this { this.buf.push(0x97); return this; }

    // ── Type conversion ──

    convertD(): this { this.buf.push(0x75); return this; }
    convertI(): this { this.buf.push(0x73); return this; }
    convertU(): this { this.buf.push(0x74); return this; }
    convertS(): this { this.buf.push(0x70); return this; }
    convertB(): this { this.buf.push(0x76); return this; }
    coerceA(): this { this.buf.push(0x82); return this; }
    coerceS(): this { this.buf.push(0x85); return this; }
    typeOf(): this { this.buf.push(0x95); return this; }

    // ── Type checking ──

    /** Pop value and type, push (value is type). */
    isTypeLate(): this { this.buf.push(0xB3); return this; }
    /** Pop value and type, push (value instanceof type). */
    instanceOf(): this { this.buf.push(0xB1); return this; }

    // ── Branching ──

    /** Current byte offset in the buffer (for jump target tracking). */
    get position(): number { return this.buf.length; }

    /** Emit OP_jump targeting a known absolute position. */
    jumpTo(targetPos: number): this {
        this.buf.push(0x10);
        const patchPos = this.buf.length;
        encodeS24(targetPos - (patchPos + 3), this.buf);
        return this;
    }

    /** Emit OP_iftrue targeting a known absolute position. Pops boolean. */
    ifTrueTo(targetPos: number): this {
        this.buf.push(0x11);
        const patchPos = this.buf.length;
        encodeS24(targetPos - (patchPos + 3), this.buf);
        return this;
    }

    /** Emit OP_iffalse targeting a known absolute position. Pops boolean. */
    ifFalseTo(targetPos: number): this {
        this.buf.push(0x12);
        const patchPos = this.buf.length;
        encodeS24(targetPos - (patchPos + 3), this.buf);
        return this;
    }

    /** Emit OP_jump with placeholder offset. Returns patch position. */
    jumpForward(): number {
        this.buf.push(0x10);
        const patchPos = this.buf.length;
        this.buf.push(0, 0, 0);
        return patchPos;
    }

    /** Emit OP_iftrue with placeholder offset. Returns patch position. Pops boolean. */
    ifTrueForward(): number {
        this.buf.push(0x11);
        const patchPos = this.buf.length;
        this.buf.push(0, 0, 0);
        return patchPos;
    }

    /** Emit OP_iffalse with placeholder offset. Returns patch position. Pops boolean. */
    ifFalseForward(): number {
        this.buf.push(0x12);
        const patchPos = this.buf.length;
        this.buf.push(0, 0, 0);
        return patchPos;
    }

    /** Emit OP_ifstricteq with placeholder. Pops two values, branches if equal. */
    ifStrictEqForward(): number {
        this.buf.push(0x19);
        const patchPos = this.buf.length;
        this.buf.push(0, 0, 0);
        return patchPos;
    }

    /** Emit OP_ifstrictne with placeholder. Pops two values, branches if not equal. */
    ifStrictNeForward(): number {
        this.buf.push(0x1A);
        const patchPos = this.buf.length;
        this.buf.push(0, 0, 0);
        return patchPos;
    }

    /** Patch a forward jump to target the current position. */
    patchJumpHere(patchPos: number): void {
        const delta = this.buf.length - (patchPos + 3);
        this.buf[patchPos] = delta & 0xFF;
        this.buf[patchPos + 1] = (delta >> 8) & 0xFF;
        this.buf[patchPos + 2] = (delta >> 16) & 0xFF;
    }

    // ── Property access ──
    // All take a U30 multiname index from the constant pool.

    /** Pop obj, push obj.prop (multiname resolved at compile time). */
    getProperty(mn: number): this {
        this.buf.push(0x66); encodeU30(mn, this.buf);
        return this;
    }

    /** Pop value and obj, set obj.prop = value. */
    setProperty(mn: number): this {
        this.buf.push(0x61); encodeU30(mn, this.buf);
        return this;
    }

    /** Find the scope object that has this property, push it. */
    findPropStrict(mn: number): this {
        this.buf.push(0x5D); encodeU30(mn, this.buf);
        return this;
    }

    /** findpropstrict + getproperty combined. Push the property value from scope chain. */
    getLex(mn: number): this {
        this.buf.push(0x60); encodeU30(mn, this.buf);
        return this;
    }

    // ── Object / Array ──

    /** Pop count values, create array, push it. */
    newArray(count: number): this {
        this.buf.push(0x56); encodeU30(count, this.buf);
        return this;
    }

    /** Pop count*2 values (key, value pairs), create object, push it. */
    newObject(count: number): this {
        this.buf.push(0x55); encodeU30(count, this.buf);
        return this;
    }

    /** Create a function closure from a method_info index, push it. */
    newFunction(methodIdx: number): this {
        this.buf.push(0x40); encodeU30(methodIdx, this.buf);
        return this;
    }

    // ── Calls ──

    /** Pop args and obj, call obj.prop(args), push result. */
    callProperty(mn: number, argc: number): this {
        this.buf.push(0x46); encodeU30(mn, this.buf); encodeU30(argc, this.buf);
        return this;
    }

    /** Pop args and obj, call obj.prop(args), discard result. */
    callPropVoid(mn: number, argc: number): this {
        this.buf.push(0x4F); encodeU30(mn, this.buf); encodeU30(argc, this.buf);
        return this;
    }

    /** Pop args and class, construct new instance, push it. */
    constructProp(mn: number, argc: number): this {
        this.buf.push(0x4A); encodeU30(mn, this.buf); encodeU30(argc, this.buf);
        return this;
    }

    // ── Scope ──

    pushScope(): this { this.buf.push(0x30); return this; }
    popScope(): this { this.buf.push(0x1D); return this; }
    getGlobalScope(): this { this.buf.push(0x64); return this; }
    getScopeObject(idx: number): this {
        this.buf.push(0x65); encodeU30(idx, this.buf);
        return this;
    }

    // ── Class ──

    newClass(classIdx: number): this {
        this.buf.push(0x58); encodeU30(classIdx, this.buf);
        return this;
    }

    initProperty(mn: number): this {
        this.buf.push(0x68); encodeU30(mn, this.buf);
        return this;
    }

    constructSuper(argc: number): this {
        this.buf.push(0x49); encodeU30(argc, this.buf);
        return this;
    }

    // ── Enumeration ──

    /** Advance iterator: updates object/index locals, pushes boolean. */
    hasNext2(objectReg: number, indexReg: number): this {
        this.buf.push(0x32);
        encodeU30(objectReg, this.buf);
        encodeU30(indexReg, this.buf);
        return this;
    }

    /** Pop index and obj, push property name at that index. */
    nextName(): this { this.buf.push(0x1E); return this; }

    /** Pop index and obj, push property value at that index. */
    nextValue(): this { this.buf.push(0x23); return this; }

    // ── Return ──

    returnValue(): this { this.buf.push(0x48); return this; }
    returnVoid(): this { this.buf.push(0x47); return this; }

    // ── Raw ──

    /** Append pre-built bytecode bytes directly. */
    rawBytes(bytes: Uint8Array): this {
        for (const b of bytes) this.buf.push(b);
        return this;
    }

    /** Finalize to Uint8Array. */
    toBytes(): Uint8Array {
        return new Uint8Array(this.buf);
    }

    /** Current byte length. */
    get length(): number {
        return this.buf.length;
    }
}

// ─── ABC Assembly ───────────────────────────────────────────────────────────

/**
 * Build a complete ABC (ActionScript Byte Code) block containing:
 * - A class __NativeEval with static properties `ach` (Array) and `rp` (Array)
 * - cinit populates them with function closures for each achievement/RP
 * - Each achievement function: function(gameRoot, storage) → int (0 or 1)
 * - Each RP function: function(gameRoot, storage) → * (string result)
 *
 * The firmware loads the SWF, gets the class via applicationDomain.getDefinition,
 * and reads the static arrays to get native function references.
 */
export function buildNativeEvalABC(
    pool: AVM2ConstantPool,
    achBodies: Uint8Array[],
    rpBodies: Uint8Array[],
    achLocalCount: number,
    rpLocalCount: number,
): Uint8Array {
    const out: number[] = [];

    // Pre-create multinames we need
    const mnClassName = pool.publicQName("__NativeEval");
    const mnAch = pool.publicQName("ach");
    const mnRp = pool.publicQName("rp");
    const mnObject = pool.publicQName("Object");

    // ABC header: major=16, minor=46
    writeU16(16, out);
    writeU16(46, out);

    // Constant pool
    pool.serialize(out);

    // ── Method infos ──
    // 0: iinit (empty constructor)
    // 1: cinit (creates function arrays)
    // 2: script init (defines class)
    // 3..3+achCount-1: achievement functions
    // 3+achCount..3+achCount+rpCount-1: RP functions
    const totalMethods = 3 + achBodies.length + rpBodies.length;
    encodeU30(totalMethods, out);

    // method 0: iinit — no params, return *
    encodeU30(0, out); // param_count
    encodeU30(0, out); // return_type (0 = *)
    encodeU30(0, out); // param_type[0] (none)
    out.push(0);       // flags

    // method 1: cinit — no params, return *
    encodeU30(0, out);
    encodeU30(0, out);
    encodeU30(0, out); // no name
    out.push(0);

    // method 2: script init — no params, return *
    encodeU30(0, out);
    encodeU30(0, out);
    encodeU30(0, out);
    out.push(0);

    // methods 3+: ach/rp functions — 2 params (gameRoot, storage), return *
    for (let i = 0; i < achBodies.length + rpBodies.length; i++) {
        encodeU30(2, out); // param_count
        encodeU30(0, out); // return_type (0 = *)
        encodeU30(0, out); // param_types (0 = * for each)
        encodeU30(0, out);
        out.push(0);       // flags
    }

    // ── Metadata (none) ──
    encodeU30(0, out);

    // ── Classes (1: __NativeEval) ──
    encodeU30(1, out);

    // instance_info[0]
    encodeU30(mnClassName, out); // name
    encodeU30(mnObject, out);    // super_name (Object)
    out.push(0x00);              // flags (not sealed — we want dynamic access)
    encodeU30(0, out);           // interface_count
    encodeU30(0, out);           // iinit = method 0
    encodeU30(0, out);           // trait_count

    // class_info[0]
    encodeU30(1, out);           // cinit = method 1
    encodeU30(2, out);           // trait_count = 2 (ach, rp slots)

    // Trait: ach (Slot)
    encodeU30(mnAch, out);       // name
    out.push(0x00);              // kind = Slot
    encodeU30(0, out);           // slot_id (auto)
    encodeU30(0, out);           // type_name (*)
    encodeU30(0, out);           // vindex (no default)

    // Trait: rp (Slot)
    encodeU30(mnRp, out);
    out.push(0x00);
    encodeU30(0, out);
    encodeU30(0, out);
    encodeU30(0, out);

    // ── Scripts (1) ──
    encodeU30(1, out);
    encodeU30(2, out);           // init = method 2
    encodeU30(1, out);           // trait_count = 1

    // Trait: __NativeEval (Class)
    encodeU30(mnClassName, out); // name
    out.push(0x04);              // kind = Class
    encodeU30(0, out);           // slot_id (auto)
    encodeU30(0, out);           // classi = class 0

    // ── Method bodies ──
    encodeU30(totalMethods, out);

    // body[0]: iinit — just returnvoid
    encodeU30(0, out);  // method
    encodeU30(1, out);  // max_stack
    encodeU30(1, out);  // local_count (just this)
    encodeU30(0, out);  // init_scope_depth
    encodeU30(1, out);  // max_scope_depth
    encodeU30(1, out);  // code_length
    out.push(0x47);     // returnvoid
    encodeU30(0, out);  // exception_count
    encodeU30(0, out);  // trait_count

    // body[1]: cinit — create function arrays and assign to static slots
    {
        const cinit = new AVM2Code(pool);
        cinit.getLocal(0);  // class scope
        cinit.pushScope();

        // Build achievement array: [fn3, fn4, ...]
        const achStart = 3;
        cinit.findPropStrict(mnAch);
        for (let i = 0; i < achBodies.length; i++) {
            cinit.newFunction(achStart + i);
        }
        cinit.newArray(achBodies.length);
        cinit.setProperty(mnAch);

        // Build RP array
        const rpStart = achStart + achBodies.length;
        cinit.findPropStrict(mnRp);
        for (let i = 0; i < rpBodies.length; i++) {
            cinit.newFunction(rpStart + i);
        }
        cinit.newArray(rpBodies.length);
        cinit.setProperty(mnRp);

        cinit.returnVoid();
        const cinitCode = cinit.toBytes();

        encodeU30(1, out);  // method
        encodeU30(Math.max(achBodies.length, rpBodies.length) + 2, out); // max_stack
        encodeU30(1, out);  // local_count
        encodeU30(0, out);  // init_scope_depth
        encodeU30(1, out);  // max_scope_depth
        encodeU30(cinitCode.length, out);
        for (const b of cinitCode) out.push(b);
        encodeU30(0, out);  // exception_count
        encodeU30(0, out);  // trait_count
    }

    // body[2]: script init — newclass + initproperty
    {
        const scriptInit = new AVM2Code(pool);
        scriptInit.getLocal(0);
        scriptInit.pushScope();
        scriptInit.getGlobalScope();
        scriptInit.getLex(mnObject);
        scriptInit.pushScope();
        scriptInit.getLex(mnObject);
        scriptInit.newClass(0);
        scriptInit.popScope();
        scriptInit.initProperty(mnClassName);
        scriptInit.returnVoid();
        const siCode = scriptInit.toBytes();

        encodeU30(2, out);  // method
        encodeU30(3, out);  // max_stack
        encodeU30(1, out);  // local_count
        encodeU30(1, out);  // init_scope_depth
        encodeU30(3, out);  // max_scope_depth
        encodeU30(siCode.length, out);
        for (const b of siCode) out.push(b);
        encodeU30(0, out);
        encodeU30(0, out);
    }

    // bodies[3..]: achievement function bodies
    for (let i = 0; i < achBodies.length; i++) {
        encodeU30(3 + i, out);             // method
        encodeU30(15, out);                // max_stack (conservative)
        encodeU30(achLocalCount, out);     // local_count
        encodeU30(0, out);                 // init_scope_depth
        encodeU30(1, out);                 // max_scope_depth
        encodeU30(achBodies[i].length, out);
        for (const b of achBodies[i]) out.push(b);
        encodeU30(0, out);                 // exception_count
        encodeU30(0, out);                 // trait_count
    }

    // bodies[3+achCount..]: RP function bodies
    for (let i = 0; i < rpBodies.length; i++) {
        encodeU30(3 + achBodies.length + i, out);
        encodeU30(10, out);                // max_stack
        encodeU30(rpLocalCount, out);      // local_count
        encodeU30(0, out);                 // init_scope_depth
        encodeU30(1, out);                 // max_scope_depth
        encodeU30(rpBodies[i].length, out);
        for (const b of rpBodies[i]) out.push(b);
        encodeU30(0, out);
        encodeU30(0, out);
    }

    return new Uint8Array(out);
}

// ─── SWF Writer ─────────────────────────────────────────────────────────────

/** Write a SWF tag (short or long form). */
function writeTag(tagType: number, content: Uint8Array, buf: number[]): void {
    if (content.length < 0x3F) {
        const tcl = (tagType << 6) | content.length;
        writeU16(tcl, buf);
    } else {
        const tcl = (tagType << 6) | 0x3F;
        writeU16(tcl, buf);
        writeU32(content.length, buf);
    }
    for (const b of content) buf.push(b);
}

/**
 * Build a minimal AVM2 SWF containing a DoABC2 tag with the given ABC data.
 * No visual content — exists only to define and execute ActionScript 3.
 */
export function buildAVM2SWF(abc: Uint8Array): Uint8Array {
    const buf: number[] = [];

    // SWF header
    buf.push(0x46, 0x57, 0x53); // "FWS" (uncompressed)
    buf.push(11);                // SWF version 11
    buf.push(0, 0, 0, 0);       // FileLength placeholder (bytes 4-7)

    // RECT (0x0 stage)
    buf.push(0x00);

    // FrameRate (1 fps — irrelevant for non-visual SWFs)
    buf.push(0x00, 0x01);

    // FrameCount (1)
    buf.push(0x01, 0x00);

    // FileAttributes tag (type 69) — ActionScript3 flag
    const fileAttrs = new Uint8Array([0x08, 0x00, 0x00, 0x00]);
    writeTag(69, fileAttrs, buf);

    // DoABC2 tag (type 82) — flags=1 (lazy init), empty name
    const doABCContent: number[] = [];
    writeU32(1, doABCContent);   // flags: lazy initialization
    doABCContent.push(0x00);     // name: "" (null-terminated)
    const doABCPayload = new Uint8Array(doABCContent.length + abc.length);
    doABCPayload.set(doABCContent);
    doABCPayload.set(abc, doABCContent.length);
    writeTag(82, doABCPayload, buf);

    // ShowFrame (type 1, length 0)
    buf.push(0x40, 0x00);

    // End tag (type 0, length 0)
    buf.push(0x00, 0x00);

    // Backfill FileLength
    const result = new Uint8Array(buf);
    const len = result.length;
    result[4] = len & 0xFF;
    result[5] = (len >> 8) & 0xFF;
    result[6] = (len >> 16) & 0xFF;
    result[7] = (len >> 24) & 0xFF;

    return result;
}
