import JSON;

class JSONDiff {

    /**
     * @property {String} DELETE_SENTINEL - A unique value used in diffs to signify that a key should be deleted.
     */
    static public var DELETE_SENTINEL:String = "__DELETE__";

    /**
     * @property {Number} SALVAGE_THRESHOLD - A value between 0.0 and 1.0. If the similarity ratio of two objects
     * is below this threshold, the diff will replace the entire object rather than performing a deep diff.
     */
    static public var SALVAGE_THRESHOLD:Number = 0.5;

    /**
     * The class is static and should not be instantiated.
     */
    private function JSONDiff() {
        // Private constructor to prevent instantiation.
    }

    /**
     * Generates a diff object describing the changes between a "before" and "after" state.
     */
    static public function getDataDiff(before:Object, after:Object):Object {
        var diff:Object = { edited: [] };
        var allKeys:Object = {};
        var key:String;
        for (key in before) { allKeys[key] = true; }
        for (key in after) { allKeys[key] = true; }

        var isArray:Boolean = (before instanceof Array);

        for (key in allKeys) {
            var beforeVal:Object = before[key];
            var afterVal:Object = after[key];
            var pathSegment:String = isArray ? (key + "[]") : key;

            if (!before.hasOwnProperty(key)) {
                diff.edited.push([pathSegment, afterVal]);
            } else if (!after.hasOwnProperty(key)) {
                diff.edited.push([pathSegment, JSONDiff.DELETE_SENTINEL]);
            } else if (!JSONDiff._areEqual(beforeVal, afterVal)) {
                var nestedDiff:Object = JSONDiff._getDataDiffRecursive(beforeVal, afterVal, pathSegment);
                diff.edited = diff.edited.concat(nestedDiff.edited);
            }
        }
        return diff;
    }

    /**
     * Applies an incoming diff to the target object.
     */
    static public function processIncomingDiff(target:Object, clientDiff:Object):Object {
        JSONDiff.applyDataDiff(target, clientDiff);
        return { fullDiff: clientDiff, derivedDiff: { edited: [] } };
    }

    /**
     * Applies a diff to a target object, sorting deletions to be processed last.
     */
    static public function applyDataDiff(target:Object, diff:Object):Void {
        if (diff == null || diff.edited == null) return;
        
        var sortedDiff:Array = diff.edited.concat(); // Create a shallow copy to sort
        sortedDiff.sort(function(a:Array, b:Array):Number {
            var aIsDelete:Boolean = a[1] == JSONDiff.DELETE_SENTINEL;
            var bIsDelete:Boolean = b[1] == JSONDiff.DELETE_SENTINEL;
            // Non-deletions first
            if (aIsDelete && !bIsDelete) return 1;
            if (!aIsDelete && bIsDelete) return -1;
            // Both deletions: sort by descending array index to avoid index shifting bugs
            if (aIsDelete && bIsDelete) {
                var pathA:String = String(a[0]);
                var pathB:String = String(b[0]);
                var partsA:Array = pathA.split('/');
                var partsB:Array = pathB.split('/');
                var lastA:String = String(partsA[partsA.length - 1]);
                var lastB:String = String(partsB[partsB.length - 1]);
                // Strip [] suffix and parse as number
                lastA = lastA.split('[]')[0];
                lastB = lastB.split('[]')[0];
                var numA:Number = parseInt(lastA);
                var numB:Number = parseInt(lastB);
                if (!isNaN(numA) && !isNaN(numB)) {
                    // Compare parent paths first
                    var parentA:String = partsA.slice(0, -1).join('/');
                    var parentB:String = partsB.slice(0, -1).join('/');
                    if (parentA != parentB) {
                        return parentA > parentB ? 1 : -1;
                    }
                    return numB - numA; // Descending order
                }
                return pathB > pathA ? 1 : -1;
            }
            return 0;
        });

        for (var i:Number=0; i<sortedDiff.length; i++) {
            var op:Array = sortedDiff[i];
            var path:String = String(op[0]);
            var newValue:Object = op[1];
            if (newValue == JSONDiff.DELETE_SENTINEL) {
                JSONDiff._removeValue(target, path);
            } else {
                JSONDiff._setValue(target, path, newValue);
            }
        }
    }

