<template>
    <div class="container" v-if="App.ready">

        <div v-if="!App.flashConnected" class="flash-disconnected-banner">
            Flash Player is not running &mdash; live evaluation is disabled. Last results stay visible.
        </div>

        <div class="history-bar">
            <button class="history-btn" :disabled="historyIndex <= 0" @click="historyBack()">&lt;</button>
            <button class="history-btn" :disabled="historyIndex >= history.length - 1" @click="historyForward()">&gt;</button>
        </div>

        <div class="input-wrapper">
            <textarea
                id="memory-input-field"
                class="memory-input"
                v-model="memoryInput"
                placeholder="Example: .player.health"

            ></textarea>
            <div class="split-button">
                <button class="split-main" :disabled="!App.flashConnected" @click="evaluate()">Evaluate</button>
                <button class="split-toggle" :disabled="!App.flashConnected" @click="dropdownOpen = !dropdownOpen">&#9662;</button>
                <div class="split-dropdown" v-if="dropdownOpen">
                    <button :disabled="!previousResults || !App.flashConnected" @click="compare(); dropdownOpen = false">Changed</button>
                    <button :disabled="!previousResults || !App.flashConnected" @click="remains(); dropdownOpen = false">Remains</button>
                    <button :disabled="!previousResults || !App.flashConnected" @click="leaves(); dropdownOpen = false">Leaves</button>
                </div>
            </div>
        </div>

        <div class="results-wrapper">
            <div class="results-container">
                <template v-if="isCompareMode">
                    <div v-if="filteredCompareResults.length === 0" class="no-results">
                        <p v-if="compareResults.length === 0">No changes detected.</p>
                        <p v-else>No matches for "{{ filterText }}"</p>
                    </div>
                    <table class="results-table" v-else>
                        <thead>
                            <tr>
                                <th>Changes ({{ addedCount }} added, {{ removedCount }} removed, {{ modifiedCount }} modified)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(res, index) in filteredCompareResults" :class="'row-' + res.status">
                                <td>{{ res.value }}</td>
                                <td class="status-icon">{{ res.status === 'added' ? '+' : res.status === 'removed' ? '−' : '' }}</td>
                            </tr>
                        </tbody>
                    </table>
                </template>
                <template v-else-if="isRemainsMode">
                    <div v-if="remainsResults.length === 0" class="no-results">
                        <p>No remaining results.</p>
                    </div>
                    <table class="results-table" v-else>
                        <thead>
                            <tr>
                                <th>Remains ({{ remainsResults.length }} rows, {{ remainsChangedCount }} changed)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(res, index) in filteredRemainsResults" :class="'row-' + res.status">
                                <td>{{ res.value }}</td>
                                <td class="status-icon">{{ res.status === 'changed' ? '+' : '' }}</td>
                            </tr>
                        </tbody>
                    </table>
                </template>
                <template v-else-if="isLeavesMode">
                    <div v-if="leavesResults.length === 0" class="no-results">
                        <p>Nothing left. All keys still present.</p>
                    </div>
                    <table class="results-table" v-else>
                        <thead>
                            <tr>
                                <th>Leaves ({{ leavesResults.length }} rows gone)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(res, index) in filteredLeavesResults">
                                <td>{{ res.value }}</td>
                            </tr>
                        </tbody>
                    </table>
                </template>
                <template v-else>
                    <div v-if="memoryResult.length === 0" class="no-results">
                        <p>No results found. Try a different expression.</p>
                    </div>
                    <div v-else-if="filteredResults.length === 0" class="no-results">
                        <p>No matches for "{{ filterText }}"</p>
                    </div>
                    <table class="results-table" v-else>
                        <thead>
                            <tr>
                                <th v-if="filterText">Result ({{ filteredResults.length }} of {{ memoryResult.length }})</th>
                                <th v-else>Result ({{ memoryResult.length }} found)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(res, index) in filteredResults"
                                :class="{ expandable: isExpandable(res.value) }"
                                @dblclick="drillInto(res.value)">
                                <td>
                                    {{ res.value }}
                                    <button v-if="isEditable(res.value) && App.flashConnected" class="edit-btn" @click.stop="openEdit(res.value)" title="Edit value">&#9998;</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </template>
            </div>
        </div>

        <input
            class="mono-input filter-input"
            v-model="filterText"
            placeholder="Filter results..."
            spellcheck="false"
            v-if="memoryResult.length > 0 || isCompareMode || isRemainsMode || isLeavesMode"
        />

        <!-- Edit value popup -->
        <div v-if="editState" class="edit-overlay" @click.self="editState = null">
            <div class="edit-popup">
                <div class="edit-label">{{ editState.key }}</div>
                <input
                    class="edit-input"
                    v-model="editValue"
                    @keydown.enter="submitEdit"
                    @keydown.escape="editState = null"
                    ref="editInputRef"
                    spellcheck="false"
                />
                <div class="edit-actions">
                    <button class="edit-save" @click="submitEdit">Save</button>
                    <button class="edit-cancel" @click="editState = null">Cancel</button>
                </div>
            </div>
        </div>
    </div>
