package flash.net;

/**
 * AS3 SharedObject shim. Game SWFs are rewritten on the fly so every
 * `flash.net::SharedObject` reference in their constants pools becomes
 * `flash.net::__RAShim_S0_`; this class is then injected into the same
 * SWF (as a separate DoABC tag) so the rewritten references resolve to
 * us instead of the native class.
 *
 * Each instance wraps a real `flash.net.SharedObject` so the game's save
 * still persists to disk exactly as before. We additionally invoke a
 * static `_relay` callback on every flush so RAEngine can mirror the
 * data into saves/<gameHash>/slots/<slot>/<name>.json. The firmware
 * installs the relay (and sets the active slot) after the game's SWF
 * loads.
 */
class __RAShim_S0_ extends flash.events.EventDispatcher {
    public static var _relay:Dynamic = null;
    /**
     * Flush calls that landed before the firmware registered a relay.
     * We buffer them (capped at _pendingMax) and drain on the next setRelay.
     * Without this, frame-1 saves silently lose their JSON mirror — the
     * native .sol still persists, but RAEngine's slot picker shows the
     * mirror as empty until the next save.
     */
    public static var _pendingCalls:Array<{name:String, path:String, data:Dynamic}> = [];
    public static inline var _pendingMax:Int = 8;
    public static function setRelay(f:Dynamic):Void {
        _relay = f;
        if (f == null || _pendingCalls.length == 0) return;
        var pending = _pendingCalls;
        _pendingCalls = [];
        for (call in pending) {
            try {
                f(call.name, call.path, call.data);
            } catch (e:Dynamic) { /* swallow — never break the save path */ }
        }
    }

    /**
     * Active save slot. Lazy-resolved from the GAME's loader URL on first
     * access — RAEngine bakes `?rafslot=<slot>` into the URL Flash uses
     * to load the game, so the shim sees the correct slot synchronously
     * before any native getLocal call. The firmware's setSlot() is also
     * available as a fallback (e.g. for tests or environments where the
     * URL parsing fails). Defaults to "default" if neither path resolves.
     */
    public static var _slot:String = "default";
    public static var _slotResolved:Bool = false;
    public static function setSlot(s:String):Void {
        if (s == null || s == "") s = "default";
        _slot = s;
        _slotResolved = true;
    }
    private static function resolveSlotFromUrl():Void {
        _slotResolved = true;
        try {
            var url:String = flash.Lib.current.loaderInfo.url;
            if (url == null) return;
            // In child mode, flash.Lib.current is the game and its
            // loaderInfo.url has `?rafslot=`. In parent mode it's the
            // firmware and its loaderInfo.url has `?slot=` instead.
            // Accept either to cover the early-frame-1 race where the
            // game saves before the firmware's setSlot() runs.
            //
            // Anchor every lookup on the leading `?` or `&` separator so
            // a user-controlled string further down the URL (e.g. a
            // filename, originUrl spoof) can't masquerade as a slot
            // override.
            var idx:Int = url.indexOf("?rafslot=");
            var keyLen:Int = 9;
            if (idx < 0) {
                idx = url.indexOf("&rafslot=");
                if (idx < 0) {
                    idx = url.indexOf("?slot=");
                    keyLen = 6;
                    if (idx < 0) {
                        idx = url.indexOf("&slot=");
                    }
                }
            }
            if (idx < 0) return;
            var s:String = url.substr(idx + keyLen);
            var amp:Int = s.indexOf("&");
            if (amp >= 0) s = s.substr(0, amp);
            if (s.length > 0) _slot = s;
        } catch (e:Dynamic) { /* fall through with default */ }
    }

    /**
     * Suffix the save name (NOT the localPath) with the active slot. Flash
     * Player validates that localPath is a prefix of the SWF's URL path —
     * appending /__rafslot/<slot> there triggers Error #2134. The name
     * argument has no such constraint, so the slot lives there instead.
     * Each slot gets its own .sol file: `<name>__rafslot__<slot>.sol`.
     * The "default" slot keeps the unsuffixed name so a single-slot game
     * stays compatible with its existing .sol on disk.
     */
    private static function slottedName(name:String):String {
        if (!_slotResolved) resolveSlotFromUrl();
        return (_slot == null || _slot == "" || _slot == "default")
            ? name
            : name + "__rafslot__" + _slot;
    }