    /**
     * Merges two diffs into a single, logical diff. This function enforces strict sequential
     * consistency, returning null if the second diff attempts an operation that is impossible
     * given the changes in the first diff.
     *
     * NOTE: Unlike the TypeScript version which throws an Error on conflict, AS2 returns null.
     * Callers must check for null return value to detect merge conflicts.
     */
    static public function mergeDiffs(diffA:Object, diffB:Object):Object {
        var editsA:Array = (diffA != null && diffA.edited != null) ? diffA.edited : [];
        var editsB:Array = (diffB != null && diffB.edited != null) ? diffB.edited : [];

        if (editsA.length == 0) return { edited: editsB.concat() };
        if (editsB.length == 0) return { edited: editsA.concat() };

        var mergedOperations:Object = {};
        var i:Number;
        var op:Array;
        var path:String;
        var value:Object;

        for (i = 0; i < editsA.length; i++) {
            op = editsA[i];
            path = String(op[0]);
            value = op[1];
            mergedOperations[path] = value;
        }

        for (i = 0; i < editsB.length; i++) {
            op = editsB[i];
            var pathB:String = String(op[0]);
            var valueB:Object = op[1];

            var pathParts:Array = pathB.split('/');
            if (pathParts.length > 1) {
                for (var j:Number = 1; j < pathParts.length; j++) {
                    var parentPath:String = pathParts.slice(0, j).join('/');
                    if (mergedOperations[parentPath] != undefined) {
                        var parentValue:Object = mergedOperations[parentPath];
                        if (parentValue == JSONDiff.DELETE_SENTINEL) {
                            return null;
                        }
                        if (typeof parentValue != 'object' || parentValue == null) {
                            return null;
                        }
                    }
                }
            }
            
            var parentPrefix:String = pathB + '/';
            for (var existingPath:String in mergedOperations) {
                if (existingPath.substring(0, parentPrefix.length) == parentPrefix) {
                    delete mergedOperations[existingPath];
                }
            }

            mergedOperations[pathB] = valueB;
        }

        var finalEdits:Array = [];
        for (path in mergedOperations) {
            finalEdits.push([path, mergedOperations[path]]);
        }
        
        return { edited: finalEdits };
    }

    /**
     * Determines if a diff object is "pointless," meaning it is guaranteed to have no
     * effect when applied.
     * @param diff - The diff object to inspect.
     * @returns {boolean} True if the diff has no operations, false otherwise.
     */
    static public function isPointlessDiff(diff: Object): Boolean {
        return diff == null || diff.edited == null || diff.edited.length == 0;
    }

    /**
     * Calculates a "salvage ratio" to determine how similar two values are.
     */
    static private function _getSalvageRatio(a:Object, b:Object):Number {
        var aIsArray:Boolean = (a instanceof Array);
        var bIsArray:Boolean = (b instanceof Array);
        if (aIsArray != bIsArray) return 0.0;
        if (typeof a != typeof b) return 0.0;
        if (a == null || b == null) return a == b ? 1.0 : 0.0;
        if (aIsArray) return JSONDiff._getArraySalvageRatio(Array(a), Array(b));
        if (typeof a == 'object') return JSONDiff._getObjectSalvageRatio(a, b);
        return a == b ? 1.0 : 0.0;
    }

    /**
     * @private
     */
    static private function _getObjectSalvageRatio(a:Object, b:Object):Number {
        var allKeys:Object = {};
        var key:String;
        var size:Number = 0;
        for (key in a) { allKeys[key] = true; }
        for (key in b) { allKeys[key] = true; }
        for (key in allKeys) { size++; }

        if (size == 0) return 1.0;

        var totalRatio:Number = 0;
        for (key in allKeys) {
            if (a[key] != undefined && b[key] != undefined) {
                totalRatio += JSONDiff._getSalvageRatio(a[key], b[key]);
            }
        }
        return totalRatio / size;
    }

    /**
     * @private
     */
    static private function _getArraySalvageRatio(a:Array, b:Array):Number {
        var maxLength:Number = Math.max(a.length, b.length);
        if (maxLength == 0) return 1.0;
        var totalRatio:Number = 0;
        for (var i:Number = 0; i < maxLength; i++) {
            if (i < a.length && i < b.length) {
                totalRatio += JSONDiff._getSalvageRatio(a[i], b[i]);
            }
        }
        return totalRatio / maxLength;
    }

