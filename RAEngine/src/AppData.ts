import { crypto } from 'jsr:@std/crypto';
import { JSONDiff } from './JSONDiff.ts';
import type { AppDataStructure, Asset } from './types.ts';

export class AppData {
    static data: AppDataStructure = {
        assets: [],
        codeNotes: [],
        gameConfig: { title: '', originUrl: '' },
    };

    // Game-specific state file path
    static gamePath: string | null = null;
    static stateFilePath: string | null = null;
    static gameHash: string | null = null;

    /**
     * Calculate MD5 hash of a file
     */
    static async hashFile(filePath: string): Promise<string> {
        const fileData = await Deno.readFile(filePath);
        const hashBuffer = await crypto.subtle.digest("MD5", fileData);
        return Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, "0")).join("");
    }

    /**
     * Set the game path and derive the state file path from MD5 hash of SWF contents
     */
    static async setGamePath(gamePath: string): Promise<void> {
        this.gamePath = gamePath;
        this.gameHash = await this.hashFile(gamePath);
        this.stateFilePath = `RACache/games/${this.gameHash}.json`;
    }

    /**
     * Loads game-specific state from the state file.
     * Must call setGamePath() first.
     */
    static async loadData(): Promise<void> {
        if (!this.stateFilePath) {
            throw new Error("Game path not set. Call setGamePath() first.");
        }

        try {
            const content = await Deno.readTextFile(this.stateFilePath);
            const loadedData = JSON.parse(content);

            // Filter out null/invalid entries and mark all loaded assets as saved
            if (loadedData.assets) {
                loadedData.assets = loadedData.assets.filter((a: Record<string, unknown>) => a != null && a.id != null);
                for (const asset of loadedData.assets) {
                    asset._saved = true;
                    asset._modified = false;
                    asset.state = "ACTIVE"; // state is ephemeral, always starts as ACTIVE
                    asset._originalSnapshot = JSON.parse(JSON.stringify(this.stripAssetData(asset, this.assetSchema)));
                }
            }

            const diff = JSONDiff.getDataDiff(AppData.data, loadedData);
            JSONDiff.processIncomingDiff(AppData.data, diff);
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                // New game, start fresh
                this.data = { assets: [], codeNotes: [], gameConfig: { title: '', originUrl: '' } };
            } else {
                throw error;
            }
        }
    }

    /**
     * Sanitize asset data before saving (e.g., ensure maxHits is valid integer)
     */
    static sanitizeAssetForSave(asset: Asset): void {
        const groups = asset.groups;
        if (!groups) return;

        for (const group of groups) {
            const requirements = group.requirements;
            if (!requirements) continue;

            for (const req of requirements) {
                // Ensure maxHits is a valid integer, default to 0
                const maxHits = req.maxHits;
                if (maxHits === undefined || maxHits === null || typeof maxHits !== 'number' || !Number.isFinite(maxHits)) {
                    req.maxHits = 0;
                } else {
                    req.maxHits = Math.floor(maxHits);
                }
            }
        }
    }

    /**
     * Saves game-specific state to the state file.
     * Must call setGamePath() first.
     */
    static async saveData(): Promise<boolean> {
        if (!this.stateFilePath) {
            console.error("Failed to save data: game path not set");
            return false;
        }

        try {
            // Ensure directory exists
            await Deno.mkdir("RACache/games", { recursive: true });

            // Sanitize and strip computed fields before saving
            const assets = this.data.assets;
            const codeNotes = this.data.codeNotes || [];

            // Sanitize each asset before saving
            for (const asset of assets) {
                this.sanitizeAssetForSave(asset);
            }

            const strippedData = {
                assets: assets.map(asset => this.stripAssetData(asset, this.assetSchema)),
                codeNotes: codeNotes.map(note => this.stripAssetData(note, this.codeNoteSchema)),
                gameConfig: this.stripAssetData(this.data.gameConfig || {}, this.gameConfigSchema),
            };
            await Deno.writeTextFile(this.stateFilePath, JSON.stringify(strippedData, null, 2));
            return true;
        } catch (e) {
            console.error("Failed to save data:", e);
            return false;
        }
    }

    /**
     * Saves specific assets (or all unsaved/modified if no ids provided).
     * Updates _saved and _modified flags and creates new snapshots.
     * @param ids Optional array of asset IDs to save. If undefined, saves all unsaved/modified.
     * @returns Array of asset IDs that were saved.
     */
    static async saveAssets(ids?: number[]): Promise<number[]> {
        const assets = this.data.assets;
        const savedIds: number[] = [];
        const previousState: Array<{ asset: Asset, saved: boolean | undefined, modified: boolean | undefined, snapshot: Record<string, unknown> | undefined }> = [];

        for (const asset of assets) {
            const shouldSave = ids
                ? ids.includes(asset.id)
                : (!asset._saved || asset._modified);

            if (shouldSave) {
                previousState.push({ asset, saved: asset._saved, modified: asset._modified, snapshot: asset._originalSnapshot });
                asset._saved = true;
                asset._modified = false;
                asset._originalSnapshot = JSON.parse(JSON.stringify(this.stripAssetData(asset, this.assetSchema)));
                savedIds.push(asset.id);
            }
        }

        // Persist to disk
        const ok = await this.saveData();
        if (!ok) {
            // Revert flag changes since disk write failed
            for (const prev of previousState) {
                prev.asset._saved = prev.saved;
                prev.asset._modified = prev.modified;
                prev.asset._originalSnapshot = prev.snapshot;
            }
            return [];
        }

        return savedIds;
    }

    /**
     * Resets specific assets to their last saved state.
     * Only works for assets with _saved: true.
     * @param ids Array of asset IDs to reset.
     * @returns Object with arrays of reset asset IDs and their restored data.
     */
    static async resetAssets(ids: number[]): Promise<{ resetIds: number[], restoredAssets: Asset[] }> {
        const assets = this.data.assets;
        const resetIds: number[] = [];
        const restoredAssets: Asset[] = [];

        for (let i = 0; i < assets.length; i++) {
            const asset = assets[i];
            if (ids.includes(asset.id) && asset._saved && asset._originalSnapshot) {
                // Restore from snapshot
                const restored = JSON.parse(JSON.stringify(asset._originalSnapshot));
                restored._saved = true;
                restored._modified = false;
                restored._originalSnapshot = JSON.parse(JSON.stringify(asset._originalSnapshot));

                assets[i] = restored;
                resetIds.push(restored.id);
                restoredAssets.push(restored);
            }
        }

        return { resetIds, restoredAssets };
    }

    /**
     * Deletes specific assets from memory and optionally from disk.
     * @param ids Array of asset IDs to delete.
     * @returns Object with arrays of deleted IDs and whether disk was modified.
     */
    static async deleteAssets(ids: number[]): Promise<{ deletedIds: number[], diskModified: boolean }> {
        const assets = this.data.assets;
        const deletedIds: number[] = [];
        let diskModified = false;

        // Filter out deleted assets
        const remainingAssets = assets.filter(asset => {
            if (ids.includes(asset.id)) {
                deletedIds.push(asset.id);
                if (asset._saved) {
                    diskModified = true;
                }
                return false;
            }
            return true;
        });

        // Update assets array
        this.data.assets = remainingAssets;

        // If any saved assets were deleted, update disk
        if (diskModified) {
            const ok = await this.saveData();
            if (!ok) {
                // Restore deleted assets since disk write failed
                this.data.assets = assets;
                return { deletedIds: [], diskModified: false };
            }
        }

        return { deletedIds, diskModified };
    }

    /**
     * Checks if an asset has been modified compared to its snapshot.
     * @param asset The asset to check.
     * @returns true if the asset differs from its snapshot.
     */
    static isAssetModified(asset: Asset): boolean {
        if (!asset._saved || !asset._originalSnapshot) return false;

        const currentStripped = JSON.stringify(this.stripAssetData(asset, this.assetSchema));
        const snapshotStripped = JSON.stringify(asset._originalSnapshot);

        return currentStripped !== snapshotStripped;
    }

    /**
     * Updates _modified flag for an asset based on comparison with snapshot.
     * @param asset The asset to update.
     */
    static updateModifiedFlag(asset: Asset): void {
        if (asset._saved) {
            asset._modified = this.isAssetModified(asset);
        }
    }

    static assetSchema: Record<string, unknown> = {
        type: 'object',
        properties: {
            id: { type: 'number' },
            type: { type: 'string' },
            progressionType: { type: 'string' },
            points: { type: 'number' },
            name: { type: 'string' },
            description: { type: 'string' },
            formula: { type: 'string' },  // Rich Presence formula
            // state is ephemeral (not persisted), always starts as ACTIVE
            category: { type: 'string' },
            modified: { type: 'boolean' },
            published: { type: 'boolean' },
            badgeImage: { type: 'string' },
            groups: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'number' },
                        type: { type: 'string' },
                        requirements: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'number' },
                                    flag: { type: 'string' },
                                    typeA: { type: 'string' },
                                    addressA: { type: 'string' },
                                    cmp: { type: 'string' },
                                    typeB: { type: 'string' },
                                    addressB: { type: 'string' },
                                    maxHits: { type: 'number' },
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    static codeNoteSchema: Record<string, unknown> = {
        type: 'object',
        properties: {
            id: { type: 'number' },
            note: { type: 'string' },
            path: { type: 'string' },
        }
    };

    static gameConfigSchema: Record<string, unknown> = {
        type: 'object',
        properties: {
            title: { type: 'string' },
            originUrl: { type: 'string' },
        }
    };

    /**
     * Recursively strips an object of any properties not defined in the schema.
     * This removes computed fields like compiledA/compiledB before saving to disk.
     * @param data The data object or array to strip.
     * @param schema The schema to validate against.
     * @returns A new, cleaned object or array.
     */
    static stripAssetData(data: unknown, schema: Record<string, unknown>): Record<string, unknown> {
        // If the data isn't an object, we can't strip it, so return it as is.
        if (typeof data !== 'object' || data === null) {
            return data as Record<string, unknown>;
        }

        // Handle arrays: strip each item in the array according to the schema.
        if (Array.isArray(data)) {
            // If the schema doesn't define array items, return an empty array.
            if (!schema.items) return [] as unknown as Record<string, unknown>;
            return data.map(item => AppData.stripAssetData(item, schema.items as Record<string, unknown>)) as unknown as Record<string, unknown>;
        }

        // Handle objects: build a new object with only the allowed properties.
        const strippedAsset: Record<string, unknown> = {};
        const schemaProperties = schema.properties as Record<string, Record<string, unknown>> | undefined;

        if (!schemaProperties) return {}; // Return empty if no properties defined in schema.

        // Iterate over the keys DEFINED IN THE SCHEMA, not the data.
        for (const key in schemaProperties) {
            // Check if the data object actually has this key.
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                const propSchema = schemaProperties[key];
                const propValue = (data as Record<string, unknown>)[key];

                // Recursively call this function for nested objects or arrays.
                if ((propSchema.type === 'object' || propSchema.type === 'array') && propValue) {
                    strippedAsset[key] = AppData.stripAssetData(propValue, propSchema);
                } else {
                    // Otherwise, just copy the primitive value.
                    strippedAsset[key] = propValue;
                }
            }
        }

        return strippedAsset;
    }
}
