package;

#if flash
import flash.display.DisplayObject;
import flash.display.DisplayObjectContainer;
import flash.display.Loader;
import flash.display.MovieClip;
import flash.display.Sprite;
import flash.text.TextField;
import flash.utils.Dictionary;
#end

/**
 * Stack-based bytecode interpreter for the Formula DSL.
 * Port of AVM1Firmware/Main.as evaluate() (lines 676-1300).
 *
 * Every stack value is an Array<Dynamic> — scalars are single-element arrays.
 * Binary ops broadcast: scalar×N, N×scalar, N×N (element-wise), M×N (NaN).
 */
class Evaluate {

    // Remembered values for {expr} syntax — persists across evaluation frames
    public static var rememberedValues:Map<String, Array<Dynamic>> = new Map();

    // Sentinel objects for special DSL globals (root, class)
    // These are recognized by enumerateProperties/readProperty for special handling.
    public static var ROOT_SENTINEL:Dynamic = {__raflash_type: "root"};
    public static var CLASS_SENTINEL:Dynamic = {__raflash_type: "class"};

    // Function-call hook state. Maps wrapper Function → Int hook ID.
    // Uses Dictionary (identity keys) because AS3 Function objects are sealed
    // and cannot have custom properties stamped on them.
    #if flash
    private static var hookIds:Dictionary = null;
    private static var hookSkipped:Dictionary = null;
    #end
    private static var hookSeen:Map<Int, Bool> = new Map();
    private static var hookPending:Map<Int, Bool> = new Map();
    private static var hookNextId:Int = 0;

    // Cached game class registry: className → classRef. Built lazily on first use.
    private static var gameClassRegistry:Map<String, Dynamic> = null;
    // Cached merged statics: fieldName → value. Built alongside gameClassRegistry.
    private static var mergedStaticFields:Map<String, Dynamic> = null;
    private static var mergedStaticKeys:Array<String> = null;
    // The gameRoot used to build the registry (to detect staleness)
    private static var registryGameRoot:Dynamic = null;

    private static function buildClassRegistry(gameRoot:Dynamic):Void {
        if (gameClassRegistry != null && registryGameRoot == gameRoot) return;
        gameClassRegistry = new Map();
        mergedStaticFields = new Map();
        mergedStaticKeys = [];
        registryGameRoot = gameRoot;

        #if flash
        try {
            var appDomain:Dynamic = untyped gameRoot.loaderInfo.applicationDomain;
            var names:Dynamic = untyped appDomain.getQualifiedDefinitionNames();
            var numNames:Int = untyped names.length;
            var i:Int = 0;
            while (i < numNames) {
                var fullName:String = Std.string(untyped names[i]);
                i++;
                // Skip Flash/Haxe/framework internals
                if (fullName.indexOf("flash.") == 0) continue;
                if (fullName.indexOf("haxe.") == 0) continue;
                if (fullName.indexOf("openfl.") == 0) continue;
                if (fullName.indexOf("lime.") == 0) continue;
                if (fullName.indexOf("libtf.") == 0) continue;
                if (fullName.indexOf("__AS3__.") == 0) continue;
                if (fullName.indexOf("§") == 0) continue;
                // Get short name (after last dot or ::)
                var shortName:String = fullName;
                var colonIdx:Int = fullName.lastIndexOf("::");
                if (colonIdx >= 0) {
                    shortName = fullName.substr(colonIdx + 2);
                } else {
                    var dotIdx:Int = fullName.lastIndexOf(".");
                    if (dotIdx >= 0) shortName = fullName.substr(dotIdx + 1);
                }
                // Try to get the class
                try {
                    var cls:Dynamic = untyped appDomain.getDefinition(fullName);
                    if (cls == null) continue;
                    gameClassRegistry.set(shortName, cls);
                    // Enumerate statics and add to merged map
                    try {
                        var classXml:Dynamic = untyped __global__["flash.utils.describeType"](cls);
                        var staticVars:Dynamic = untyped classXml.variable;
                        var numVars:Int = untyped staticVars.length();
                        var v:Int = 0;
                        while (v < numVars) {
                            var varName:String = Std.string(untyped staticVars[v].attribute("name"));
                            if (!mergedStaticFields.exists(varName)) {
                                mergedStaticFields.set(varName, cls);
                                mergedStaticKeys.push(varName);
                            }
                            v++;
                        }
                    } catch (e2:Dynamic) {}
                } catch (e2:Dynamic) {}
            }
        } catch (e:Dynamic) {}
        #end
    }

    // Cached "main" resolution per gameRoot
    private static var cachedMainGameRoot:Dynamic = null;
    private static var cachedMainResult:Dynamic = null;

    /**
     * Resolve the "main" keyword: if gameRoot's class is already named "Main",
     * return gameRoot itself (pure AS3). Otherwise (Haxe boot shim), look for
     * a class named "Main" in the game's ApplicationDomain and return the class
     * object (for static field access).
     */
    private static function resolveMain(gameRoot:Dynamic):Dynamic {
        if (cachedMainGameRoot == gameRoot) return cachedMainResult;
        cachedMainGameRoot = gameRoot;
        cachedMainResult = gameRoot; // default fallback

        #if flash
        try {
            var className:String = Std.string(untyped __global__["flash.utils.getQualifiedClassName"](gameRoot));
            // Strip package prefix to get short name
            var shortName:String = className;
            var colonIdx:Int = className.lastIndexOf("::");
            if (colonIdx >= 0) shortName = className.substr(colonIdx + 2);
            else {
                var dotIdx:Int = className.lastIndexOf(".");
                if (dotIdx >= 0) shortName = className.substr(dotIdx + 1);
            }

            if (shortName == "Main") {
                // Pure AS3: gameRoot IS Main, no indirection needed
                cachedMainResult = gameRoot;
            } else {
                // Haxe/framework boot shim: look for a "Main" class in the game's domain
                try {
                    var appDomain:Dynamic = untyped gameRoot.loaderInfo.applicationDomain;
                    if (untyped appDomain.hasDefinition("Main")) {
                        var cls:Dynamic = untyped appDomain.getDefinition("Main");
                        if (cls != null) cachedMainResult = cls;
                    }
                } catch (e:Dynamic) {}
            }
        } catch (e:Dynamic) {}
        #end

        return cachedMainResult;
    }

    // Flash built-in property defaults (documented in Adobe AS3 reference).
    // Properties at their default value are hidden during enumeration to reduce noise.
    private static var flashPropDefaults:Map<String, Dynamic> = null;
    // Properties that are always noise (dynamic mouse coords, always-present objects, structural refs)
    private static var flashPropSkip:Map<String, Bool> = null;
    // Loader/LoaderInfo properties that throw SecurityError on cross-domain content
    private static var flashPropCrossDomain:Map<String, Bool> = null;

