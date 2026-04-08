package;

#if flash
import flash.display.DisplayObject;
import flash.display.DisplayObjectContainer;
import flash.display.MovieClip;
import flash.display.Sprite;
import flash.text.TextField;
#end

/**
 * Stack-based bytecode interpreter for the Formula DSL.
 * Port of AVM1Firmware/Main.as evaluate() (lines 676-1300).
 *
 * Every stack value is an Array<Dynamic> — scalars are single-element arrays.
 * Binary ops broadcast: scalar×N, N×scalar, N×N (element-wise), M×N (NaN).
 */
class Evaluate {

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
    public static function evaluate(formula:Array<Dynamic>, start:Int, end:Int, context:Array<Dynamic>, keys:Array<Dynamic>, gameRoot:Dynamic):Array<Dynamic> {
        var stack:Array<Array<Dynamic>> = [];
        var i:Int = start;

        while (i < end) {
            var token:String = cast formula[i];
            i++;

            if (token == "VALUE") {
                stack.push([Std.parseInt(cast(formula[i], String))]);
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
                var b = stack.pop();
                var a = stack.pop();
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
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryArith(a, b, function(av:Float, bv:Float):Float { return av - bv; }));
            } else if (token == "MUL") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryArith(a, b, function(av:Float, bv:Float):Float { return av * bv; }));
            } else if (token == "DIV") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryArith(a, b, function(av:Float, bv:Float):Float { return av / bv; }));
            } else if (token == "MOD") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryArith(a, b, function(av:Float, bv:Float):Float { return av % bv; }));
            } else if (token == "POW") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryArith(a, b, function(av:Float, bv:Float):Float { return Math.pow(av, bv); }));
            } else if (token == "EQUAL") {
                var b = stack.pop();
                var a = stack.pop();
                // null comparison: check if array is empty
                if (b.length == 1 && b[0] == null) {
                    stack.push([a.length == 0 ? 1 : 0]);
                } else if (a.length == 1 && a[0] == null) {
                    stack.push([b.length == 0 ? 1 : 0]);
                } else {
                    stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return av == bv ? 1 : 0; }));
                }
            } else if (token == "NOT_EQUAL") {
                var b = stack.pop();
                var a = stack.pop();
                // null comparison: check if array is not empty
                if (b.length == 1 && b[0] == null) {
                    stack.push([a.length > 0 ? 1 : 0]);
                } else if (a.length == 1 && a[0] == null) {
                    stack.push([b.length > 0 ? 1 : 0]);
                } else {
                    stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return av != bv ? 1 : 0; }));
                }
            } else if (token == "GREATER") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return (av : Float) > (bv : Float) ? 1 : 0; }));
            } else if (token == "GREATER_EQUAL") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return (av : Float) >= (bv : Float) ? 1 : 0; }));
            } else if (token == "LESSER") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return (av : Float) < (bv : Float) ? 1 : 0; }));
            } else if (token == "LESSER_EQUAL") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return (av : Float) <= (bv : Float) ? 1 : 0; }));
            } else if (token == "AND") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return isTruthy(av) && isTruthy(bv) ? 1 : 0; }));
            } else if (token == "OR") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int { return isTruthy(av) || isTruthy(bv) ? 1 : 0; }));
            } else if (token == "XOR") {
                var b = stack.pop();
                var a = stack.pop();
                stack.push(binaryCompare(a, b, function(av:Dynamic, bv:Dynamic):Int {
                    var ai:Int = isTruthy(av) ? 1 : 0;
                    var bi:Int = isTruthy(bv) ? 1 : 0;
                    return (ai ^ bi) != 0 ? 1 : 0;
                }));
            } else if (token == "READ_GLOBAL") {
                var identifiers = stack.pop();
                if (identifiers.length == 1) {
                    var name:String = cast identifiers[0];
                    if (name == "stage") {
                        stack.push([gameRoot]);
                    } else if (name == "this") {
                        stack.push(context);
                    } else if (name == "key") {
                        stack.push(keys);
                    } else {
                        trace("[Evaluate] Invalid global identifier: " + name);
                        return null;
                    }
                } else {
                    trace("[Evaluate] Invalid global identifiers array");
                    return null;
                }
            } else if (token == "OBJECT_ACCESS") {
                var targets = stack.pop();
                var amount:Int = Std.parseInt(cast(formula[i], String));

                var result:Array<Dynamic> = [];

                // OPTIMIZATION: Detect simple property access pattern
                // Pattern: IDENTIFIER key, READ_GLOBAL, IDENTIFIER <name>, EQUAL (length 6)
                if (amount == 6 &&
                    formula[i + 1] == "IDENTIFIER" &&
                    formula[i + 2] == "key" &&
                    formula[i + 3] == "READ_GLOBAL" &&
                    formula[i + 4] == "IDENTIFIER" &&
                    formula[i + 6] == "EQUAL") {

                    var propName:String = cast formula[i + 5];
                    var j:Int = 0;
                    while (j < targets.length) {
                        var target:Dynamic = targets[j];
                        var value:Dynamic = readProperty(target, propName);
                        if (value != null || hasProperty(target, propName)) {
                            result.push(value);
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
                var targets = stack.pop();
                var amount:Int = Std.parseInt(cast(formula[i], String));

                var result:Array<Dynamic> = [];

                // OPTIMIZATION: Detect simple numeric index pattern
                // Pattern: VALUE <n> (length 2)
                if (amount == 2 && formula[i + 1] == "VALUE") {
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
                    // Generic implementation: evaluate the index expression
                    var j:Int = 0;
                    while (j < targets.length) {
                        var target:Dynamic = targets[j];
                        var indexResult = evaluate(formula, i + 1, i + amount + 1, [target], [], gameRoot);
                        if (indexResult != null && indexResult.length > 0) {
                            var index:Dynamic = indexResult[0];
                            var value:Dynamic = readIndex(target, index);
                            if (value != null) {
                                result.push(value);
                            }
                        }
                        j++;
                    }
                    stack.push(result);
                    i += amount + 1;
                }
            } else if (token == "TERNARY") {
                var thenLen:Int = Std.parseInt(cast(formula[i], String));
                i++;
                var thenStart:Int = i;
                var thenEnd:Int = thenStart + thenLen;

                var elseLen:Int = Std.parseInt(cast(formula[thenEnd], String));
                var elseStart:Int = thenEnd + 1;
                var elseEnd:Int = elseStart + elseLen;

                var condition:Array<Dynamic> = stack.pop();

                var thenResult = evaluate(formula, thenStart, thenEnd, context, keys, gameRoot);
                var elseResult = evaluate(formula, elseStart, elseEnd, context, keys, gameRoot);

                var result:Array<Dynamic> = [];
                var j:Int = 0;
                while (j < condition.length) {
                    var cond:Dynamic = condition[j];
                    var thenVal:Dynamic = (thenResult.length == 1) ? thenResult[0] : thenResult[j];
                    var elseVal:Dynamic = (elseResult.length == 1) ? elseResult[0] : elseResult[j];
                    result.push(isTruthy(cond) ? thenVal : elseVal);
                    j++;
                }
                stack.push(result);
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
            if (Std.isOfType(value, MovieClip) || Std.isOfType(value, Sprite)) {
                if (level == 0 && singular) {
                    var props = enumerateProperties(value);
                    var k:Int = 0;
                    while (k < props.keys.length) {
                        var childFormatted:Dynamic = formatOutput([props.values[k]], level + 1);
                        output.push({value: props.keys[k] + ": " + childFormatted.output[0].value});
                        k++;
                    }
                } else {
                    var props = enumerateProperties(value);
                    output.push({value: "[MovieClip ..." + props.keys.length + "]"});
                }
            } else if (Std.isOfType(value, TextField)) {
                var tf:TextField = cast value;
                output.push({value: "[TextField \"" + createLabelString(tf.text) + "\"]"});
            } else
            #end
            if (Std.isOfType(value, Float)) {
                output.push({value: value});
            } else if (Std.isOfType(value, String)) {
                output.push({value: "\"" + value + "\""});
            } else if (Std.isOfType(value, Bool)) {
                output.push({value: value});
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
                    output.push({value: "[Object ..." + fields.keys.length + "]"});
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
    public static function searchTargetForValue(target:Dynamic, value:String, path:String, output:Array<Dynamic>, visited:Array<Dynamic>):Void {
        // Circular reference protection for objects
        if (#if flash Std.isOfType(target, DisplayObjectContainer) || #end (untyped __typeof__(target) == "object" && target != null)) {
            var v:Int = 0;
            while (v < visited.length) {
                if (untyped visited[v] == target) return;
                v++;
            }
            visited.push(target);
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
    public static function searchTargetForName(target:Dynamic, nameLower:String, path:String, output:Array<Dynamic>, visited:Array<Dynamic>):Void {
        // Circular reference protection for objects
        if (#if flash Std.isOfType(target, DisplayObjectContainer) || #end (untyped __typeof__(target) == "object" && target != null)) {
            var v:Int = 0;
            while (v < visited.length) {
                if (untyped visited[v] == target) return;
                v++;
            }
            visited.push(target);
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

        // 2. Display children (if DisplayObjectContainer)
        #if flash
        if (Std.isOfType(target, DisplayObjectContainer)) {
            var container:DisplayObjectContainer = cast target;
            var numChildren:Int = container.numChildren;
            var c:Int = 0;
            while (c < numChildren) {
                var child:DisplayObject = container.getChildAt(c);
                var childName:String = child.name;
                // Skip auto-generated names and duplicates
                if (!seen.exists(childName)) {
                    propKeys.push(childName);
                    propValues.push(child);
                    seen.set(childName, true);
                }
                c++;
            }
        }
        #end

        return {keys: propKeys, values: propValues};
    }

    /**
     * Read a named property from a target object.
     * Handles both dynamic properties and display children.
     */
    private static function readProperty(target:Dynamic, name:String):Dynamic {
        // Try direct property access first (covers dynamic props and built-in fields)
        try {
            var value:Dynamic = untyped target[name];
            if (untyped __typeof__(value) != "undefined") {
                return value;
            }
        } catch (e:Dynamic) {}

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
        try {
            var value:Dynamic = untyped target[name];
            if (untyped __typeof__(value) != "undefined") {
                return true;
            }
        } catch (e:Dynamic) {}

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
            return null;
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
            return null;
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
