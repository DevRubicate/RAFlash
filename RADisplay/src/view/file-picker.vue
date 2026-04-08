<template>
    <div class="container" v-if="ready">
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
                 :class="{ selected: selectedFile === item.name, directory: item.type === 'directory' }"
                 @click="handleClick(item)"
                 @dblclick="handleDoubleClick(item)">
                <span class="icon">{{ item.type === 'directory' ? '📁' : '📄' }}</span>
                <span class="name">{{ item.name }}</span>
            </div>
            <div class="empty-message" v-if="items.length === 0">
                No .swf files found in this directory
            </div>
        </div>

        <footer class="action-bar">
            <div class="selected-info">
                {{ selectedFile ? selectedFile : 'No file selected' }}
            </div>
            <button class="btn btn-primary"
                    :disabled="!selectedFile"
                    @click="confirmSelection">
                Open
            </button>
        </footer>
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

    .file-item.selected {
        background-color: var(--c-primary);
        color: #ffffff;
    }

    .file-item.selected:hover {
        background-color: var(--c-primary-hover);
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

    .selected-info {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }
</style>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { Network } from '../js/network.ts';

const ready = ref(false);
const pathSegments = ref([]);
const items = ref([]);
const selectedFile = ref(null);

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
            selectedFile.value = null;
        }
    } catch (err) {
        console.error('Failed to load directory:', err);
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

// Handle single click on item
function handleClick(item) {
    if (item.type === 'directory') {
        // Single click on directory just selects it visually
        selectedFile.value = null;
    } else {
        // Single click on file selects it
        selectedFile.value = item.name;
    }
}

// Handle double click on item
function handleDoubleClick(item) {
    if (item.type === 'directory') {
        // Double click on directory navigates into it
        pathSegments.value.push(item.name);
        loadDirectory(currentPath.value);
    } else {
        // Double click on file confirms selection
        selectedFile.value = item.name;
        confirmSelection();
    }
}

// Confirm file selection and notify server
async function confirmSelection() {
    if (!selectedFile.value) return;

    const fullPath = currentPath.value + '/' + selectedFile.value;

    try {
        await Network.send({
            command: 'selectFile',
            params: { path: fullPath }
        });
        // Server will close the window after receiving this
    } catch (err) {
        console.error('Failed to select file:', err);
    }
}

// Initialize on mount
onMounted(async () => {
    // Connect to server
    Network.connect();

    // Get current working directory
    try {
        const response = await Network.send({
            command: 'getDirectoryInfo',
            params: {}
        });

        if (response.success) {
            pathSegments.value = response.params.currentDirectory;
        }
    } catch (err) {
        console.error('Failed to get directory info:', err);
        pathSegments.value = ['.'];
    }

    // Load initial directory
    await loadDirectory(currentPath.value);
    ready.value = true;
});
</script>
