import { AppData } from './AppData.ts'; // Assuming your state is exported from here

// --- Type Definitions ---

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

// --- Class Implementation ---

export class JSONDiff {
    private static watchers: Watcher[] = [];

    // ========================================================================
    // Public API Methods
    // ========================================================================

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
     * Main entry point for processing a diff from a client. It applies the diff,
     * triggers any relevant watchers, and returns a final, authoritative diff
     * representing the total change.
     * @param clientDiff The diff object received from a client.
     * @returns A final diff object to be broadcast to all clients.
     */
    public static processIncomingDiff(clientDiff: DiffObject): DiffObject {
        // 1. Create a snapshot of the state BEFORE any changes.
        const stateBefore = JSON.parse(JSON.stringify(AppData.data));

        // 2. Apply the client's changes directly to the live data.
        this.applyDataDiff(clientDiff);

        // 3. Trigger watchers based on the client's diff. Watchers may make
        //    further mutations to the live AppData.data object.
        this._findAndTriggerWatchers(clientDiff);
        
        // 4. Calculate a single, clean diff between the initial state and the
        //    final state after all mutations are complete.
        const finalDiff = this.getDataDiff(stateBefore, AppData.data);
        
        // 5. This final diff is what you broadcast to all clients.
        return finalDiff;
    }
    
    /**
     * Applies a diff directly to the AppData.data object.
     */
    public static applyDataDiff(diff: DiffObject): void {
        if (diff.removed) {
            for (const [path] of diff.removed) {
                this._removeValue(AppData.data, path);
            }
        }
        if (diff.added) {
            for (const [path, value] of diff.added) {
                this._setValue(AppData.data, path, value);
            }
        }
        if (diff.edited) {
            for (const [path, , newValue] of diff.edited) {
                this._setValue(AppData.data, path, newValue);
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

    // ========================================================================
    // Private Helper Methods
    // ========================================================================

    /**
     * Iterates through changed paths from the diff and triggers any matching watchers.
     * UPDATED: Now inspects both 'added' and 'edited' arrays.
     */
    private static _findAndTriggerWatchers(clientDiff: DiffObject): void {
        if (!clientDiff.edited) return;

        const changedPaths = [
            ...(clientDiff.added || []).map(item => item[0]),
            ...(clientDiff.edited || []).map(item => item[0])
        ];
        
        const uniquePaths = [...new Set(changedPaths)];

        for (const path of uniquePaths) {
            for (const watcher of this.watchers) {
                this._traverse(
                    AppData.data,
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
     * Recursively traverses an object to match a pattern against a path,
     * collecting live references along the way.
     */
    private static _traverse(
        currentNode: any,
        patternParts: string[],
        pathParts: string[],
        onMatch: (refPath: any[]) => void,
        refPath: any[] = []
    ): void {
        // If the pattern and path don't have the same length, they can't match.
        if (patternParts.length !== pathParts.length) {
            return;
        }

        // If we've successfully traversed all parts, the traversal is complete.
        if (patternParts.length === 0) {
            // FIX: Add the final currentNode (the actual value) to the refPath.
            onMatch([...refPath, currentNode]);
            return;
        }

        const currentPattern = patternParts[0];
        const currentPathPart = pathParts[0];
        
        // The reference path includes the current parent node.
        const newRefPath = [...refPath, currentNode];

        if (currentPattern === '*' || currentPattern === currentPathPart) {
            const nextNode = currentNode[currentPathPart];
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
}