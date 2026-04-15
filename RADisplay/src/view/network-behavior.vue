<template>
    <div class="container" v-if="App.ready">
        <!-- Settings view (takes over entire window) -->
        <template v-if="editingRule !== null">
            <header class="editor-header">
                <button class="btn btn-compact btn-secondary" @click="editingRule = null">&larr; Back</button>
                <h2 class="header-title">{{ editingRule.label || 'Untitled Rule' }} &mdash; Settings</h2>
            </header>

            <div class="settings-body" v-if="editingRule.action === 'text'">
                <div class="form-group" style="flex: 1;">
                    <label>Response Body</label>
                    <textarea class="mono-input settings-textarea"
                              v-model="editingRule.body"
                              placeholder="Enter the text response body..."></textarea>
                </div>
            </div>
            <div class="settings-body" v-else>
                <div class="empty-state">
                    <p>Select an action type to configure its settings.</p>
                </div>
            </div>
        </template>

        <!-- Main table view -->
        <template v-else>
            <header class="editor-header">
                <h2 class="header-title">Network Behavior</h2>
                <span style="flex: 1;"></span>
                <button class="btn btn-compact btn-primary" @click="addRule" :disabled="!isRaflash">+ Add Rule</button>
            </header>

            <div v-if="!isRaflash" class="disabled-banner">
                Only available for .raflash files. Use "Convert to .raflash" from the devtools menu.
            </div>

            <div class="table-wrap">
                <table class="data-table" v-if="rules.length > 0">
                    <thead>
                        <tr>
                            <th class="col-active">Active</th>
                            <th class="col-label">Label</th>
                            <th class="col-url">URL</th>
                            <th class="col-status">Status</th>
                            <th class="col-action">Action</th>
                            <th class="col-actions"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(rule, index) in rules" :key="index" :class="{ 'row-inactive': !rule.active }">
                            <td class="col-active">
                                <input type="checkbox" class="row-checkbox" v-model="rule.active"
                                       :disabled="!isRaflash">
                            </td>
                            <td class="col-label">
                                <input type="text" class="cell-input" v-model="rule.label"
                                       :disabled="!isRaflash" placeholder="Untitled">
                            </td>
                            <td class="col-url">
                                <input type="text" class="cell-input mono" v-model="rule.url"
                                       :disabled="!isRaflash" placeholder="http://example.com/path">
                            </td>
                            <td class="col-status">
                                <input type="number" class="cell-input cell-status" v-model.number="rule.status"
                                       :disabled="!isRaflash" min="100" max="599">
                            </td>
                            <td class="col-action">
                                <select class="cell-input" v-model="rule.action" :disabled="!isRaflash">
                                    <option value="text">Text Response</option>
                                </select>
                            </td>
                            <td class="col-actions">
                                <button class="row-btn row-btn-settings" @click="editingRule = rule"
                                        :disabled="!isRaflash" title="Settings">
                                    <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>
                                </button>
                                <button class="row-btn row-btn-delete" @click="removeRule(index)"
                                        :disabled="!isRaflash" title="Delete">
                                    <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div class="empty-state" v-else>
                    <p>No network rules defined.</p>
                    <p>Add a rule to intercept HTTP requests from the game.</p>
                </div>
            </div>

            <footer class="editor-footer" v-if="isRaflash">
                <span class="save-hint" v-if="dirty">Unsaved changes</span>
                <button class="btn btn-primary" :disabled="!dirty" @click="save">Save</button>
            </footer>
        </template>
    </div>
</template>

