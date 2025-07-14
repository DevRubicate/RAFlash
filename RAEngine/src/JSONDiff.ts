/**
 * Describes a single change operation in a diff.
 * It's a tuple containing the path and the new value.
 */
type DiffOperation = [string, any];

/**
 * Represents the diff object, which contains a list of edit operations.
 */
type Diff = {
    edited: DiffOperation[];
};

/**
 * Defines the structure for a watcher.
 * The callback receives an array of the actual objects/values from the target
 * that correspond to each part of the matched path.
 */
interface Watcher {
    pattern: string;
    callback: (segments: any[]) => void;
}

export class JSONDiff {
    /**
     * @property {Array<Watcher>} watchers - A static list of watcher objects, each with a pattern and a callback.
     */
    static watchers: Watcher[] = [];

    /**
     * @property {string} DELETE_SENTINEL - A unique value used in diffs to signify that a key should be deleted.
     */
    static readonly DELETE_SENTINEL: string = '__DELETE__';

    /**
     * @property {number} SALVAGE_THRESHOLD - A value between 0.0 and 1.0. If the similarity ratio of two objects
     * is below this threshold, the diff will replace the entire object rather than performing a deep diff.
     * This prevents generating overly complex diffs for objects that have changed drastically.
     */
    static SALVAGE_THRESHOLD: number = 0.5;

    /**
     * Generates a diff object describing the changes between a "before" and "after" state.
     * @param before - The original state.
     * @param after - The new state.
     * @returns A diff object.
     */
    static getDataDiff(before: Record<string, any> | any[], after: Record<string, any> | any[]): Diff {
        const diff: Diff = { edited: [] };
        const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
        const isArray = Array.isArray(before);

        for (const key of allKeys) {
            const beforeVal = (before as any)[key];
            const afterVal = (after as any)[key];
            const pathSegment = isArray ? `${key}[]` : key;

            if (!(key in before)) {
                diff.edited.push([pathSegment, afterVal]);
            } else if (!(key in after)) {
                diff.edited.push([pathSegment, this.DELETE_SENTINEL]);
            } else if (!this._areEqual(beforeVal, afterVal)) {
                const nestedDiff = this._getDataDiffRecursive(beforeVal, afterVal, pathSegment);
                diff.edited.push(...nestedDiff.edited);
            }
        }
        return diff;
    }

    /**
     * Applies a diff to a target object, sorting deletions to be processed last.
     * @param target - The object to modify.
     * @param diff - The diff to apply.
     */
    static applyDataDiff(target: Record<string, any>, diff: Diff | null): void {
        if (!diff || !diff.edited) return;

        const additionsAndEdits: DiffOperation[] = [];
        const deletions: DiffOperation[] = [];

        // 1. Separate deletions from other operations
        for (const op of diff.edited) {
            if (op[1] === this.DELETE_SENTINEL) {
                deletions.push(op);
            } else {
                additionsAndEdits.push(op);
            }
        }

        // 2. Sort deletions by path, paying special attention to array indices in reverse
        deletions.sort(([pathA], [pathB]) => {
            const partsA = pathA.split('/');
            const partsB = pathB.split('/');
            
            // A simple string localeCompare is NOT sufficient for numeric indices.
            // We need to sort 'items/10[]' after 'items/2[]'.
            // For array deletions specifically, we want higher indices first.
            const lastPartA = partsA[partsA.length - 1].replace('[]', '');
            const lastPartB = partsB[partsB.length - 1].replace('[]', '');
            const numA = parseInt(lastPartA, 10);
            const numB = parseInt(lastPartB, 10);

            // If both are numbers, sort descending.
            if (!isNaN(numA) && !isNaN(numB)) {
                // If parent paths are different, sort by parent path first
                const parentA = partsA.slice(0, -1).join('/');
                const parentB = partsB.slice(0, -1).join('/');
                if (parentA !== parentB) {
                    return parentA.localeCompare(parentB);
                }
                return numB - numA; // Sort numerically descending
            }

            // Fallback to standard path comparison
            return pathB.localeCompare(pathA);
        });

        // 3. Apply additions/edits first, then deletions
        for (const [path, newValue] of additionsAndEdits) {
            this._setValue(target, path, newValue);
        }
        for (const [path, newValue] of deletions) {
            this._removeValue(target, path);
        }
    }

