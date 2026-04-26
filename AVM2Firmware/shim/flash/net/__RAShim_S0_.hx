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
class __RAShim_S0_ {
    public static var _relay:Dynamic = null;
    public static function setRelay(f:Dynamic):Void { _relay = f; }

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
            var idx:Int = url.indexOf("rafslot=");
            if (idx < 0) return;
            var s:String = url.substr(idx + 8);
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

    // `data` and `size` are Haxe-property-style on flash.net.SharedObject; we
    // expose them as plain public fields here. AS3 bytecode reads `instance.data`
    // as a property access — since this is a `Dynamic`/Object reference, the
    // getter shape doesn't matter; the verifier just needs a slot named "data"
    // on the class for the property lookup to bind.
    public var data:Dynamic;
    public var size:UInt;

    public function new(native:flash.net.SharedObject, name:String, ?localPath:String) {
        _native = native;
        _name = name;
        _localPath = localPath;
        data = native == null ? ({} : Dynamic) : native.data;
        size = native == null ? 0 : native.size;
    }

    public function flush(?minDiskSpace:Int):String {
        var status:String = "pending";
        if (_native != null) {
            status = _native.flush(minDiskSpace == null ? 0 : minDiskSpace);
        }
        if (_relay != null) {
            try {
                _relay(_name, _localPath, _native == null ? {} : _native.data);
            } catch (e:Dynamic) {
                // Never let the relay break the game's save path.
            }
        }
        return status;
    }

    public function clear():Void { if (_native != null) _native.clear(); }
    public function close():Void { if (_native != null) _native.close(); }
}
