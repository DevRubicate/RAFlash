/**
 * AVM2 firmware injector for child mode.
 *
 * Generates minimal ABC (ActionScript Bytecode) that defines a class
 * `__RAFlashInjector extends MovieClip`. When placed on the game's main
 * timeline via DefineSprite + SymbolClass + PlaceObject3, the class is
 * instantiated automatically and its constructor loads the firmware SWF
 * as a child of the game's root display object.
 *
 * This mirrors AVM1's child-mode injection (DoAction bytecode that calls
 * createEmptyMovieClip + loadMovie) but uses AVM2's class-based code model.
 */

const enc = new TextEncoder();

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
    const bytes = enc.encode(s);
    encodeU30(bytes.length, out);
    for (const b of bytes) out.push(b);
}

// ─── ABC constant pool indices ───────────────────────────────────────────────
//
// IMPORTANT: String index 0 is the implicit default and must NOT be used for
// namespace names. Flash Player treats name=0 as "no name" rather than "empty
// string". An explicit "" must be stored at string[1] for the public namespace.

// Strings (index 0 = implicit default, index 1 = explicit "")
const S_EMPTY             = 1;  // "" (explicit — used for public PackageNamespace)
const S_FLASH_DISPLAY     = 2;  // "flash.display"
const S_MOVIECLIP         = 3;  // "MovieClip"
const S_LOADER            = 4;  // "Loader"
const S_FLASH_NET         = 5;  // "flash.net"
const S_URLREQUEST        = 6;  // "URLRequest"
const S_CLASSNAME         = 7;  // "__RAFlashInjector"
const S_VISIBLE           = 8;  // "visible"
const S_ROOT              = 9;  // "root"
const S_GETCHILDBYNAME    = 10; // "getChildByName"
const S_RAFLASH           = 11; // "__raflash"
const S_NAME              = 12; // "name"
const S_ADDCHILD          = 13; // "addChild"
const S_LOAD              = 14; // "load"
const S_FIRMWARE_URL      = 15; // (dynamic)
const S_FLASH_SYSTEM      = 16; // "flash.system"
const S_LOADERCONTEXT     = 17; // "LoaderContext"
const S_APPLICATIONDOMAIN = 18; // "ApplicationDomain"
const STRING_COUNT        = 19;

// Namespaces (index 0 = any/*)
const NS_PUBLIC           = 1;  // PackageNamespace(S_EMPTY)
const NS_FLASH_DISPLAY    = 2;  // PackageNamespace(S_FLASH_DISPLAY)
const NS_FLASH_NET        = 3;  // PackageNamespace(S_FLASH_NET)
const NS_FLASH_SYSTEM     = 4;  // PackageNamespace(S_FLASH_SYSTEM)
const NAMESPACE_COUNT     = 5;

// Namespace sets
const NSSET_PUBLIC        = 1;  // { NS_PUBLIC }
const NS_SET_COUNT        = 2;

// Multinames (index 0 = *)
const MN_MOVIECLIP        = 1;  // QName(NS_FLASH_DISPLAY, S_MOVIECLIP)
const MN_LOADER           = 2;  // QName(NS_FLASH_DISPLAY, S_LOADER)
const MN_URLREQUEST       = 3;  // QName(NS_FLASH_NET, S_URLREQUEST)
const MN_VISIBLE          = 4;  // Multiname(S_VISIBLE, NSSET_PUBLIC)
const MN_ROOT             = 5;  // Multiname(S_ROOT, NSSET_PUBLIC)
const MN_GETCHILDBYNAME   = 6;  // Multiname(S_GETCHILDBYNAME, NSSET_PUBLIC)
const MN_NAME             = 7;  // Multiname(S_NAME, NSSET_PUBLIC)
const MN_ADDCHILD         = 8;  // Multiname(S_ADDCHILD, NSSET_PUBLIC)
const MN_LOAD             = 9;  // Multiname(S_LOAD, NSSET_PUBLIC)
const MN_CLASSNAME        = 10; // QName(NS_PUBLIC, S_CLASSNAME)
const MN_LOADERCONTEXT    = 11; // QName(NS_FLASH_SYSTEM, S_LOADERCONTEXT)
const MN_APPLICATIONDOMAIN= 12; // QName(NS_FLASH_SYSTEM, S_APPLICATIONDOMAIN)
const MULTINAME_COUNT     = 13;

