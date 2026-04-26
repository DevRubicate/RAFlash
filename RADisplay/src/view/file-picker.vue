<template>
    <div class="launcher" v-if="ready">
        <div class="user-sidebar">
            <div class="sidebar-header">Users</div>
            <div class="user-list">
                <div class="user-item"
                     v-for="name in users"
                     :key="name"
                     :class="{ selected: selectedUser === name }"
                     @click="selectUser(name)">
                    {{ name }}
                </div>
                <div class="user-item new-user"
                     @click="createUser">
                    &lt;New User&gt;
                </div>
            </div>
        </div>

        <div class="file-panel">
            <header class="path-bar">
                <span class="path-segment"
                      v-for="(segment, index) in pathSegments"
                      :key="index"
                      @click="navigateToSegment(index)">
                    {{ segment || 'Root' }}<span v-if="index < pathSegments.length - 1"> / </span>
                </span>
            </header>

            <div class="file-list">
                <div class="file-item parent-dir"
                     v-if="pathSegments.length > 1"
                     @click="navigateUp()">
                    <span class="icon">📁</span>
                    <span class="name">..</span>
                </div>
                <div class="file-item"
                     v-for="item in sortedItems"
                     :key="item.name"
                     :class="{ directory: item.type === 'directory' }"
                     @dblclick="handleDoubleClick(item)">
                    <span class="icon" v-if="item.type === 'directory'">📁</span>
                    <img class="icon file-icon" v-else :src="item.name.toLowerCase().endsWith('.raflash') ? '/raflash-icon.png' : '/flash-icon.png'" alt="">
                    <span class="name">{{ item.name }}</span>
                    <span class="row-spacer" v-if="item.type === 'file'"></span>
                    <button class="save-icon"
                            v-if="item.type === 'file'"
                            title="Manage save slots"
                            @click.stop="toggleSlotPopover(item, $event)">💾</button>
                </div>
                <div class="empty-message" v-if="items.length === 0">
                    No .swf or .raflash files found in this directory
                </div>
            </div>

            <footer class="action-bar">
                <div class="action-bar-left">
                    <button class="btn btn-secondary" @click="openEventLog">Event Log</button>
                    <button class="btn btn-secondary" @click="openSettings">Settings</button>
                </div>
                <div class="action-bar-right">
                    <button class="btn btn-secondary" @click="syncAssets" :disabled="assetSyncState !== 'idle'">
                        {{ assetSyncLabel }}
                    </button>
                    <button class="btn btn-secondary" @click="checkForUpdates" :disabled="updateState !== 'idle'">
                        {{ updateLabel }}
                    </button>
                </div>
            </footer>

            <!-- Update modal -->
            <div class="update-overlay" v-if="updateInfo" @click.self="updateInfo = null">
                <div class="update-modal">
                    <div class="update-header">Update Available</div>
                    <div class="update-versions">
                        v{{ updateInfo.currentVersion }} &rarr; v{{ updateInfo.latestVersion }}
                    </div>
                    <div class="update-name" v-if="updateInfo.releaseName">{{ updateInfo.releaseName }}</div>
                    <div class="update-notes" v-if="updateInfo.releaseNotes">{{ updateInfo.releaseNotes }}</div>
                    <div class="update-actions">
                        <button class="btn btn-secondary" @click="updateInfo = null">Cancel</button>
                        <button class="btn btn-primary" @click="applyUpdate" :disabled="updateState === 'downloading'">
                            {{ updateState === 'downloading' ? 'Downloading...' : 'Update and Restart' }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Slot popover -->
            <div class="slot-popover-overlay" v-if="slotPopover" @click.self="closeSlotPopover()" @contextmenu.prevent>
                <div class="slot-popover" :style="slotPopover.style">
                    <div class="slot-popover-header">Save slots</div>
                    <div class="slot-popover-body" v-if="slotPopover.info">
                        <div class="slot-row"
                             v-for="slot in slotPopover.info.slots"
                             :key="slot"
                             :class="{ active: slot === slotPopover.info.currentSlot }"
                             @click="switchSlot(slot)">
                            <span class="slot-check">{{ slot === slotPopover.info.currentSlot ? '✓' : '' }}</span>
                            <span class="slot-name">{{ slot }}</span>
                            <button class="slot-action"
                                    v-if="slot !== 'default'"
                                    title="Rename"
                                    @click.stop="renameSlotPrompt(slot)">✏</button>
                            <button class="slot-action"
                                    v-if="slot !== 'default'"
                                    title="Delete"
                                    @click.stop="deleteSlotPrompt(slot)">🗑</button>
                        </div>
                        <div class="slot-row slot-add" @click="newSlotPrompt()">
                            <span class="slot-check">+</span>
                            <span class="slot-name">New slot</span>
                        </div>
                    </div>
                    <div class="slot-popover-body" v-else>
                        <div class="slot-row slot-loading">Loading…</div>
                    </div>
                </div>
            </div>

            <!-- Invalid drop modal (drag-drop launches that hit a bad path) -->
            <div class="update-overlay" v-if="invalidDropMessage" @click.self="invalidDropMessage = null">
                <div class="update-modal">
                    <div class="update-header">Invalid File</div>
                    <div class="update-notes">{{ invalidDropMessage }}</div>
                    <div class="update-actions">
                        <button class="btn btn-primary" @click="invalidDropMessage = null">OK</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div class="loading" v-else>
        Loading...
    </div>
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

    .launcher {
        display: flex;
        height: 100vh;
    }

    /* === User Sidebar === */
    .user-sidebar {
        width: 160px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        background-color: var(--c-surface-alt);
        border-right: 1px solid var(--c-border);
    }

    .sidebar-header {
        padding: 0.5rem 0.75rem;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--c-text-muted);
        border-bottom: 1px solid var(--c-border);
    }

    .user-list {
        flex: 1;
        overflow-y: auto;
        padding: 0.375rem;
    }

    .user-item {
        padding: 0.375rem 0.625rem;
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: 0.8125rem;
        transition: background-color 80ms var(--ease);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .user-item:hover {
        background-color: var(--c-surface);
    }

    .user-item.selected {
        background-color: var(--c-primary);
        color: #ffffff;
    }

    .user-item.selected:hover {
        background-color: var(--c-primary-hover);
    }

    .user-item.new-user {
        color: var(--c-text-muted);
        font-style: italic;
    }

    /* === File Panel === */
    .file-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .path-bar {
        display: flex;
        align-items: center;
        padding: 0.5rem 0.875rem;
        background-color: var(--c-surface);
        border-bottom: 1px solid var(--c-border);
        flex-shrink: 0;
        overflow-x: auto;
        white-space: nowrap;
        font-size: 0.8125rem;
    }

    .path-segment {
        color: var(--c-text-secondary);
        cursor: pointer;
        transition: color var(--duration) var(--ease);
    }

    .path-segment:hover {
        color: var(--c-primary);
    }

    .file-list {
        flex: 1;
        overflow: auto;
        background: var(--c-surface);
        padding: 0.375rem;
    }

    .file-item {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.4375rem 0.625rem;
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: 0.8125rem;
        transition: background-color 80ms var(--ease);
    }

    .file-item:hover {
        background-color: var(--c-surface-alt);
    }

    .file-item .icon {
        font-size: 1.125rem;
        flex-shrink: 0;
    }

    .file-item .file-icon {
        width: 1.125rem;
        height: 1.125rem;
        object-fit: contain;
    }

    .file-item .name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .file-item.parent-dir {
        color: var(--c-text-muted);
    }

    .empty-message {
        padding: 2.5rem 1.5rem;
        text-align: center;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }

    .action-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.875rem;
        background-color: var(--c-surface);
        border-top: 1px solid var(--c-border);
        flex-shrink: 0;
    }

    .action-bar-left, .action-bar-right {
        display: flex;
        gap: 0.5rem;
    }

    /* Update modal */
    .update-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
    }

    .update-modal {
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-lg, 8px);
        padding: 1.25rem;
        max-width: 420px;
        width: 90%;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .update-header {
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--c-text);
    }

    .update-versions {
        font-size: 0.8125rem;
        color: var(--c-text-secondary);
    }

    .update-name {
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--c-text);
    }

    .update-notes {
        font-size: 0.75rem;
        color: var(--c-text-muted);
        line-height: 1.5;
        max-height: 150px;
        overflow-y: auto;
        white-space: pre-wrap;
    }

    .update-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        margin-top: 0.25rem;
    }

    /* === Slot picker === */
    .row-spacer { flex: 1; }

    .save-icon {
        background: transparent;
        border: none;
        color: var(--c-text-muted);
        cursor: pointer;
        font-size: 0.875rem;
        padding: 0.125rem 0.375rem;
        border-radius: var(--radius-sm, 4px);
        opacity: 0.55;
        flex-shrink: 0;
        transition: opacity var(--duration) var(--ease), background-color var(--duration) var(--ease);
    }

    .file-item:hover .save-icon { opacity: 1; }
    .save-icon:hover { background: var(--c-surface-alt); }

    .slot-popover-overlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        background: transparent;
    }

    .slot-popover {
        position: fixed;
        min-width: 220px;
        max-width: 320px;
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        font-size: 0.8125rem;
        overflow: hidden;
    }

    .slot-popover-header {
        padding: 0.4375rem 0.625rem;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--c-text-muted);
        background: var(--c-surface-alt);
        border-bottom: 1px solid var(--c-border);
    }

    .slot-popover-body {
        padding: 0.25rem;
        max-height: 300px;
        overflow-y: auto;
    }

    .slot-row {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.5rem;
        border-radius: var(--radius-sm, 4px);
        cursor: pointer;
        transition: background-color 80ms var(--ease);
    }

    .slot-row:hover { background: var(--c-surface-alt); }
    .slot-row.active .slot-name { font-weight: 600; color: var(--c-text); }

    .slot-check {
        flex-shrink: 0;
        width: 0.875rem;
        text-align: center;
        color: var(--c-primary);
    }

    .slot-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .slot-action {
        background: transparent;
        border: none;
        color: var(--c-text-muted);
        cursor: pointer;
        padding: 0.125rem 0.3125rem;
        border-radius: var(--radius-sm, 4px);
        font-size: 0.75rem;
        opacity: 0;
        transition: opacity var(--duration) var(--ease), background-color var(--duration) var(--ease);
    }

    .slot-row:hover .slot-action { opacity: 0.7; }
    .slot-action:hover { opacity: 1; background: var(--c-surface); }

    .slot-add { color: var(--c-text-muted); font-style: italic; }
    .slot-add:hover { color: var(--c-text); }
    .slot-loading { color: var(--c-text-muted); cursor: default; padding: 0.5rem 0.625rem; }
    .slot-loading:hover { background: transparent; }