</template>

<style>
    .container {
        padding: 0.75rem;
    }

    .flash-disconnected-banner {
        flex-shrink: 0;
        margin-bottom: 0.5rem;
        padding: 0.4375rem 0.625rem;
        background-color: var(--c-surface-alt);
        border: 1px solid var(--c-border);
        border-left: 3px solid var(--c-text-muted);
        border-radius: var(--radius-sm);
        color: var(--c-text-muted);
        font-family: var(--font-sans);
        font-size: 0.75rem;
    }

    /* === History Navigation === */
    .history-bar {
        display: flex;
        gap: 2px;
        margin-bottom: 0.375rem;
    }

    .history-btn {
        background-color: var(--c-surface);
        color: var(--c-text-secondary);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        padding: 0.125rem 0.5rem;
        font-family: var(--font-mono);
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all var(--duration) var(--ease);
    }

    .history-btn:hover:not(:disabled) {
        background-color: var(--c-surface-alt);
        border-color: #d4d4d0;
    }

    .history-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
    }

    /* === Input Area === */
    .input-wrapper {
        flex-shrink: 0;
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.625rem;
    }

    .memory-input {
        flex-grow: 1;
        background-color: var(--c-surface);
        color: var(--c-text);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        padding: 0.5rem 0.75rem;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        resize: vertical;
        min-height: 56px;
        transition: border-color var(--duration) var(--ease), box-shadow var(--duration) var(--ease);
    }

    .memory-input:focus {
        outline: none;
        border-color: var(--c-primary);
        box-shadow: var(--shadow-ring);
    }

    /* === Split Button === */
    .split-button {
        position: relative;
        display: flex;
        height: 56px;
        flex-shrink: 0;
    }

    .split-main {
        background-color: var(--c-primary);
        color: #ffffff;
        font-weight: 550;
        font-size: 0.8125rem;
        font-family: var(--font-sans);
        border: none;
        border-radius: var(--radius-md) 0 0 var(--radius-md);
        padding: 0 1rem;
        cursor: pointer;
        transition: background-color var(--duration) var(--ease);
    }

    .split-main:hover {
        background-color: var(--c-primary-hover);
    }

    .split-toggle {
        background-color: var(--c-primary);
        color: #ffffff;
        font-size: 0.6875rem;
        border: none;
        border-left: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 0 var(--radius-md) var(--radius-md) 0;
        padding: 0 0.5rem;
        cursor: pointer;
        transition: background-color var(--duration) var(--ease);
    }

    .split-toggle:hover {
        background-color: var(--c-primary-hover);
    }

    .split-dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        background-color: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-md);
        z-index: 10;
        min-width: 100%;
        overflow: hidden;
    }

    .split-dropdown button {
        display: block;
        width: 100%;
        background: none;
        border: none;
        padding: 0.4375rem 0.75rem;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
        color: var(--c-text);
    }

    .split-dropdown button:hover:not(:disabled) {
        background-color: var(--c-primary-soft);
    }

    .split-dropdown button:disabled {
        color: var(--c-text-muted);
        cursor: not-allowed;
    }

    /* === Compare/Remains Rows === */
    .row-added td { color: var(--c-success); }
    .row-removed td { color: var(--c-danger); }
    .row-changed td { color: var(--c-success); }

    .status-icon {
        text-align: right;
        width: 1.75rem;
        font-size: 1.25rem;
        font-weight: 700;
    }

    /* === Filter Input === */
    .filter-input {
        flex-shrink: 0;
        margin-top: 0.5rem;
    }

    /* === Results Area === */
    .results-wrapper {
        flex-grow: 1;
        display: flex;
        min-height: 0;
    }

    .results-container {
        flex-grow: 1;
        overflow-y: auto;
        background-color: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-xs);
    }

    .results-table {
        width: 100%;
        border-collapse: collapse;
    }

    .results-table th, .results-table td {
        padding: 0.4375rem 0.75rem;
        text-align: left;
        border-bottom: 1px solid var(--c-border-subtle);
    }

    .results-table td {
        user-select: text;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
    }

    .results-table thead {
        background-color: var(--c-surface-alt);
        color: var(--c-text-muted);
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        position: sticky;
        top: 0;
    }

    .results-table tbody tr:last-child td {
        border-bottom: none;
    }

    .results-table tbody tr:nth-child(even) {
        background-color: var(--c-surface-alt);
    }

    .results-table tbody tr:hover {
        background-color: var(--c-primary-soft);
    }

    .results-table tbody tr.row-added:hover td { color: var(--c-success); }
    .results-table tbody tr.row-removed:hover td { color: var(--c-danger); }

    .results-table tbody tr.expandable {
        cursor: pointer;
    }

    .results-table tbody tr.expandable td {
        color: var(--c-primary-hover);
    }

    .results-table tbody tr.expandable:hover td {
        color: var(--c-primary);
    }

    .no-results {
        text-align: center;
        padding: 2.5rem 1.5rem;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }

    /* === Edit Button === */
    .edit-btn {
        float: right;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 0.8125rem;
        color: var(--c-text-muted);
        padding: 0 0.25rem;
        opacity: 0;
        transition: opacity var(--duration) var(--ease);
    }

    tr:hover .edit-btn { opacity: 1; }
    .edit-btn:hover { color: var(--c-primary); }

    /* === Edit Popup === */
    .edit-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
    }

    .edit-popup {
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-md);
        padding: 1rem;
        min-width: 280px;
        max-width: 400px;
    }

    .edit-label {
        font-family: var(--font-mono);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--c-text-muted);
        margin-bottom: 0.5rem;
    }

    .edit-input {
        width: 100%;
        background: var(--c-surface-alt);
        color: var(--c-text);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        padding: 0.5rem 0.75rem;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        box-sizing: border-box;
    }

    .edit-input:focus {
        outline: none;
        border-color: var(--c-primary);
        box-shadow: var(--shadow-ring);
    }

    .edit-actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.75rem;
        justify-content: flex-end;
    }

    .edit-save, .edit-cancel {
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        font-weight: 550;
        padding: 0.375rem 0.75rem;
        border-radius: var(--radius-md);
        cursor: pointer;
        border: none;
    }

    .edit-save {
        background: var(--c-primary);
        color: #fff;
    }

    .edit-save:hover { background: var(--c-primary-hover); }

    .edit-cancel {
        background: var(--c-surface-alt);
        color: var(--c-text);
        border: 1px solid var(--c-border);
    }

    .edit-cancel:hover { background: var(--c-surface); }