    /**
     * @private
     */
    static private function _areEqual(a:Object, b:Object):Boolean {
        if (a === b) return true;

        var aIsObject:Boolean = (a != null && typeof a == 'object');
        var bIsObject:Boolean = (b != null && typeof b == 'object');
        if (!aIsObject || !bIsObject) return false;

        var aIsArray:Boolean = (a instanceof Array);
        if (aIsArray != (b instanceof Array)) return false;

        if (aIsArray) {
            var arrA:Array = Array(a);
            var arrB:Array = Array(b);
            if (arrA.length != arrB.length) return false;
            for (var i:Number = 0; i < arrA.length; i++) {
                if (!JSONDiff._areEqual(arrA[i], arrB[i])) return false;
            }
        } else {
            var keysA:Array = [];
            var numKeysA:Number = 0;
            var key:String;
            for (key in a) { keysA.push(key); numKeysA++; }
            
            var numKeysB:Number = 0;
            for (key in b) { numKeysB++; }
            if (numKeysA != numKeysB) return false;

            for (var i:Number = 0; i < keysA.length; i++) {
                key = keysA[i];
                if (!b.hasOwnProperty(key) || !JSONDiff._areEqual(a[key], b[key])) {
                    return false;
                }
            }
        }
        
        return true;
    }

    /**
     * @private
     */
    static private function _getDataDiffRecursive(before:Object, after:Object, pathPrefix:String):Object {
        if (typeof before != 'object' || before == null || typeof after != 'object' || after == null || (before instanceof Array) != (after instanceof Array)) {
            return { edited: [[pathPrefix, after]] };
        }

        var salvageRatio:Number = JSONDiff._getSalvageRatio(before, after);
        if (salvageRatio < JSONDiff.SALVAGE_THRESHOLD) {
            return { edited: [[pathPrefix, after]] };
        }

        var subDiff:Object = JSONDiff.getDataDiff(before, after);
        var finalSubDiff:Object = { edited: [] };
        for(var i:Number=0; i<subDiff.edited.length; i++) {
            var op:Array = subDiff.edited[i];
            var path:String = String(op[0]);
            var value:Object = op[1];
            finalSubDiff.edited.push([pathPrefix + "/" + path, value]);
        }
        return finalSubDiff;
    }

    /**
     * @private
     */
    static private function _setValue(obj:Object, path:String, value:Object):Void {
        var keys:Array = path.split('/');
        var current:Object = obj;
        for (var i:Number = 0; i < keys.length - 1; i++) {
            var key:String = keys[i];
            var accessKey:String = JSONDiff._stripArraySuffix(key);
            var nextIsArray:Boolean = keys[i + 1].indexOf("[]") != -1;

            if (current[accessKey] == undefined || typeof current[accessKey] != 'object' || current[accessKey] == null) {
                current[accessKey] = nextIsArray ? [] : {};
            }
            current = current[accessKey];
        }

        var finalKey:String = JSONDiff._stripArraySuffix(keys[keys.length - 1]);
        if ((current instanceof Array) && !isNaN(Number(finalKey))) {
            Array(current)[Number(finalKey)] = value;
        } else {
            current[finalKey] = value;
        }
    }

    /**
     * @private
     */
    static private function _removeValue(obj:Object, path:String):Void {
        var keys:Array = path.split('/');
        var finalKey:String;
        if (keys.length == 1) {
            finalKey = JSONDiff._stripArraySuffix(keys[0]);
            if ((obj instanceof Array)) {
                Array(obj).splice(Number(finalKey), 1);
            } else {
                delete obj[finalKey];
            }
            return;
        }
        var current:Object = obj;
        for (var i:Number = 0; i < keys.length - 1; i++) {
            var key:String = JSONDiff._stripArraySuffix(keys[i]);
            if (current[key] == undefined) return;
            current = current[key];
        }
        finalKey = JSONDiff._stripArraySuffix(keys[keys.length - 1]);
        if ((current instanceof Array)) {
            Array(current).splice(Number(finalKey), 1);
        } else {
            delete current[finalKey];
        }
    }

    /**
     * @private
     */
    static private function _stripArraySuffix(key:String):String {
        if (key != null && key.substring(key.length - 2) == "[]") {
            return key.substring(0, key.length - 2);
        }
        return key;
    }
}