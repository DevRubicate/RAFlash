<template>
    <div class="container" v-if="App.ready">

        <div v-if="!App.flashConnected" class="flash-disconnected-banner">
            Flash Player is not running &mdash; tree and preview stay on the last snapshot.
        </div>

        <div class="toolbar">
            <button class="btn btn-secondary btn-compact" :disabled="!App.flashConnected" @click="refresh()">
                Refresh
            </button>
            <span class="toolbar-hint" v-if="tree && filterText.trim()">
                {{ flatRows.length }} of {{ totalNodeCount }} nodes
            </span>
            <span class="toolbar-hint" v-else-if="tree">{{ flatRows.length }} nodes visible</span>
            <div class="hit-test-buttons">
                <button
                    class="hit-test-button"
                    :class="{ active: hitTestMode === 'click' }"
                    :disabled="!App.flashConnected || (hitTestMode !== null && hitTestMode !== 'click')"
                    @click="toggleHitTest('click')"
                    title="Click, then click in the game to pick a clickable element (button or interactive MovieClip)"
                >
                    <span v-if="hitTestMode === 'click'">Cancel</span>
                    <span v-else>Click HitTest</span>
                </button>
                <button
                    class="hit-test-button"
                    :class="{ active: hitTestMode === 'element' }"
                    :disabled="!App.flashConnected || (hitTestMode !== null && hitTestMode !== 'element')"
                    @click="toggleHitTest('element')"
                    title="Click, then click in the game to pick any element under the cursor (any MovieClip, Button, or TextField)"
                >
                    <span v-if="hitTestMode === 'element'">Cancel</span>
                    <span v-else>Element HitTest</span>
                </button>
            </div>
        </div>

        <div v-if="hitTestResult" class="hit-test-modal-backdrop">
            <div class="hit-test-modal">
                <button class="hit-test-modal-close-x" @click="hitTestResult = null" title="Close">&times;</button>
                <div class="hit-test-modal-title">
                    {{ hitTestResult.path ? 'Detected click target' : 'No target detected' }}
                </div>

                <div v-if="hitTestResult.path" class="hit-test-modal-path-row">
                    <div v-if="hitTestResult.namePath" class="hit-test-modal-path-label">Position based:</div>
                    <div class="hit-test-modal-path">{{ hitTestResult.path }}</div>
                    <button class="hit-test-copy" @click="copyHitTestPath('path')">{{ copied === 'path' ? 'Copied' : 'Copy' }}</button>
                </div>

                <div v-if="hitTestResult.namePath" class="hit-test-modal-path-row">
                    <div class="hit-test-modal-path-label">Name based:</div>
                    <div class="hit-test-modal-path">{{ hitTestResult.namePath }}</div>
                    <button class="hit-test-copy" @click="copyHitTestPath('namePath')">{{ copied === 'namePath' ? 'Copied' : 'Copy' }}</button>
                </div>

                <div v-if="!hitTestResult.path" class="hit-test-modal-empty">Click at ({{ hitTestResult.x }}, {{ hitTestResult.y }}) didn't hit any clickable element.</div>
            </div>
        </div>

        <div class="split">
            <div class="tree-pane">
                <div v-if="tree === null" class="pane-placeholder">
                    Loading stage&hellip;
                </div>
                <div v-else ref="treeListRef" class="tree-list" :class="{ stale: treeLoading }">
                    <div
                        v-for="row in flatRows"
                        :key="row.node.path"
                        :data-path="row.node.path"
                        class="tree-row"
                        :class="{ selected: !row.node.placeholder && row.node.path === selectedPath, placeholder: row.node.placeholder }"
                        :style="{ paddingLeft: (0.5 + row.depth * 1.25) + 'rem' }"
                        @click="row.node.placeholder ? null : selectNode(row.node)"
                        @contextmenu="row.node.placeholder ? null : openContextMenu(row.node, $event)"
                    >
                        <span
                            v-if="!row.node.placeholder && !filterText.trim() && row.node.children.length > 0"
                            class="disclosure"
                            @click.stop="toggleNode(row.node)"
                        >{{ row.node.expanded ? '▼' : '▶' }}</span>
                        <span v-else class="disclosure-spacer"></span>
                        <template v-if="row.node.placeholder">
                            <span class="node-placeholder">[…]</span>
                        </template>
                        <template v-else>
                            <span class="type-tag" :class="'type-' + row.node.typeLabel.toLowerCase()">[{{ row.node.typeLabel }}]</span>
                            <span class="node-name">{{ row.node.key }}</span>
                        </template>
                    </div>
                </div>
            </div>

            <div class="preview-pane">
                <div v-if="selectedPath === null" class="pane-placeholder">
                    Click a node to inspect its properties.
                </div>
                <template v-else>
                    <div class="preview-header">
                        <span class="preview-path">{{ selectedPath }}</span>
                        <button
                            class="eye-btn"
                            v-if="App.flashConnected"
                            @click="focusSelected()"
                            title="Focus this object in the game"
                        >&#128065;</button>
                    </div>
                    <div v-if="selectedLoading && selectedProps.length === 0" class="pane-placeholder">
                        Loading&hellip;
                    </div>
                    <div v-else-if="selectedProps.length === 0" class="pane-placeholder">
                        No scalar properties.
                    </div>
                    <table v-else class="preview-table" :class="{ stale: selectedLoading }">
                        <tbody>
                            <tr v-for="prop in selectedProps" :key="prop.key">
                                <td class="prop-key">{{ prop.key }}</td>
                                <td class="prop-value">{{ prop.value }}</td>
                            </tr>
                        </tbody>
                    </table>
                </template>
            </div>
        </div>

        <input
            class="mono-input filter-input"
            v-model="filterText"
            placeholder="Filter tree..."
            spellcheck="false"
            v-if="tree"
        />

        <div
            v-if="contextMenu"
            class="context-menu"
            :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
            @mousedown.stop
            @click.stop
            @contextmenu.prevent
        >
            <button class="context-menu-item" @click="copyStructure()">
                Copy structure into clipboard
            </button>
        </div>
    </div>