// AVM2 opcodes
const OP_getlocal_0     = 0xD0;
const OP_getlocal_1     = 0xD1;
const OP_getlocal_2     = 0xD2;
const OP_setlocal_1     = 0xD5;
const OP_setlocal_2     = 0xD6;
const OP_setlocal_3     = 0xD7;
const OP_getlocal_3     = 0xD3;
const OP_pushscope      = 0x30;
const OP_constructsuper = 0x49;
const OP_pushfalse      = 0x27;
const OP_pushnull       = 0x20;
const OP_pushstring     = 0x2C;
const OP_setproperty    = 0x61;
const OP_getproperty    = 0x66;
const OP_findpropstrict = 0x5D;
const OP_callproperty   = 0x46;
const OP_callpropvoid   = 0x4F;
const OP_constructprop  = 0x4A;
const OP_ifstricteq     = 0x19;
const OP_ifstrictne     = 0x1A;
const OP_popscope       = 0x1D;
const OP_returnvoid     = 0x47;
const OP_newclass       = 0x58;
const OP_getlex         = 0x60;
const OP_getglobalscope = 0x64;
const OP_initproperty   = 0x68;

// ─── Constructor bytecode ────────────────────────────────────────────────────

function buildConstructorBytecode(): Uint8Array {
    const code: number[] = [];

    code.push(OP_getlocal_0, OP_pushscope);
    code.push(OP_getlocal_0, OP_constructsuper);
    encodeU30(0, code);

    // this.visible = false
    code.push(OP_getlocal_0, OP_pushfalse, OP_setproperty);
    encodeU30(MN_VISIBLE, code);

    // var r = this.root
    code.push(OP_getlocal_0, OP_getproperty);
    encodeU30(MN_ROOT, code);
    code.push(OP_setlocal_1);

    // if (r == null) goto END
    code.push(OP_getlocal_1, OP_pushnull, OP_ifstricteq);
    const ifNullPos = code.length;
    encodeS24(0, code);

    // if (r.getChildByName("__raflash") != null) goto END
    code.push(OP_getlocal_1, OP_pushstring);
    encodeU30(S_RAFLASH, code);
    code.push(OP_callproperty);
    encodeU30(MN_GETCHILDBYNAME, code);
    encodeU30(1, code);
    code.push(OP_pushnull, OP_ifstrictne);
    const ifExistsPos = code.length;
    encodeS24(0, code);

    // var loader = new Loader()
    code.push(OP_findpropstrict);
    encodeU30(MN_LOADER, code);
    code.push(OP_constructprop);
    encodeU30(MN_LOADER, code);
    encodeU30(0, code);
    code.push(OP_setlocal_2);

    // loader.name = "__raflash"
    code.push(OP_getlocal_2, OP_pushstring);
    encodeU30(S_RAFLASH, code);
    code.push(OP_setproperty);
    encodeU30(MN_NAME, code);

    // r.addChild(loader)
    code.push(OP_getlocal_1, OP_getlocal_2, OP_callpropvoid);
    encodeU30(MN_ADDCHILD, code);
    encodeU30(1, code);

    // var appDomain = new ApplicationDomain(null)
    // Standalone domain (parent = system domain only) to isolate the firmware's
    // Haxe runtime from the game's. Without this, the firmware's boot class
    // resolves "Main" from the game's domain and fails with "main is not a function".
    // Note: ApplicationDomain() with no args creates a CHILD domain (parent-first
    // resolution). Passing null creates a standalone domain with true isolation.
    code.push(OP_findpropstrict);
    encodeU30(MN_APPLICATIONDOMAIN, code);
    code.push(OP_pushnull);
    code.push(OP_constructprop);
    encodeU30(MN_APPLICATIONDOMAIN, code);
    encodeU30(1, code);
    code.push(OP_setlocal_3);

    // loader.load(new URLRequest(firmwareUrl), new LoaderContext(false, appDomain))
    code.push(OP_getlocal_2, OP_findpropstrict);
    encodeU30(MN_URLREQUEST, code);
    code.push(OP_pushstring);
    encodeU30(S_FIRMWARE_URL, code);
    code.push(OP_constructprop);
    encodeU30(MN_URLREQUEST, code);
    encodeU30(1, code);
    code.push(OP_findpropstrict);
    encodeU30(MN_LOADERCONTEXT, code);
    code.push(OP_pushfalse, OP_getlocal_3);
    code.push(OP_constructprop);
    encodeU30(MN_LOADERCONTEXT, code);
    encodeU30(2, code);
    code.push(OP_callpropvoid);
    encodeU30(MN_LOAD, code);
    encodeU30(2, code); // load(urlReq, ctx) = 2 args

    // END:
    const endOffset = code.length;
    code.push(OP_returnvoid);

    // Patch branch offsets
    const patchS24 = (pos: number) => {
        const delta = endOffset - (pos + 3);
        code[pos] = delta & 0xFF;
        code[pos + 1] = (delta >> 8) & 0xFF;
        code[pos + 2] = (delta >> 16) & 0xFF;
    };
    patchS24(ifNullPos);
    patchS24(ifExistsPos);

    return new Uint8Array(code);
}

