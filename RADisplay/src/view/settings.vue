<template>
    <div class="settings" v-if="ready">
        <div class="tab-bar">
            <button class="tab"
                    v-for="tab in tabs"
                    :key="tab.id"
                    :class="{ active: activeTab === tab.id }"
                    @click="activeTab = tab.id">
                {{ tab.label }}
            </button>
        </div>

        <div class="tab-content">
            <div v-if="activeTab === 'compatibility'">
                <div class="setting-group">
                    <label class="setting-row">
                        <input type="checkbox" v-model="settings.fixTextFieldBindings" @change="save">
                        <div class="setting-info">
                            <span class="setting-name">Fix TextField variable bindings</span>
                            <span class="setting-desc">Syncs AS2 TextField input values to their bound variables each frame. Fixes games where text input fields don't work when loaded inside the firmware (e.g. DJ Maniax login screen).</span>
                        </div>
                    </label>
                </div>
            </div>

            <div v-if="activeTab === 'developer'">
                <div class="setting-group">
                    <label class="setting-row">
                        <input type="checkbox" v-model="settings.benchmarkingEnabled" @change="save">
                        <div class="setting-info">
                            <span class="setting-name">Enable Benchmarking</span>
                            <span class="setting-desc">Profiles firmware execution time per frame. A Benchmarking window becomes available in devtools. Has a minor performance cost when active.</span>
                        </div>
                    </label>
                </div>
            </div>
        </div>
    </div>
    <div class="loading" v-else>Loading...</div>
</template>

<style>
    .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }

    .settings {
        display: flex;
        flex-direction: column;
        height: 100vh;
    }

    .tab-bar {
        display: flex;
        gap: 0;
        background-color: var(--c-surface-alt);
        border-bottom: 1px solid var(--c-border);
        flex-shrink: 0;
        padding: 0 0.5rem;
    }

    .tab {
        padding: 0.5rem 1rem;
        border: none;
        background: none;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: color var(--duration) var(--ease), border-color var(--duration) var(--ease);
    }

    .tab:hover {
        color: var(--c-text);
    }

    .tab.active {
        color: var(--c-primary);
        border-bottom-color: var(--c-primary);
    }

    .tab-content {
        flex: 1;
        overflow: auto;
        padding: 1rem;
        background: var(--c-surface);
    }

    .setting-group {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .setting-row {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 0.625rem;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background-color 80ms var(--ease);
    }

    .setting-row:hover {
        background-color: var(--c-surface-alt);
    }

    .setting-row input[type="checkbox"] {
        margin-top: 0.125rem;
        flex-shrink: 0;
    }

    .setting-info {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .setting-name {
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--c-text);
    }

    .setting-desc {
        font-size: 0.75rem;
        color: var(--c-text-muted);
        line-height: 1.4;
    }
</style>

<script setup>
import { ref, onMounted } from 'vue';
import { Network } from '../js/network.ts';
import { App } from '../js/app.ts';

const ready = ref(false);
const activeTab = ref('compatibility');

const tabs = [
    { id: 'compatibility', label: 'Compatibility' },
    { id: 'developer', label: 'Developer' },
];

const settings = ref({
    fixTextFieldBindings: true,
    benchmarkingEnabled: false,
});

async function save() {
    await Network.send({
        command: 'saveSettings',
        params: { settings: settings.value }
    });
}

onMounted(async () => {
    App.windowId = Number(new URL(window.location.href).searchParams.get('windowId'));
    Network.connect();

    const response = await Network.send({ command: 'getSettings', params: {} });
    if (response.success) {
        // Merge saved settings over defaults (preserves new defaults for new settings)
        Object.assign(settings.value, response.params);
    }
    ready.value = true;
});
</script>
