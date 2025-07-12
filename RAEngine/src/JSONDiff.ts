type DiffObject = {
    added: Array<[string, any]>;
    removed: Array<[string, any]>;
    edited: Array<[string, any, any]>;
};

type WatcherCallback = (refPath: any[]) => void;

type Watcher = {
    pattern: string;
    callback: WatcherCallback;
};

type ProcessedDiffResult = {
    finalDiff: DiffObject; // The combined total change
    extraDiff: DiffObject; // Just the changes made by watchers
};


export class JSONDiff {
    private static watchers: Watcher[] = [];

    /**
     * Registers a callback to be triggered when any of the provided path patterns are matched.
     * @param patterns An array of path patterns with wildcards (*) to watch.
     * @param callback The function to execute on a match. It receives the index of the
     * matched pattern and an array of live references to the path.
     */
    public static watch(pattern: string, callback: WatcherCallback): void {
        this.watchers.push({ pattern, callback });
    }

    /**
     * Processes an incoming diff, applies it, triggers watchers, and returns
     * both the final combined diff and the isolated watcher-only diff.
     * @param clientDiff The diff object received from a client.
     * @returns An object containing the finalDiff and the watcherDiff.
     */
    public static processIncomingDiff(target:any, clientDiff: DiffObject): ProcessedDiffResult {
        // 1. Capture state BEFORE any changes.
        const stateBefore = JSON.parse(JSON.stringify(target));

        // 2. Apply the client's diff.
        JSONDiff.applyDataDiff(target, clientDiff);

        // 3. Capture state AFTER client diff but BEFORE watchers.
        const stateAfterClientChanges = JSON.parse(JSON.stringify(target));

        // 4. Trigger watchers, which may make further changes.
        JSONDiff._findAndTriggerWatchers(target, clientDiff);
        
        // 5. Calculate the diff of just the watcher changes.
        const extraDiff = JSONDiff.getDataDiff(stateAfterClientChanges, target);

        // 6. Calculate the total combined diff.
        const finalDiff = JSONDiff.getDataDiff(stateBefore, target);
        
        // 7. Return both diffs.
        return { finalDiff, extraDiff };
    }
    
    /**
     * Applies a diff directly to the object.
     */
    public static applyDataDiff(target:any, diff: DiffObject): void {
        if (diff.removed) {
            for (const [path] of diff.removed) {
                this._removeValue(target, path);
            }
        }
        if (diff.added) {
            for (const [path, value] of diff.added) {
                this._setValue(target, path, value);
            }
        }
        if (diff.edited) {
            for (const [path, , newValue] of diff.edited) {
                this._setValue(target, path, newValue);
            }
        }
    }

    /**
     * Generates a diff object between two states.
     */
    public static getDataDiff(before: any, after: any): DiffObject {
        const structBefore = this._getStructPath(before);
        const structAfter = this._getStructPath(after);

        return {
            added: this._getPathsDiff(structAfter, structBefore),
            removed: this._getPathsDiff(structBefore, structAfter),
            edited: this._getEditedPaths(structBefore, structAfter)
        };
    }

    /**
     * Directly modifies an object by setting a new value at a given path
     * AND returns the diff object representing that change.
     * This function has a side effect: it mutates the sourceObject.
     * @param path The path to the property to change.
     * @param newValue The new value for the property.
     * @param sourceObject The state object to read from AND modify.
     * @returns A valid DiffObject representing the change.
     */
    public static updateAndGetDiff(sourceObject: any, path: string, newValue: any): DiffObject {
        // 1. Read the old value before making any changes.
        const oldValue = this._getValueByPath(sourceObject, path);

        // 2. Enact the change by directly modifying the source object.
        this._setValue(sourceObject, path, newValue);

        // 3. Create the diff based on the old and new values.
        const diff: DiffObject = { added: [], removed: [], edited: [] };

        if (oldValue === undefined) {
            diff.added.push([path, newValue]);
        } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            diff.edited.push([path, oldValue, newValue]);
        }
        
