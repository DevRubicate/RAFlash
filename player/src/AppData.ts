import { join } from "https://deno.land/std/path/mod.ts";
import { Formula } from './formula/Formula.ts';
import { JSONDiff } from './JSONDiff.ts';

export class AppData {
    static data: any = {
        assets: [

        ],
    };

    static compileAsset(asset:any) {
        for(const group of asset.groups) {
            for(const req of group.requirements) {
                req.compiledAddressA = Formula.compile(req.addressA);
                req.compiledAddressB = Formula.compile(req.addressB);
            }
        }
        return asset;
    }

    /**
     * Loads all asset data from .json files in the 'assets' directory.
     * It replaces the existing AppData.data.assets array with the loaded data.
     */
    static async loadData() {
        const assetsDir = './assets';
        const loadedData:{assets:Array<any>} = {
            assets: [],
        }

        try {
            // Asynchronously read all entries in the directory
            for await (const file of Deno.readDir(assetsDir)) {
                if (file.isFile && file.name.endsWith('.json')) {
                    const filePath = join(assetsDir, file.name);
                    const fileContent = await Deno.readTextFile(filePath);
                    const asset = JSON.parse(fileContent);
                    const compiledAsset = AppData.compileAsset(asset);
                    loadedData.assets.push(compiledAsset);
                }
            }
            const diff = JSONDiff.getDataDiff(this.data, loadedData);
            JSONDiff.processIncomingDiff(diff);
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                // If the directory doesn't exist, we assume no data has been saved yet.
                this.data.assets = [];
            } else {
                throw error; // Re-throw other errors
            }
        }
    }

    /**
     * Saves all assets from AppData.data.assets to individual .json files.
     * Each file is named after the asset's id and placed in the 'assets' directory.
     * It will create the directory if it does not exist and overwrite existing files.
     */
    static async saveData() {
        const assetsDir = "./assets";

        try {
            // Ensure the 'assets' directory exists, creating it if necessary.
            await Deno.mkdir(assetsDir, { recursive: true });

            const savePromises = this.data.assets.map((asset: any) => {
                const strippedAsset = AppData.stripAssetData(asset, AppData.assetSchema);
                const filePath = join(assetsDir, `${strippedAsset.id}.json`);
                // Use JSON.stringify with formatting for human-readable files
                const jsonString = JSON.stringify(strippedAsset, null, 2);
                return Deno.writeTextFile(filePath, jsonString);
            });

            await Promise.all(savePromises);
        } catch (error) {
            throw error; // Re-throw other errors
        }
    }

    static assetSchema: any = {
        type: 'object',
        properties: {
            id: { type: 'number' },
            type: { type: 'string' },
            points: { type: 'number' },
            name: { type: 'string' },
            description: { type: 'string' },
            state: { type: 'string' },
            category: { type: 'string' },
            modified: { type: 'boolean' },
            published: { type: 'boolean' },
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
                                    hits: { type: 'number' },
                                    maxHits: { type: 'number' },
                                }
                            }
                        }
                    }
                }
            }
        }
    };
    /**
     * Recursively strips an object of any properties not defined in the schema.
     * @param data The data object or array to strip.
     * @param schema The schema to validate against.
     * @returns A new, cleaned object or array.
     */
    static stripAssetData(data: any, schema: any): any {
        // If the data isn't an object, we can't strip it, so return it as is.
        if (typeof data !== 'object' || data === null) {
            return data;
        }

        // Handle arrays: strip each item in the array according to the schema.
        if (Array.isArray(data)) {
            // If the schema doesn't define array items, return an empty array.
            if (!schema.items) return []; 
            return data.map(item => AppData.stripAssetData(item, schema.items));
        }

        // Handle objects: build a new object with only the allowed properties.
        const strippedAsset: any = {};
        const schemaProperties = schema.properties;

        if (!schemaProperties) return {}; // Return empty if no properties defined in schema.

        // Iterate over the keys DEFINED IN THE SCHEMA, not the data.
        for (const key in schemaProperties) {
            // Check if the data object actually has this key.
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                const propSchema = schemaProperties[key];
                const propValue = data[key];
                
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