    /**
     * Processes an incoming diff, applies it, triggers watchers, and calculates the final resulting changes.
     * @param target - The object to apply the diff to.
     * @param clientDiff - The initial diff from the client.
     * @returns An object containing the total net change (`finalDiff`) and watcher-specific changes (`extraDiff`).
     */
    static processIncomingDiff(target: Record<string, any>, clientDiff: Diff): { finalDiff: Diff; extraDiff: Diff } {
        const stateBefore = JSON.parse(JSON.stringify(target));

        this.applyDataDiff(target, clientDiff);
        const stateAfterClientChanges = JSON.parse(JSON.stringify(target));

        let diffToProcess: Diff | null = clientDiff;
        const MAX_ITERATIONS = 10;
        for (let i = 0; i < MAX_ITERATIONS; i++) {
            if (!diffToProcess || (diffToProcess.edited || []).length === 0) {
                break;
            }

            const stateBeforeThisIterationWatchers = JSON.parse(JSON.stringify(target));
            
            this._findAndTriggerWatchers(target, diffToProcess);
            
            const newWatcherDiff = this.getDataDiff(stateBeforeThisIterationWatchers, target);
            this.applyDataDiff(target, newWatcherDiff);

            diffToProcess = newWatcherDiff;

            if (i === MAX_ITERATIONS - 1 && (diffToProcess.edited || []).length > 0) {
                console.warn("JSONDiff: Max watcher iterations reached. Possible infinite loop.");
            }
        }

        const finalDiff = this.getDataDiff(stateBefore, target);
        const extraDiff = this.getDataDiff(stateAfterClientChanges, target);
        return { finalDiff, extraDiff };
    }

    /**
     * Merges two diffs into a single, logical diff. This function enforces strict sequential
     * consistency, throwing an error if the second diff attempts an operation that is impossible
     * given the changes in the first diff.
     *
     * Merge Rules & Conflict Detection:
     * 1.  **Direct Override**: If both diffs change the same path, the operation from `diffB` is kept.
     *
     * 2.  **Parent Override**: If `diffB` modifies a parent path (e.g., `user`), it completely
     *     invalidates and replaces any changes to its children (e.g., `user/name`) from `diffA`.
     *     This is a valid "last write wins" scenario.
     *
     * 3.  **Conflict: Modifying a Deleted Path**: Throws an error if `diffB` tries to modify a
     *     child path of a parent that was deleted in `diffA`.
     *     - A: `['user', '__DELETE__']`, B: `['user/name', 'Bob']` -> **ERROR**
     *
     * 4.  **Conflict: Modifying a Primitive's "Child"**: Throws an error if `diffB` tries to set
     *     a property on a path that `diffA` changed to a non-object (e.g., a string or number).
     *     - A: `['config', 123]`, B: `['config/timeout', 5000]` -> **ERROR**
     *
     * @param diffA - The first diff to be applied.
     * @param diffB - The second, subsequent diff.
     * @returns A new, clean Diff object representing the final net change.
     * @throws {Error} If a logical conflict is detected between the two diffs.
     */
    static mergeDiffs(diffA: Diff, diffB: Diff): Diff {
        const editsA = diffA?.edited || [];
        const editsB = diffB?.edited || [];

        if (editsA.length === 0) return { edited: [...editsB] };
        if (editsB.length === 0) return { edited: [...editsA] };

        // Use a Map for efficient lookups and overrides. Key is the path.
        const mergedOperations = new Map<string, any>();

        // 1. Pre-load the map with all operations from the first diff.
        for (const [path, value] of editsA) {
            mergedOperations.set(path, value);
        }

        // 2. Iterate through the second diff to merge, validate, and override.
        for (const [pathB, valueB] of editsB) {
            // --- CONFLICT VALIDATION ---
            // Check if any parent of the current path was altered in an incompatible way by diffA.
            const pathParts = pathB.split('/');
            if (pathParts.length > 1) {
                // Iterate through potential parent paths (e.g., for 'a/b/c', check 'a' then 'a/b').
                for (let i = 1; i < pathParts.length; i++) {
                    const parentPath = pathParts.slice(0, i).join('/');
                    if (mergedOperations.has(parentPath)) {
                        const parentValue = mergedOperations.get(parentPath);

                        // CONFLICT 1: Parent was explicitly deleted.
                        if (parentValue === this.DELETE_SENTINEL) {
                            throw new Error(`Logical conflict in merge: Cannot apply change to '${pathB}' because its parent path '${parentPath}' was deleted in the first diff.`);
                        }

                        // CONFLICT 2: Parent was replaced by a primitive (non-object).
                        if (typeof parentValue !== 'object' || parentValue === null) {
                            throw new Error(`Logical conflict in merge: Cannot set property on '${pathB}' because its parent path '${parentPath}' was replaced with a non-object value ('${parentValue}') in the first diff.`);
                        }
                    }
                }
            }

            // --- MERGE LOGIC ---
            // A change to a parent path in diffB obsoletes any prior changes to its children.
            // This is a valid override, not a conflict.
            for (const existingPath of mergedOperations.keys()) {
                if (existingPath.startsWith(pathB + '/')) {
                    mergedOperations.delete(existingPath);
                }
            }

            // Finally, add or overwrite the operation from diffB. This handles direct overrides.
            mergedOperations.set(pathB, valueB);
        }

        // 3. Convert the map back to the Diff format.
        const finalEdits: DiffOperation[] = Array.from(mergedOperations.entries());
        
        return { edited: finalEdits };
    }
    
