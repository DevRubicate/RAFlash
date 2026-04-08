<template>
    <div class="container" v-if="App.ready">
        <header class="editor-header">
            <div class="form-group">
                <label for="name">Name</label>
                <input type="text" id="name" :value="selectedAsset.name" readonly>
            </div>
            <div class="form-group form-group-small">
                <label for="id">ID</label>
                <input type="text" id="id" :value="selectedAsset.id" readonly>
            </div>
        </header>

        <div class="preview-row">
            <label>Preview:</label>
            <span class="preview-result">{{ previewResult || '(no result)' }}</span>
        </div>

        <div class="editor-main">
            <textarea
                v-model="selectedAsset.formula"
                @input="onFormulaChange"
                placeholder="Enter Rich Presence formula..."
                spellcheck="false"
            ></textarea>
        </div>

        <footer class="editor-footer">
            <div class="form-group-checkbox">
                <input type="checkbox" id="active-check" v-model="isAssetActive">
                <label for="active-check">Active</label>
            </div>
            <button class="btn btn-primary" :disabled="!hasUnsavedChanges" @click="saveAsset()">Save</button>
        </footer>
    </div>
</template>

<style>
    /* Header */
    .editor-header {
        display: flex;
        gap: 1rem;
        background-color: var(--c-surface);
        padding: 0.75rem 0.875rem;
        border-bottom: 1px solid var(--c-border);
        flex-shrink: 0;
    }

    /* Preview row */
    .preview-row {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.5rem 0.875rem;
        background-color: var(--c-surface-alt);
        border-bottom: 1px solid var(--c-border);
        flex-shrink: 0;
    }

    .preview-row label {
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--c-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .preview-result {
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        color: var(--c-text);
        flex: 1;
    }

    /* Editor main area */
    .editor-main {
        flex: 1;
        display: flex;
        padding: 0.625rem;
        min-height: 0;
    }

    .editor-main textarea {
        flex: 1;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        line-height: 1.6;
        padding: 0.625rem 0.75rem;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-lg);
        resize: none;
        background-color: var(--c-surface);
        color: var(--c-text);
        box-shadow: var(--shadow-xs);
        transition: border-color var(--duration) var(--ease), box-shadow var(--duration) var(--ease);
    }

    .editor-main textarea:focus {
        outline: none;
        border-color: var(--c-primary);
        box-shadow: var(--shadow-ring);
    }

    .editor-main textarea::placeholder {
        color: var(--c-text-muted);
    }

    /* Footer */
    .editor-footer {
        flex-shrink: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0.875rem;
        background-color: var(--c-surface);
        border-top: 1px solid var(--c-border);
    }
</style>

<script setup>
    import { ref, computed, onUnmounted } from 'vue';
    import { App } from '../js/app.ts';
    import { Network } from '../js/network.ts';

    const previewResult = ref('');
    const selectedAssetId = ref(null);
    let pollInterval = null;
    let saveTimeout = null;

    // Computed that always looks up the asset from App.data.assets
    const selectedAsset = computed(() => {
        if (!App.data?.assets || selectedAssetId.value === null) {
            return { name: '', formula: '' };
        }
        return App.data.assets.find(a => a.id === selectedAssetId.value) || { name: '', formula: '' };
    });

    // Check if asset has unsaved changes (new assets always need saving)
    const hasUnsavedChanges = computed(() => {
        const asset = selectedAsset.value;
        if (!asset) return false;
        return !asset._saved || asset._modified === true;
    });

    const saveAsset = async () => {
        if (selectedAssetId.value === null) return;
        await Network.send({ command: 'saveAssets', params: { ids: [selectedAssetId.value] } });
    };

    const isAssetActive = computed({
        get() {
            return selectedAsset.value?.state === 'ACTIVE';
        },
        set(value) {
            const asset = App.data.assets.find(a => a.id === selectedAssetId.value);
            if (asset) {
                asset.state = value ? 'ACTIVE' : 'INACTIVE';
                App.save();
            }
        }
    });

    // Debounced save on formula change
    const onFormulaChange = () => {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        saveTimeout = setTimeout(() => {
            App.save();
        }, 300);
    };

    // Poll for Rich Presence result
    const pollResult = async () => {
        if (!selectedAsset.value?.id) return;

        try {
            const reply = await Network.send({
                command: 'getRichPresenceResult',
                params: { assetId: selectedAsset.value.id }
            });

            if (reply.success && reply.params?.result !== undefined) {
                previewResult.value = reply.params.result || '';
            }
        } catch {
            // Silently ignore errors
        }
    };

    App.initialize().then(() => {
        const asset = App.data.assets.find((a) => a.id === App.windowParams.selectedAssetId);
        if (!asset) {
            console.error('Asset not found:', App.windowParams.selectedAssetId);
            return;
        }
        selectedAssetId.value = asset.id;
        App.ready = true;

        // Start polling for Rich Presence result
        pollInterval = setInterval(pollResult, 500);
        // Initial poll
        pollResult();
    });

    // Cleanup
    onUnmounted(() => {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
    });
</script>
