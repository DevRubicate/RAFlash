<template>
    <div class="container" v-if="App.ready">
        <header class="editor-header">
            <h2 class="header-title">Game Behavior</h2>
        </header>

        <div class="editor-body">
            <div class="form-group">
                <label for="game-title">Title</label>
                <input type="text" id="game-title" v-model="title" placeholder="Game title" spellcheck="true">
            </div>

            <div class="form-group">
                <label for="origin-url">Origin URL</label>
                <input type="text" id="origin-url" class="mono-input" v-model="originUrl" placeholder="http://www.coolmathgames.com/game.swf">
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
    const dirty = ref(false);

    // Snapshot of saved values for dirty comparison
    let savedTitle = '';
    let savedOriginUrl = '';

    watch([title, originUrl], () => {
        dirty.value = title.value !== savedTitle || originUrl.value !== savedOriginUrl;
    });

    const save = async () => {
        await Network.send({
            command: 'editData',
            params: {
                edited: [
                    ['gameConfig', { title: title.value, originUrl: originUrl.value }]
                ]
            }
        });
        savedTitle = title.value;
        savedOriginUrl = originUrl.value;
        dirty.value = false;
    };

    App.initialize().then(() => {
        const config = App.data.gameConfig || { title: '', originUrl: '' };
        savedTitle = config.title || '';
        savedOriginUrl = config.originUrl || '';
        title.value = savedTitle;
        originUrl.value = savedOriginUrl;
        App.ready = true;
    });
</script>
