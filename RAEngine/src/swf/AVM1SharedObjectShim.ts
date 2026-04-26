/**
 * AVM1 SharedObject monkey-patch via injected DoAction.
 *
 * In child mode the AVM1 firmware loads asynchronously into a child clip of
 * the game's _root, so by the time it can call _global.SharedObject =
 * <wrapper>, the game's frame-1 actions have already run. To close that
 * race, we splice an extra DoAction tag into the game's SWF that performs
 * the same monkey-patch synchronously, BEFORE any of the game's own frame-1
 * action tags execute.
 *
 * The injected bytecode mirrors the firmware's `patchSharedObject()` (see
 * AVM1Firmware/Main.as) but is hand-emitted here:
 *
 *   - Saves originals on _global.__RAShim_origGetLocal / _RAShim_origGetRemote
 *   - Clears the write-protect flags on the native getLocal/getRemote
 *   - Replaces them with wrappers that:
 *       * lazy-resolve the active save slot from `?rafslot=<slot>` baked
 *         into _root._url (works without firmware participation)
 *       * suffix the SO name with `__rafslot__<slot>` for non-default slots
 *       * wrap each returned SO's flush() to relay through
 *         _global.__RAShim_relay if the firmware has registered one
 *
 * The firmware's job in child mode is reduced to setting that relay and
 * (optionally) overriding the slot if URL parsing fell short. It must NOT
 * monkey-patch _global.SharedObject again — the game already holds the
 * wrappers, and a second wrap would either no-op (idempotency guard fires)
 * or double-wrap and break flush.
 */

import {
    AVM1Builder,
    aBool,
    aInt,
    aString,
    aUndefined,
} from "./AVM1Builder.ts";

/**
 * Build the body of the inner flush() wrapper.
 *
 *   var status = this.__raflash_orig_flush.apply(this, arguments);
 *   var relay = _global.__RAShim_relay;
 *   if (relay != undefined) relay(this.__raflash_orig_name,
 *                                 this.__raflash_orig_path, this.data);
 *   return status;
 */
function buildFlushBody(): Uint8Array {
    const b = new AVM1Builder();

    // var status = this.__raflash_orig_flush.apply(this, arguments);
    // SetVariable pops value then name; push order: name, value.
    b.push(aString("status"));
    // Build the call: this.__raflash_orig_flush.apply(this, arguments)
    // CallMethod pops method name, object, numArgs, then args (LIFO).
    // Push args in reverse order: arguments, this, then numArgs(2), then
    // the function object (this.__raflash_orig_flush), then "apply".
    b.push(aString("arguments")); b.getVariable();
    b.push(aString("this")); b.getVariable();
    b.push(aInt(2));
    b.push(aString("this")); b.getVariable();
    b.push(aString("__raflash_orig_flush")); b.getMember();
    b.push(aString("apply"));
    b.callMethod();
    b.setVariable();

    // var relay = _global.__RAShim_relay;
    b.push(aString("relay"));
    b.push(aString("_global")); b.getVariable();
    b.push(aString("__RAShim_relay")); b.getMember();
    b.setVariable();

    // if (relay != undefined) relay(name, path, data);
    b.push(aString("relay")); b.getVariable();
    b.push(aUndefined());
    b.equals2();                        // (relay == undefined) → bool
    const skipRelay = b.jumpIfForward(); // skip body if equal (i.e. undefined)

    // relay(this.__raflash_orig_name, this.__raflash_orig_path, this.data);
    // CallFunction looks up the name in scope; "relay" is a local var here.
    b.push(aString("this")); b.getVariable();
    b.push(aString("data")); b.getMember();
    b.push(aString("this")); b.getVariable();
    b.push(aString("__raflash_orig_path")); b.getMember();
    b.push(aString("this")); b.getVariable();
    b.push(aString("__raflash_orig_name")); b.getMember();
    b.push(aInt(3));
    b.push(aString("relay"));
    b.callFunction();
    b.pop();                            // discard return value

    b.patchJumpHere(skipRelay);

    // return status;
    b.push(aString("status")); b.getVariable();
    b.returnOp();
    b.end();

    return b.toBytes();
}

/**
 * Build the body of the getLocal(name, localPath, secure) wrapper.
 */