</style>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Network } from '../js/network.ts';
import { App } from '../js/app.ts';

const ready = ref(false);
const pathSegments = ref([]);
const items = ref([]);
const users = ref([]);
const selectedUser = ref(null);

// Asset sync state
const assetSyncState = ref('idle'); // 'idle' | 'syncing' | 'done'
const assetSyncLabel = computed(() => {
    if (assetSyncState.value === 'syncing') return 'Syncing...';
    if (assetSyncState.value === 'done') return 'Assets synced!';
    return 'Sync Assets';
});

// Update state
const updateState = ref('idle'); // 'idle' | 'checking' | 'downloading' | 'uptodate'
const updateInfo = ref(null);

// Invalid-drop message (set when RAFlash was launched with a bad CLI arg)
const invalidDropMessage = ref(null);
const updateLabel = computed(() => {
    if (updateState.value === 'checking') return 'Checking...';
    if (updateState.value === 'downloading') return 'Downloading...';
    if (updateState.value === 'uptodate') return 'Up to date!';
    return 'Check for Updates';
});

// === Save slots ===
// slotInfoCache[item.name] = { hash, currentSlot, slots[] } | null (loading) | undefined (not yet fetched)
const slotInfoCache = ref({});
const slotPopover = ref(null); // { itemName, style, info }

