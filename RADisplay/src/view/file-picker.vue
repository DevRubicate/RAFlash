<template>
    <div class="launcher" v-if="ready">
        <div class="user-sidebar">
            <div class="sidebar-header">Users</div>
            <div class="user-list">
                <div class="user-item"
                     v-for="name in users"
                     :key="name"
                     :class="{ selected: selectedUser === name }"
                     @click="selectedUser = name">
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
                    <span class="icon">{{ item.type === 'directory' ? '📁' : '📄' }}</span>
                    <span class="name">{{ item.name }}</span>
                </div>
                <div class="empty-message" v-if="items.length === 0">
                    No .swf files found in this directory
                </div>
            </div>

            <footer class="action-bar">
                <div class="action-bar-left">
                    <button class="btn btn-secondary" @click="openEventLog">Event Log</button>
                    <button class="btn btn-secondary" @click="openSettings">Settings</button>
                </div>
                <button class="btn btn-secondary" @click="checkForUpdates" :disabled="updateState !== 'idle'">
                    {{ updateLabel }}
                </button>
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

    .action-bar-left {
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

</style>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { Network } from '../js/network.ts';
import { App } from '../js/app.ts';

const ready = ref(false);
const pathSegments = ref([]);
const items = ref([]);
const users = ref([]);
const selectedUser = ref(null);

// Update state
const updateState = ref('idle'); // 'idle' | 'checking' | 'downloading' | 'uptodate'
const updateInfo = ref(null);
const updateLabel = computed(() => {
    if (updateState.value === 'checking') return 'Checking...';
    if (updateState.value === 'downloading') return 'Downloading...';
    if (updateState.value === 'uptodate') return 'Up to date!';
    return 'Check for Updates';
});

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
                item.name.toLowerCase().endsWith('.swf')
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
            // Auto-select if only one user
            if (users.value.length === 1) {
                selectedUser.value = users.value[0];
            }
        }
    } catch (err) {
        console.error('Failed to load users:', err);
    }
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
    await Network.send({ command: 'showPopup', params: { url: 'internals/assets/settings.html', width: 500, height: 400, params: {}, parentWindowId: App.windowId } });
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
            setTimeout(() => { updateState.value = 'idle'; }, 2000);
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
    Network.connect();

    // Load users and directory info in parallel
    const [, dirResponse] = await Promise.all([
        loadUsers(),
        Network.send({ command: 'getDirectoryInfo', params: {} })
    ]);

    if (dirResponse.success) {
        pathSegments.value = dirResponse.params.currentDirectory;
    } else {
        pathSegments.value = ['.'];
    }

    await loadDirectory(currentPath.value);
    ready.value = true;
});
</script>
