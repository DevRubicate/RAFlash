<template>
    <div class="container" v-if="App.ready">
        <header class="editor-header">
            <h2 class="header-title">Game Behavior</h2>
        </header>

        <div v-if="!App.flashConnected" class="flash-disconnected-banner">
            Flash Player is not running. Your edits are still saved &mdash; relaunch the game to apply them.
        </div>

        <div class="editor-body">
            <div class="badge-row">
                <div class="badge-image-wrapper">
                    <img v-if="badgeImage" :src="badgeImage" alt="Game Badge">
                    <div v-else class="badge-placeholder">No image</div>
                    <input type="file" ref="fileInput" accept="image/*" @change="onFileSelected" style="display: none">
                    <button class="btn btn-secondary btn-compact" @click="fileInput.click()">Upload</button>
                </div>
                <div class="badge-fields">
                    <div class="form-group">
                        <label for="game-title">Title</label>
                        <input type="text" id="game-title" v-model="title" placeholder="Game title" spellcheck="true">
                    </div>

                    <div class="form-group">
                        <label for="origin-url">Origin URL</label>
                        <input type="text" id="origin-url" class="mono-input" v-model="originUrl" placeholder="http://www.coolmathgames.com">
                    </div>
                </div>
            </div>
        </div>

        <footer class="editor-footer">
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

    .flash-disconnected-banner {
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

    .editor-body .mono-input {
        font-family: var(--font-mono);
    }

    .badge-row {
        display: flex;
        gap: 1rem;
    }

    .badge-image-wrapper {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.375rem;
        flex-shrink: 0;
    }

    .badge-image-wrapper img {
        width: 96px;
        height: 96px;
        object-fit: contain;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-lg);
        padding: 0.375rem;
        background-color: var(--c-surface);
        box-shadow: var(--shadow-xs);
    }

    .badge-placeholder {
        width: 96px;
        height: 96px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px dashed var(--c-border);
        border-radius: var(--radius-lg);
        background-color: var(--c-surface);
        color: var(--c-text-muted);
        font-size: 0.6875rem;
    }

    .badge-fields {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
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

    const title = ref('');
    const originUrl = ref('');
    const badgeImage = ref('');
    const dirty = ref(false);
    const fileInput = ref(null);

    // Snapshot of saved values for dirty comparison
    let savedTitle = '';
    let savedOriginUrl = '';
    let savedBadgeImage = '';

    watch([title, originUrl, badgeImage], () => {
        dirty.value = title.value !== savedTitle
            || originUrl.value !== savedOriginUrl
            || badgeImage.value !== savedBadgeImage;
    });

    const onFileSelected = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            badgeImage.value = e.target.result;
        };
        reader.readAsDataURL(file);
    };

    const save = async () => {
        await Network.send({
            command: 'editData',
            params: {
                edited: [
                    ['gameConfig', { title: title.value, originUrl: originUrl.value, badgeImage: badgeImage.value }]
                ]
            }
        });
        savedTitle = title.value;
        savedOriginUrl = originUrl.value;
        savedBadgeImage = badgeImage.value;
        dirty.value = false;
    };

    App.initialize().then(() => {
        const config = App.data.gameConfig || { title: '', originUrl: '', badgeImage: '' };
        savedTitle = config.title || '';
        savedOriginUrl = config.originUrl || '';
        savedBadgeImage = config.badgeImage || '';
        title.value = savedTitle;
        originUrl.value = savedOriginUrl;
        badgeImage.value = savedBadgeImage;
        App.ready = true;
    });
</script>