// ─── Script initializer bytecode ─────────────────────────────────────────────

function buildScriptInitBytecode(): Uint8Array {
    const code: number[] = [];
    code.push(OP_getlocal_0, OP_pushscope);
    code.push(OP_getglobalscope);
    code.push(OP_getlex); encodeU30(MN_MOVIECLIP, code);
    code.push(OP_pushscope);
    code.push(OP_getlex); encodeU30(MN_MOVIECLIP, code);
    code.push(OP_newclass); encodeU30(0, code);
    code.push(OP_popscope);
    code.push(OP_initproperty); encodeU30(MN_CLASSNAME, code);
    code.push(OP_returnvoid);
    return new Uint8Array(code);
}

// ─── ABC serialization ───────────────────────────────────────────────────────

function buildInjectorABC(firmwareUrl: string): Uint8Array {
    const out: number[] = [];
    const constructorCode = buildConstructorBytecode();
    const scriptInitCode = buildScriptInitBytecode();

    // ABC header
    writeU16(16, out); writeU16(46, out);

    // Constant pool
    encodeU30(0, out); // int_count (empty)
    encodeU30(0, out); // uint_count (empty)
    encodeU30(0, out); // double_count (empty)

    encodeU30(STRING_COUNT, out);
    writeString("", out);                     // 1: explicit empty string
    writeString("flash.display", out);        // 2
    writeString("MovieClip", out);            // 3
    writeString("Loader", out);               // 4
    writeString("flash.net", out);            // 5
    writeString("URLRequest", out);           // 6
    writeString("__RAFlashInjector", out);    // 7
    writeString("visible", out);              // 8
    writeString("root", out);                 // 9
    writeString("getChildByName", out);       // 10
    writeString("__raflash", out);            // 11
    writeString("name", out);                 // 12
    writeString("addChild", out);             // 13
    writeString("load", out);                 // 14
    writeString(firmwareUrl, out);            // 15
    writeString("flash.system", out);         // 16
    writeString("LoaderContext", out);        // 17
    writeString("ApplicationDomain", out);   // 18

    encodeU30(NAMESPACE_COUNT, out);
    out.push(0x16); encodeU30(S_EMPTY, out);          // ns[1]: public
    out.push(0x16); encodeU30(S_FLASH_DISPLAY, out);  // ns[2]: flash.display
    out.push(0x16); encodeU30(S_FLASH_NET, out);      // ns[3]: flash.net
    out.push(0x16); encodeU30(S_FLASH_SYSTEM, out);   // ns[4]: flash.system

    encodeU30(NS_SET_COUNT, out);
    encodeU30(1, out); encodeU30(NS_PUBLIC, out);      // nsset[1]: {public}

    encodeU30(MULTINAME_COUNT, out);
    out.push(0x07); encodeU30(NS_FLASH_DISPLAY, out); encodeU30(S_MOVIECLIP, out);
    out.push(0x07); encodeU30(NS_FLASH_DISPLAY, out); encodeU30(S_LOADER, out);
    out.push(0x07); encodeU30(NS_FLASH_NET, out);     encodeU30(S_URLREQUEST, out);
    out.push(0x09); encodeU30(S_VISIBLE, out);         encodeU30(NSSET_PUBLIC, out);
    out.push(0x09); encodeU30(S_ROOT, out);            encodeU30(NSSET_PUBLIC, out);
    out.push(0x09); encodeU30(S_GETCHILDBYNAME, out);  encodeU30(NSSET_PUBLIC, out);
    out.push(0x09); encodeU30(S_NAME, out);            encodeU30(NSSET_PUBLIC, out);
    out.push(0x09); encodeU30(S_ADDCHILD, out);        encodeU30(NSSET_PUBLIC, out);
    out.push(0x09); encodeU30(S_LOAD, out);            encodeU30(NSSET_PUBLIC, out);
    out.push(0x07); encodeU30(NS_PUBLIC, out);         encodeU30(S_CLASSNAME, out);
    out.push(0x07); encodeU30(NS_FLASH_SYSTEM, out);  encodeU30(S_LOADERCONTEXT, out);
    out.push(0x07); encodeU30(NS_FLASH_SYSTEM, out);  encodeU30(S_APPLICATIONDOMAIN, out);

    // Methods (3)
    encodeU30(3, out);
    for (let i = 0; i < 3; i++) {
        encodeU30(0, out); encodeU30(0, out); encodeU30(0, out); out.push(0);
    }

    // Metadata (none)
    encodeU30(0, out);

    // Classes (1)
    encodeU30(1, out);
    // instance_info[0]
    encodeU30(MN_CLASSNAME, out);  // name
    encodeU30(MN_MOVIECLIP, out);  // super_name
    out.push(0x01);                // flags = SEALED
    encodeU30(0, out);             // intrf_count = 0
    encodeU30(0, out);             // iinit = method#0
    encodeU30(0, out);             // trait_count = 0
    // class_info[0]
    encodeU30(1, out);             // cinit = method#1
    encodeU30(0, out);             // trait_count = 0

    // Scripts (1)
    encodeU30(1, out);
    encodeU30(2, out);             // init = method#2
    encodeU30(1, out);             // trait_count = 1
    encodeU30(MN_CLASSNAME, out);  // Trait_Class name
    out.push(0x04);                // kind = Trait_Class
    encodeU30(0, out);             // slot_id = 0
    encodeU30(0, out);             // classi = 0

    // Method bodies (3)
    encodeU30(3, out);

    // body[0]: constructor
    encodeU30(0, out); encodeU30(5, out); encodeU30(4, out); // max_stack=5, locals=4 (this,r,loader,appDomain)
    encodeU30(1, out); encodeU30(2, out);
    encodeU30(constructorCode.length, out);
    for (const b of constructorCode) out.push(b);
    encodeU30(0, out); encodeU30(0, out);

    // body[1]: cinit (just returnvoid)
    encodeU30(1, out); encodeU30(0, out); encodeU30(1, out);
    encodeU30(1, out); encodeU30(1, out);
    encodeU30(1, out); out.push(OP_returnvoid);
    encodeU30(0, out); encodeU30(0, out);

    // body[2]: script init (newclass + initproperty)
    encodeU30(2, out); encodeU30(2, out); encodeU30(1, out);
    encodeU30(1, out); encodeU30(3, out);
    encodeU30(scriptInitCode.length, out);
    for (const b of scriptInitCode) out.push(b);
    encodeU30(0, out); encodeU30(0, out);

    return new Uint8Array(out);
}

