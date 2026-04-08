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
                    <button :disabled="!previousResults" @click="compare(); dropdownOpen = false">Compare</button>
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
            class="filter-input"
            v-model="filterText"
            placeholder="Filter results..."
            spellcheck="false"
            v-if="memoryResult.length > 0 || isCompareMode"
        />
    </div>
</template>

<style>
    .container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        padding: 1rem;
        box-sizing: border-box;
    }

    /* === Input Area === */
    /* Updated to use flexbox for alignment */
    .input-wrapper {
        flex-shrink: 0;
        display: flex;
        gap: 0.75rem; /* Adds space between the textarea and button */
        margin-bottom: 1rem;
    }

    .memory-input {
        flex-grow: 1; /* Allows the textarea to fill the available space */
        background-color: #ffffff;
        color: #111827;
        border: 1px solid #d1d5db;
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
        font-family: "Fira Code", monospace;
        font-size: 0.9rem;
        resize: vertical;
        min-height: 60px;
        box-sizing: border-box;
        transition: border-color 200ms, box-shadow 200ms;
    }

    .memory-input:focus {
        outline: none;
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
    }

    /* === Split Button === */
    .split-button {
        position: relative;
        display: flex;
        height: 60px;
        flex-shrink: 0;
    }

    .split-main {
        background-color: #4f46e5;
        color: #ffffff;
        font-weight: 500;
        font-size: 0.9rem;
        border: none;
        border-radius: 0.5rem 0 0 0.5rem;
        padding: 0.75rem 1.25rem;
        cursor: pointer;
        transition: background-color 200ms;
    }

    .split-main:hover {
        background-color: #4338ca;
    }

    .split-toggle {
        background-color: #4f46e5;
        color: #ffffff;
        font-size: 0.75rem;
        border: none;
        border-left: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 0 0.5rem 0.5rem 0;
        padding: 0 0.6rem;
        cursor: pointer;
        transition: background-color 200ms;
    }

    .split-toggle:hover {
        background-color: #4338ca;
    }

    .split-dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 0.25rem;
        background-color: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 0.375rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        z-index: 10;
        min-width: 100%;
    }

    .split-dropdown button {
        display: block;
        width: 100%;
        background: none;
        border: none;
        padding: 0.5rem 1rem;
        font-size: 0.85rem;
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
        color: #374151;
    }

    .split-dropdown button:hover:not(:disabled) {
        background-color: #f3f4f6;
    }

    .split-dropdown button:disabled {
        color: #9ca3af;
        cursor: not-allowed;
    }

    .row-added td { color: #16a34a; }
    .row-removed td { color: #dc2626; }

    .status-icon {
        text-align: right;
        width: 2rem;
        font-size: 1.4rem;
        font-weight: 700;
    }


    /* === Filter Input === */
    .filter-input {
        flex-shrink: 0;
        background-color: #ffffff;
        color: #111827;
        border: 1px solid #d1d5db;
        border-radius: 0.5rem;
        padding: 0.5rem 1rem;
        font-family: "Fira Code", monospace;
        font-size: 0.8rem;
        margin-top: 0.75rem;
        box-sizing: border-box;
        transition: border-color 200ms, box-shadow 200ms;
    }

    .filter-input:focus {
        outline: none;
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
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
        background-color: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 0.5rem;
    }

    .results-table {
        width: 100%;
        border-collapse: collapse;
    }

    .results-table th, .results-table td {
        padding: 0.75rem 1rem;
        text-align: left;
        border-bottom: 1px solid #e5e7eb;
    }

    .results-table td {
        user-select: text;
    }

    .results-table thead {
        background-color: #f9fafb;
        color: #6b7280;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        position: sticky;
        top: 0;
    }

    .results-table tbody tr:last-child th,
    .results-table tbody tr:last-child td {
        border-bottom: none;
    }

    .results-table tbody tr:nth-child(even) {
        background-color: #f9fafb;
    }

    .results-table tbody tr:hover {
        background-color: #eef2ff;
        color: #4338ca;
    }

    .results-table tbody tr.row-added:hover td { color: #16a34a; }
    .results-table tbody tr.row-removed:hover td { color: #dc2626; }

    .no-results {
        text-align: center;
        padding: 3rem;
        color: #6b7280;
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