function buildGetLocalBody(flushBody: Uint8Array): Uint8Array {
    const b = new AVM1Builder();

    // var slot = _global.__RAShim_slot;
    b.push(aString("slot"));
    b.push(aString("_global")); b.getVariable();
    b.push(aString("__RAShim_slot")); b.getMember();
    b.setVariable();

    // if (slot == undefined) { ...resolve from _root._url... }
    // ActionIf branches when stack-top is true. We want to skip the resolve
    // block when slot is ALREADY resolved (defined), so push (slot==undef),
    // negate, and branch.
    b.push(aString("slot")); b.getVariable();
    b.push(aUndefined());
    b.equals2();
    b.not();                            // true if slot is defined
    const skipResolve = b.jumpIfForward();

    // slot = "default";
    b.push(aString("slot"));
    b.push(aString("default"));
    b.setVariable();

    // var url = String(_root._url);
    b.push(aString("url"));
    b.push(aString("_root")); b.getVariable();
    b.push(aString("_url")); b.getMember();
    b.push(aInt(1));
    b.push(aString("String"));
    b.callFunction();
    b.setVariable();

    // var idx = url.indexOf("rafslot=");
    b.push(aString("idx"));
    b.push(aString("rafslot="));
    b.push(aInt(1));
    b.push(aString("url")); b.getVariable();
    b.push(aString("indexOf"));
    b.callMethod();
    b.setVariable();

    // if (idx >= 0) { ... }
    // less2 pushes (idx < 0). We want to ENTER the block when idx >= 0,
    // i.e. SKIP when idx < 0. ActionIf branches when stack-top is true,
    // so the (idx < 0) result is exactly what we want.
    b.push(aString("idx")); b.getVariable();
    b.push(aInt(0));
    b.less2();
    const skipSubstring = b.jumpIfForward();

    // var s = url.substring(idx + 8);
    b.push(aString("s"));
    b.push(aInt(8));
    b.push(aString("idx")); b.getVariable();
    b.add2();                           // idx + 8
    b.push(aInt(1));
    b.push(aString("url")); b.getVariable();
    b.push(aString("substring"));
    b.callMethod();
    b.setVariable();

    // var amp = s.indexOf("&");
    b.push(aString("amp"));
    b.push(aString("&"));
    b.push(aInt(1));
    b.push(aString("s")); b.getVariable();
    b.push(aString("indexOf"));
    b.callMethod();
    b.setVariable();

    // if (amp >= 0) s = s.substring(0, amp);
    b.push(aString("amp")); b.getVariable();
    b.push(aInt(0));
    b.less2();                          // amp < 0
    const skipAmp = b.jumpIfForward();

    b.push(aString("s"));
    b.push(aString("amp")); b.getVariable();
    b.push(aInt(0));
    b.push(aInt(2));
    b.push(aString("s")); b.getVariable();
    b.push(aString("substring"));
    b.callMethod();
    b.setVariable();

    b.patchJumpHere(skipAmp);

    // if (s.length > 0) slot = s;
    // ActionGreater (0x67): pops a, b, pushes (a > b) ? hmm let me think.
    // Actually 0x67 ActionGreater is "pops two, pushes typed result of a > b
    // for the SECOND-popped > FIRST-popped". So push s.length first, then 0,
    // greater pushes (s.length > 0).
    b.push(aString("s")); b.getVariable();
    b.push(aString("length")); b.getMember();
    b.push(aInt(0));
    b.greater();                        // s.length > 0
    b.not();                            // skip block if NOT greater
    const skipAssign = b.jumpIfForward();

    b.push(aString("slot"));
    b.push(aString("s")); b.getVariable();
    b.setVariable();

    b.patchJumpHere(skipAssign);
    b.patchJumpHere(skipSubstring);

    // _global.__RAShim_slot = slot;
    b.push(aString("_global")); b.getVariable();
    b.push(aString("__RAShim_slot"));
    b.push(aString("slot")); b.getVariable();
    b.setMember();

    b.patchJumpHere(skipResolve);

    // var realName = name;
    b.push(aString("realName"));
    b.push(aString("name")); b.getVariable();
    b.setVariable();

    // if (slot != "default") realName = name + "__rafslot__" + slot;
    // (slot == "default") → equals2 → ActionIf branches if equal (i.e. skip suffix)
    b.push(aString("slot")); b.getVariable();
    b.push(aString("default"));
    b.equals2();
    const skipSuffix = b.jumpIfForward();

    b.push(aString("realName"));
    b.push(aString("name")); b.getVariable();
    b.push(aString("__rafslot__"));
    b.add2();                           // name + "__rafslot__"
    b.push(aString("slot")); b.getVariable();
    b.add2();                           // ... + slot
    b.setVariable();

    b.patchJumpHere(skipSuffix);

    // var so = _global.__RAShim_origGetLocal.call(
    //              _global.SharedObject, realName, localPath, secure);
    b.push(aString("so"));
    b.push(aString("secure")); b.getVariable();
    b.push(aString("localPath")); b.getVariable();
    b.push(aString("realName")); b.getVariable();
    b.push(aString("_global")); b.getVariable();
    b.push(aString("SharedObject")); b.getMember();
    b.push(aInt(4));                    // numArgs (thisObj + 3 real args)
    b.push(aString("_global")); b.getVariable();
    b.push(aString("__RAShim_origGetLocal")); b.getMember();
    b.push(aString("call"));
    b.callMethod();
    b.setVariable();

    // if (so == undefined) skip the wrap block
    b.push(aString("so")); b.getVariable();
    b.push(aUndefined());
    b.equals2();
    const skipWrapNull = b.jumpIfForward();

    // if (so.__raflash_so_wrapped == true) skip the wrap block (already wrapped)
    b.push(aString("so")); b.getVariable();
    b.push(aString("__raflash_so_wrapped")); b.getMember();
    b.push(aBool(true));
    b.equals2();
    const skipWrapAlready = b.jumpIfForward();

    // so.__raflash_so_wrapped = true;
    b.push(aString("so")); b.getVariable();
    b.push(aString("__raflash_so_wrapped"));
    b.push(aBool(true));
    b.setMember();

    // so.__raflash_orig_name = name;
    b.push(aString("so")); b.getVariable();
    b.push(aString("__raflash_orig_name"));
    b.push(aString("name")); b.getVariable();
    b.setMember();

    // so.__raflash_orig_path = localPath;
    b.push(aString("so")); b.getVariable();
    b.push(aString("__raflash_orig_path"));
    b.push(aString("localPath")); b.getVariable();
    b.setMember();

    // so.__raflash_orig_flush = so.flush;
    b.push(aString("so")); b.getVariable();
    b.push(aString("__raflash_orig_flush"));
    b.push(aString("so")); b.getVariable();
    b.push(aString("flush")); b.getMember();
    b.setMember();

    // so.flush = function() { ...flushBody... };
    b.push(aString("so")); b.getVariable();
    b.push(aString("flush"));
    b.defineFunction2({
        registerCount: 1,
        params: [],
        flags: 0,
        body: flushBody,
    });
    b.setMember();

    b.patchJumpHere(skipWrapAlready);
    b.patchJumpHere(skipWrapNull);

    // return so;
    b.push(aString("so")); b.getVariable();
    b.returnOp();
    b.end();

    return b.toBytes();
}