    /**
     * Registers a watcher that will execute a callback when a path matching the pattern changes.
     * The callback receives an array of "segments," which are the actual object references
     * encountered while matching the path.
     *
     * @example
     * // For a target object like: { users: { 'user-123': { name: 'Alice' } } }
     * // And a change to 'users/user-123/name'
     * JSONDiff.watch('users/*\/name', (segments) => {
     *   const rootObject = segments[0]; // The entire target object
     *   const usersObject = segments[1]; // The 'users' object
     *   const specificUserObject = segments[2]; // The 'user-123' object
     *   const nameValue = segments[3]; // The final value, 'Alice'
     *   console.log(`User changed:`, specificUserObject.name);
     * });
     *
     * @param pattern - The path pattern to watch (e.g., 'users/*\/name'). Use '*' as a wildcard.
     * @param callback - The function to call on match. It receives an array of path segments.
     */
    static watch(pattern: string, callback: (segments: any[]) => void): void {
        this.watchers.push({ pattern, callback });
    }

    /**
     * Determines if a diff object is "pointless," meaning it is guaranteed to have no
     * effect when applied.
     * @param diff - The diff object to inspect.
     * @returns {boolean} True if the diff has no operations, false otherwise.
     */
    static isPointlessDiff(diff: Diff): boolean {
        return !diff || diff.edited.length === 0;
    }

    /**
     * Calculates a "salvage ratio" to determine how similar two values are.
     * This is the core of the selective deep-diffing strategy. A ratio of 1.0 means identical,
     * and 0.0 means completely different.
     * @param a - The first value.
     * @param b - The second value.
     * @returns The similarity ratio (0.0 to 1.0).
     */
    private static _getSalvageRatio(a: any, b: any): number {
        const aIsArray = Array.isArray(a);
        const bIsArray = Array.isArray(b);
        if (aIsArray !== bIsArray) return 0.0;
        if (typeof a !== typeof b) return 0.0;
        if (a === null || b === null) return a === b ? 1.0 : 0.0;
        if (aIsArray) return this._getArraySalvageRatio(a, b);
        if (typeof a === 'object') return this._getObjectSalvageRatio(a, b);
        return a === b ? 1.0 : 0.0;
    }