    private static function initFlashDefaults():Void {
        if (flashPropDefaults != null) return;

        flashPropDefaults = new Map();
        // DisplayObject
        flashPropDefaults.set("alpha", 1);
        flashPropDefaults.set("x", 0);
        flashPropDefaults.set("y", 0);
        flashPropDefaults.set("z", 0);
        flashPropDefaults.set("rotation", 0);
        flashPropDefaults.set("rotationX", 0);
        flashPropDefaults.set("rotationY", 0);
        flashPropDefaults.set("rotationZ", 0);
        flashPropDefaults.set("scaleX", 1);
        flashPropDefaults.set("scaleY", 1);
        flashPropDefaults.set("scaleZ", 1);
        flashPropDefaults.set("width", 0);
        flashPropDefaults.set("height", 0);
        flashPropDefaults.set("visible", true);
        flashPropDefaults.set("blendMode", "normal");
        flashPropDefaults.set("cacheAsBitmap", false);
        flashPropDefaults.set("numChildren", 0);
        // InteractiveObject
        flashPropDefaults.set("mouseEnabled", true);
        flashPropDefaults.set("tabEnabled", false);
        flashPropDefaults.set("tabIndex", -1);
        flashPropDefaults.set("doubleClickEnabled", false);
        flashPropDefaults.set("needsSoftKeyboard", false);
        // DisplayObjectContainer
        flashPropDefaults.set("mouseChildren", true);
        flashPropDefaults.set("tabChildren", true);
        // Sprite
        flashPropDefaults.set("buttonMode", false);
        flashPropDefaults.set("useHandCursor", true);
        // MovieClip
        // Note: currentFrame intentionally excluded — it cycles during animations
        // and would blink in/out of the Memory Explorer when it hits 1.
        flashPropDefaults.set("totalFrames", 1);
        flashPropDefaults.set("framesLoaded", 1);
        flashPropDefaults.set("enabled", true);
        flashPropDefaults.set("isPlaying", false);
        flashPropDefaults.set("trackAsMenu", false);

        flashPropSkip = new Map();
        // Dynamic values (change every frame based on cursor)
        flashPropSkip.set("mouseX", true);
        flashPropSkip.set("mouseY", true);
        // Always-present objects (not useful for game state)
        flashPropSkip.set("transform", true);
        flashPropSkip.set("graphics", true);
        flashPropSkip.set("textSnapshot", true);
        flashPropSkip.set("currentScene", true);
        flashPropSkip.set("scenes", true);
        flashPropSkip.set("currentLabels", true);
        flashPropSkip.set("loaderInfo", true);
        // Structural references (always set for on-stage objects)
        flashPropSkip.set("parent", true);
        flashPropSkip.set("root", true);
        flashPropSkip.set("stage", true);
        // Loader/LoaderInfo properties that throw SecurityError on cross-domain content
        flashPropCrossDomain = new Map();
        flashPropCrossDomain.set("content", true);
        flashPropCrossDomain.set("contentLoaderInfo", true);
        flashPropCrossDomain.set("uncaughtErrorEvents", true);
        flashPropCrossDomain.set("bytes", true);
    }

    /** Check if a Flash accessor value matches its documented default (for non-trivial types). */
    private static function isFlashDefault(name:String, val:Dynamic):Bool {
        if (flashPropDefaults.exists(name)) {
            return val == flashPropDefaults.get(name);
        }
        if (name == "filters") {
            return Std.isOfType(val, Array) && (cast(val, Array<Dynamic>)).length == 0;
        }
        if (name == "soundTransform") {
            try {
                return untyped val.volume == 1 && untyped val.pan == 0
                    && untyped val.leftToLeft == 1 && untyped val.leftToRight == 0
                    && untyped val.rightToRight == 1 && untyped val.rightToLeft == 0;
            } catch (e:Dynamic) { return false; }
        }
        return false;
    }

    // === Function Hook API ===

    /**
     * Move pending hook calls → seen. Called once per frame from Main.onEnterFrame
     * before achievement evaluation, so all formulas within one frame see a
     * consistent snapshot of which hooked functions fired.
     */
    public static function snapshotHooks():Void {
        hookSeen = hookPending;
        hookPending = new Map();
    }

    /**
     * Wrap a function value with a hook that records calls.
     * Returns the wrapper for function values; returns the original value
     * unchanged for non-functions or if the replacement didn't stick (sealed slot).
     */
    private static function wrapHook(parent:Dynamic, key:String, value:Dynamic):Dynamic {
        if (untyped __typeof__(value) != "function") return value;

        #if flash
        if (hookIds == null) {
            hookIds = new Dictionary(false);
            hookSkipped = new Dictionary(false);
        }
        // Already wrapped or previously failed
        if (hookIds[value] != null) return value;
        if (hookSkipped[value] != null) return value;

        var id:Int = ++hookNextId;
        var orig:Dynamic = value;
        // Create wrapper that records the call and delegates to original.
        // Reflect.makeVarArgs produces a proper AS3 ...rest function on Flash target.
        var wrapper:Dynamic = Reflect.makeVarArgs(function(args:Array<Dynamic>):Dynamic {
            hookPending.set(id, true);
            return Reflect.callMethod(parent, orig, args);
        });
        hookIds[wrapper] = id;

        // Try to replace the function on the parent object
        try {
            untyped parent[key] = wrapper;
        } catch (e:Dynamic) {}
        // Verify the assignment took
        try {
            if (untyped parent[key] != wrapper) {
                hookSkipped[value] = true;
                return value;
            }
        } catch (e:Dynamic) {
            hookSkipped[value] = true;
            return value;
        }
        return wrapper;
        #else
        return value;
        #end
    }

    /**
     * Check whether a value is a hooked function wrapper and return its hook ID,
     * or -1 if it is not hooked.
     */
    private static function getHookId(value:Dynamic):Int {
        #if flash
        if (hookIds == null) return -1;
        var id:Dynamic = hookIds[value];
        return id != null ? cast(id, Int) : -1;
        #else
        return -1;
        #end
    }

    /**
     * Check whether a value is a function that we tried and failed to hook
     * (e.g., sealed slot on a non-dynamic class).
     */
    private static function isHookSkipped(value:Dynamic):Bool {
        #if flash
        if (hookSkipped == null) return false;
        return hookSkipped[value] != null;
        #else
        return false;
        #end
    }

    // === Public API ===

    /**
     * Evaluate a compiled formula bytecode array.
     * @param formula  The bytecode token array (starts with VERSION_1)
     * @param start    Start index in formula
     * @param end      End index (exclusive)
     * @param context  Current "this" array
     * @param keys     Current "key" array (parallel to context)
     * @param gameRoot The loaded game's root display object (for READ_GLOBAL "stage")
     * @return Array of result values, or null on error
     */
    private static var _emptyArr:Array<Dynamic> = [];