/**
 * Build the body of the getRemote() wrapper.
 *
 *   return _global.__RAShim_origGetRemote.apply(_global.SharedObject, arguments);
 */
function buildGetRemoteBody(): Uint8Array {
    const b = new AVM1Builder();

    b.push(aString("arguments")); b.getVariable();
    b.push(aString("_global")); b.getVariable();
    b.push(aString("SharedObject")); b.getMember();
    b.push(aInt(2));
    b.push(aString("_global")); b.getVariable();
    b.push(aString("__RAShim_origGetRemote")); b.getMember();
    b.push(aString("apply"));
    b.callMethod();
    b.returnOp();
    b.end();

    return b.toBytes();
}

/**
 * Build the entire SO-patch action stream (without the DoAction tag header).
 *
 * Idempotent: if `_global.__RAShim_SO_patched == true` the whole body is
 * skipped. The firmware can still be reloaded across `_level0.loadMovie()`
 * resets — Flash blanks _global on a clean reload, so the guard re-arms.
 */
export function buildSharedObjectShimAction(): Uint8Array {
    const flushBody = buildFlushBody();
    const getLocalBody = buildGetLocalBody(flushBody);
    const getRemoteBody = buildGetRemoteBody();

    const main = new AVM1Builder();

    // Idempotency: if (_global.__RAShim_SO_patched == true) return;
    main.push(aString("_global")); main.getVariable();
    main.push(aString("__RAShim_SO_patched")); main.getMember();
    main.push(aBool(true));
    main.equals2();
    const skipPatch = main.jumpIfForward();

    // _global.__RAShim_SO_patched = true;
    main.push(aString("_global")); main.getVariable();
    main.push(aString("__RAShim_SO_patched"));
    main.push(aBool(true));
    main.setMember();

    // _global.__RAShim_origGetLocal = _global.SharedObject.getLocal;
    main.push(aString("_global")); main.getVariable();
    main.push(aString("__RAShim_origGetLocal"));
    main.push(aString("_global")); main.getVariable();
    main.push(aString("SharedObject")); main.getMember();
    main.push(aString("getLocal")); main.getMember();
    main.setMember();

    // _global.__RAShim_origGetRemote = _global.SharedObject.getRemote;
    main.push(aString("_global")); main.getVariable();
    main.push(aString("__RAShim_origGetRemote"));
    main.push(aString("_global")); main.getVariable();
    main.push(aString("SharedObject")); main.getMember();
    main.push(aString("getRemote")); main.getMember();
    main.setMember();

    // ASSetPropFlags(_global.SharedObject, "getLocal", 0, 7);
    // Built-in methods on _global.SharedObject are write-protected (DontEnum
    // | DontDelete | ReadOnly = bits 0..2 = 7). Clearing those bits lets us
    // overwrite them. ASSetPropFlags(obj, names, set, clear).
    main.push(aInt(7));
    main.push(aInt(0));
    main.push(aString("getLocal"));
    main.push(aString("_global")); main.getVariable();
    main.push(aString("SharedObject")); main.getMember();
    main.push(aInt(4));
    main.push(aString("ASSetPropFlags"));
    main.callFunction();
    main.pop();

    // ASSetPropFlags(_global.SharedObject, "getRemote", 0, 7);
    main.push(aInt(7));
    main.push(aInt(0));
    main.push(aString("getRemote"));
    main.push(aString("_global")); main.getVariable();
    main.push(aString("SharedObject")); main.getMember();
    main.push(aInt(4));
    main.push(aString("ASSetPropFlags"));
    main.callFunction();
    main.pop();

    // _global.SharedObject.getLocal = function(name, localPath, secure) {...};
    main.push(aString("_global")); main.getVariable();
    main.push(aString("SharedObject")); main.getMember();
    main.push(aString("getLocal"));
    main.defineFunction2({
        registerCount: 1,
        params: [
            { register: 0, name: "name" },
            { register: 0, name: "localPath" },
            { register: 0, name: "secure" },
        ],
        flags: 0,
        body: getLocalBody,
    });
    main.setMember();

    // _global.SharedObject.getRemote = function() {...};
    main.push(aString("_global")); main.getVariable();
    main.push(aString("SharedObject")); main.getMember();
    main.push(aString("getRemote"));
    main.defineFunction2({
        registerCount: 1,
        params: [],
        flags: 0,
        body: getRemoteBody,
    });
    main.setMember();

    main.patchJumpHere(skipPatch);
    main.end();

    return main.toBytes();
}

/**
 * Wrap an action stream in a DoAction (tag type 12) tag header.
 */
export function wrapInDoActionTag(actionStream: Uint8Array): Uint8Array {
    if (actionStream.length < 0x3F) {
        const tagCodeAndLength = (12 << 6) | actionStream.length;
        const out = new Uint8Array(2 + actionStream.length);
        out[0] = tagCodeAndLength & 0xFF;
        out[1] = (tagCodeAndLength >> 8) & 0xFF;
        out.set(actionStream, 2);
        return out;
    }
    const shortTag = (12 << 6) | 0x3F;
    const out = new Uint8Array(6 + actionStream.length);
    out[0] = shortTag & 0xFF;
    out[1] = (shortTag >> 8) & 0xFF;
    out[2] = actionStream.length & 0xFF;
    out[3] = (actionStream.length >> 8) & 0xFF;
    out[4] = (actionStream.length >> 16) & 0xFF;
    out[5] = (actionStream.length >> 24) & 0xFF;
    out.set(actionStream, 6);
    return out;
}