<style>
    .editor-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 0.875rem;
        background-color: var(--c-surface);
        border-bottom: 1px solid var(--c-border);
        flex-shrink: 0;
    }

    .header-title {
        font-size: 0.875rem;
        font-weight: 650;
        margin: 0;
        color: var(--c-text);
    }

    .disabled-banner {
        flex-shrink: 0;
        margin: 0.5rem 0.875rem 0;
        padding: 0.4375rem 0.625rem;
        background-color: var(--c-surface-alt);
        border: 1px solid var(--c-border);
        border-left: 3px solid var(--c-text-muted);
        border-radius: var(--radius-sm);
        color: var(--c-text-muted);
        font-family: var(--font-sans);
        font-size: 0.75rem;
    }

    .table-wrap {
        flex: 1;
        overflow-y: auto;
    }

    .col-active  { width: 42px; text-align: center; }
    .col-label   { width: 18%; }
    .col-url     { width: 36%; }
    .col-status  { width: 8%; }
    .col-action  { width: 18%; }
    .col-actions { width: 64px; white-space: nowrap; text-align: right; }

    .cell-input {
        width: 100%;
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        padding: 0.25rem 0.4rem;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        color: var(--c-text);
        transition: border-color var(--duration) var(--ease), background-color var(--duration) var(--ease);
    }

    .cell-input:hover:not(:disabled) {
        border-color: var(--c-border);
        background-color: var(--c-surface);
    }

    .cell-input:focus {
        outline: none;
        border-color: var(--c-primary);
        background-color: var(--c-surface);
        box-shadow: var(--shadow-ring);
    }

    .cell-input.mono {
        font-family: var(--font-mono);
        font-size: 0.75rem;
    }

    .cell-status {
        width: 60px;
        text-align: center;
    }

    /* Hide number input spinners */
    .cell-status::-webkit-inner-spin-button,
    .cell-status::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }
    .cell-status { -moz-appearance: textfield; }

    .row-checkbox {
        width: 0.875rem;
        height: 0.875rem;
        accent-color: var(--c-primary);
        cursor: pointer;
    }

    .row-inactive {
        opacity: 0.45;
    }

    .row-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--c-text-muted);
        cursor: pointer;
        transition: all var(--duration) var(--ease);
    }

    .row-btn svg {
        width: 14px;
        height: 14px;
    }

    .row-btn:hover:not(:disabled) {
        background-color: var(--c-surface-alt);
        color: var(--c-text-secondary);
    }

    .row-btn-delete:hover:not(:disabled) {
        background-color: #fef2f2;
        color: var(--c-danger);
    }

    .row-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .editor-footer {
        flex-shrink: 0;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.875rem;
        background-color: var(--c-surface);
        border-top: 1px solid var(--c-border);
    }

    .save-hint {
        font-size: 0.75rem;
        color: var(--c-text-muted);
    }

    /* Settings view */
    .settings-body {
        flex: 1;
        padding: 1rem 0.875rem;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
    }

    .settings-textarea {
        flex: 1;
        resize: none;
        min-height: 200px;
    }
</style>

<script setup>
    import { ref, reactive, watch } from 'vue';
    import { Network } from '../js/network.ts';
    import { App } from '../js/app.ts';

    const rules = reactive([]);
    const dirty = ref(false);
    const isRaflash = ref(false);
    const editingRule = ref(null);

    let savedSnapshot = '[]';

    function takeSnapshot() {
        return JSON.stringify(rules.map(r => ({ active: r.active, label: r.label, url: r.url, status: r.status, action: r.action, body: r.body })));
    }

    watch(rules, () => {
        dirty.value = takeSnapshot() !== savedSnapshot;
    }, { deep: true });

    function addRule() {
        rules.push({ active: true, label: '', url: '', status: 200, action: 'text', body: '' });
    }

    function removeRule(index) {
        if (editingRule.value === rules[index]) editingRule.value = null;
        rules.splice(index, 1);
    }

    async function save() {
        const stripped = rules.map(r => ({ active: r.active, label: r.label, url: r.url, status: r.status, action: r.action, body: r.body }));

        // Save to .raflash data.json
        await Network.send({
            command: 'saveRaflashData',
            params: { networkRules: stripped }
        });

        // Update in-memory gameConfig so proxy picks up changes immediately
        const config = App.data.gameConfig || {};
        await Network.send({
            command: 'editData',
            params: {
                edited: [
                    ['gameConfig', { ...config, networkRules: stripped }]
                ]
            }
        });

        savedSnapshot = takeSnapshot();
        dirty.value = false;
    }

    App.initialize().then(async () => {
        const config = App.data.gameConfig || {};
        const loaded = config.networkRules || [];
        for (const rule of loaded) {
            rules.push({
                active: rule.active !== false,
                label: rule.label || '',
                url: rule.url || '',
                status: rule.status ?? 200,
                action: rule.action || 'text',
                body: rule.body || '',
            });
        }
        savedSnapshot = takeSnapshot();

        const response = await Network.send({ command: 'getSettings', params: {} });
        if (response.success) {
            isRaflash.value = !!response.params.isRaflash;
        }

        App.ready = true;
    });
</script>