    private static inline function safePop(stack:Array<Array<Dynamic>>):Array<Dynamic> {
        return stack.length > 0 ? stack.pop() : _emptyArr;
    }

    public static function evaluate(formula:Array<Dynamic>, start:Int, end:Int, context:Array<Dynamic>, keys:Array<Dynamic>, gameRoot:Dynamic):Array<Dynamic> {
        var stack:Array<Array<Dynamic>> = [];
        var i:Int = start;

        while (i < end) {
            var token:String = cast formula[i];
            i++;

            if (token == "VALUE") {
                stack.push([Std.parseFloat(cast(formula[i], String))]);
                i++;
            } else if (token == "STRING") {
                stack.push([formula[i]]);
                i++;
            } else if (token == "NULL") {
                stack.push([null]);
            } else if (token == "IDENTIFIER") {
                stack.push([formula[i]]);
                i++;
            } else if (token == "ADD") {
                var b = safePop(stack);
                var a = safePop(stack);
                var length = a.length > b.length ? a.length : b.length;

                if (a.length > 0 && b.length == 0) {
                    stack.push(a);
                } else if (b.length > 0 && a.length == 0) {
                    stack.push(b);
                } else if (a.length != b.length && a.length != 1 && b.length != 1) {
                    var result:Array<Dynamic> = [];
                    var j:Int = 0;
                    while (j < length) { result.push(Math.NaN); j++; }
                    stack.push(result);
                } else {
                    var aPlural = a.length != 1;
                    var bPlural = b.length != 1;
                    var result:Array<Dynamic> = [];
                    var j:Int = 0;
                    while (j < length) {
                        var aVal:Dynamic = aPlural ? a[j] : a[0];
                        var bVal:Dynamic = bPlural ? b[j] : b[0];
                        if (Std.isOfType(aVal, String) || Std.isOfType(bVal, String)) {
                            result.push(Std.string(aVal) + Std.string(bVal));
                        } else if (Std.isOfType(aVal, Float) && Std.isOfType(bVal, Float)) {
                            result.push((aVal : Float) + (bVal : Float));
                        } else {
                            result.push(Math.NaN);
                        }
                        j++;
                    }
                    stack.push(result);
                }
            } else if (token == "SUB") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryArith(a, b, function(av:Float, bv:Float):Float { return av - bv; }));
            } else if (token == "MUL") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryArith(a, b, function(av:Float, bv:Float):Float { return av * bv; }));
            } else if (token == "DIV") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryArith(a, b, function(av:Float, bv:Float):Float { return av / bv; }));
            } else if (token == "MOD") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryArith(a, b, function(av:Float, bv:Float):Float { return av % bv; }));
            } else if (token == "POW") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryArith(a, b, function(av:Float, bv:Float):Float { return Math.pow(av, bv); }));
            } else if (token == "EQUAL") {
                var b = safePop(stack);
                var a = safePop(stack);
                // null comparison: check if array is empty
                if (b.length == 1 && b[0] == null) {
                    stack.push([a.length == 0 ? 1 : 0]);
                } else if (a.length == 1 && a[0] == null) {
                    stack.push([b.length == 0 ? 1 : 0]);
                } else {
                    stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return av == bv ? 1 : 0; }));
                }
            } else if (token == "NOT_EQUAL") {
                var b = safePop(stack);
                var a = safePop(stack);
                // null comparison: check if array is not empty
                if (b.length == 1 && b[0] == null) {
                    stack.push([a.length > 0 ? 1 : 0]);
                } else if (a.length == 1 && a[0] == null) {
                    stack.push([b.length > 0 ? 1 : 0]);
                } else {
                    stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return av != bv ? 1 : 0; }));
                }
            } else if (token == "GREATER") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return (av : Float) > (bv : Float) ? 1 : 0; }));
            } else if (token == "GREATER_EQUAL") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return (av : Float) >= (bv : Float) ? 1 : 0; }));
            } else if (token == "LESSER") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return (av : Float) < (bv : Float) ? 1 : 0; }));
            } else if (token == "LESSER_EQUAL") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return (av : Float) <= (bv : Float) ? 1 : 0; }));
            } else if (token == "AND") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return isTruthy(av) && isTruthy(bv) ? 1 : 0; }));
            } else if (token == "OR") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return isTruthy(av) || isTruthy(bv) ? 1 : 0; }));
            } else if (token == "XOR") {
                var b = safePop(stack);
                var a = safePop(stack);
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int {
                    var ai:Int = isTruthy(av) ? 1 : 0;
                    var bi:Int = isTruthy(bv) ? 1 : 0;
                    return (ai ^ bi) != 0 ? 1 : 0;
                }));
            } else if (token == "NOT") {
                var a = safePop(stack);
                if (a.length == 0) {
                    stack.push([1]);
                } else {
                    var notResult:Array<Dynamic> = [];
                    for (v in a) {
                        notResult.push(isTruthy(v) ? 0 : 1);
                    }
                    stack.push(notResult);
                }
            } else if (token == "LEN") {
                var a = safePop(stack);
                // Flatten array elements (same as OBJECT_ACCESS preamble)
                // so len(.arr) where arr=[] returns 0, not 1
                var flat:Array<Dynamic> = [];
                for (el in a) {
                    if (Std.isOfType(el, Array)) {
                        var inner:Array<Dynamic> = cast el;
                        for (innerEl in inner) {
                            flat.push(innerEl);
                        }
                    } else {
                        flat.push(el);
                    }
                }
                stack.push([flat.length]);
            } else if (token == "READ_GLOBAL") {
                var identifiers = safePop(stack);
                if (identifiers.length == 1) {
                    var name:String = cast identifiers[0];
                    if (name == "root") {
                        // Combined soup: display list + all game class statics
                        ROOT_SENTINEL.__raflash_gameRoot = gameRoot;
                        stack.push([ROOT_SENTINEL]);
                    } else if (name == "stage") {
                        // Display list only (document class instance)
                        stack.push([gameRoot]);
                    } else if (name == "main") {
                        // Smart alias: if gameRoot IS "Main", same as stage.
                        // Otherwise (Haxe boot shim), resolve the real Main class.
                        stack.push([resolveMain(gameRoot)]);
                    } else if (name == "class") {
                        // Class namespace: all game classes as children
                        CLASS_SENTINEL.__raflash_gameRoot = gameRoot;
                        stack.push([CLASS_SENTINEL]);
                    } else if (name == "this") {
                        stack.push(context);
                    } else if (name == "key") {
                        stack.push(keys);
                    } else if (name == "stage_frame") {
                        #if flash
                        var mc = Std.downcast(gameRoot, flash.display.MovieClip);
                        stack.push([mc != null ? mc.currentFrame : 0]);
                        #else
                        stack.push([0]);
                        #end
                    } else {
                        return null;
                    }
                } else {
                    trace("[Evaluate] Invalid global identifiers array");
                    return null;
                }
            } else if (token == "OBJECT_ACCESS") {
                var targets = safePop(stack);
                var amount:Int = Std.parseInt(cast(formula[i], String));

                // Flatten Array targets so .prop maps over array elements
                // e.g. stage.allTitles.charTitle where allTitles is an Array
                var needsFlatten:Bool = false;
                var fj:Int = 0;
                while (fj < targets.length) {
                    if (Std.isOfType(targets[fj], Array)) {
                        needsFlatten = true;
                        break;
                    }
                    fj++;
                }
                if (needsFlatten) {
                    var flatTargets:Array<Dynamic> = [];
                    fj = 0;
                    while (fj < targets.length) {
                        if (Std.isOfType(targets[fj], Array)) {
                            var innerArr:Array<Dynamic> = cast targets[fj];
                            var fk:Int = 0;
                            while (fk < innerArr.length) {
                                flatTargets.push(innerArr[fk]);
                                fk++;
                            }
                        } else {
                            flatTargets.push(targets[fj]);
                        }
                        fj++;
                    }
                    targets = flatTargets;
                }

                var result:Array<Dynamic> = [];

                // OPTIMIZATION: Detect simple property access pattern
                // Pattern: IDENTIFIER key, READ_GLOBAL, IDENTIFIER <name>, EQUAL (length 6)
                if (amount == 6 && i + amount < formula.length &&
                    formula[i + 1] == "IDENTIFIER" &&
                    formula[i + 2] == "key" &&
                    formula[i + 3] == "READ_GLOBAL" &&
                    formula[i + 4] == "IDENTIFIER" &&
                    formula[i + 6] == "EQUAL") {

                    var propName:String = cast formula[i + 5];
                    var j:Int = 0;
                    while (j < targets.length) {
                        var target:Dynamic = targets[j];
                        // Synthetic .triggered on hooked functions:
                        // resolves to 1 if the wrapper fired this frame, 0 otherwise.
                        // Returns "ERROR" if the function couldn't be hooked (sealed slot).
                        if (propName == "triggered") {
                            var hid:Int = getHookId(target);
                            if (hid >= 0) {
                                result.push(hookSeen.exists(hid) ? 1 : 0);
                                j++;
                                continue;
                            }
                            if (isHookSkipped(target)) {
                                result.push("ERROR");
                                j++;
                                continue;
                            }
                        }
                        var value:Dynamic = readProperty(target, propName);
                        if (value != null || hasProperty(target, propName)) {
                            result.push(wrapHook(target, propName, value));
                        }
                        j++;
                    }
                    stack.push(result);
                    i += amount + 1;
                } else {
                    // Generic implementation: enumerate all properties and filter
                    var j:Int = 0;
                    while (j < targets.length) {
                        var target:Dynamic = targets[j];
                        var props = enumerateProperties(target);
                        var childThis:Array<Dynamic> = props.values;
                        var childKeys:Array<Dynamic> = props.keys;

                        // Synthetic .triggered for hooked functions, so
                        // generic-path filters like `key == "triggered"` work.
                        // Returns "ERROR" for functions that couldn't be hooked.
                        var hid:Int = getHookId(target);
                        if (hid >= 0) {
                            childKeys.push("triggered");
                            childThis.push(hookSeen.exists(hid) ? 1 : 0);
                        } else if (isHookSkipped(target)) {
                            childKeys.push("triggered");
                            childThis.push("ERROR");
                        }

                        var filterResult = evaluate(formula, i + 1, i + amount + 1, childThis, childKeys, gameRoot);
                        if (filterResult != null) {
                            var k:Int = 0;
                            while (k < filterResult.length) {
                                if (filterResult[k] == true || filterResult[k] == 1) {
                                    result.push(childThis[k]);
                                }
                                k++;
                            }
                        }
                        j++;
                    }
                    stack.push(result);
                    i += amount + 1;
                }
            } else if (token == "ARRAY_ACCESS") {
                var targets = safePop(stack);
                var amount:Int = Std.parseInt(cast(formula[i], String));

                var result:Array<Dynamic> = [];

                // OPTIMIZATION: Detect simple numeric index pattern
                // Pattern: VALUE <n> (length 2)
                if (amount == 2 && i + amount < formula.length && formula[i + 1] == "VALUE") {
                    var idx:Int = Std.parseInt(cast(formula[i + 2], String));
                    var j:Int = 0;
                    while (j < targets.length) {
                        var value:Dynamic = readIndex(targets[j], idx);
                        if (value != null) {
                            result.push(value);
                        }
                        j++;
                    }
                    stack.push(result);
                    i += amount + 1;
                } else {
                    // Generic implementation: filter array elements by condition
                    // Enumerate elements as (this=values, key=indices), evaluate
                    // condition per-element, keep elements where result is true
                    var j:Int = 0;
                    while (j < targets.length) {
                        var target:Dynamic = targets[j];

                        var childThis:Array<Dynamic> = [];
                        var childKeys:Array<Dynamic> = [];

                        if (Std.isOfType(target, Array)) {
                            var arr:Array<Dynamic> = cast target;
                            var ai:Int = 0;
                            while (ai < arr.length) {
                                childThis.push(arr[ai]);
                                childKeys.push(ai);
                                ai++;
                            }
                        } else {
                            // For non-array targets, try numeric index access
                            try {
                                var len:Int = untyped target.length;
                                var ai:Int = 0;
                                while (ai < len) {
                                    childThis.push(untyped target[ai]);
                                    childKeys.push(ai);
                                    ai++;
                                }
                            } catch (e:Dynamic) {}
                        }

                        var filterResult = evaluate(formula, i + 1, i + amount + 1, childThis, childKeys, gameRoot);
                        if (filterResult != null) {
                            var k:Int = 0;
                            while (k < filterResult.length) {
                                if (filterResult[k] == true || filterResult[k] == 1) {
                                    if (k < childThis.length) {
                                        result.push(childThis[k]);
                                    }
                                }
                                k++;
                            }
                        }
                        j++;
                    }
                    stack.push(result);
                    i += amount + 1;
                }
            } else if (token == "REMEMBER") {
                var remLen:Int = Std.parseInt(cast(formula[i], String));
                i++;
                var remStart:Int = i;
                var remEnd:Int = remStart + remLen;

                // Build key from inner bytecode for deduplication
                var remKey:String = "";
                var rk:Int = remStart;
                while (rk < remEnd) {
                    remKey += Std.string(formula[rk]) + "|";
                    rk++;
                }

                var remResult = evaluate(formula, remStart, remEnd, context, keys, gameRoot);

                if (remResult != null && remResult.length > 0) {
                    rememberedValues.set(remKey, remResult);
                    stack.push(remResult);
                } else if (rememberedValues.exists(remKey)) {
                    stack.push(rememberedValues.get(remKey));
                } else {
                    stack.push([]);
                }
                i = remEnd;
            } else if (token == "TERNARY") {
                var thenLen:Int = Std.parseInt(cast(formula[i], String));
                i++;
                var thenStart:Int = i;
                var thenEnd:Int = thenStart + thenLen;

                var elseLen:Int = Std.parseInt(cast(formula[thenEnd], String));
                var elseStart:Int = thenEnd + 1;
                var elseEnd:Int = elseStart + elseLen;

                var condition:Array<Dynamic> = safePop(stack);

                // Check if condition is uniformly truthy or falsy to avoid evaluating both branches
                var allTrue:Bool = true;
                var allFalse:Bool = true;
                var ci:Int = 0;
                while (ci < condition.length) {
                    if (isTruthy(condition[ci])) allFalse = false;
                    else allTrue = false;
                    ci++;
                }

                if (allTrue) {
                    var onlyThen = evaluate(formula, thenStart, thenEnd, context, keys, gameRoot);
                    stack.push(onlyThen != null ? onlyThen : []);
                } else if (allFalse) {
                    var onlyElse = evaluate(formula, elseStart, elseEnd, context, keys, gameRoot);
                    stack.push(onlyElse != null ? onlyElse : []);
                } else {
                    var thenResult = evaluate(formula, thenStart, thenEnd, context, keys, gameRoot);
                    var elseResult = evaluate(formula, elseStart, elseEnd, context, keys, gameRoot);
                    if (thenResult == null) thenResult = [];
                    if (elseResult == null) elseResult = [];

                    var result:Array<Dynamic> = [];
                    var j:Int = 0;
                    while (j < condition.length) {
                        var cond:Dynamic = condition[j];
                        var thenVal:Dynamic = (thenResult.length == 1) ? thenResult[0] : (j < thenResult.length ? thenResult[j] : null);
                        var elseVal:Dynamic = (elseResult.length == 1) ? elseResult[0] : (j < elseResult.length ? elseResult[j] : null);
                        result.push(isTruthy(cond) ? thenVal : elseVal);
                        j++;
                    }
                    stack.push(result);
                }
                i = elseEnd;
            } else {
                // Unknown token
                trace("[Evaluate] Unknown token: " + token);
                return null;
            }
        }

        if (stack.length == 1) {
            return stack[0];
        } else {
            return null;
        }
    }

    // === Output Formatting ===

    /**
     * Format evaluation results for display in devtools.
     * Port of AVM1Firmware/Main.as formatOutput() (lines 1446-1508).
     */
    public static function formatOutput(input:Array<Dynamic>, level:Int):Dynamic {
        var singular:Bool = input.length == 1;
        var output:Array<Dynamic> = [];

        var idx:Int = 0;
        while (idx < input.length) {
            var value:Dynamic = input[idx];

            #if flash
            if (Std.isOfType(value, DisplayObject)) {
                var typeName:String = Std.isOfType(value, MovieClip) ? "MovieClip"
                    : Std.isOfType(value, Loader) ? "Loader"
                    : Std.isOfType(value, Sprite) ? "Sprite"
                    : Std.isOfType(value, TextField) ? "TextField"
                    : {
                        var cn:String = try Std.string(Type.getClassName(Type.getClass(value))) catch (_:Dynamic) null;
                        if (cn != null && cn != "null" && cn.length > 0) {
                            var dot:Int = cn.lastIndexOf(".");
                            dot >= 0 ? cn.substr(dot + 1) : cn;
                        } else "Object";
                    };
                if (Std.isOfType(value, TextField)) {
                    var tf:TextField = cast value;
                    output.push({value: "[TextField \"" + createLabelString(tf.text) + "\"]"});
                } else if (level == 0 && singular) {
                    var props = enumerateProperties(value);
                    var k:Int = 0;
                    while (k < props.keys.length) {
                        var childFormatted:Dynamic = formatOutput([props.values[k]], level + 1);
                        output.push({value: props.keys[k] + ": " + childFormatted.output[0].value});
                        k++;
                    }
                } else {
                    var props = enumerateProperties(value);
                    output.push({value: "[" + typeName + " ..." + props.keys.length + "]"});
                }
            } else
            #end
            if (Std.isOfType(value, Float)) {
                output.push({value: value});
            } else if (Std.isOfType(value, String)) {
                output.push({value: "\"" + value + "\""});
            } else if (Std.isOfType(value, Bool)) {
                output.push({value: value});
            #if flash
            } else if (untyped __is__(value, __global__["Date"])) {
                output.push({value: "[Date \"" + Std.string(value) + "\"]"});
            #end
            } else if (Std.isOfType(value, Array)) {
                var arr:Array<Dynamic> = cast value;
                if (level == 0 && singular) {
                    var k:Int = 0;
                    while (k < arr.length) {
                        var childFormatted:Dynamic = formatOutput([arr[k]], level + 1);
                        output.push({value: k + ": " + childFormatted.output[0].value});
                        k++;
                    }
                } else {
                    output.push({value: "[Array ..." + arr.length + "]"});
                }
            } else if (value == null) {
                output.push({value: "null"});
            } else if (untyped __typeof__(value) == "function") {
                output.push({value: "[Function]"});
            } else {
                // Generic object
                if (level == 0 && singular) {
                    var fields = enumerateProperties(value);
                    var k:Int = 0;
                    while (k < fields.keys.length) {
                        var childFormatted:Dynamic = formatOutput([fields.values[k]], level + 1);
                        output.push({value: fields.keys[k] + ": " + childFormatted.output[0].value});
                        k++;
                    }
                } else {
                    var fields = enumerateProperties(value);
                    var objName:String = "Object";
                    try {
                        var cn:String = Std.string(Type.getClassName(Type.getClass(value)));
                        if (cn != null && cn != "null" && cn.length > 0) {
                            var dot:Int = cn.lastIndexOf(".");
                            objName = dot >= 0 ? cn.substr(dot + 1) : cn;
                        }
                    } catch (_:Dynamic) {}
                    output.push({value: "[" + objName + " ..." + fields.keys.length + "]"});
                }
            }
            idx++;
        }

        return {output: output};
    }

    // === Value Search ===

    /**
     * Recursively search a game object tree for values matching a wildcard pattern.
     * Port of AVM1Firmware/Main.as searchTargetForValue() (lines 1377-1437).
     *
     * @param target  The object to search
     * @param value   The wildcard pattern to match against
     * @param path    The current dot-notation path (e.g., "stage.player")
     * @param output  Array to collect matching path strings
     * @param visited Array for circular reference protection
     */
    public static function searchTargetForValue(target:Dynamic, value:String, path:String, output:Array<Dynamic>, visited:#if flash flash.utils.Dictionary #else Dynamic #end):Void {
        // Circular reference protection for objects (Dictionary uses identity keys for O(1) lookup)
        if (#if flash Std.isOfType(target, DisplayObjectContainer) || #end (untyped __typeof__(target) == "object" && target != null)) {
            if (untyped visited[target] == true) return;
            untyped visited[target] = true;
        }

        #if flash
        if (Std.isOfType(target, DisplayObjectContainer)) {
            // MovieClip/Sprite: enumerate and recurse into properties
            var props = enumerateProperties(target);
            var k:Int = 0;
            while (k < props.keys.length) {
                searchTargetForValue(props.values[k], value, path + "." + props.keys[k], output, visited);
                k++;
            }
        } else if (Std.isOfType(target, TextField)) {
            var tf:TextField = cast target;
            if (matchesWildcard(tf.text, value)) {
                output.push(path);
            }
        } else
        #end
        if (Std.isOfType(target, Float)) {
            if (matchesWildcard(Std.string(target), value)) {
                output.push(path);
            }
        } else if (Std.isOfType(target, String)) {
            if (matchesWildcard(cast(target, String), value)) {
                output.push(path);
            }
        } else if (Std.isOfType(target, Bool)) {
            if (matchesWildcard(Std.string(target), value.toLowerCase())) {
                output.push(path);
            }
        #if flash
        } else if (untyped __is__(target, __global__["Date"])) {
            if (matchesWildcard(Std.string(target), value)) {
                output.push(path);
            }
        #end
        } else if (Std.isOfType(target, Array)) {
            var arr:Array<Dynamic> = cast target;
            var j:Int = 0;
            while (j < arr.length) {
                searchTargetForValue(arr[j], value, path + "[" + j + "]", output, visited);
                j++;
            }
        } else if (target == null) {
            if (value == "null") {
                output.push(path);
            }
        } else if (untyped __typeof__(target) == "function") {
            if ("[function]" == value.toLowerCase()) {
                output.push(path);
            }
        } else if (untyped __typeof__(target) == "object") {
            // Generic object: enumerate and recurse
            var props = enumerateProperties(target);
            var k:Int = 0;
            while (k < props.keys.length) {
                searchTargetForValue(props.values[k], value, path + "." + props.keys[k], output, visited);
                k++;
            }
        }
    }

    /**
     * Recursively search for property names containing a substring.
     */
    public static function searchTargetForName(target:Dynamic, nameLower:String, path:String, output:Array<Dynamic>, visited:#if flash flash.utils.Dictionary #else Dynamic #end):Void {
        // Circular reference protection for objects (Dictionary uses identity keys for O(1) lookup)
        if (#if flash Std.isOfType(target, DisplayObjectContainer) || #end (untyped __typeof__(target) == "object" && target != null)) {
            if (untyped visited[target] == true) return;
            untyped visited[target] = true;
        }

        #if flash
        if (Std.isOfType(target, DisplayObjectContainer)) {
            var props = enumerateProperties(target);
            var k:Int = 0;
            while (k < props.keys.length) {
                var key:String = props.keys[k];
                var childPath:String = path + "." + key;
                if (key.toLowerCase().indexOf(nameLower) != -1) {
                    output.push(childPath);
                }
                searchTargetForName(props.values[k], nameLower, childPath, output, visited);
                k++;
            }
        } else
        #end
        if (Std.isOfType(target, Array)) {
            var arr:Array<Dynamic> = cast target;
            var j:Int = 0;
            while (j < arr.length) {
                searchTargetForName(arr[j], nameLower, path + "[" + j + "]", output, visited);
                j++;
            }
        } else if (untyped __typeof__(target) == "object" && target != null) {
            var props = enumerateProperties(target);
            var k:Int = 0;
            while (k < props.keys.length) {
                var key:String = props.keys[k];
                var childPath:String = path + "." + key;
                if (key.toLowerCase().indexOf(nameLower) != -1) {
                    output.push(childPath);
                }
                searchTargetForName(props.values[k], nameLower, childPath, output, visited);
                k++;
            }
        }
    }

    /**
     * Check if a string matches a pattern with * wildcards and | OR operator.
     * Port of AVM1Firmware/Main.as matchesWildcard() (lines 1311-1371).
     */
    public static function matchesWildcard(str:String, pattern:String):Bool {
        // OR matching: split by | and try each alternative
        if (pattern.indexOf("|") != -1) {
            var alternatives:Array<String> = pattern.split("|");
            var i:Int = 0;
            while (i < alternatives.length) {
                if (matchesWildcard(str, alternatives[i])) return true;
                i++;
            }
            return false;
        }

        // Fast path: match-all wildcard
        if (pattern == "*") return true;

        // Fast path: no wildcards, direct equality
        if (pattern.indexOf("*") == -1) return str == pattern;

        // Split pattern by * to get literal parts
        var parts:Array<String> = pattern.split("*");

        // Early rejection: find longest static part and check existence
        var longestPart:String = "";
        var i:Int = 0;
        while (i < parts.length) {
            if (parts[i].length > longestPart.length) longestPart = parts[i];
            i++;
        }
        if (longestPart.length > 0 && str.indexOf(longestPart) == -1) return false;

        // Full wildcard matching
        var pos:Int = 0;
        i = 0;
        while (i < parts.length) {
            var part:String = parts[i];
            if (part.length == 0) { i++; continue; }

            var idx:Int = str.indexOf(part, pos);
            if (idx == -1) return false;

            // First part must be at start (unless pattern starts with *)
            if (i == 0 && pattern.charAt(0) != "*" && idx != 0) return false;

            pos = idx + part.length;
            i++;
        }

        // Last part must be at end (unless pattern ends with *)
        if (parts.length > 0 && pattern.charAt(pattern.length - 1) != "*") {
            var lastPart:String = parts[parts.length - 1];
            if (lastPart.length > 0 && str.lastIndexOf(lastPart) + lastPart.length != str.length) return false;
        }

        return true;
    }

    // === Private Helpers ===

    /**
     * Enumerate all properties of a target object.
     * Merges dynamic properties (via untyped iteration) with display children.
     */
    public static function enumerateProperties(target:Dynamic):{keys:Array<Dynamic>, values:Array<Dynamic>} {
        var propKeys:Array<Dynamic> = [];
        var propValues:Array<Dynamic> = [];
        var seen:Map<String, Bool> = new Map();
        // Always skip — noise properties that appear across all sources
        seen.set("prototype", true);

        // Handle sentinel objects
        #if flash
        try {
            if (untyped target.__raflash_type == "class") {
                // CLASS_SENTINEL: list all game classes as children
                var gr:Dynamic = untyped target.__raflash_gameRoot;
                buildClassRegistry(gr);
                for (className in gameClassRegistry.keys()) {
                    propKeys.push(className);
                    propValues.push(gameClassRegistry.get(className));
                }
                return {keys: propKeys, values: propValues};
            } else if (untyped target.__raflash_type == "root") {
                // ROOT_SENTINEL: merge display list properties + all game class statics
                var gr:Dynamic = untyped target.__raflash_gameRoot;
                // First get all display list properties (delegate to normal enumeration)
                var stageProps = enumerateProperties(gr);
                var j:Int = 0;
                while (j < stageProps.keys.length) {
                    propKeys.push(stageProps.keys[j]);
                    propValues.push(stageProps.values[j]);
                    seen.set(Std.string(stageProps.keys[j]), true);
                    j++;
                }
                // Then merge all game class statics
                buildClassRegistry(gr);
                for (fieldName in mergedStaticKeys) {
                    if (!seen.exists(fieldName)) {
                        var cls:Dynamic = mergedStaticFields.get(fieldName);
                        try {
                            propKeys.push(fieldName);
                            propValues.push(untyped cls[fieldName]);
                            seen.set(fieldName, true);
                        } catch (e:Dynamic) {}
                    }
                }
                return {keys: propKeys, values: propValues};
            }
        } catch (e:Dynamic) {}
        #end

        // 1. Dynamic properties via untyped iteration
        try {
            var dynKeys:Array<String> = untyped __keys__(target);
            var k:Int = 0;
            while (k < dynKeys.length) {
                var key:String = dynKeys[k];
                propKeys.push(key);
                propValues.push(untyped target[key]);
                seen.set(key, true);
                k++;
            }
        } catch (e:Dynamic) {
            // Not a dynamic object, skip
        }

        // 2. Typed class fields via describeType
        #if flash
        try {
            var typeXml:Dynamic = untyped __global__["flash.utils.describeType"](target);

            // Variables: read values directly (safe, no code execution)
            var variables:Dynamic = untyped typeXml.variable;
            var numVars:Int = untyped variables.length();
            var v:Int = 0;
            while (v < numVars) {
                var varName:String = Std.string(untyped variables[v].attribute("name"));
                if (!seen.exists(varName)) {
                    try {
                        propKeys.push(varName);
                        propValues.push(untyped target[varName]);
                        seen.set(varName, true);
                    } catch (e2:Dynamic) {}
                }
                v++;
            }

            // Accessors: game-declared ones are listed by name only (calling getters
            // can trigger side effects like cross-domain loads). Flash-declared ones
            // are safe to read, but only shown when their value is non-default.
            // For Loaders with cross-domain content, skip security-sensitive properties.
            // Loaders may contain cross-domain content — skip security-sensitive
            // properties unconditionally (probing childAllowsParent itself can trigger errors)
            var isLoader:Bool = false;
            #if flash
            isLoader = Std.isOfType(target, Loader);
            #end
            var accessors:Dynamic = untyped typeXml.accessor;
            var numAcc:Int = untyped accessors.length();
            var a:Int = 0;
            while (a < numAcc) {
                var accAccess:String = Std.string(untyped accessors[a].attribute("access"));
                if (accAccess == "readonly" || accAccess == "readwrite") {
                    var accName:String = Std.string(untyped accessors[a].attribute("name"));
                    if (!seen.exists(accName)) {
                        var declaredBy:String = Std.string(untyped accessors[a].attribute("declaredBy"));
                        if (declaredBy.length >= 6 && declaredBy.substr(0, 6) == "flash.") {
                            // Flash built-in: safe to read, only include if non-default
                            initFlashDefaults();
                            if (!flashPropSkip.exists(accName) && !(isLoader && flashPropCrossDomain.exists(accName))) {
                                try {
                                    var val:Dynamic = untyped target[accName];
                                    var dominated:Bool = (val == null);
                                    if (!dominated) {
                                        dominated = isFlashDefault(accName, val);
                                    }
                                    if (!dominated) {
                                        propKeys.push(accName);
                                        propValues.push(val);
                                        seen.set(accName, true);
                                    }
                                } catch (e2:Dynamic) {}
                            }
                        } else {
                            // Game-declared: include name only, don't call getter
                            propKeys.push(accName);
                            propValues.push(null);
                            seen.set(accName, true);
                        }
                    }
                }
                a++;
            }
        } catch (e:Dynamic) {
            // describeType not available or failed
        }
        #end

        // 3. Static class fields via describeType on the class
        // Use target.constructor to get the exact class of the instance, avoiding
        // name collisions in shared ApplicationDomain (e.g. game's Main vs firmware's Main)
        #if flash
        try {
            var cl:Dynamic = untyped target.constructor;
            if (cl != null) {
                var classXml:Dynamic = untyped __global__["flash.utils.describeType"](cl);

                // Static variables
                var staticVars:Dynamic = untyped classXml.variable;
                var numStaticVars:Int = untyped staticVars.length();
                var sv:Int = 0;
                while (sv < numStaticVars) {
                    var svName:String = Std.string(untyped staticVars[sv].attribute("name"));
                    if (!seen.exists(svName)) {
                        try {
                            propKeys.push(svName);
                            propValues.push(untyped cl[svName]);
                            seen.set(svName, true);
                        } catch (e2:Dynamic) {}
                    }
                    sv++;
                }

                // Static accessors (skip Flash-declared, same logic as instance accessors)
                var staticAcc:Dynamic = untyped classXml.accessor;
                var numStaticAcc:Int = untyped staticAcc.length();
                var sa:Int = 0;
                while (sa < numStaticAcc) {
                    var saAccess:String = Std.string(untyped staticAcc[sa].attribute("access"));
                    if (saAccess == "readonly" || saAccess == "readwrite") {
                        var saName:String = Std.string(untyped staticAcc[sa].attribute("name"));
                        if (!seen.exists(saName)) {
                            var saDeclaredBy:String = Std.string(untyped staticAcc[sa].attribute("declaredBy"));
                            if (saDeclaredBy.length < 6 || saDeclaredBy.substr(0, 6) != "flash.") {
                                propKeys.push(saName);
                                propValues.push(null);
                                seen.set(saName, true);
                            }
                        }
                    }
                    sa++;
                }
            }
        } catch (e:Dynamic) {}
        #end

        // 4. Display children (if DisplayObjectContainer)
        #if flash
        try {
            if (Std.isOfType(target, DisplayObjectContainer)) {
                var container:DisplayObjectContainer = cast target;
                var numChildren:Int = container.numChildren;
                var c:Int = 0;
                while (c < numChildren) {
                    var child:DisplayObject = container.getChildAt(c);
                    var childName:String = child.name;
                    // Skip firmware child and duplicates (already found as dynamic property)
                    if (childName != "__raflash" && !seen.exists(childName)) {
                        propKeys.push(childName);
                        propValues.push(child);
                        seen.set(childName, true);
                    }
                    c++;
                }
            }
        } catch (e:Dynamic) {
            // Security sandbox or other restriction on display children
        }
        #end

        return {keys: propKeys, values: propValues};
    }

    /**
     * Read a named property from a target object.
     * Handles both dynamic properties and display children.
     */
    private static function readProperty(target:Dynamic, name:String):Dynamic {
        // Handle sentinel objects
        #if flash
        try {
            if (untyped target.__raflash_type == "class") {
                var gr:Dynamic = untyped target.__raflash_gameRoot;
                buildClassRegistry(gr);
                return gameClassRegistry.exists(name) ? gameClassRegistry.get(name) : null;
            } else if (untyped target.__raflash_type == "root") {
                // Try display list first (delegate to readProperty on gameRoot)
                var gr:Dynamic = untyped target.__raflash_gameRoot;
                var stageResult:Dynamic = readProperty(gr, name);
                if (stageResult != null) return stageResult;
                // Then try merged statics
                buildClassRegistry(gr);
                if (mergedStaticFields.exists(name)) {
                    var cls:Dynamic = mergedStaticFields.get(name);
                    try { return untyped cls[name]; } catch (e:Dynamic) {}
                }
                return null;
            }
        } catch (e:Dynamic) {}
        #end

        // Try direct property access first (covers dynamic props and built-in fields)
        try {
            var value:Dynamic = untyped target[name];
            if (untyped __typeof__(value) != "undefined") {
                return value;
            }
        } catch (e:Dynamic) {}

        // Fall back to static class field (use constructor to avoid name collisions)
        #if flash
        try {
            var cl:Dynamic = untyped target.constructor;
            if (cl != null) {
                var sval:Dynamic = untyped cl[name];
                if (untyped __typeof__(sval) != "undefined") {
                    return sval;
                }
            }
        } catch (e:Dynamic) {}
        #end

        // Fall back to display child lookup
        #if flash
        if (Std.isOfType(target, DisplayObjectContainer)) {
            var container:DisplayObjectContainer = cast target;
            var numChildren:Int = container.numChildren;
            var c:Int = 0;
            while (c < numChildren) {
                var child:DisplayObject = container.getChildAt(c);
                if (child.name == name) {
                    return child;
                }
                c++;
            }
        }
        #end

        return null;
    }

    /**
     * Check if a target has a named property (including display children).
     */
    private static function hasProperty(target:Dynamic, name:String):Bool {
        // Handle sentinel objects
        #if flash
        try {
            if (untyped target.__raflash_type == "class") {
                var gr:Dynamic = untyped target.__raflash_gameRoot;
                buildClassRegistry(gr);
                return gameClassRegistry.exists(name);
            } else if (untyped target.__raflash_type == "root") {
                var gr:Dynamic = untyped target.__raflash_gameRoot;
                if (hasProperty(gr, name)) return true;
                buildClassRegistry(gr);
                return mergedStaticFields.exists(name);
            }
        } catch (e:Dynamic) {}
        #end

        try {
            var value:Dynamic = untyped target[name];
            if (untyped __typeof__(value) != "undefined") {
                return true;
            }
        } catch (e:Dynamic) {}

        // Check static class fields (use constructor to avoid name collisions)
        #if flash
        try {
            var cl:Dynamic = untyped target.constructor;
            if (cl != null) {
                var sval:Dynamic = untyped cl[name];
                if (untyped __typeof__(sval) != "undefined") {
                    return true;
                }
            }
        } catch (e:Dynamic) {}
        #end

        #if flash
        if (Std.isOfType(target, DisplayObjectContainer)) {
            var container:DisplayObjectContainer = cast target;
            var numChildren:Int = container.numChildren;
            var c:Int = 0;
            while (c < numChildren) {
                if (container.getChildAt(c).name == name) return true;
                c++;
            }
        }
        #end

        return false;
    }

    /**
     * Read a numeric index from a target (array-style access).
     */
    private static function readIndex(target:Dynamic, index:Dynamic):Dynamic {
        try {
            var value:Dynamic = untyped target[index];
            if (untyped __typeof__(value) != "undefined") {
                return value;
            }
        } catch (e:Dynamic) {}
        return null;
    }

    /**
     * Check if a Dynamic value is truthy.
     */
    private static function isTruthy(value:Dynamic):Bool {
        if (value == null) return false;
        if (Std.isOfType(value, Bool)) return (value : Bool);
        if (Std.isOfType(value, Float)) return (value : Float) != 0;
        if (Std.isOfType(value, String)) return (value : String) != "";
        return true;
    }

    /**
     * Binary arithmetic operation with broadcasting.
     * Used for SUB, MUL, DIV, MOD, POW.
     */
    private static function binaryArith(a:Array<Dynamic>, b:Array<Dynamic>, op:Float->Float->Float):Array<Dynamic> {
        if (a.length == 1) {
            var av:Float = a[0];
            var result:Array<Dynamic> = [];
            var j:Int = 0;
            while (j < b.length) { result.push(op(av, b[j])); j++; }
            return result;
        } else if (b.length == 1) {
            var bv:Float = b[0];
            var result:Array<Dynamic> = [];
            var j:Int = 0;
            while (j < a.length) { result.push(op(a[j], bv)); j++; }
            return result;
        } else if (a.length == b.length) {
            var result:Array<Dynamic> = [];
            var j:Int = 0;
            while (j < a.length) { result.push(op(a[j], b[j])); j++; }
            return result;
        } else {
            trace("[Evaluate] Mismatched array lengths for arithmetic");
            return [];
        }
    }

    /**
     * Binary comparison/boolean operation with broadcasting.
     * Used for EQUAL, NOT_EQUAL, GREATER, LESSER, AND, OR, XOR, etc.
     */
    private static function binaryCompare(a:Array<Dynamic>, b:Array<Dynamic>, op:Dynamic->Dynamic->Int):Array<Dynamic> {
        if (a.length == 1) {
            var av:Dynamic = a[0];
            var result:Array<Dynamic> = [];
            var j:Int = 0;
            while (j < b.length) { result.push(op(av, b[j])); j++; }
            return result;
        } else if (b.length == 1) {
            var bv:Dynamic = b[0];
            var result:Array<Dynamic> = [];
            var j:Int = 0;
            while (j < a.length) { result.push(op(a[j], bv)); j++; }
            return result;
        } else if (a.length == b.length) {
            var result:Array<Dynamic> = [];
            var j:Int = 0;
            while (j < a.length) { result.push(op(a[j], b[j])); j++; }
            return result;
        } else {
            trace("[Evaluate] Mismatched array lengths for comparison");
            return [];
        }
    }

    /**
     * Truncate text for display (max 32 chars, first line only).
     */
    private static function createLabelString(text:String):String {
        // Normalize line endings
        text = StringTools.replace(text, "\r\n", "\n");
        text = StringTools.replace(text, "\r", "\n");
        // First line only
        var newlineIdx = text.indexOf("\n");
        if (newlineIdx >= 0) {
            text = text.substr(0, newlineIdx);
        }
        // Truncate
        if (text.length > 32) {
            text = text.substr(0, 32);
        }
        return text;
    }
}