// ─── SWF tag construction ────────────────────────────────────────────────────

function buildTag(tagType: number, content: Uint8Array): Uint8Array {
    const buf: number[] = [];
    if (content.length < 0x3F) {
        const tcl = (tagType << 6) | content.length;
        writeU16(tcl, buf);
    } else {
        const tcl = (tagType << 6) | 0x3F;
        writeU16(tcl, buf);
        writeU32(content.length, buf);
    }
    const result = new Uint8Array(buf.length + content.length);
    result.set(buf);
    result.set(content, buf.length);
    return result;
}

/**
 * Build the SWF tags needed to inject the __RAFlashInjector class into an
 * AVM2 game SWF: DoABC + DefineSprite + SymbolClass + PlaceObject3.
 */
export function buildInjectorTags(firmwareUrl: string, charId: number): Uint8Array {
    const classNameBytes = enc.encode("__RAFlashInjector");

    // DoABC2 (tag type 82) with flags=1 (lazy init)
    const abcData = buildInjectorABC(firmwareUrl);
    const doABCContent: number[] = [];
    writeU32(1, doABCContent);
    for (const b of classNameBytes) doABCContent.push(b);
    doABCContent.push(0x00);
    const doABCPayload = new Uint8Array(doABCContent.length + abcData.length);
    doABCPayload.set(doABCContent);
    doABCPayload.set(abcData, doABCContent.length);
    const doABC = buildTag(82, doABCPayload);

    // DefineSprite (tag type 39)
    const spriteContent = new Uint8Array(8);
    spriteContent[0] = charId & 0xFF; spriteContent[1] = (charId >> 8) & 0xFF;
    spriteContent[2] = 0x01; spriteContent[3] = 0x00;
    spriteContent[4] = 0x40; spriteContent[5] = 0x00;
    spriteContent[6] = 0x00; spriteContent[7] = 0x00;
    const defineSprite = buildTag(39, spriteContent);

    // SymbolClass (tag type 76)
    const symContent: number[] = [];
    writeU16(1, symContent);
    writeU16(charId, symContent);
    for (const b of classNameBytes) symContent.push(b);
    symContent.push(0x00);
    const symbolClass = buildTag(76, new Uint8Array(symContent));

    // PlaceObject3 (tag type 70)
    const placeContent = new Uint8Array(6);
    placeContent[0] = 0x02; placeContent[1] = 0x00;
    placeContent[2] = 0xFF; placeContent[3] = 0x3F;
    placeContent[4] = charId & 0xFF; placeContent[5] = (charId >> 8) & 0xFF;
    const placeObject = buildTag(70, placeContent);

    // Concatenate
    const totalLen = doABC.length + defineSprite.length + symbolClass.length + placeObject.length;
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const tag of [doABC, defineSprite, symbolClass, placeObject]) {
        result.set(tag, offset);
        offset += tag.length;
    }
    return result;
}