function fullPathFor(itemName) {
    return [...pathSegments.value, itemName].join('/');
}

async function loadSlotInfo(itemName, force = false) {
    if (!force && slotInfoCache.value[itemName]) return slotInfoCache.value[itemName];
    const path = fullPathFor(itemName);
    const r = await Network.send({ command: 'listSlots', params: { path } });
    if (r.success) {
        slotInfoCache.value[itemName] = r.params;
        return r.params;
    }
    return null;
}

async function toggleSlotPopover(item, evt) {
    if (slotPopover.value && slotPopover.value.itemName === item.name) {
        slotPopover.value = null;
        return;
    }
    const rect = evt.currentTarget.getBoundingClientRect();
    const style = {
        top: `${rect.bottom + 4}px`,
        right: `${window.innerWidth - rect.right}px`,
    };
    slotPopover.value = { itemName: item.name, style, info: null };
    const info = await loadSlotInfo(item.name, true);
    if (slotPopover.value && slotPopover.value.itemName === item.name) {
        slotPopover.value = { ...slotPopover.value, info };
    }
}

function closeSlotPopover() {
    slotPopover.value = null;
}

async function switchSlot(slot) {
    if (!slotPopover.value) return;
    const itemName = slotPopover.value.itemName;
    const path = fullPathFor(itemName);
    const r = await Network.send({ command: 'setSlot', params: { path, slot } });
    if (r.success) {
        await loadSlotInfo(itemName, true);
        const info = slotInfoCache.value[itemName];
        if (slotPopover.value && slotPopover.value.itemName === itemName) {
            slotPopover.value = { ...slotPopover.value, info };
        }
    } else {
        alert(r.error || 'Failed to switch slot');
    }
}

