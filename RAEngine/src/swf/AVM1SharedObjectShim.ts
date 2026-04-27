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
 *   if (relay != undefined) {
 *       relay(this.__raflash_orig_name,
 *             this.__raflash_orig_path, this.data);
 *   } else {
 *       // Frame-1 race: firmware hasn't registered yet. Buffer the
 *       // call as a flat triple in _global.__RAShim_pending_relay; the
 *       // firmware drains the buffer when it installs the relay.
 *       var buf = _global.__RAShim_pending_relay;
 *       if (buf == undefined) {
 *           buf = [];
 *           _global.__RAShim_pending_relay = buf;
 *       }
 *       if (buf.length < 24) {  // 8 entries × 3 fields
 *           buf.push(name); buf.push(path); buf.push(data);
 *       }
 *   }
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

    // if (relay == undefined) goto bufferPath; else call relay; goto end
    b.push(aString("relay")); b.getVariable();
    b.push(aUndefined());
    b.equals2();                        // (relay == undefined)
    const goBuffer = b.jumpIfForward(); // if undefined, take buffer path

    // relay path: relay(name, path, data)
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
    const skipBuffer = b.jumpForward(); // jump past buffer path

    // bufferPath: lazy-create buf, append triple if not full.
    b.patchJumpHere(goBuffer);

    // var buf = _global.__RAShim_pending_relay
    b.push(aString("buf"));
    b.push(aString("_global")); b.getVariable();
    b.push(aString("__RAShim_pending_relay")); b.getMember();
    b.setVariable();

    // if (buf == undefined) { buf = []; _global.__RAShim_pending_relay = buf; }
    b.push(aString("buf")); b.getVariable();
    b.push(aUndefined());
    b.equals2();
    b.not();                            // buf != undefined
    const skipCreate = b.jumpIfForward();

    // buf = []
    b.push(aString("buf"));
    b.push(aInt(0));
    b.initArray();
    b.setVariable();

    // _global.__RAShim_pending_relay = buf
    b.push(aString("_global")); b.getVariable();
    b.push(aString("__RAShim_pending_relay"));
    b.push(aString("buf")); b.getVariable();
    b.setMember();

    b.patchJumpHere(skipCreate);

    // if (buf.length >= 24) goto end
    b.push(aString("buf")); b.getVariable();
    b.push(aString("length")); b.getMember();
    b.push(aInt(24));
    b.less2();                          // (buf.length < 24)
    b.not();                            // (buf.length >= 24) → skip push
    const skipPush = b.jumpIfForward();

    // buf.push(name); buf.push(path); buf.push(data);
    b.push(aString("this")); b.getVariable();
    b.push(aString("__raflash_orig_name")); b.getMember();
    b.push(aInt(1));
    b.push(aString("buf")); b.getVariable();
    b.push(aString("push"));
    b.callMethod();
    b.pop();

    b.push(aString("this")); b.getVariable();
    b.push(aString("__raflash_orig_path")); b.getMember();
    b.push(aInt(1));
    b.push(aString("buf")); b.getVariable();
    b.push(aString("push"));
    b.callMethod();
    b.pop();

    b.push(aString("this")); b.getVariable();
    b.push(aString("data")); b.getMember();
    b.push(aInt(1));
    b.push(aString("buf")); b.getVariable();
    b.push(aString("push"));
    b.callMethod();
    b.pop();

    b.patchJumpHere(skipPush);
    b.patchJumpHere(skipBuffer);

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

    // Re-resolve the slot from `_root._url` on every call. We previously
    // cached it in `_global.__RAShim_slot`, but `_global` survives any
    // self-restart path that doesn't go through `_level0.loadMovie()`
    // (mid-session slot changes followed by a game self-restart, etc.),
    // so the cache could pin saves to a stale slot. The parse is cheap
    // and saves are infrequent — re-resolve every call instead.

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

    // var idx = url.indexOf("?rafslot=");
    // Anchored on the leading separator so a user-controlled string further
    // down the URL (e.g. a filename, originUrl spoof) can't masquerade as
    // a slot override.
    b.push(aString("idx"));
    b.push(aString("?rafslot="));
    b.push(aInt(1));
    b.push(aString("url")); b.getVariable();
    b.push(aString("indexOf"));
    b.callMethod();
    b.setVariable();

    // if (idx < 0) idx = url.indexOf("&rafslot=");
    b.push(aString("idx")); b.getVariable();
    b.push(aInt(0));
    b.less2();                          // (idx < 0)
    b.not();                            // (idx >= 0) — true means skip
    const skipAlt = b.jumpIfForward();

    b.push(aString("idx"));
    b.push(aString("&rafslot="));
    b.push(aInt(1));
    b.push(aString("url")); b.getVariable();
    b.push(aString("indexOf"));
    b.callMethod();
    b.setVariable();

    b.patchJumpHere(skipAlt);

    // if (idx >= 0) { ... extract slot from substring ... }
    // less2 pushes (idx < 0). ActionIf branches when stack-top is true, so
    // skip the block when idx < 0.
    b.push(aString("idx")); b.getVariable();
    b.push(aInt(0));
    b.less2();
    const skipSubstring = b.jumpIfForward();

    // var s = url.substring(idx + 9);
    // 9 = 1-byte separator ('?' or '&') + 8 bytes of "rafslot="
    b.push(aString("s"));
    b.push(aInt(9));
    b.push(aString("idx")); b.getVariable();
    b.add2();                           // idx + 9
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
 * Idempotent: if `_global.SharedObject.getLocal.__raflash_is_wrapper == true`
 * the whole body is skipped. We tag our wrapper with that property after
 * install, so the guard tracks whether the LIVE getLocal is our wrapper —
 * not a separate boolean that could go out of sync with the orig-fn cache
 * if a soft-reset rebuilt `_global.SharedObject` without blanking the rest
 * of `_global`.
 */
export function buildSharedObjectShimAction(): Uint8Array {
    const flushBody = buildFlushBody();
    const getLocalBody = buildGetLocalBody(flushBody);
    const getRemoteBody = buildGetRemoteBody();

    const main = new AVM1Builder();

    // Idempotency: skip if the active SharedObject.getLocal is already
    // our tagged wrapper.
    main.push(aString("_global")); main.getVariable();
    main.push(aString("SharedObject")); main.getMember();
    main.push(aString("getLocal")); main.getMember();
    main.push(aString("__raflash_is_wrapper")); main.getMember();
    main.push(aBool(true));
    main.equals2();
    const skipPatch = main.jumpIfForward();

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

    // Tag the wrappers so the idempotency check above can recognize them
    // by identity instead of relying on a separate boolean.
    main.push(aString("_global")); main.getVariable();
    main.push(aString("SharedObject")); main.getMember();
    main.push(aString("getLocal")); main.getMember();
    main.push(aString("__raflash_is_wrapper"));
    main.push(aBool(true));
    main.setMember();

    main.push(aString("_global")); main.getVariable();
    main.push(aString("SharedObject")); main.getMember();
    main.push(aString("getRemote")); main.getMember();
    main.push(aString("__raflash_is_wrapper"));
    main.push(aBool(true));
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
    out[1] = (shortTag >>> 8) & 0xFF;
    out[2] = actionStream.length & 0xFF;
    out[3] = (actionStream.length >>> 8) & 0xFF;
    out[4] = (actionStream.length >>> 16) & 0xFF;
    out[5] = (actionStream.length >>> 24) & 0xFF;
    out.set(actionStream, 6);
    return out;
}