        return diff;
    }

    /**
     * Checks if a diff object is "pointless" meaning it contains no changes.
     * @param diff The diff object to check.
     * @returns True if the diff has no added, removed, or edited entries.
     */
    public static isPointlessDiff(diff: DiffObject): boolean {
        // Return true only if all three arrays are empty.
        return diff.added.length === 0 &&
               diff.removed.length === 0 &&
               diff.edited.length === 0;
    }

    // ========================================================================
    // Private Helper Methods
    // ========================================================================

    /**
     * Iterates through changed paths from the diff and triggers any matching watchers.
     * UPDATED: Now inspects both 'added' and 'edited' arrays.
     */
    private static _findAndTriggerWatchers(target:any,clientDiff: DiffObject): void {
        if (!clientDiff.edited) return;

        const changedPaths = [
            ...(clientDiff.added || []).map(item => item[0]),
            ...(clientDiff.edited || []).map(item => item[0])
        ];
        
        const uniquePaths = [...new Set(changedPaths)];

        for (const path of uniquePaths) {
            for (const watcher of this.watchers) {
                this._traverse(
                    target,
                    watcher.pattern.split('/'),
                    path.split('/'),
                    (refPath) => {
                        watcher.callback(refPath);
                    }
                );
            }
        }
    }

    /**
     * Recursively traverses an object to match a pattern against a path.
     * UPDATED: Now correctly handles "[]" array markers in paths during traversal.
     */
    private static _traverse(
        currentNode: any,
        patternParts: string[],
        pathParts: string[],
        onMatch: (refPath: any[]) => void,
        refPath: any[] = []
    ): void {
        if (patternParts.length !== pathParts.length) return;
        if (patternParts.length === 0) {
            onMatch([...refPath, currentNode]);
            return;
        }

        const currentPattern = patternParts[0];
        const currentPathPart = pathParts[0];
        const newRefPath = [...refPath, currentNode];

        if (currentPattern === '*' || currentPattern === currentPathPart.replace(/\[\]$/, '')) {
            // FIX: Clean the '[]' marker from the key before accessing the object.
            const accessKey = currentPathPart.replace(/\[\]$/, '');
            const nextNode = currentNode[accessKey];
            
            if (nextNode !== undefined) {
                this._traverse(nextNode, patternParts.slice(1), pathParts.slice(1), onMatch, newRefPath);
            }
        }
    }

    /**
     * Sets a value by path, creating nested objects/arrays as needed.
     */
    private static _setValue(obj: any, path: string, value: any): void {
        const keys = path.split('/');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            // FIX: The key must be cleaned at every step of the loop.
            const key = keys[i].replace(/\[\]$/, ''); 
            
            if (current[key] === undefined || typeof current[key] !== 'object' || current[key] === null) {
                const nextKey = keys[i + 1].replace(/\[\]$/, '');
                if (String(Number(nextKey)) === nextKey && !isNaN(Number(nextKey))) {
                    current[key] = [];
                } else {
                    current[key] = {};
                }
            }
            current = current[key];
        }

        // Clean the final key as well.
        const finalKey = keys[keys.length - 1].replace(/\[\]$/, '');
        current[finalKey] = value;
    }

    /**
     * Removes a value by path.
     * Uses the user's original, more robust logic.
     */
    private static _removeValue(obj: any, path: string): void {
        const keys = path.split('/');
        if (keys.length === 1) {
            delete obj[keys[0].replace(/\[\]$/, '')];
            return;
        }
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i].replace(/\[\]$/, '');
            if (current[key] === undefined) return;
            current = current[key];
        }
        delete current[keys[keys.length - 1].replace(/\[\]$/, '')];
    }
    
    /**
     * Flattens an object into a path-based key-value map for diffing.
     */
    private static _getStructPath(obj: any, path: string = '', result: { [key: string]: any } = {}): { [key: string]: any } {
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const newPath = path ? `${path}/${key}` : key;
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    this._getStructPath(obj[key], newPath, result);
                } else {
                    result[newPath] = obj[key];
                }
            }
        }
        return result;
    }
    
    /**
     * Finds paths that exist in obj1 but not obj2.
     */
    private static _getPathsDiff(obj1: any, obj2: any): Array<[string, any]> {
        const diff: Array<[string, any]> = [];
        for (const key in obj1) {
            if (!(key in obj2)) {
                diff.push([key, obj1[key]]);
            }
        }
        return diff;
    }

    /**
     * Finds paths that exist in both objects but have different values.
     */
    private static _getEditedPaths(obj1: any, obj2: any): Array<[string, any, any]> {
        const diff: Array<[string, any, any]> = [];
        for (const key in obj1) {
            if (key in obj2 && JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
                diff.push([key, obj1[key], obj2[key]]);
            }
        }
        return diff;
    }

    /**
     * [INTERNAL HELPER] Traverses an object using a path string and returns the value.
     * Returns undefined if the path does not exist.
     */
    private static _getValueByPath(obj: any, path: string): any {
        const keys = path.split('/');
        let current = obj;
        
        for (let i = 0; i < keys.length; i++) {
            if (current === undefined || current === null) {
                return undefined;
            }
            const key = keys[i].replace(/\[\]$/, '');
            current = current[key];
        }
        
        return current;
    }
}