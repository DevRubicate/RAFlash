import { createApp }                    from 'https://unpkg.com/petite-vue?module';
import { getDiff }                      from './json-diff.js';
import { alertDialog, confirmDialog }   from './dialog.js';
import { Network }                      from './network.js';

export function view(config) {
    const appData = {
        ...config,
        ready: false,
        gameId: 1686,
    
        data: {assets: []},
        originalData: {assets: []},
    
        selectedAsset: null,
        set selectedAssetId(value) {
            this.selectedAsset = this.data.assets.find(asset => asset.id === value) ?? null;
            const groupId = this.selectedAsset.groups.find(group => group.type === 'CORE')?.id;
            if(groupId) {
                this.selectedGroupId = groupId;
            }
        },
        get selectedAssetId() {
            return this.selectedAsset?.id ?? null;
        },


        // methods
        getFakeId() {
            return Math.floor(Math.random() * -0xFFFFFF)
        },
    
        setData(key, value) {
            this[key] = value;
        },
        applyDataDiff(diff) {
            // Helper function to set a value in the object by path
            function setValue(obj, path, value) {
                const keys = path.split('/');
                let current = obj;
                for (let i = 0; i < keys.length - 1; i++) {
                const key = keys[i].replace(/\[\]$/, ''); // Remove array brackets if present
                current = current[key] = current[key] || (keys[i + 1].match(/\[\]$/) ? [] : {});
                }
                const finalKey = keys[keys.length - 1].replace(/\[\]$/, '');
                current[finalKey] = value;
            }
    
            // Helper function to remove a value from the object by path
            function removeValue(obj, path) {
                const keys = path.split('/');
                let current = obj;
                for (let i = 0; i < keys.length - 1; i++) {
                    const key = keys[i].replace(/\[\]$/, '');
                    if (!(key in current)) return; // Path does not exist
                    current = current[key];
                }
                const finalKey = keys[keys.length - 1].replace(/\[\]$/, '');
                delete current[finalKey];
            }
    
            // Apply added changes
            if (diff.added) {
                for (const [path, value] of diff.added) {
                setValue(this.data, path, value);
                }
            }
    
            // Apply removed changes
            if (diff.removed) {
                for (const [path] of diff.removed) {
                removeValue(this.data, path);
                }
            }
    
            // Apply edited changes
            if (diff.edited) {
                for (const [path, , newValue] of diff.edited) {
                setValue(this.data, path, newValue);
                }
            }
        },
        async save() {
            await Network.sendMessage({command: 'editData', params: getDiff(appData.originalData, appData.data)});
            appData.originalData = JSON.parse(JSON.stringify(appData.data));
        },
    };

    const app = createApp(appData);
    app.mount();

    Network.initialize(appData);
}