async function newSlotPrompt() {
    if (!slotPopover.value) return;
    const name = prompt('New slot name:');
    if (!name || !name.trim()) return;
    const itemName = slotPopover.value.itemName;
    const path = fullPathFor(itemName);
    const create = await Network.send({ command: 'createSlot', params: { path, slot: name.trim() } });
    if (!create.success) { alert(create.error || 'Failed to create slot'); return; }
    // Auto-switch to the new slot — that's the usual intent.
    const setR = await Network.send({ command: 'setSlot', params: { path, slot: name.trim() } });
    if (!setR.success) { alert(setR.error || 'Failed to switch slot'); return; }
    const info = await loadSlotInfo(itemName, true);
    if (slotPopover.value && slotPopover.value.itemName === itemName) {
        slotPopover.value = { ...slotPopover.value, info };
    }
}

async function renameSlotPrompt(oldSlot) {
    if (!slotPopover.value) return;
    const next = prompt(`Rename "${oldSlot}" to:`, oldSlot);
    if (!next || !next.trim() || next.trim() === oldSlot) return;
    const itemName = slotPopover.value.itemName;
    const path = fullPathFor(itemName);
    const r = await Network.send({ command: 'renameSlot', params: { path, oldSlot, newSlot: next.trim() } });
    if (!r.success) { alert(r.error || 'Failed to rename slot'); return; }
    const info = await loadSlotInfo(itemName, true);
    if (slotPopover.value && slotPopover.value.itemName === itemName) {
        slotPopover.value = { ...slotPopover.value, info };
    }
}

async function deleteSlotPrompt(slot) {
    if (!slotPopover.value) return;
    if (!confirm(`Delete slot "${slot}"? This permanently removes its save files.`)) return;
    const itemName = slotPopover.value.itemName;
    const path = fullPathFor(itemName);
    const r = await Network.send({ command: 'deleteSlot', params: { path, slot } });
    if (!r.success) { alert(r.error || 'Failed to delete slot'); return; }
    const info = await loadSlotInfo(itemName, true);
    if (slotPopover.value && slotPopover.value.itemName === itemName) {
        slotPopover.value = { ...slotPopover.value, info };
    }
}

// Sort items: directories first, then files, alphabetically
const sortedItems = computed(() => {
    const dirs = items.value.filter(i => i.type === 'directory').sort((a, b) => a.name.localeCompare(b.name));
    const files = items.value.filter(i => i.type === 'file').sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...files];
});

// Get current path as string
const currentPath = computed(() => {
    return pathSegments.value.join('/') || '/';
});

// Load directory contents
async function loadDirectory(path) {
    try {
        const response = await Network.send({
            command: 'readDirectory',
            params: { path: path || '.' }
        });

        if (response.success) {
            // Filter to only show directories and .swf files
            items.value = response.params.filter(item =>
                item.type === 'directory' ||
                item.name.toLowerCase().endsWith('.swf') || item.name.toLowerCase().endsWith('.raflash')
            );
        }
    } catch (err) {
        console.error('Failed to load directory:', err);
    }
}

// Load available users
async function loadUsers() {
    try {
        const response = await Network.send({
            command: 'listUsers',
            params: {}
        });
        if (response.success) {
            users.value = response.params.users;
            const last = response.params.lastUser;
            if (last && users.value.includes(last)) {
                selectedUser.value = last;
            } else if (users.value.includes("Guest")) {
                selectedUser.value = "Guest";
            } else if (users.value.length > 0) {
                selectedUser.value = users.value[0];
            }
        }
    } catch (err) {
        console.error('Failed to load users:', err);
    }
}

// Select a user and persist the choice
function selectUser(name) {
    selectedUser.value = name;
    Network.send({ command: 'setLastUser', params: { name } });
}

// Create a new user
async function createUser() {
    const name = prompt('User name:');
    if (!name || !name.trim()) return;

    try {
        await Network.send({
            command: 'createUser',
            params: { name: name.trim() }
        });
        await loadUsers();
        selectedUser.value = name.trim();
    } catch (err) {
        console.error('Failed to create user:', err);
    }
}