    /**
     * Helper to calculate the salvage ratio for two objects. It averages the salvage
     * ratios of all shared keys.
     * @private
     * @param a - The first object.
     * @param b - The second object.
     * @returns The similarity ratio.
     */
    private static _getObjectSalvageRatio(a: Record<string, any>, b: Record<string, any>): number {
        const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
        if (allKeys.size === 0) return 1.0;
        let totalRatio = 0;
        for (const key of allKeys) {
            if (key in a && key in b) {
                totalRatio += this._getSalvageRatio(a[key], b[key]);
            }
        }
        return totalRatio / allKeys.size;
    }

    /**
     * Helper to calculate the salvage ratio for two arrays. It compares elements at the
     * same index and averages their ratios.
     * @private
     * @param a - The first array.
     * @param b - The second array.
     * @returns The similarity ratio.
     */
    private static _getArraySalvageRatio(a: any[], b: any[]): number {
        const maxLength = Math.max(a.length, b.length);
        if (maxLength === 0) return 1.0;
        let totalRatio = 0;
        for (let i = 0; i < maxLength; i++) {
            if (i < a.length && i < b.length) {
                totalRatio += this._getSalvageRatio(a[i], b[i]);
            }
        }
        return totalRatio / maxLength;
    }

    /**
     * Recursively compares two values for deep equality, short-circuiting on the first difference.
     * @private
     * @param a - The first value.
     * @param b - The second value.
     * @returns True if the values are deeply equal.
     */
    private static _areEqual(a: any, b: any): boolean {
        if (a === b) return true;

        const aIsObject = a && typeof a === 'object';
        const bIsObject = b && typeof b === 'object';
        if (!aIsObject || !bIsObject) return false;

        const aIsArray = Array.isArray(a);
        if (aIsArray !== Array.isArray(b)) return false;

        if (aIsArray) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!this._areEqual(a[i], b[i])) return false;
            }
        } else {
            const keysA = Object.keys(a);
            if (keysA.length !== Object.keys(b).length) return false;
            for (const key of keysA) {
                if (!Object.prototype.hasOwnProperty.call(b, key) || !this._areEqual(a[key], b[key])) {
                    return false;
                }
            }
        }
        
        return true;
    }
    
    /**
     * Handles the recursive step of the diffing process.
     * @private
     * @param before - The original sub-tree.
     * @param after - The new sub-tree.
     * @param pathPrefix - The path to this point in the object tree.
     * @returns A diff object for the nested structure.
     */
    private static _getDataDiffRecursive(before: any, after: any, pathPrefix: string): Diff {
        if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null || Array.isArray(before) !== Array.isArray(after)) {
            return { edited: [[pathPrefix, after]] };
        }

        const salvageRatio = this._getSalvageRatio(before, after);
        if (salvageRatio < this.SALVAGE_THRESHOLD) {
            return { edited: [[pathPrefix, after]] };
        }

        const subDiff = this.getDataDiff(before, after);
        const finalSubDiff: Diff = { edited: [] };
        for(const [path, value] of subDiff.edited) {
            finalSubDiff.edited.push([`${pathPrefix}/${path}`, value]);
        }
        return finalSubDiff;
    }

    /**
     * Sets a value at a specified path within an object, creating nested structures as needed.
     * @private
     */
    private static _setValue(obj: any, path: string, value: any): void {
        const keys = path.split('/');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            const accessKey = key.replace(/\[\]$/, '');
            const nextIsArray = keys[i + 1].endsWith('[]');
            if (current[accessKey] === undefined || typeof current[accessKey] !== 'object' || current[accessKey] === null) {
                current[accessKey] = nextIsArray ? [] : {};
            }
            current = current[accessKey];
        }
        const finalKey = keys[keys.length - 1].replace(/\[\]$/, '');
        if (Array.isArray(current) && !isNaN(Number(finalKey))) {
            current[Number(finalKey)] = value;
        } else {
            current[finalKey] = value;
        }
    }

    /**
     * Removes a value at a specified path within an object.
     * @private
     */
    private static _removeValue(obj: any, path: string): void {
        const keys = path.split('/');
        if (keys.length === 1) {
            const key = keys[0].replace(/\[\]$/, '');
            if (Array.isArray(obj)) {
                obj.splice(Number(key), 1);
            } else {
                delete obj[key];
            }
            return;
        }
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i].replace(/\[\]$/, '');
            if (current[key] === undefined) return;
            current = current[key];
        }
        const finalKey = keys[keys.length - 1].replace(/\[\]$/, '');
        if (Array.isArray(current)) {
            current.splice(Number(finalKey), 1);
        } else {
            delete current[finalKey];
        }
    }

    /**
     * Finds and triggers watchers based on a set of changed paths from a diff.
     * @private
     */
    private static _findAndTriggerWatchers(target: Record<string, any>, clientDiff: Diff): void {
        const changedEntries = (clientDiff.edited || []);
        if (changedEntries.length === 0) return;

        const pathsToCheck = new Set<string>();
        for (const [path, newValue] of changedEntries) {
            pathsToCheck.add(path);
            if (newValue !== this.DELETE_SENTINEL && typeof newValue === 'object' && newValue !== null) {
                this._generateSubPaths(path, newValue, pathsToCheck);
            }
        }

        for (const path of pathsToCheck) {
            for (const watcher of this.watchers) {
                // The onMatch callback now directly passes the collected segments to the watcher's callback.
                this._traverse(
                    target,
                    watcher.pattern.split('/'),
                    path.split('/'),
                    (segments: any[]) => {
                        watcher.callback(segments);
                    },
                    [],
                    [target] // Start the segment accumulation with the root object.
                );
            }
        }
    }

    /**
     * A traversal function to match a concrete path against a pattern, collecting
     * object references along the way.
     * @private
     * @param currentNode - The current object/value in the target data structure.
     * @param patternParts - The remaining parts of the pattern to match.
     * @param pathParts - The remaining parts of the concrete path being checked.
     * @param onMatch - The callback to execute when a full match is found.
     * @param currentMatchPath - (Internal) Accumulator for the matched path string segments.
     * @param segmentObjects - (Internal) Accumulator for the matched object references.
     */
    private static _traverse(
        currentNode: any,
        patternParts: string[],
        pathParts: string[],
        onMatch: (segments: any[]) => void,
        currentMatchPath: string[] = [],
        segmentObjects: any[] = [] // New accumulator for object segments
    ): void {
        // Base case: Pattern is fully matched. If the concrete path is also fully consumed, it's a success.
        if (patternParts.length === 0) {
            if (pathParts.length === 0) {
                onMatch(segmentObjects);
            }
            return;
        }

        // Pruning: If pattern remains but path is exhausted, no match is possible.
        if (pathParts.length === 0) return;

        const pattern = patternParts[0];
        const pathPart = pathParts[0];

        // Match current segment (either wildcard or direct match).
        if (pattern === '*' || pattern === pathPart) {
            const accessKey = pathPart.replace(/\[\]$/, '');
            const nextNode = currentNode?.[accessKey];

            // If the next node exists, recurse deeper.
            if (nextNode !== undefined) {
                this._traverse(
                    nextNode,
                    patternParts.slice(1),
                    pathParts.slice(1),
                    onMatch,
                    [...currentMatchPath, pathPart],
                    [...segmentObjects, nextNode] // Add the next node to our segments array
                );
            }
        }
    }

    /**
     * Recursively generates all possible sub-paths from a given base path and value.
     * @private
     */
    private static _generateSubPaths(basePath: string, value: any, pathSet: Set<string>): void {
        if (typeof value !== 'object' || value === null) return;

        for (const key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                const pathSegment = Array.isArray(value) ? `${key}[]` : key;
                const newPath = `${basePath}/${pathSegment}`;
                pathSet.add(newPath);
                this._generateSubPaths(newPath, value[key], pathSet);
            }
        }
    }
}