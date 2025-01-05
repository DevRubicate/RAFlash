package;

/**
 * Applies path-based diffs to dynamic objects.
 * Port of AVM1Firmware/JSONDiff.as (applyDataDiff and helpers only).
 *
 * Diff format: { edited: [[path, value], ...] }
 * - Paths use '/' separator: "assets/0[]/groups/1[]/name"
 * - Array indices have '[]' suffix: "items/5[]"
 * - Deletion sentinel: value == "__DELETE__"
 */
class JSONDiff {

    public static inline var DELETE_SENTINEL:String = "__DELETE__";

    /**
     * Applies a diff to a target object, sorting deletions to be processed last
     * (and in reverse index order to avoid index shifting bugs).
     */
    public static function applyDataDiff(target:Dynamic, diff:Dynamic):Void {
        if (diff == null) return;
        var edited:Dynamic = untyped diff.edited;
        if (edited == null) return;

        // Shallow copy to sort without mutating the original
        var editedArr:Array<Dynamic> = cast edited;
        var sorted:Array<Dynamic> = editedArr.copy();

        sorted.sort(function(a:Dynamic, b:Dynamic):Int {
            var aVal:Dynamic = untyped a[1];
            var bVal:Dynamic = untyped b[1];
            var aIsDelete:Bool = aVal == DELETE_SENTINEL;
            var bIsDelete:Bool = bVal == DELETE_SENTINEL;

            // Non-deletions first
            if (aIsDelete && !bIsDelete) return 1;
            if (!aIsDelete && bIsDelete) return -1;

            // Both deletions: sort by descending array index to avoid index shifting
            if (aIsDelete && bIsDelete) {
                var pathA:String = Std.string(untyped a[0]);
                var pathB:String = Std.string(untyped b[0]);
                var partsA:Array<String> = pathA.split('/');
                var partsB:Array<String> = pathB.split('/');
                var lastA:String = partsA[partsA.length - 1];
                var lastB:String = partsB[partsB.length - 1];
                // Strip [] suffix and parse as number
                lastA = lastA.split('[]')[0];
                lastB = lastB.split('[]')[0];
                var numA:Null<Int> = Std.parseInt(lastA);
                var numB:Null<Int> = Std.parseInt(lastB);
                if (numA != null && numB != null) {
                    // Compare parent paths first
                    var parentA:String = partsA.slice(0, partsA.length - 1).join('/');
                    var parentB:String = partsB.slice(0, partsB.length - 1).join('/');
                    if (parentA != parentB) {
                        return parentA > parentB ? 1 : -1;
                    }
                    return numB - numA; // Descending order
                }
                return pathB > pathA ? 1 : -1;
            }
            return 0;
        });

        var i:Int = 0;
        while (i < sorted.length) {
            var op:Dynamic = sorted[i];
            var path:String = Std.string(untyped op[0]);
            var newValue:Dynamic = untyped op[1];
            if (newValue == DELETE_SENTINEL) {
                removeValue(target, path);
            } else {
                setValue(target, path, newValue);
            }
            i++;
        }
    }

    /**
     * Set a value at a '/'-separated path, creating intermediate objects/arrays as needed.
     */
    private static function setValue(obj:Dynamic, path:String, value:Dynamic):Void {
        var keys:Array<String> = path.split('/');
        var current:Dynamic = obj;

        var i:Int = 0;
        while (i < keys.length - 1) {
            var key:String = keys[i];
            var accessKey:String = stripArraySuffix(key);
            var nextIsArray:Bool = keys[i + 1].indexOf("[]") != -1;

            var child:Dynamic = untyped current[accessKey];
            if (untyped __typeof__(child) == "undefined" || child == null || untyped __typeof__(child) != "object") {
                if (nextIsArray) {
                    untyped current[accessKey] = [];
                } else {
                    untyped current[accessKey] = {};
                }
            }
            current = untyped current[accessKey];
            i++;
        }

        var finalKey:String = stripArraySuffix(keys[keys.length - 1]);
        if (Std.isOfType(current, Array)) {
            var idx:Null<Int> = Std.parseInt(finalKey);
            if (idx != null) {
                untyped current[idx] = value;
            } else {
                untyped current[finalKey] = value;
            }
        } else {
            untyped current[finalKey] = value;
        }
    }

    /**
     * Remove a value at a '/'-separated path. Uses splice for array elements, delete for object props.
     */
    private static function removeValue(obj:Dynamic, path:String):Void {
        var keys:Array<String> = path.split('/');

        if (keys.length == 1) {
            var finalKey:String = stripArraySuffix(keys[0]);
            if (Std.isOfType(obj, Array)) {
                var idx:Null<Int> = Std.parseInt(finalKey);
                if (idx != null) {
                    untyped obj.splice(idx, 1);
                }
            } else {
                untyped __delete__(obj, finalKey);
            }
            return;
        }

        var current:Dynamic = obj;
        var i:Int = 0;
        while (i < keys.length - 1) {
            var key:String = stripArraySuffix(keys[i]);
            var child:Dynamic = untyped current[key];
            if (untyped __typeof__(child) == "undefined" || child == null) return;
            current = child;
            i++;
        }

        var finalKey:String = stripArraySuffix(keys[keys.length - 1]);
        if (Std.isOfType(current, Array)) {
            var idx:Null<Int> = Std.parseInt(finalKey);
            if (idx != null) {
                untyped current.splice(idx, 1);
            }
        } else {
            untyped __delete__(current, finalKey);
        }
    }

    /**
     * Strip the '[]' suffix from a path segment (e.g., "5[]" -> "5").
     */
    private static function stripArraySuffix(key:String):String {
        if (key.length >= 2 && key.substring(key.length - 2) == "[]") {
            return key.substring(0, key.length - 2);
        }
        return key;
    }
}