// Navigate to a specific path segment
function navigateToSegment(index) {
    pathSegments.value = pathSegments.value.slice(0, index + 1);
    loadDirectory(currentPath.value);
}

// Navigate up to parent directory
function navigateUp() {
    if (pathSegments.value.length > 1) {
        pathSegments.value.pop();
        loadDirectory(currentPath.value);
    }
}

// Handle double click on item
function handleDoubleClick(item) {
    if (item.type === 'directory') {
        pathSegments.value.push(item.name);
        loadDirectory(currentPath.value);
    } else {
        confirmSelection(item.name);
    }
}

// Open Event Log window
async function openEventLog() {
    await Network.send({ command: 'showPopup', params: { url: 'internals/assets/event-log.html', width: 700, height: 500, params: {}, parentWindowId: App.windowId } });
}

// Open Settings window
async function openSettings() {
    await Network.send({ command: 'showPopup', params: { url: 'internals/assets/settings.html', width: 500, height: 600, params: {}, parentWindowId: App.windowId } });
}

// Check for updates
// Track any setTimeouts we schedule so they can be cleared on unmount.
const pendingTimeouts = new Set();
function trackedTimeout(fn, ms) {
    const id = setTimeout(() => {
        pendingTimeouts.delete(id);
        fn();
    }, ms);
    pendingTimeouts.add(id);
    return id;
}
onUnmounted(() => {
    for (const id of pendingTimeouts) clearTimeout(id);
    pendingTimeouts.clear();
});

async function syncAssets() {
    assetSyncState.value = 'syncing';
    try {
        const response = await Network.send({ command: 'syncAssets', params: {} });
        if (!response.success) {
            alert(response.error || 'Failed to sync assets');
            assetSyncState.value = 'idle';
            return;
        }
        assetSyncState.value = 'done';
        trackedTimeout(() => { assetSyncState.value = 'idle'; }, 2000);
    } catch {
        alert('Failed to sync assets');
        assetSyncState.value = 'idle';
    }
}

// Check for updates
async function checkForUpdates() {
    updateState.value = 'checking';
    try {
        const response = await Network.send({ command: 'checkForUpdates', params: {} });
        if (!response.success) {
            alert(response.error || 'Failed to check for updates');
            return;
        }
        if (response.params.updateAvailable) {
            updateInfo.value = response.params;
        } else {
            updateState.value = 'uptodate';
            trackedTimeout(() => { updateState.value = 'idle'; }, 2000);
            return;
        }
    } catch {
        alert('Failed to check for updates');
    } finally {
        if (updateState.value === 'checking') updateState.value = 'idle';
    }
}

// Apply update
async function applyUpdate() {
    if (!updateInfo.value?.downloadUrl) {
        alert('No download URL available');
        return;
    }
    updateState.value = 'downloading';
    try {
        const response = await Network.send({
            command: 'applyUpdate',
            params: { downloadUrl: updateInfo.value.downloadUrl }
        });
        if (!response.success) {
            alert(response.error || 'Update failed');
            updateState.value = 'idle';
        }
        // If successful, the app will restart — connection will drop
    } catch {
        alert('Update failed');
        updateState.value = 'idle';
    }
}

// Confirm file selection and notify server
async function confirmSelection(fileName) {
    if (!fileName || !selectedUser.value) return;

    const fullPath = currentPath.value + '/' + fileName;

    try {
        await Network.send({
            command: 'selectFile',
            params: { path: fullPath, user: selectedUser.value }
        });
    } catch (err) {
        console.error('Failed to select file:', err);
    }
}

// Initialize on mount
onMounted(async () => {
    App.windowId = Number(new URL(window.location.href).searchParams.get('windowId'));
    await Network.connect();

    // Load users, directory info, and per-window setup params in parallel
    const [, dirResponse, setupResponse] = await Promise.all([
        loadUsers(),
        Network.send({ command: 'getDirectoryInfo', params: {} }),
        Network.send({ command: 'setup', params: { windowId: App.windowId } })
    ]);

    // Show the invalid-drop modal if RAEngine plumbed a message through windowParams
    if (setupResponse.success && setupResponse.params?.params?.invalidDropMessage) {
        invalidDropMessage.value = setupResponse.params.params.invalidDropMessage;
    }

    if (dirResponse.success) {
        pathSegments.value = dirResponse.params.currentDirectory;
    } else {
        pathSegments.value = ['.'];
    }

    await loadDirectory(currentPath.value);
    ready.value = true;
});
</script>