    public static function getLocal(name:String, ?localPath:String, ?secure:Bool):__RAShim_S0_ {
        var native:flash.net.SharedObject = flash.net.SharedObject.getLocal(slottedName(name), localPath, secure == null ? false : secure);
        return new __RAShim_S0_(native, name, localPath);
    }

    /**
     * `getRemote` is essentially defunct in modern Flash Player (Adobe deprecated
     * Flash Media Server connections), but we mirror the API for completeness.
     * The returned shim has no native backing; flush()/data behave as no-ops.
     */
    public static function getRemote(name:String, ?remotePath:String, ?persistence:Dynamic, ?secure:Bool):__RAShim_S0_ {
        return new __RAShim_S0_(null, name, null);
    }

    private var _native:flash.net.SharedObject;
    private var _name:String;
    private var _localPath:String;
    // Empty stand-in for instances with no native backing (getRemote shim).
    // Initialized once in the constructor so writes via `myShim.data.foo`
    // accumulate on a stable object instead of being lost.
    private var _orphanData:Dynamic;
    // Set of event types we've already wired up a forwarder for on the
    // native object. Each game-side addEventListener for a new type
    // triggers a single native subscription that re-dispatches through
    // the shim (so event.target/currentTarget point at the shim, not
    // the native). Subsequent listeners on the same type just register
    // on the shim's own EventDispatcher.
    private var _bridgedTypes:haxe.ds.StringMap<Bool>;

    // AS3 bytecode reads `instance.data` and `instance.size` as property
    // accesses; Haxe `(get, never)` properties compile to verifier-visible
    // accessor methods, so reads always re-fetch from the native backing —
    // critical for `data`, which Flash's native `clear()` swaps out for a
    // fresh object underneath us.
    public var data(get, never):Dynamic;
    public var size(get, never):UInt;
    private inline function get_data():Dynamic {
        return _native != null ? _native.data : _orphanData;
    }
    private inline function get_size():UInt {
        return _native != null ? _native.size : 0;
    }

    /**
     * AS3 has no proper public exposure of objectEncoding outside this
     * SharedObject API. Mirrored as a plain pass-through so games that
     * read or set encoding on the shim talk to the native object.
     */
    public var objectEncoding(get, set):UInt;
    private inline function get_objectEncoding():UInt {
        return _native != null ? _native.objectEncoding : 3;
    }
    private inline function set_objectEncoding(v:UInt):UInt {
        if (_native != null) _native.objectEncoding = v;
        return v;
    }

    public var fps(never, set):Float;
    private inline function set_fps(v:Float):Float {
        if (_native != null) _native.fps = v;
        return v;
    }

    /**
     * `client` is set by getRemote-style remoting. The shim doesn't relay
     * remoting calls, but exposing the property keeps games that probe it
     * (`if (so.client != null)`) from throwing.
     */
    public var client(get, set):Dynamic;
    private inline function get_client():Dynamic {
        return _native != null ? (_native:Dynamic).client : null;
    }
    private inline function set_client(v:Dynamic):Dynamic {
        if (_native != null) (_native:Dynamic).client = v;
        return v;
    }

    public function new(native:flash.net.SharedObject, name:String, ?localPath:String) {
        super();
        _native = native;
        _name = name;
        _localPath = localPath;
        _orphanData = ({} : Dynamic);
        _bridgedTypes = new haxe.ds.StringMap();
    }

    public function flush(?minDiskSpace:Int):String {
        // Orphan shims (from getRemote, no native backing) have nothing to
        // flush asynchronously — the data lives in _orphanData and is
        // already "persisted" as far as we're concerned. Returning "pending"
        // would imply a follow-up NetStatusEvent that never arrives, hanging
        // any game code that awaits the disk-quota dialog flow.
        var status:String = "flushed";
        if (_native != null) {
            status = _native.flush(minDiskSpace == null ? 0 : minDiskSpace);
        }
        var data:Dynamic = _native == null ? _orphanData : _native.data;
        if (_relay != null) {
            try {
                _relay(_name, _localPath, data);
            } catch (e:Dynamic) {
                // Never let the relay break the game's save path.
            }
        } else if (_pendingCalls.length < _pendingMax) {
            // Frame-1 race: firmware hasn't registered a relay yet. Hold
            // the call for setRelay() to drain. The data ref is live —
            // by drain time it reflects the latest state, which is what
            // the JSON mirror should record anyway.
            _pendingCalls.push({name: _name, path: _localPath, data: data});
        }
        return status;
    }

