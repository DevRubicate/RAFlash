<template>
    <div class="container" v-if="App.ready">
        
        <div class="input-wrapper">
            <textarea
                id="memory-input-field"
                class="memory-input"
                v-model="memoryInput"
                placeholder="Example: .player.health"

            ></textarea>
            <div class="split-button">
                <button class="split-main" @click="evaluate()">Evaluate</button>
                <button class="split-toggle" @click="dropdownOpen = !dropdownOpen">&#9662;</button>
                <div class="split-dropdown" v-if="dropdownOpen">
                    <button :disabled="!previousResults" @click="compare(); dropdownOpen = false">Changed</button>
                    <button :disabled="!previousResults" @click="remains(); dropdownOpen = false">Remains</button>
                    <button :disabled="!previousResults" @click="leaves(); dropdownOpen = false">Leaves</button>
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
                            <tr v-for="(res, index) in filteredResults">
                                <td>{{ res.value }}</td>
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
    </div>
</template>

<style>
    .container {
        padding: 0.75rem;
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
        background-color: #6366f1;
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
        background-color: var(--c-primary);
    }

    .split-toggle {
        background-color: #6366f1;
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
        background-color: var(--c-primary);
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

    .no-results {
        text-align: center;
        padding: 2.5rem 1.5rem;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }
</style>

<script setup>
    import { ref, computed, onMounted, onUnmounted } from 'vue';
    import { Network } from '../js/network.ts';
    import { App }          from '../js/app.ts';

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
        if (reply.success) return reply.params.result.output;
        return null;
    };

    const evaluate = async () => {
        memoryResultValid.value = false;
        filterText.value = '';
        isCompareMode.value = false;
        isRemainsMode.value = false;
        isLeavesMode.value = false;
        const results = await runDSL();
        if (results) {
            memoryResult.value = results;
            previousResults.value = results;
            memoryResultValid.value = true;
        }
    };

    const compare = async () => {
        filterText.value = '';
        const results = await runDSL();
        if (results) {
            compareResults.value = computeDiff(previousResults.value, results);
            previousResults.value = results;
            memoryResult.value = results;
            isCompareMode.value = true;
            memoryResultValid.value = true;
        }
    };

    const remains = async () => {
        filterText.value = '';
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
            previousResults.value = kept;
            memoryResult.value = results;
            isRemainsMode.value = true;
            isCompareMode.value = false;
            memoryResultValid.value = true;
        }
    };

    const leaves = async () => {
        filterText.value = '';
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
            previousResults.value = gone;
            memoryResult.value = results;
            isLeavesMode.value = true;
            isCompareMode.value = false;
            isRemainsMode.value = false;
            memoryResultValid.value = true;
        }
    };

    const closeDropdown = (e) => {
        if (!e.target.closest('.split-button')) dropdownOpen.value = false;
    };

    onMounted(() => {
        evaluate();
        document.addEventListener('click', closeDropdown);
    });

    onUnmounted(() => {
        document.removeEventListener('click', closeDropdown);
    });

    App.initialize().then(() => App.ready = true);
</script>