</style>

<script setup>
    import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
    import { Network } from '../js/network.ts';
    import { App }          from '../js/app.ts';

    const editState = ref(null);  // { key, fullPath } or null
    const editValue = ref('');
    const editInputRef = ref(null);

    const memoryInput = ref('');
    const memoryResult = ref([]);
    const memoryResultValid = ref(false);
    const filterText = ref('');
    const previousResults = ref(null);
    const isCompareMode = ref(false);
    const compareResults = ref([]);
    const isRemainsMode = ref(false);
    const remainsResults = ref([]);
    const isLeavesMode = ref(false);
    const leavesResults = ref([]);
    const dropdownOpen = ref(false);

    // History stack for undo/redo navigation
    const MAX_HISTORY = 50;
    const history = ref([]);
    const historyIndex = ref(-1);
    let restoringHistory = false;

    const pushHistory = () => {
        // Skip if current state is identical to the latest history entry
        if (historyIndex.value >= 0) {
            const last = history.value[historyIndex.value];
            if (last.input === memoryInput.value &&
                last.isCompareMode === isCompareMode.value &&
                last.isRemainsMode === isRemainsMode.value &&
                last.isLeavesMode === isLeavesMode.value &&
                JSON.stringify(last.result) === JSON.stringify(memoryResult.value)) {
                return;
            }
        }

        // Truncate any forward history
        history.value = history.value.slice(0, historyIndex.value + 1);
        history.value.push({
            input: memoryInput.value,
            result: JSON.parse(JSON.stringify(memoryResult.value)),
            previousResults: previousResults.value ? JSON.parse(JSON.stringify(previousResults.value)) : null,
            isCompareMode: isCompareMode.value,
            compareResults: JSON.parse(JSON.stringify(compareResults.value)),
            isRemainsMode: isRemainsMode.value,
            remainsResults: JSON.parse(JSON.stringify(remainsResults.value)),
            isLeavesMode: isLeavesMode.value,
            leavesResults: JSON.parse(JSON.stringify(leavesResults.value)),
            filterText: filterText.value,
        });
        // Prune oldest entries if history exceeds limit
        if (history.value.length > MAX_HISTORY) {
            history.value.splice(0, history.value.length - MAX_HISTORY);
        }
        historyIndex.value = history.value.length - 1;
    };

    const restoreHistory = (entry) => {
        restoringHistory = true;
        memoryInput.value = entry.input;
        memoryResult.value = entry.result;
        previousResults.value = entry.previousResults;
        isCompareMode.value = entry.isCompareMode;
        compareResults.value = entry.compareResults;
        isRemainsMode.value = entry.isRemainsMode;
        remainsResults.value = entry.remainsResults;
        isLeavesMode.value = entry.isLeavesMode;
        leavesResults.value = entry.leavesResults;
        filterText.value = entry.filterText;
        memoryResultValid.value = true;
        restoringHistory = false;
    };

    const historyBack = () => {
        if (historyIndex.value <= 0) return;
        historyIndex.value--;
        restoreHistory(history.value[historyIndex.value]);
    };

    const historyForward = () => {
        if (historyIndex.value >= history.value.length - 1) return;
        historyIndex.value++;
        restoreHistory(history.value[historyIndex.value]);
    };

    const filteredResults = computed(() => {
        if (!filterText.value) return memoryResult.value;
        const needle = filterText.value.toLowerCase();
        return memoryResult.value.filter(res => String(res.value).toLowerCase().includes(needle));
    });

    const filteredCompareResults = computed(() => {
        if (!filterText.value) return compareResults.value;
        const needle = filterText.value.toLowerCase();
        return compareResults.value.filter(res => String(res.value).toLowerCase().includes(needle));
    });

    const addedCount = computed(() => compareResults.value.filter(r => r.status === 'added').length);
    const removedCount = computed(() => compareResults.value.filter(r => r.status === 'removed').length);
    const modifiedCount = computed(() => compareResults.value.filter(r => r.status === 'modified').length);

    const filteredRemainsResults = computed(() => {
        if (!filterText.value) return remainsResults.value;
        const needle = filterText.value.toLowerCase();
        return remainsResults.value.filter(res => String(res.value).toLowerCase().includes(needle));
    });

    const remainsChangedCount = computed(() => remainsResults.value.filter(r => r.status === 'changed').length);

    const filteredLeavesResults = computed(() => {
        if (!filterText.value) return leavesResults.value;
        const needle = filterText.value.toLowerCase();
        return leavesResults.value.filter(res => String(res.value).toLowerCase().includes(needle));
    });

    const extractKey = (str) => {
        const idx = str.indexOf(': ');
        return idx !== -1 ? str.substring(0, idx) : null;
    };

    const expandablePattern = /^\[\w+ \.\.\.\d+\]$/;

    const isExpandable = (rowValue) => {
        const str = String(rowValue);
        const key = extractKey(str);
        if (key === null) return false;
        const value = str.substring(str.indexOf(': ') + 2);
        return expandablePattern.test(value);
    };

    const drillInto = (rowValue) => {
        const str = String(rowValue);
        if (!isExpandable(str)) return;
        const key = extractKey(str);
        const currentInput = memoryInput.value.trim();
        // Numeric keys get array access syntax, others get dot access
        if (/^\d+$/.test(key)) {
            memoryInput.value = currentInput + '[' + key + ']';
        } else {
            memoryInput.value = currentInput + '.' + key;
        }
        evaluate();
    };

    const specialPattern = /^\[(?:Function|TextField|Date|MovieClip|Object|Array)\b/;

    const isEditable = (rowValue) => {
        const str = String(rowValue);
        const key = extractKey(str);
        if (key === null) return false;
        const value = str.substring(str.indexOf(': ') + 2);
        return !specialPattern.test(value);
    };

    const extractValue = (rowValue) => {
        const str = String(rowValue);
        const raw = str.substring(str.indexOf(': ') + 2);
        // Strip surrounding quotes for strings
        if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
        return raw;
    };

    const openEdit = async (rowValue) => {
        const str = String(rowValue);
        const key = extractKey(str);
        const currentInput = memoryInput.value.trim();
        const fullPath = /^\d+$/.test(key)
            ? currentInput + '[' + key + ']'
            : currentInput + '.' + key;
        editState.value = { key, fullPath };
        editValue.value = extractValue(str);
        await nextTick();
        if (editInputRef.value) {
            editInputRef.value.focus();
            editInputRef.value.select();
        }
    };

    const submitEdit = async () => {
        if (!editState.value) return;
        await Network.send({
            command: 'setValue',
            params: { path: editState.value.fullPath, value: editValue.value }
        });
        editState.value = null;
        evaluate();
    };

    const buildFrequencyMap = (results) => {
        const map = new Map();
        for (const res of results) {
            const key = String(res.value);
            map.set(key, (map.get(key) || 0) + 1);
        }
        return map;
    };

    const computeDiff = (prev, curr) => {
        const diff = [];

        // Index entries by extracted key (unique keys only)
        const indexByKey = (results) => {
            const map = new Map();
            const dupes = new Set();
            for (let i = 0; i < results.length; i++) {
                const key = extractKey(String(results[i].value));
                if (key === null) continue;
                if (map.has(key)) dupes.add(key);
                else map.set(key, i);
            }
            for (const k of dupes) map.delete(k);
            return map;
        };

        const prevKeyIndex = indexByKey(prev);
        const currKeyIndex = indexByKey(curr);
        const usedPrev = new Set();
        const usedCurr = new Set();

        // Match by key
        for (const [key, currIdx] of currKeyIndex) {
            if (prevKeyIndex.has(key)) {
                const prevIdx = prevKeyIndex.get(key);
                const prevVal = String(prev[prevIdx].value);
                const currVal = String(curr[currIdx].value);
                usedPrev.add(prevIdx);
                usedCurr.add(currIdx);
                if (prevVal !== currVal) {
                    diff.push({ value: currVal, status: 'modified' });
                }
            }
        }

        // Remaining entries: frequency-based diff
        const remainingPrev = prev.filter((_, i) => !usedPrev.has(i));
        const remainingCurr = curr.filter((_, i) => !usedCurr.has(i));
        const prevMap = buildFrequencyMap(remainingPrev);
        const currMap = buildFrequencyMap(remainingCurr);

        for (const [val, count] of currMap) {
            const prevCount = prevMap.get(val) || 0;
            for (let i = 0; i < count - prevCount; i++) {
                diff.push({ value: val, status: 'added' });
            }
        }

        for (const [val, count] of prevMap) {
            const currCount = currMap.get(val) || 0;
            for (let i = 0; i < count - currCount; i++) {
                diff.push({ value: val, status: 'removed' });
            }
        }

        return diff;
    };

    const runDSL = async () => {
        const reply = await Network.send({ command: 'evaluate', params: { input: memoryInput.value } });
        if (reply.success && reply.params?.result?.output) return reply.params.result.output;
        return null;
    };

    const evaluate = async () => {
        memoryResultValid.value = false;
        isCompareMode.value = false;
        isRemainsMode.value = false;
        isLeavesMode.value = false;
        const results = await runDSL();
        if (results) {
            memoryResult.value = results;
            previousResults.value = results;
            memoryResultValid.value = true;
            pushHistory();
        }
    };

    const compare = async () => {
        const results = await runDSL();
        if (results) {
            compareResults.value = computeDiff(previousResults.value, results);
            previousResults.value = results;
            memoryResult.value = results;
            isCompareMode.value = true;
            memoryResultValid.value = true;
            pushHistory();
        }
    };

    const remains = async () => {
        const results = await runDSL();
        if (results) {
            // Build map of previous results: key → full value string
            const prevMap = new Map();
            for (const res of previousResults.value) {
                const key = extractKey(String(res.value));
                if (key !== null) {
                    prevMap.set(key, String(res.value));
                }
            }

            // Keep only results whose key existed in previous results
            const kept = [];
            for (const res of results) {
                const key = extractKey(String(res.value));
                if (key === null) continue;
                if (!prevMap.has(key)) continue;

                const prevValue = prevMap.get(key);
                const currValue = String(res.value);
                kept.push({
                    value: currValue,
                    status: prevValue === currValue ? 'same' : 'changed'
                });
            }

            remainsResults.value = kept;
            previousResults.value = kept.map(entry => ({ value: entry.value }));
            memoryResult.value = results;
            isRemainsMode.value = true;
            isCompareMode.value = false;
            memoryResultValid.value = true;
            pushHistory();
        }
    };

    const leaves = async () => {
        const results = await runDSL();
        if (results) {
            // Build set of keys found in new results
            const newKeys = new Set();
            for (const res of results) {
                const key = extractKey(String(res.value));
                if (key !== null) newKeys.add(key);
            }

            // Keep previous results whose key is NOT in the new results
            const gone = [];
            for (const res of previousResults.value) {
                const key = extractKey(String(res.value));
                if (key === null) continue;
                if (!newKeys.has(key)) {
                    gone.push({ value: String(res.value) });
                }
            }

            leavesResults.value = gone;
            previousResults.value = gone.map(entry => ({ value: entry.value }));
            memoryResult.value = results;
            isLeavesMode.value = true;
            isCompareMode.value = false;
            isRemainsMode.value = false;
            memoryResultValid.value = true;
            pushHistory();
        }
    };

    const closeDropdown = (e) => {
        if (!e.target.closest('.split-button')) dropdownOpen.value = false;
    };

    onMounted(() => {
        document.addEventListener('click', closeDropdown);
    });

    onUnmounted(() => {
        document.removeEventListener('click', closeDropdown);
    });

    App.initialize().then(() => {
        App.ready = true;
        evaluate();
    });
</script>

