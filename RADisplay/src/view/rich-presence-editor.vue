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
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: #f9fafb; color: #374151; font-size: 14px; overflow: hidden; }
    .container { display: flex; flex-direction: column; height: 100vh; }

    /* Header */
    .editor-header {
        display: flex;
        gap: 1.5rem;
        background-color: #ffffff;
        padding: 1rem;
        border-bottom: 1px solid #e5e7eb;
        flex-shrink: 0;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        flex: 1;
    }
    .form-group label {
        font-size: 0.8rem;
        font-weight: 500;
        color: #6b7280;
        margin-bottom: 0.25rem;
    }
    .form-group-small { flex: 0 1 130px; }

    .form-group input[type="text"] {
        width: 100%;
        background-color: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 0.375rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.9rem;
        transition: border-color 200ms, box-shadow 200ms;
    }
    .form-group input[type="text"]:focus {
        outline: none;
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
    }
    .form-group input[readonly] {
        background-color: #f9fafb;
        cursor: not-allowed;
    }

    /* Preview row */
    .preview-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        background-color: #f3f4f6;
        border-bottom: 1px solid #e5e7eb;
        flex-shrink: 0;
    }
    .preview-row label {
        font-size: 0.85rem;
        font-weight: 500;
        color: #6b7280;
    }
    .preview-result {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: 0.9rem;
        color: #111827;
        flex: 1;
    }

    /* Editor main area */
    .editor-main {
        flex: 1;
        display: flex;
        padding: 1rem;
        min-height: 0;
    }
    .editor-main textarea {
        flex: 1;
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: 0.9rem;
        line-height: 1.5;
        padding: 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 0.375rem;
        resize: none;
        background-color: #ffffff;
    }
    .editor-main textarea:focus {
        outline: none;
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
    }
    .editor-main textarea::placeholder {
        color: #9ca3af;
    }

    /* Footer */
    .editor-footer {
        flex-shrink: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 1rem;
        background-color: #ffffff;
        border-top: 1px solid #e5e7eb;
    }

    /* Button Styles */
    .btn {
        border: 1px solid transparent;
        border-radius: 0.375rem;
        padding: 0.5rem 1rem;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 200ms, border-color 200ms;
        white-space: nowrap;
    }
    .btn-primary {
        background-color: #4f46e5;
        color: #ffffff;
    }
    .btn-primary:hover:not(:disabled) { background-color: #4338ca; }
    .btn-primary:disabled { background-color: #a5b4fc; cursor: not-allowed; }

    .form-group-checkbox {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .form-group-checkbox input[type="checkbox"] {
        width: 1rem;
        height: 1rem;
        border-radius: 0.25rem;
        border: 1px solid #d1d5db;
        accent-color: #4f46e5;
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
