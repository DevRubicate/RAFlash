<template>
    <div class="settings" v-if="ready">
        <div class="tab-bar">
            <button class="tab"
                    v-for="tab in tabs"
                    :key="tab.id"
                    :class="{ active: activeTab === tab.id }"
                    @click="activeTab = tab.id; currentSubview = null">
                {{ tab.label }}
            </button>
        </div>

        <div class="tab-content">
            <!-- Firmware tab: mode picker (top level) -->
            <div v-if="activeTab === 'firmware' && currentSubview === null">
                <div class="setting-group">
                    <div class="firmware-mode-row" :class="{ active: settings.firmwareMode === 'child' }">
                        <label class="firmware-mode-main">
                            <input type="radio" value="child" v-model="settings.firmwareMode" @change="save">
                            <div class="setting-info">
                                <span class="setting-name">Child Injection Firmware</span>
                                <span class="setting-desc">Flash Player launches the game directly. RAEngine injects bytecode at frame 1 that loads the firmware as a child clip of the game's _root, so the game runs as the true _level0.</span>
                            </div>
                        </label>
                        <button class="settings-button" @click="currentSubview = 'child'">Settings →</button>
                    </div>

                    <div class="firmware-mode-row" :class="{ active: settings.firmwareMode === 'parent' }">
                        <label class="firmware-mode-main">
                            <input type="radio" value="parent" v-model="settings.firmwareMode" @change="save">
                            <div class="setting-info">
                                <span class="setting-name">Parent Wrapper Firmware</span>
                                <span class="setting-desc">Flash Player launches the firmware, which then loads the game into a child clip.</span>
                            </div>
                        </label>
                        <button class="settings-button" @click="currentSubview = 'parent'">Settings →</button>
                    </div>

                    <div class="firmware-mode-row" :class="{ active: settings.firmwareMode === 'none' }">
                        <label class="firmware-mode-main">
                            <input type="radio" value="none" v-model="settings.firmwareMode" @change="save">
                            <div class="setting-info">
                                <span class="setting-name">No Firmware</span>
                                <span class="setting-desc">Flash Player launches the game directly with no firmware. No devtools or achievement support.</span>
                            </div>
                        </label>
                    </div>

                    <p class="firmware-note">
                        Mode change applies on next game launch. For AVM2 (AS3) games, "Child Injection" silently falls back to "Parent Wrapper" since AVM2 child mode isn't implemented yet.
                    </p>
                </div>
            </div>

            <!-- Firmware tab: Parent Wrapper sub-view -->
            <div v-if="activeTab === 'firmware' && currentSubview === 'parent'">
                <div class="subview-header">
                    <button class="back-button" @click="currentSubview = null">← Back</button>
                    <span class="subview-title">Parent Wrapper Firmware Settings</span>
                </div>
                <div class="setting-group">
                    <label class="setting-row">
                        <input type="checkbox" v-model="settings.fixTextFieldBindings" @change="save">
                        <div class="setting-info">
                            <span class="setting-name">Fix TextField variable bindings</span>
                            <span class="setting-desc">Restores two-way AS2 TextField variable bindings that break under loadMovie(). Syncs variable changes to text display and user input back to variables each frame.</span>
                        </div>
                    </label>
                    <label class="setting-row">
                        <input type="checkbox" v-model="settings.fixSoundAttach" @change="save">
                        <div class="setting-info">
                            <span class="setting-name">Fix Sound attachSound scope</span>
                            <span class="setting-desc">Fixes sounds that fail to play because attachSound looks in the firmware's library instead of the game's. Replaces broken Sound objects with correctly-targeted ones after game load.</span>
                        </div>
                    </label>
                </div>
            </div>

            <!-- Firmware tab: Child Injection sub-view -->
            <div v-if="activeTab === 'firmware' && currentSubview === 'child'">
                <div class="subview-header">
                    <button class="back-button" @click="currentSubview = null">← Back</button>
                    <span class="subview-title">Child Injection Firmware Settings</span>
                </div>
                <div class="setting-group">
                    <p class="empty-note">No settings yet — child mode runs without the parent-mode compatibility hacks.</p>
                </div>
            </div>


            <!-- Developer tab -->
            <div v-if="activeTab === 'developer'">
                <div class="setting-group">
                    <label class="setting-row">
                        <input type="checkbox" v-model="settings.benchmarkingEnabled" @change="save">
                        <div class="setting-info">
                            <span class="setting-name">Enable Benchmarking</span>
                            <span class="setting-desc">Profiles firmware execution time per frame. A Benchmarking window becomes available in devtools. Has a minor performance cost when active.</span>
                        </div>
                    </label>
                    <label class="setting-row">
                        <input type="checkbox" v-model="settings.autoOpenDevtools" @change="save">
                        <div class="setting-info">
                            <span class="setting-name">Open RAFlash dev tools when game opens</span>
                            <span class="setting-desc">Automatically opens the devtools menu every time a game launches. Useful for sitelocked or immediately-crashing games where you'd never get a chance to hit F12 in time.</span>
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

    .firmware-mode-row {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 0.75rem;
        border-radius: var(--radius-md);
        border: 1px solid var(--c-border);
        background-color: var(--c-surface);
        transition: border-color 80ms var(--ease), background-color 80ms var(--ease);
    }

    .firmware-mode-row.active {
        border-color: var(--c-primary);
        background-color: var(--c-surface-alt);
    }

    .firmware-mode-row:hover:not(.active) {
        background-color: var(--c-surface-alt);
    }

    .firmware-mode-main {
        flex: 1;
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        cursor: pointer;
    }

    .firmware-mode-row input[type="radio"] {
        margin-top: 0.125rem;
        flex-shrink: 0;
    }

    .settings-button {
        padding: 0.375rem 0.75rem;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        background: var(--c-surface);
        color: var(--c-text);
        font-size: 0.75rem;
        cursor: pointer;
        align-self: flex-start;
        flex-shrink: 0;
        transition: background-color 80ms var(--ease);
    }

    .settings-button:hover {
        background-color: var(--c-surface-alt);
    }

    .firmware-note {
        margin: 0.5rem 0 0;
        font-size: 0.75rem;
        color: var(--c-text-muted);
        line-height: 1.4;
    }

    .subview-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--c-border);
    }

    .back-button {
        padding: 0.375rem 0.75rem;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        background: var(--c-surface);
        color: var(--c-text);
        font-size: 0.75rem;
        cursor: pointer;
        transition: background-color 80ms var(--ease);
    }

    .back-button:hover {
        background-color: var(--c-surface-alt);
    }

    .subview-title {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--c-text);
    }

    .empty-note {
        margin: 0;
        padding: 0.625rem;
        font-size: 0.75rem;
        color: var(--c-text-muted);
        line-height: 1.4;
        font-style: italic;
    }
</style>

<script setup>
import { ref, onMounted } from 'vue';
import { Network } from '../js/network.ts';
import { App } from '../js/app.ts';

const ready = ref(false);
const activeTab = ref('firmware');
const currentSubview = ref(null); // null | 'parent' | 'child'

const tabs = [
    { id: 'firmware', label: 'Firmware' },
    { id: 'developer', label: 'Developer' },
];

const settings = ref({
    firmwareMode: 'child',
    fixTextFieldBindings: true,
    fixSoundAttach: true,
    benchmarkingEnabled: false,
    autoOpenDevtools: false,
});

async function save() {
    await Network.send({
        command: 'saveSettings',
        params: { settings: settings.value }
    });
}

onMounted(async () => {
    App.windowId = Number(new URL(window.location.href).searchParams.get('windowId'));
    await Network.connect();

    const response = await Network.send({ command: 'getSettings', params: {} });
    if (response.success) {
        // Merge saved settings over defaults (preserves new defaults for new settings)
        Object.assign(settings.value, response.params);
    }
    ready.value = true;
});
</script>
