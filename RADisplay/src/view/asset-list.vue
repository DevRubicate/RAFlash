<template>
    <div class="container" v-if="App.ready">
    <header class="top-bar">
        <div class="left-filters">
            <div class="tab-group">
                <button class="tab" :class="{ active: filterType === 'ACHIEVEMENT' }" @click="filterType = 'ACHIEVEMENT'">Achievements</button>
                <button class="tab" :class="{ active: filterType === 'RICH_PRESENCE' }" @click="filterType = 'RICH_PRESENCE'">Rich Presence</button>
            </div>
            <select class="form-control" v-model="filterState">
                <option>All</option>
                <option>Active</option>
                <option>Inactive</option>
                <option>Triggered</option>
                <option>Modified</option>
            </select>
        </div>
        <div class="right-info">
            <div class="info-stack">
                <span id="game-id">Game Id: {{App.gameId}}</span>
                <span>Achievements: {{ filteredAssets.length }}</span>
                <span>Points: {{ filteredAssets.reduce((c, v) => c + (Number(v.points) || 0), 0) }}</span>
            </div>
            <button class="btn btn-secondary btn-compact btn-activate" @click="toggleActivation">{{ activationButtonLabel }}</button>
            <div class="form-group-checkbox">
                <input type="checkbox" id="proc-active" v-model="processingActive"/>
                <label for="proc-active">Processing Active</label>
            </div>
        </div>
    </header>

    <div class="main-content">
        <div class="table-container" @click="handleContainerClick">
            <table>
                <thead>
                    <tr>
                        <th></th>
                        <th>Id</th>
                        <th>Name</th>
                        <th>Points</th>
                        <th>State</th>
                        <th>Changes</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(asset, index) in filteredAssets"
                        :key="asset.id"
                        @click="handleRowClick(asset, index, $event)"
                        @dblclick="openAsset(asset.id)"
                        :class="{ selected: selectedAssetIds.has(asset.id) }"
                    >
                        <td><span class="icon">♔</span></td>
                        <td>{{ asset.id < 0 ? 'Local' : asset.id }}</td>
                        <td>{{asset.name}}</td>
                        <td>{{asset.points}}</td>
                        <td>{{ formatState(asset.state) }}</td>
                        <td>{{ getChangeStatus(asset) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <footer class="bottom-bar">
        <div class="left-actions">
            <button class="btn btn-primary" @click="newAsset()" :disabled="newButtonDisabled">New</button>
            <button class="btn btn-secondary" @click="cloneAsset()" v-if="filterType !== 'RICH_PRESENCE'">Clone</button>
        </div>
        <div class="right-actions">
            <button class="btn btn-secondary" @click="saveAssets()">{{ saveButtonLabel }}</button>
            <button class="btn btn-secondary" @click="resetAssets()" :disabled="resetDisabled">{{ resetButtonLabel }}</button>
            <button class="btn btn-danger" @click="deleteAssets()" :disabled="selectedAssetIds.size === 0">Delete</button>
        </div>
    </footer>
    </div>
</template>

<style>
    /* === Top Bar === */
    .top-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        padding: 0.5rem 0.875rem;
        background-color: var(--c-surface);
        border-bottom: 1px solid var(--c-border);
        flex-shrink: 0;
    }

    .left-filters, .right-info { display: flex; align-items: center; gap: 1rem; }

    /* Tabs */
    .tab-group { display: flex; gap: 0; }
    .tab {
        background: none;
        border: none;
        padding: 0.375rem 0.75rem;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--c-text-muted);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: color var(--duration) var(--ease), border-color var(--duration) var(--ease);
    }
    .tab:hover { color: var(--c-text); }
    .tab.active { color: var(--c-primary); border-bottom-color: var(--c-primary); font-weight: 600; }

    /* Info stack */
    .info-stack { display: flex; flex-direction: column; gap: 1px; }
    .info-stack span { font-size: 0.75rem; color: var(--c-text-muted); white-space: nowrap; line-height: 1.25; }
    .info-stack #game-id { font-weight: 600; color: var(--c-text-secondary); }

    /* Filter select */
    .top-bar .form-control {
        background-color: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        padding: 0.35rem 0.625rem;
        font-size: 0.8125rem;
        font-family: var(--font-sans);
        color: var(--c-text);
    }

    /* === Main Table === */
    .main-content { flex: 1 1 auto; display: flex; min-height: 0; }

    .table-container {
        flex: 1;
        overflow: auto;
        background: var(--c-surface);
    }

    table { width: 100%; border-collapse: collapse; }

    th, td {
        padding: 0.5rem 0.75rem;
        text-align: left;
        border-bottom: 1px solid var(--c-border-subtle);
        white-space: nowrap;
    }

    thead { position: sticky; top: 0; z-index: 1; }

    th {
        background-color: var(--c-surface-alt);
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--c-text-muted);
        padding-top: 0.4375rem;
        padding-bottom: 0.4375rem;
    }

    tbody tr {
        cursor: pointer;
        transition: background-color 80ms var(--ease);
    }
    tbody tr:hover { background-color: var(--c-primary-soft); }

    tbody tr.selected {
        background-color: var(--c-primary);
        color: #ffffff;
    }
    tbody tr.selected:hover {
        background-color: var(--c-primary-hover);
    }

    .icon { font-size: 1rem; color: var(--c-warning); }

    /* === Bottom Bar === */
    .bottom-bar {
        flex-shrink: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0.875rem;
        background-color: var(--c-surface);
        border-top: 1px solid var(--c-border);
    }

    .left-actions, .right-actions { display: flex; gap: 0.375rem; }
    .btn-new { background-color: var(--c-primary); color: #ffffff; }
    .btn-new:hover:not(:disabled) { background-color: var(--c-primary-hover); }

    .btn-activate { min-width: 6.5rem; text-align: center; }
</style>

<script setup>
    import { ref, reactive, computed, watch } from 'vue';
    import { Network } from '../js/network.ts';
    import { App }          from '../js/app.ts';
    import { confirmDialog } from '../js/dialog.ts';

    const filterState = ref('All');
    const filterType = ref('ACHIEVEMENT');

    // Runtime settings (not persisted)
    const processingActive = ref(true);

    // Send setting changes to firmware
    watch(processingActive, (val) => {
        Network.send({ command: 'setRuntimeSetting', params: { key: 'processingActive', value: val } });
    });

    // Multi-select state
    const selectedAssetIds = ref(new Set());
    let lastSelectedIndex = null;

    const filteredAssets = computed(() => {
        if (!App.data.assets) return [];

        // Filter out null/invalid entries (can happen if data gets corrupted)
        let filtered = App.data.assets.filter(a => a != null && a.id != null);

        switch (filterState.value) {
            case 'Active':
                filtered = filtered.filter(asset => asset.state === 'ACTIVE');
                break;
            case 'Inactive':
                filtered = filtered.filter(asset => asset.state === 'INACTIVE');
                break;
            case 'Triggered':
                filtered = filtered.filter(asset => asset.state === 'TRIGGERED');
                break;
            case 'Modified':
                filtered = filtered.filter(asset => !asset._saved || asset._modified);
                break;
        }

        if (filterType.value !== 'All') {
            filtered = filtered.filter(asset => asset.type === filterType.value);
        }
        
        return filtered;
    });

    // Click on blank space in container to deselect
    const handleContainerClick = (event) => {
        // Only deselect if clicking directly on the container or table (not on a row)
        if (event.target.closest('tbody tr')) return;
        selectedAssetIds.value.clear();
        lastSelectedIndex = null;
    };

    // Multi-select row click handler
    const handleRowClick = (asset, index, event) => {
        if (event.ctrlKey || event.metaKey) {
            // Toggle selection
            if (selectedAssetIds.value.has(asset.id)) {
                selectedAssetIds.value.delete(asset.id);
            } else {
                selectedAssetIds.value.add(asset.id);
            }
            lastSelectedIndex = index;
        } else if (event.shiftKey && lastSelectedIndex !== null) {
            // Range selection
            const start = Math.min(lastSelectedIndex, index);
            const end = Math.max(lastSelectedIndex, index);
            for (let i = start; i <= end; i++) {
                selectedAssetIds.value.add(filteredAssets.value[i].id);
            }
        } else {
            // Normal click - single select
            selectedAssetIds.value.clear();
            selectedAssetIds.value.add(asset.id);
            lastSelectedIndex = index;
        }
        // Keep App.selectedAssetId in sync for double-click to open
        App.selectedAssetId = asset.id;
    };

    // Activation toggle button label
    const activationButtonLabel = computed(() => {
        if (selectedAssetIds.value.size === 0) {
            return 'Activate All';
        }
        const selectedAssets = App.data.assets.filter(a => selectedAssetIds.value.has(a.id));
        const hasInactive = selectedAssets.some(a => a.state !== 'ACTIVE');
        return hasInactive ? 'Activate' : 'Deactivate';
    });

    // Activation toggle handler
    const toggleActivation = async () => {
        if (selectedAssetIds.value.size === 0) {
            // Activate All: make all non-ACTIVE assets ACTIVE
            for (const asset of App.data.assets) {
                if (asset.state !== 'ACTIVE') {
                    asset.state = 'ACTIVE';
                }
            }
        } else {
            const selectedAssets = App.data.assets.filter(a => selectedAssetIds.value.has(a.id));
            const hasInactive = selectedAssets.some(a => a.state !== 'ACTIVE');

            if (hasInactive) {
                // Activate: make non-ACTIVE selected assets ACTIVE
                for (const asset of selectedAssets) {
                    if (asset.state !== 'ACTIVE') {
                        asset.state = 'ACTIVE';
                    }
                }
            } else {
                // Deactivate: make all selected assets INACTIVE
                for (const asset of selectedAssets) {
                    asset.state = 'INACTIVE';
                }
            }
        }
        await App.save();
    };

    // Format state for display (ACTIVE → Active)
    const formatState = (state) => {
        if (!state) return '';
        return state.charAt(0) + state.slice(1).toLowerCase();
    };

    // Get change status for display in Changes column
    const getChangeStatus = (asset) => {
        if (!asset._saved) return 'unsaved';
        if (asset._modified) return 'modified';
        return '';
    };

    // Dynamic button labels
    const saveButtonLabel = computed(() =>
        selectedAssetIds.value.size > 0 ? 'Save' : 'Save All');

    const resetButtonLabel = computed(() =>
        selectedAssetIds.value.size > 0 ? 'Reset' : 'Reset All');

    // Reset button disabled state - disabled if there's nothing to reset
    const resetDisabled = computed(() => {
        if (selectedAssetIds.value.size === 0) {
            // No selection: disabled if no assets have changes to reset
            return !App.data.assets?.some(a => a._saved && a._modified);
        }
        // Has selection: disabled if none of the selected assets have changes to reset
        return ![...selectedAssetIds.value].some(id => {
            const asset = App.data.assets.find(a => a.id === id);
            return asset && asset._saved && asset._modified;
        });
    });

    // New button disabled state - disabled if Rich Presence filter and one already exists
    const newButtonDisabled = computed(() => {
        if (filterType.value !== 'RICH_PRESENCE') return false;
        return App.data.assets?.some(a => a.type === 'RICH_PRESENCE');
    });

    // Save assets handler
    const savingAssets = ref(false);
    const saveAssets = async () => {
        if (savingAssets.value) return;
        savingAssets.value = true;
        try {
            const ids = selectedAssetIds.value.size > 0
                ? [...selectedAssetIds.value]
                : undefined; // undefined = save all
            await Network.send({ command: 'saveAssets', params: { ids } });
        } finally {
            savingAssets.value = false;
        }
    };

    // Reset assets handler
    const resetAssets = async () => {
        const ids = selectedAssetIds.value.size > 0
            ? [...selectedAssetIds.value]
            : App.data.assets.filter(a => a._saved).map(a => a.id); // Reset All = all saved assets
        if (ids.length === 0) return;
        await Network.send({ command: 'resetAssets', params: { ids } });
    };

    // Delete assets handler
    const deleteAssets = async () => {
        if (selectedAssetIds.value.size === 0) return;

        const count = selectedAssetIds.value.size;
        const confirmed = await confirmDialog(
            'Delete Assets',
            `Are you sure you want to delete ${count} asset${count > 1 ? 's' : ''}?`
        );

        if (!confirmed) return;

        const ids = [...selectedAssetIds.value];
        await Network.send({ command: 'deleteAssets', params: { ids } });
        selectedAssetIds.value.clear();
    };

    const newAsset = async () => {
        const id = App.getFakeId();
        const isRichPresence = filterType.value === 'RICH_PRESENCE';

        const asset = {
            id,
            type: isRichPresence ? 'RICH_PRESENCE' : 'ACHIEVEMENT',
            name: isRichPresence ? 'Rich Presence' : 'New Achievement',
            description: '',
            state: 'ACTIVE',
            category: 'LOCAL',
            published: false,
            _saved: false,
            groups: [{ id: App.getFakeId(), type: 'CORE', requirements: [] }],
        };

        // Only add points for non-Rich Presence assets
        if (!isRichPresence) {
            asset.points = 0;
        } else {
            // Rich Presence gets a formula field instead
            asset.formula = '';
        }

        App.data.assets.push(asset);
        await App.save();
    };

    const cloneAsset = async () => {
        // Get the first selected asset
        if (selectedAssetIds.value.size === 0) return;
        const selectedId = selectedAssetIds.value.values().next().value;
        const sourceAsset = App.data.assets.find(a => a.id === selectedId);
        if (!sourceAsset) return;

        // Deep clone the asset
        const cloned = JSON.parse(JSON.stringify(sourceAsset));

        // Assign new IDs and mark as unsaved
        cloned.id = App.getFakeId();
        cloned.name = sourceAsset.name + ' (Copy)';
        cloned.state = 'ACTIVE';
        cloned._primed = false;
        cloned.category = 'LOCAL';
        cloned.published = false;
        cloned._saved = false;
        cloned._modified = false;
        delete cloned._originalSnapshot;

        // Assign new IDs to groups and requirements
        for (const group of cloned.groups || []) {
            group.id = App.getFakeId();
            for (const req of group.requirements || []) {
                req.id = App.getFakeId();
                req.hits = 0;
                req.maxHits = 0;
            }
        }

        App.data.assets.push(cloned);
        await App.save();
    };

    const openAsset = async (id) => {
        const asset = App.data.assets.find(a => a.id === id);
        const isRichPresence = asset?.type === 'RICH_PRESENCE';

        await Network.send({
            command: 'showPopup',
            params: {
                url: isRichPresence
                    ? 'internals/assets/rich-presence-editor.html'
                    : 'internals/assets/asset-editor.html',
                width: isRichPresence ? 800 : 1050,
                height: 700,
                params: { selectedAssetId: id },
                parentWindowId: App.windowId
            }
        });
    };

    App.initialize().then(() => App.ready = true);
</script>