// ─── Character ID scanning ───────────────────────────────────────────────────

const CHARACTER_DEFINING_TAGS = new Set([
    2, 6, 7, 10, 11, 14, 20, 21, 22, 32, 33, 34, 35, 36, 37, 39,
    46, 48, 60, 75, 83, 84, 87, 91,
]);

export function findMaxCharacterId(data: Uint8Array, tagsOffset: number): number {
    let maxId = 0;
    let offset = tagsOffset;
    while (offset + 2 <= data.length) {
        const tcl = data[offset] | (data[offset + 1] << 8);
        const tagType = tcl >> 6;
        let tagLength = tcl & 0x3F;
        let headerSize = 2;
        if (tagLength === 0x3F) {
            if (offset + 6 > data.length) break;
            tagLength = data[offset + 2] | (data[offset + 3] << 8) |
                       (data[offset + 4] << 16) | (data[offset + 5] << 24);
            headerSize = 6;
        }
        if (tagType === 0) break;
        const dataStart = offset + headerSize;
        if (CHARACTER_DEFINING_TAGS.has(tagType) && tagLength >= 2 && dataStart + 2 <= data.length) {
            const charId = data[dataStart] | (data[dataStart + 1] << 8);
            if (charId > maxId) maxId = charId;
        }
        const nextOffset = offset + headerSize + tagLength;
        if (nextOffset <= offset || nextOffset > data.length) break;
        offset = nextOffset;
    }
    return maxId;
}
