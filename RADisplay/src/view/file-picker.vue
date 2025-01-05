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
*, *::before, *::after { box-sizing: border-box; }
html, body {
    height: 100%;
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background-color: #f9fafb;
    color: #374151;
    font-size: 14px;
    overflow: hidden;
}

.container {
    display: flex;
    flex-direction: column;
    height: 100vh;
}

.loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    color: #6b7280;
}

.path-bar {
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    background-color: #ffffff;
    border-bottom: 1px solid #e5e7eb;
    flex-shrink: 0;
    overflow-x: auto;
    white-space: nowrap;
}

.path-segment {
    color: #374151;
    cursor: pointer;
}

.path-segment:hover {
    color: #4f46e5;
}

.file-list {
    flex: 1;
    overflow: auto;
    background: #ffffff;
    padding: 0.5rem;
}

.file-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: background-color 150ms;
}

.file-item:hover {
    background-color: #f9fafb;
}

.file-item.selected {
    background-color: #4f46e5;
    color: #ffffff;
}

.file-item.selected:hover {
    background-color: #4338ca;
}

.file-item .icon {
    font-size: 1.25rem;
    flex-shrink: 0;
}

.file-item .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.file-item.parent-dir {
    color: #6b7280;
}

.empty-message {
    padding: 2rem;
    text-align: center;
    color: #6b7280;
}

.action-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background-color: #ffffff;
    border-top: 1px solid #e5e7eb;
    flex-shrink: 0;
}

.selected-info {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #6b7280;
}

.btn {
    border: 1px solid transparent;
    border-radius: 0.375rem;
    padding: 0.5rem 1.5rem;
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

.btn-primary:hover:not(:disabled) {
    background-color: #4338ca;
}

.btn-primary:disabled {
    background-color: #d1d5db;
    cursor: not-allowed;
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
