<template>
    <div class="container" v-if="App.ready">
    <header class="top-bar">
        <div class="left-filters">
            <select class="form-control" v-model="filterState">
                <option>All</option>
                <option>Active</option>
                <option>Inactive</option>
                <option>Modified</option>
                <option>Unpublished</option>
            </select>
            <select class="form-control" v-model="filterCategory">
                <option value="All">All</option>
                <option value="CORE">Core</option>
                <option value="UNOFFICIAL">Unofficial</option>
                <option value="LOCAL">Local</option>
            </select>
            <select class="form-control" v-model="filterType">
                <option value="All">All</option>
                <option value="ACHIEVEMENT">Achievements</option>
                <option value="LEADERBOARD">Leaderboards</option>
                <option value="RICH_PRESENCE">Rich Presence</option>
            </select>
        </div>
        <div class="right-info">
            <span id="game-id">Game Id: {{App.gameId}}</span>
            <span>Achievements: {{ filteredAssets.length }}</span>
            <span>Points: {{ filteredAssets.reduce((c, v) => c + (Number(v.points) || 0), 0) }}</span>
            <div class="form-group-checkbox">
                <input type="checkbox" id="proc-active" checked />
                <label for="proc-active">Processing Active</label>
            </div>
        </div>
    </header>

    <div class="main-content">
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th></th>
                        <th>Id</th>
                        <th>Name</th>
                        <th>Points</th>
                        <th>State</th>
                        <th>Category</th>
                        <th>Changes</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="asset in filteredAssets"
                        :key="asset.id"
                        @click="App.selectedAssetId = asset.id"
                        @dblclick="openAsset(asset.id)"
                        :class="App.selectedAssetId == asset.id ? 'selected' : ''"
                    >
                        <td><span class="icon">♔</span></td>
                        <td>{{asset.id}}</td>
                        <td>{{asset.name}}</td>
                        <td>{{asset.points}}</td>
                        <td>{{asset.state}}</td>
                        <td>{{asset.category}}</td>
                        <td>{{asset.changes}}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <aside class="action-panel">
            <button class="btn btn-secondary">Deactivate</button>
            <div class="form-group-checkbox">
                <input type="checkbox" id="keep-active"/>
                <label for="keep-active">Keep Active</label>
            </div>
            <button class="btn btn-secondary">Demote</button>
            <button class="btn btn-secondary">Reset</button>
            <button class="btn btn-secondary">Revert</button>
            <div class="spacer"></div>
            <button class="btn btn-primary" @click="newAsset()">New</button>
            <button class="btn btn-secondary" @click="cloneAsset()">Clone</button>
        </aside>
    </div>
    </div>
</template>

<style>
    /* CSS is unchanged */
    :root {
        --primary-color: #4f46e5;
        --primary-color-light: #eef2ff;
        --primary-color-dark: #4338ca;
        --text-dark: #111827;
        --text-medium: #374151;
        --text-light: #6b7280;
        --border-color: #d1d5db;
        --border-color-light: #e5e7eb;
        --bg-light: #f9fafb;
        --bg-white: #ffffff;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: var(--bg-light); color: var(--text-medium); font-size: 14px; overflow: hidden; }
    .container { display: flex; flex-direction: column; height: 100vh; }
    .spacer { flex: 1 1 auto; }
    .top-bar { display: flex; justify-content: space-between; align-items: center; gap: 1.5rem; padding: 0.75rem 1rem; background-color: var(--bg-white); border-bottom: 1px solid var(--border-color-light); flex-shrink: 0; }
    .left-filters, .right-info { display: flex; align-items: center; gap: 1.5rem; }
    .top-bar .form-control { background-color: var(--bg-white); border: 1px solid var(--border-color); border-radius: 0.375rem; padding: 0.5rem 0.75rem; font-size: 0.9rem; }
    .right-info > span { font-size: 0.9rem; color: var(--text-light); white-space: nowrap; }
    .right-info #game-id { font-weight: 500; color: var(--text-medium); }
    .form-group-checkbox { display: flex; align-items: center; gap: 0.5rem; }
    .form-group-checkbox input[type="checkbox"] { width: 1rem; height: 1rem; border-radius: 0.25rem; border: 1px solid var(--border-color); accent-color: var(--primary-color); }
    .btn { border: 1px solid transparent; border-radius: 0.375rem; padding: 0.5rem 1rem; font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background-color 200ms, border-color 200ms; white-space: nowrap; width: 100%; }
    .btn-primary, .btn-new { background-color: var(--primary-color); color: var(--bg-white); }
    .btn-primary:hover, .btn-new:hover { background-color: var(--primary-color-dark); }
    .btn-secondary { background-color: var(--bg-white); color: var(--text-medium); border-color: var(--border-color); }
    .btn-secondary:hover { border-color: var(--text-medium); }
    .main-content { flex: 1 1 auto; display: flex; min-height: 0; }
    .table-container { flex: 1; overflow: auto; background: var(--bg-white); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border-color-light); white-space: nowrap; }
    thead { position: sticky; top: 0; z-index: 1; }
    th { background-color: var(--bg-light); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-light); }
    tbody tr { cursor: pointer; transition: background-color 150ms; }
    tbody tr:hover { background-color: var(--bg-light); }
    tbody tr.selected { background-color: var(--primary-color); color: var(--bg-white); }
    tbody tr.selected:hover { background-color: var(--primary-color-dark); }
    .icon { font-size: 1.2rem; color: #f59e0b; }
    .action-panel { flex: 0 0 220px; display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; background: var(--bg-white); border-left: 1px solid var(--border-color-light); }
</style>

<script setup>
    import { ref, reactive, computed } from 'vue';
    import { Network } from '../js/network.js';
    import { App }          from '../js/app.js';

    const filterState = ref('All');
    const filterCategory = ref('All');
    const filterType = ref('All');

    const filteredAssets = computed(() => {
        if (!App.data.assets) return [];

        let filtered = App.data.assets;

        switch (filterState.value) {
            case 'Active':
                filtered = filtered.filter(asset => asset.state === 'ACTIVE');
                break;
            case 'Inactive':
                filtered = filtered.filter(asset => asset.state !== 'ACTIVE');
                break;
            case 'Modified':
                filtered = filtered.filter(asset => asset.changes === true);
                break;
            case 'Unpublished':
                filtered = filtered.filter(asset => asset.published === false);
                break;
        }

        if (filterCategory.value !== 'All') {
            filtered = filtered.filter(asset => asset.category === filterCategory.value);
        }

        if (filterType.value !== 'All') {
            filtered = filtered.filter(asset => asset.type === filterType.value);
        }
        
        return filtered;
    });

    const getFakeId = () => Date.now();


    const newAsset = async () => {
        const id = getFakeId();
        App.data.assets.push({
            id, type: 'ACHIEVEMENT', points: 0, name: 'New Achievement', description: '', state: 'Paused', category: 'LOCAL', changes: true, published: false, groups: [ { id: getFakeId(), type: 'CORE', requirements: [] } ],
        });
        await openAsset(id);
    };

    const cloneAsset = async () => {
        await Network.sendMessage({ command: 'showPopup', params: { url: 'internals/assets/asset-editor.html', width: 800, height: 700, params: {} } });
    };

    const openAsset = async (id) => {
        await Network.sendMessage({ command: 'showPopup', params: { url: 'internals/assets/asset-editor.html', width: 800, height: 700, params: { selectedAssetId: id } } });
    };

    App.initialize().then(() => App.ready = true);
</script>