    /**
     * Native `clear()` resets `_native.data` to a fresh Object underneath
     * us. The `data` property always reads through `_native.data` so
     * subsequent writes via `myShim.data.foo` land on the new object,
     * not a stale reference — the previous shim captured `data` once at
     * construction and silently dropped post-clear writes.
     */
    public function clear():Void {
        if (_native != null) _native.clear();
        else _orphanData = ({} : Dynamic);
    }
    public function close():Void { if (_native != null) _native.close(); }

    /**
     * AS3 SharedObject's setProperty is a convenience wrapper around
     * `data[name] = value` (with a value-of-undefined => delete shortcut).
     * Mirror that contract so games that prefer the explicit API work.
     *
     * Important: AS3 distinguishes `null` (a stored sentinel) from
     * `undefined` (which deletes). Haxe's `value == null` matches BOTH on
     * the AS3 target, so we drop into untyped `typeof` to discriminate —
     * a game calling `setProperty("highScore", null)` to record "no run
     * yet" must keep the field, not erase it.
     */
    public function setProperty(propertyName:String, ?value:Dynamic):Void {
        var target:Dynamic = _native != null ? _native.data : _orphanData;
        if (untyped __typeof__(value) == "undefined") {
            Reflect.deleteField(target, propertyName);
        } else {
            Reflect.setField(target, propertyName, value);
        }
    }

    /**
     * Tell Flash that some structurally-mutated key in `data` should be
     * persisted on next flush. The native `setDirty` only matters for
     * remoting (`getRemote`) shims; for local saves it's a no-op even
     * natively. Forwarded for parity.
     */
    public function setDirty(propertyName:String):Void {
        if (_native != null) (_native:Dynamic).setDirty(propertyName);
    }

    /**
     * Remoting send — used only by getRemote shims, which have no native
     * backing here. Provided so `mySO.send(...)` doesn't throw.
     */
    public function send(args:haxe.extern.Rest<Dynamic>):Void {
        if (_native != null) Reflect.callMethod(_native, Reflect.field(_native, "send"), cast args);
    }

    public function connect(?command:flash.net.NetConnection, ?params:String):Void {
        if (_native != null) (_native:Dynamic).connect(command, params);
    }

    /**
     * EventDispatcher pass-through. AS3 games attach NetStatusEvent /
     * AsyncErrorEvent / SyncEvent listeners to SharedObject for the
     * disk-quota dialog flow. We register the listener on the shim's own
     * EventDispatcher (inherited via `extends`), and lazily install a
     * single forwarder on the native object per event type that
     * re-dispatches a clone through the shim — that way `event.target`
     * and `event.currentTarget` are the shim object the game expects,
     * not the underlying native SharedObject.
     */
    override public function addEventListener(type:String, listener:Dynamic, useCapture:Bool = false, priority:Int = 0, useWeakReference:Bool = false):Void {
        super.addEventListener(type, listener, useCapture, priority, useWeakReference);
        if (_native == null) return;
        if (_bridgedTypes.exists(type)) return;
        _bridgedTypes.set(type, true);
        var self = this;
        var forwarder:flash.events.Event->Void = function(e:flash.events.Event):Void {
            // dispatchEvent on the shim sets event.target/currentTarget to
            // the shim — but only if the event hasn't already been
            // dispatched. clone() gives us a fresh, undispatched copy.
            // Some Event subclasses don't override clone() and return the
            // base class with stripped fields; tolerate by falling back.
            var copy:flash.events.Event;
            try { copy = e.clone(); } catch (err:Dynamic) { copy = e; }
            try { self.dispatchEvent(copy); } catch (err:Dynamic) { /* swallow */ }
        };
        _native.addEventListener(type, forwarder, useCapture, priority, useWeakReference);
    }
}
