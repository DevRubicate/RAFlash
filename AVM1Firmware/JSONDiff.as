import JSON;

class JSONDiff {

    /**
     * @property {Array} watchers - A static list of watcher objects, each with a pattern and a callback.
     */
    static public var watchers:Array = [];

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

            if (before[key] == undefined) {
                diff.edited.push([pathSegment, afterVal]);
            } else if (after[key] == undefined) {
                diff.edited.push([pathSegment, JSONDiff.DELETE_SENTINEL]);
            } else if (!JSONDiff._areEqual(beforeVal, afterVal)) {
                var nestedDiff:Object = JSONDiff._getDataDiffRecursive(beforeVal, afterVal, pathSegment);
                diff.edited = diff.edited.concat(nestedDiff.edited);
            }
        }
        return diff;
    }

    /**
     * Processes an incoming diff, applies it, triggers watchers, and calculates the final resulting changes.
     */
    static public function processIncomingDiff(target:Object, clientDiff:Object):Object {
        // Deep clone using the required JSON library
        var stateBefore:Object = JSON.parse(JSON.stringify(target));
        JSONDiff.applyDataDiff(target, clientDiff);
        var stateAfterClientChanges:Object = JSON.parse(JSON.stringify(target));

        var diffToProcess:Object = clientDiff;
        var MAX_ITERATIONS:Number = 10;
        for (var i:Number = 0; i < MAX_ITERATIONS; i++) {
            if (diffToProcess == null || diffToProcess.edited == null || diffToProcess.edited.length == 0) {
                break;
            }

            var stateBeforeThisIterationWatchers:Object = JSON.parse(JSON.stringify(target));
            JSONDiff._findAndTriggerWatchers(target, diffToProcess);
            var newWatcherDiff:Object = JSONDiff.getDataDiff(stateBeforeThisIterationWatchers, target);
            JSONDiff.applyDataDiff(target, newWatcherDiff);
            diffToProcess = newWatcherDiff;

            if (i == MAX_ITERATIONS - 1 && diffToProcess.edited != null && diffToProcess.edited.length > 0) {
                trace("JSONDiff: Max watcher iterations reached. Possible infinite loop.");
            }
        }

        var finalDiff:Object = JSONDiff.getDataDiff(stateBefore, target);
        var extraDiff:Object = JSONDiff.getDataDiff(stateAfterClientChanges, target);
        return { finalDiff: finalDiff, extraDiff: extraDiff };
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
            if (aIsDelete && !bIsDelete) return 1;
            if (!aIsDelete && bIsDelete) return -1;
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
                            trace("JSONDiff Logical conflict: Cannot apply change to '" + pathB + "' because its parent path '" + parentPath + "' was deleted.");
                            return null;
                        }
                        if (typeof parentValue != 'object' || parentValue == null) {
                            trace("JSONDiff Logical conflict: Cannot set property on '" + pathB + "' because its parent path '" + parentPath + "' was replaced with a non-object value.");
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
        return diff.edited.length === 0;
    }

    /**
     * Registers a watcher that will execute a callback when a path matching the pattern changes.
     * The callback receives an array of "segments," which are the actual object references
     * encountered while matching the path.
     *
     * @example
     * // For a target object like: { users: { "user-123": { name: "Alice" } } }
     * // And a change to 'users/user-123/name'
     * JSONDiff.watch("users/*\/name", function(segments:Array):Void {
     *   var rootObject:Object = segments[0]; // The entire target object
     *   var usersObject:Object = segments[1]; // The 'users' object
     *   var specificUserObject:Object = segments[2]; // The 'user-123' object
     *   var nameValue:String = String(segments[3]); // The final value, 'Alice'
     *   trace("User changed: " + specificUserObject.name);
     * });
     *
     * @param   pattern     The path pattern to watch (e.g., 'users/*\/name'). Use '*' as a wildcard.
     * @param   callback    The function to call on match. It receives an Array of path segments.
     */
    static public function watch(pattern:String, callback:Function):Void {
        JSONDiff.watchers.push({ pattern: pattern, callback: callback });
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
                if (b[key] == undefined || !JSONDiff._areEqual(a[key], b[key])) {
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
    static private function _findAndTriggerWatchers(target:Object, clientDiff:Object):Void {
        var changedEntries:Array = clientDiff.edited;
        if (changedEntries == null || changedEntries.length == 0) return;

        var pathsToCheck:Object = {};
        for (var i:Number=0; i<changedEntries.length; i++) {
            var op:Array = changedEntries[i];
            var path:String = String(op[0]);
            var newValue:Object = op[1];

            pathsToCheck[path] = true;
            if (newValue != JSONDiff.DELETE_SENTINEL && typeof newValue == 'object' && newValue != null) {
                JSONDiff._generateSubPaths(path, newValue, pathsToCheck);
            }
        }

        var changedPath:String;
        for (changedPath in pathsToCheck) {
            for (var j:Number=0; j<JSONDiff.watchers.length; j++) {
                var watcher:Object = JSONDiff.watchers[j];
                JSONDiff._traverse(
                    target,
                    String(watcher.pattern).split('/'),
                    changedPath.split('/'),
                    watcher.callback,
                    undefined,
                    [target]
                );
            }
        }
    }

    /**
     * @private
     */
    static private function _traverse(currentNode:Object, patternParts:Array, pathParts:Array, onMatch:Function, currentMatchPath:Array, segmentObjects:Array):Void {
        if (currentMatchPath == undefined) {
            currentMatchPath = [];
        }
        if (segmentObjects == undefined) {
            segmentObjects = [];
        }

        if (patternParts.length == 0) {
            if (pathParts.length == 0) {
                onMatch(segmentObjects);
            }
            return;
        }
        
        if (pathParts.length == 0) return;
        
        var pattern:String = patternParts[0];
        var pathPart:String = pathParts[0];

        if (pattern == "*" || pattern == pathPart) {
            var accessKey:String = JSONDiff._stripArraySuffix(pathPart);
            if (currentNode != null && currentNode[accessKey] != undefined) {
                var nextNode:Object = currentNode[accessKey];
                JSONDiff._traverse(
                    nextNode, 
                    patternParts.slice(1), 
                    pathParts.slice(1), 
                    onMatch, 
                    currentMatchPath.concat([pathPart]),
                    segmentObjects.concat([nextNode])
                );
            }
        }
    }

    /**
     * @private
     */
    static private function _generateSubPaths(basePath:String, value:Object, pathSet:Object):Void {
        if (typeof value != 'object' || value == null) return;
        var isArray:Boolean = (value instanceof Array);

        for (var key:String in value) {
            var pathSegment:String = isArray ? (key + "[]") : key;
            var newPath:String = basePath + "/" + pathSegment;
            pathSet[newPath] = true;
            JSONDiff._generateSubPaths(newPath, value[key], pathSet);
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