</template>

<style>
    .container {
        padding: 0.75rem;
        gap: 0.5rem;
    }

    .filter-input {
        flex-shrink: 0;
        margin-top: 0.5rem;
    }

    .flash-disconnected-banner {
        flex-shrink: 0;
        padding: 0.4375rem 0.625rem;
        background-color: var(--c-surface-alt);
        border: 1px solid var(--c-border);
        border-left: 3px solid var(--c-text-muted);
        border-radius: var(--radius-sm);
        color: var(--c-text-muted);
        font-family: var(--font-sans);
        font-size: 0.75rem;
    }

    .toolbar {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 0.625rem;
    }

    .toolbar-hint {
        color: var(--c-text-muted);
        font-size: 0.75rem;
    }

    .hit-test-buttons {
        margin-left: auto;
        display: flex;
        gap: 0.5rem;
    }

    .hit-test-button {
        color: white;
        background: #374151;
        border: none;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        font-weight: 600;
        padding: 0.5rem 1.25rem;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: opacity var(--duration) var(--ease), background var(--duration) var(--ease);
    }

    .hit-test-button.active {
        background: var(--c-primary);
    }

    .hit-test-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .hit-test-button:not(:disabled):hover {
        opacity: 0.85;
    }

    .hit-test-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1100;
    }

    .hit-test-modal {
        position: relative;
        min-width: 320px;
        max-width: 80%;
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }

    .hit-test-modal-close-x {
        position: absolute;
        top: 0.375rem;
        right: 0.5rem;
        background: none;
        border: none;
        color: var(--c-text-muted);
        font-size: 1.5rem;
        line-height: 1;
        padding: 0.125rem 0.375rem;
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition: color var(--duration) var(--ease), background var(--duration) var(--ease);
    }

    .hit-test-modal-close-x:hover {
        color: var(--c-text);
        background: rgba(255, 255, 255, 0.06);
    }

    .hit-test-modal-title {
        font-weight: 600;
        font-size: 0.875rem;
        color: var(--c-text);
    }

    .hit-test-modal-path-row {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .hit-test-modal-path-label {
        font-size: 0.75rem;
        color: var(--c-text-muted);
        font-weight: 500;
    }

    .hit-test-modal-path {
        font-family: var(--font-mono);
        font-size: 0.75rem;
        color: var(--c-text);
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        padding: 0.5rem 0.625rem;
        word-break: break-all;
        user-select: text;
    }

    .hit-test-modal-path-row .hit-test-copy {
        align-self: flex-end;
    }

    .hit-test-modal-empty {
        font-size: 0.8125rem;
        color: var(--c-text-muted);
    }

    .hit-test-copy {
        color: white;
        background: var(--c-primary);
        border: none;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        font-weight: 600;
        padding: 0.4rem 1rem;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: opacity var(--duration) var(--ease);
    }

    .hit-test-copy:hover {
        opacity: 0.85;
    }

    .split {
        flex-grow: 1;
        display: flex;
        gap: 0.5rem;
        min-height: 0;
    }

    .tree-pane,
    .preview-pane {
        flex: 1 1 0;
        min-width: 0;
        min-height: 0;
        background-color: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-xs);
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .tree-pane { flex-basis: 45%; }
    .preview-pane { flex-basis: 55%; }

    .pane-placeholder {
        padding: 2rem 1rem;
        text-align: center;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }

    /* === Tree === */
    .tree-list {
        overflow-y: auto;
        padding: 0.25rem 0;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        transition: opacity var(--duration) var(--ease);
    }

    .tree-list.stale { opacity: 0.6; }

    .tree-row {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding-top: 0.125rem;
        padding-bottom: 0.125rem;
        padding-right: 0.5rem;
        cursor: pointer;
        white-space: nowrap;
        transition: background-color 80ms var(--ease);
    }

    .tree-row:hover {
        background-color: var(--c-primary-soft);
    }

    .tree-row.selected {
        background-color: var(--c-primary-soft);
        color: var(--c-primary-text);
    }

    .tree-row.selected .type-tag {
        color: var(--c-primary-hover);
    }

    .disclosure,
    .disclosure-spacer {
        flex-shrink: 0;
        width: 1.25rem;
        text-align: center;
    }

    .disclosure {
        font-size: 0.875rem;
        color: var(--c-text-secondary);
        cursor: pointer;
        transition: color var(--duration) var(--ease);
    }

    .disclosure:hover {
        color: var(--c-primary);
    }

    .type-tag {
        flex-shrink: 0;
        color: var(--c-text-muted);
        font-weight: 500;
    }

    .type-tag.type-movieclip  { color: #7c3aed; }
    .type-tag.type-button     { color: #d97706; }
    .type-tag.type-textfield  { color: #0891b2; }
    .type-tag.type-stage      { color: var(--c-primary); font-weight: 600; }

    .node-name {
        color: var(--c-text);
    }

    .tree-row.selected .node-name {
        color: var(--c-primary-text);
        font-weight: 600;
    }

    .tree-row.placeholder {
        cursor: default;
    }

    .tree-row.placeholder:hover {
        background-color: transparent;
    }

    .node-placeholder {
        color: var(--c-text-muted);
        font-style: italic;
    }

    /* === Preview === */
    .preview-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background-color: var(--c-surface-alt);
        border-bottom: 1px solid var(--c-border);
        flex-shrink: 0;
    }

    .preview-path {
        flex-grow: 1;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        color: var(--c-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: text;
    }

    .eye-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 0.875rem;
        color: var(--c-text-muted);
        padding: 0 0.25rem;
        transition: color var(--duration) var(--ease);
    }

    .eye-btn:hover { color: var(--c-primary); }

    .preview-table {
        flex-grow: 1;
        overflow-y: auto;
        display: block;
        width: 100%;
        border-collapse: collapse;
        transition: opacity var(--duration) var(--ease);
    }

    .preview-table.stale { opacity: 0.6; }

    .preview-table tbody {
        display: table;
        width: 100%;
    }

    .preview-table td {
        padding: 0.375rem 0.75rem;
        border-bottom: 1px solid var(--c-border-subtle);
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        user-select: text;
    }

    .preview-table tr:nth-child(even) td {
        background-color: var(--c-surface-alt);
    }

    .preview-table tr:last-child td {
        border-bottom: none;
    }

    .prop-key {
        color: var(--c-text-secondary);
        width: 35%;
        word-break: break-all;
    }

    .prop-value {
        color: var(--c-text);
        word-break: break-all;
    }

    /* === Context menu === */
    .context-menu {
        position: fixed;
        z-index: 1000;
        background-color: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow-xs);
        padding: 0.25rem;
        min-width: 12rem;
        display: flex;
        flex-direction: column;
    }

    .context-menu-item {
        background: none;
        border: none;
        text-align: left;
        padding: 0.375rem 0.625rem;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        color: var(--c-text);
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition: background-color 80ms var(--ease);
    }

    .context-menu-item:hover {
        background-color: var(--c-primary-soft);
        color: var(--c-primary-text);
    }
</style>

<script setup>
    import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
    import { Network } from '../js/network.ts';
    import { App }     from '../js/app.ts';

    const focusablePattern = /^\[(?:MovieClip|Button|TextField)\b/;

    const tree = ref(null);
    const treeLoading = ref(false);
    const selectedPath = ref(null);
    const selectedProps = ref([]);
    const selectedLoading = ref(false);
    const filterText = ref('');
    const treeListRef = ref(null);
    const contextMenu = ref(null);

    // null when no HitTest is armed, else 'click' or 'element' to indicate
    // which mode the firmware is currently waiting on a click for.
    const hitTestMode = ref(null);
    const hitTestResult = ref(null);
    // null, 'path', or 'namePath' — tracks which row's Copy was just used so
    // we can flip just that button's label to "Copied".
    const copied = ref(null);

    const toggleHitTest = async (mode) => {
        if (hitTestMode.value === mode) {
            hitTestMode.value = null;
            await Network.send({ command: 'stopHitTest', params: {} });
        } else {
            const response = await Network.send({
                command: 'startHitTest',
                params: { elementMode: mode === 'element' },
            });
            if (response.success) {
                hitTestMode.value = mode;
                hitTestResult.value = null;
            }
        }
    };

    const copyHitTestPath = async (which) => {
        const value = which === 'namePath'
            ? hitTestResult.value?.namePath
            : hitTestResult.value?.path;
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            copied.value = which;
        } catch {
            copied.value = null;
        }
    };

    const extractKey = (str) => {
        const idx = str.indexOf(': ');
        return idx !== -1 ? str.substring(0, idx) : null;
    };

    const extractValue = (str) => {
        const idx = str.indexOf(': ');
        if (idx === -1) return '';
        const raw = str.substring(idx + 2);
        if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
        return raw;
    };

    const buildNode = (raw, expandedPaths, isRoot) => {
        const children = (raw.children || []).map(c => buildNode(c, expandedPaths, false));
        return {
            path: raw.path,
            key: isRoot ? 'Stage' : raw.name,
            typeLabel: isRoot ? 'Stage' : (raw.type || 'Object'),
            expanded: isRoot ? true : expandedPaths.has(raw.path),
            children,
        };
    };

    const collectExpandedPaths = (node, out) => {
        if (!node) return;
        if (node.expanded) out.add(node.path);
        for (const child of node.children) collectExpandedPaths(child, out);
    };

    const findNodeByPath = (node, path) => {
        if (!node) return null;
        if (node.path === path) return node;
        for (const child of node.children) {
            const found = findNodeByPath(child, path);
            if (found) return found;
        }
        return null;
    };

    const loadTree = async () => {
        treeLoading.value = true;
        try {
            const expandedPaths = new Set();
            if (tree.value) collectExpandedPaths(tree.value, expandedPaths);
            const reply = await Network.send({ command: 'dumpDisplayTree', params: {} });
            if (!reply.success || !reply.params?.tree) return;
            tree.value = buildNode(reply.params.tree, expandedPaths, true);
        } finally {
            treeLoading.value = false;
        }
    };

    const toggleNode = (node) => {
        if (node.children.length === 0) return;
        node.expanded = !node.expanded;
    };

    const selectNode = async (node) => {
        selectedPath.value = node.path;
        selectedLoading.value = true;
        if (App.flashConnected) {
            Network.send({ command: 'focusElement', params: { path: node.path } });
        }
        try {
            const reply = await Network.send({ command: 'evaluate', params: { input: node.path } });
            if (!reply.success || !reply.params?.result?.output) {
                selectedProps.value = [];
                return;
            }
            const props = [];
            for (const row of reply.params.result.output) {
                const str = String(row.value);
                const key = extractKey(str);
                if (key === null) continue;
                const valuePart = str.substring(str.indexOf(': ') + 2);
                if (focusablePattern.test(valuePart)) continue;
                props.push({ key, value: extractValue(str) });
            }
            selectedProps.value = props;
        } finally {
            selectedLoading.value = false;
        }
    };

    const refresh = async () => {
        await loadTree();
        if (selectedPath.value !== null) {
            const stillPresent = findNodeByPath(tree.value, selectedPath.value);
            if (stillPresent) {
                await selectNode(stillPresent);
            } else {
                selectedPath.value = null;
                selectedProps.value = [];
            }
        }
    };

    // Walk from `root` to find `targetPath`, marking every ancestor on
    // the way as expanded. Used by HitTest to surface the picked element
    // even when it lives inside collapsed parents.
    const expandAncestors = (root, targetPath) => {
        if (!root) return false;
        if (root.path === targetPath) return true;
        for (const child of root.children) {
            if (expandAncestors(child, targetPath)) {
                root.expanded = true;
                return true;
            }
        }
        return false;
    };

    const selectByPath = async (path) => {
        if (!path || !tree.value) return;
        let node = findNodeByPath(tree.value, path);
        if (!node) {
            // Tree may be a stale snapshot from before the node existed.
            await loadTree();
            node = findNodeByPath(tree.value, path);
            if (!node) return;
        }
        // Filtered view can hide ancestors; clear so the row is reachable.
        filterText.value = '';
        expandAncestors(tree.value, path);
        selectNode(node);
        await nextTick();
        if (treeListRef.value) {
            const el = treeListRef.value.querySelector(`[data-path="${CSS.escape(path)}"]`);
            if (el) el.scrollIntoView({ block: 'nearest' });
        }
    };

    Network.addEventListener('hitTestResult', (data) => {
        hitTestMode.value = null;
        copied.value = null;
        hitTestResult.value = data;
        // Tree paths are name-based, so prefer namePath when present.
        // Falling back to path covers the common case where there were
        // no auto-named ancestors (path is itself name-based).
        const treePath = data?.namePath || data?.path;
        if (treePath) selectByPath(treePath);
    });

    const focusSelected = async () => {
        if (selectedPath.value === null) return;
        await Network.send({ command: 'focusElement', params: { path: selectedPath.value } });
    };

    const nodeMatches = (node, needle) => {
        const hay = (node.key + ' [' + node.typeLabel + ']').toLowerCase();
        return hay.includes(needle);
    };

    const makeEllipsisEntry = (parentPath) => ({
        node: { placeholder: true, path: parentPath + '/__ellipsis' },
        visibleChildren: [],
    });

    const pruneToMatches = (node, needle) => {
        if (nodeMatches(node, needle)) {
            const visibleChildren = [];
            if (node.children.length > 0) visibleChildren.push(makeEllipsisEntry(node.path));
            return { node, visibleChildren };
        }
        const kept = [];
        for (const child of node.children) {
            const sub = pruneToMatches(child, needle);
            if (sub !== null) kept.push(sub);
        }
        if (kept.length === 0) return null;
        if (kept.length < node.children.length) kept.push(makeEllipsisEntry(node.path));
        return { node, visibleChildren: kept };
    };

    const countNodes = (node) => {
        let total = 1;
        for (const child of node.children) total += countNodes(child);
        return total;
    };

    const totalNodeCount = computed(() => {
        return tree.value ? countNodes(tree.value) : 0;
    });

    const flatRows = computed(() => {
        const rows = [];
        const needle = filterText.value.trim().toLowerCase();

        if (needle) {
            const pruned = tree.value ? pruneToMatches(tree.value, needle) : null;
            const walk = (entry, depth) => {
                rows.push({ node: entry.node, depth });
                for (const child of entry.visibleChildren) walk(child, depth + 1);
            };
            if (pruned) walk(pruned, 0);
        } else {
            const walk = (node, depth) => {
                rows.push({ node, depth });
                if (node.expanded) {
                    for (const child of node.children) walk(child, depth + 1);
                }
            };
            if (tree.value) walk(tree.value, 0);
        }
        return rows;
    });

    const init = async () => {
        await loadTree();
        if (tree.value) await selectNode(tree.value);
    };

    const openContextMenu = (node, event) => {
        event.preventDefault();
        contextMenu.value = { x: event.clientX, y: event.clientY, node };
    };

    const buildAsciiTree = (node, depth) => {
        const indent = '    '.repeat(depth);
        let out = indent + '[' + node.typeLabel + '] ' + node.key + '\n';
        for (const child of node.children) out += buildAsciiTree(child, depth + 1);
        return out;
    };

    const copyStructure = async () => {
        if (!contextMenu.value) return;
        const node = contextMenu.value.node;
        const text = buildAsciiTree(node, 0);
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Failed to copy structure:', err);
        }
        contextMenu.value = null;
    };

    const onDocumentMouseDown = () => {
        if (contextMenu.value) contextMenu.value = null;
    };

    const onDocumentKeyDown = (e) => {
        if (e.key === 'Escape' && contextMenu.value) contextMenu.value = null;
    };

    onMounted(() => {
        document.addEventListener('mousedown', onDocumentMouseDown);
        document.addEventListener('keydown', onDocumentKeyDown);
    });

    onBeforeUnmount(() => {
        document.removeEventListener('mousedown', onDocumentMouseDown);
        document.removeEventListener('keydown', onDocumentKeyDown);
    });

    watch(filterText, async () => {
        await nextTick();
        if (!selectedPath.value || !treeListRef.value) return;
        const el = treeListRef.value.querySelector(`[data-path="${CSS.escape(selectedPath.value)}"]`);
        if (el) el.scrollIntoView({ block: 'nearest' });
    });

    App.initialize().then(() => {
        App.ready = true;
        init();
    });
</script>
