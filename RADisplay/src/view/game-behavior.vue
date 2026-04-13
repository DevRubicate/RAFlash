<template>
    <div class="container" v-if="App.ready">
        <header class="editor-header">
            <h2 class="header-title">Game Behavior</h2>
        </header>

        <div v-if="!isRaflash" class="disabled-banner">
            Only available for .raflash files. Use "Convert to .raflash" from the devtools menu.
        </div>

        <div v-if="!App.flashConnected && isRaflash" class="flash-disconnected-banner">
            Flash Player is not running. Your edits are still saved &mdash; relaunch the game to apply them.
        </div>

        <div class="editor-body">
            <div class="form-group">
                <label for="hash-override">Hash Override</label>
                <input type="text" id="hash-override" class="mono-input" v-model="hashOverride"
                       :disabled="!isRaflash"
                       placeholder="Leave empty to use the .raflash file's own hash">
            </div>

            <div class="form-group">
                <label for="origin-url">Origin URL (to defeat sitelocks)</label>
                <input type="text" id="origin-url" class="mono-input" v-model="originUrl"
                       :disabled="!isRaflash"
                       placeholder="http://www.coolmathgames.com  or  http://host/path/to/game.swf">
            </div>

            <div class="form-group">
                <label for="scale-mode">Scale Mode</label>
                <select id="scale-mode" v-model="scaleMode" :disabled="!isRaflash">
                    <option value="noScale">No Scale</option>
                    <option value="showAll">Show All</option>
                    <option value="noBorder">No Border</option>
                    <option value="exactFit">Exact Fit</option>
                    <option value="neutral">Neutral (game decides)</option>
                </select>
            </div>

            <div class="form-group">
                <label for="align">Alignment</label>
                <select id="align" v-model="align" :disabled="!isRaflash">
                    <option value="TL">Top Left</option>
                    <option value="T">Top Center</option>
                    <option value="TR">Top Right</option>
                    <option value="L">Center Left</option>
                    <option value="">Center</option>
                    <option value="R">Center Right</option>
                    <option value="BL">Bottom Left</option>
                    <option value="B">Bottom Center</option>
                    <option value="BR">Bottom Right</option>
                    <option value="neutral">Neutral (game decides)</option>
                </select>
            </div>
        </div>

        <footer class="editor-footer" v-if="isRaflash">
            <span class="save-hint" v-if="dirty">Unsaved changes</span>
            <button class="btn btn-primary" :disabled="!dirty" @click="save">Save</button>
        </footer>
    </div>
</template>

<style>
    .editor-header {
        display: flex;
        align-items: center;
        padding: 0.75rem 0.875rem;
        background-color: var(--c-surface);
        border-bottom: 1px solid var(--c-border);
        flex-shrink: 0;
    }

    .flash-disconnected-banner, .disabled-banner {
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

    .header-title {
        font-size: 0.875rem;
        font-weight: 650;
        margin: 0;
        color: var(--c-text);
    }

    .editor-body {
        flex: 1;
        padding: 1rem 0.875rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        overflow-y: auto;
    }

    .editor-body .form-group {
        flex: none;
    }

    .editor-body .mono-input {
        font-family: var(--font-mono);
    }

    .checkbox-group label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8125rem;
        color: var(--c-text);
        cursor: pointer;
    }

    .checkbox-group input[type="checkbox"] {
        margin: 0;
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
</style>

<script setup>
    import { ref, watch } from 'vue';
    import { Network } from '../js/network.ts';
    import { App } from '../js/app.ts';

    const hashOverride = ref('');
    const originUrl = ref('');
    const scaleMode = ref('noScale');
    const align = ref('TL');
    const dirty = ref(false);
    const isRaflash = ref(false);

    let savedHashOverride = '';
    let savedOriginUrl = '';
    let savedScaleMode = 'noScale';
    let savedAlign = 'TL';

    watch([hashOverride, originUrl, scaleMode, align], () => {
        dirty.value = hashOverride.value !== savedHashOverride
            || originUrl.value !== savedOriginUrl
            || scaleMode.value !== savedScaleMode
            || align.value !== savedAlign;
    });

    const save = async () => {
        // Save behavior settings into the .raflash data.json
        await Network.send({
            command: 'saveRaflashData',
            params: {
                hashOverride: hashOverride.value,
                originUrl: originUrl.value,
                scaleMode: scaleMode.value,
                align: align.value,
            }
        });
        // Also update in-memory gameConfig so the engine and firmware pick it up
        const config = App.data.gameConfig || {};
        await Network.send({
            command: 'editData',
            params: {
                edited: [
                    ['gameConfig', {
                        title: config.title || '',
                        hashOverride: hashOverride.value,
                        originUrl: originUrl.value,
                        badgeImage: config.badgeImage || '',
                        scaleMode: scaleMode.value,
                        align: align.value,
                    }]
                ]
            }
        });
        savedHashOverride = hashOverride.value;
        savedOriginUrl = originUrl.value;
        savedScaleMode = scaleMode.value;
        savedAlign = align.value;
        dirty.value = false;
    };

    App.initialize().then(async () => {
        const config = App.data.gameConfig || {};
        savedHashOverride = config.hashOverride || '';
        savedOriginUrl = config.originUrl || '';
        savedScaleMode = config.scaleMode || 'noScale';
        savedAlign = (config.align != null) ? config.align : 'TL';
        hashOverride.value = savedHashOverride;
        originUrl.value = savedOriginUrl;
        scaleMode.value = savedScaleMode;
        align.value = savedAlign;

        const response = await Network.send({ command: 'getSettings', params: {} });
        if (response.success) {
            isRaflash.value = !!response.params.isRaflash;
        }

        App.ready = true;
    });
</script>
