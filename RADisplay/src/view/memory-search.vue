<template>
    <div class="container" v-if="App.ready">

        <div class="input-wrapper">
            <input
                type="text"
                class="path-input"
                v-model="searchPath"
                placeholder="Starting path (such as stage.enemies)"
                spellcheck="false"
            />
        </div>
        <div class="input-wrapper">
            <input
                type="text"
                class="search-input"
                v-model="searchValue"
                placeholder="Search (such as Mario or M*io)"
                spellcheck="false"
                @keyup.enter="search"
            />
            <button class="search-button" @click="search" :disabled="searching">
                {{ searching ? 'Searching...' : 'Search' }}
            </button>
            <button class="reset-button" @click="reset" :disabled="searching || searchCount === 0">
                Reset
            </button>
        </div>

        <div class="results-wrapper">
            <div class="results-container">
                <div v-if="!searched" class="no-results">
                    <p>Enter a value to search for in game memory.</p>
                </div>
                <div v-else-if="searching" class="no-results">
                    <p>Searching...</p>
                </div>
                <div v-else-if="results.length === 0" class="no-results">
                    <p>No matches found.</p>
                </div>
                <div class="results-header" v-else>
                    <span v-if="searchCount > 1">Search #{{ searchCount }} - </span>
                    {{ results.length }} path(s) found
                </div>
                <table class="results-table" v-if="results.length > 0">
                    <tbody>
                        <tr v-for="(res, index) in results" :key="index" :data-index="index">
                            <td class="path-column">
                                <input type="text" readonly class="cell-input path-cell" :value="res.value.replace(/^&quot;|&quot;$/g, '')" />
                            </td>
                            <td class="value-column">
                                <input type="text" readonly class="cell-input value-cell" :value="rowValues[index] || '-'" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
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

    .input-wrapper {
        flex-shrink: 0;
        display: flex;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
    }

    .path-input {
        flex-grow: 1;
        background-color: #ffffff;
        color: #111827;
        border: 1px solid #d1d5db;
        border-radius: 0.5rem;
        padding: 0.5rem 1rem;
        font-family: "Fira Code", monospace;
        font-size: 0.85rem;
        box-sizing: border-box;
        transition: border-color 200ms, box-shadow 200ms;
    }

    .path-input:focus {
        outline: none;
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
    }

    .search-input {
        flex-grow: 1;
        background-color: #ffffff;
        color: #111827;
        border: 1px solid #d1d5db;
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
        font-family: "Fira Code", monospace;
        font-size: 0.9rem;
        box-sizing: border-box;
        transition: border-color 200ms, box-shadow 200ms;
    }

    .search-input:focus {
        outline: none;
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
    }

    .search-button {
        background-color: #4f46e5;
        color: #ffffff;
        font-weight: 500;
        font-size: 0.9rem;
        border: none;
        border-radius: 0.5rem;
        padding: 0.75rem 1.5rem;
        cursor: pointer;
        transition: background-color 200ms;
    }

    .search-button:hover:not(:disabled) {
        background-color: #4338ca;
    }

    .search-button:disabled {
        background-color: #9ca3af;
        cursor: not-allowed;
    }

    .reset-button {
        background-color: #6b7280;
        color: #ffffff;
        font-weight: 500;
        font-size: 0.9rem;
        border: none;
        border-radius: 0.5rem;
        padding: 0.75rem 1.25rem;
        cursor: pointer;
        transition: background-color 200ms;
    }

    .reset-button:hover:not(:disabled) {
        background-color: #4b5563;
    }

    .reset-button:disabled {
        background-color: #d1d5db;
        color: #9ca3af;
        cursor: not-allowed;
    }

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
        font-family: "Fira Code", monospace;
        font-size: 0.85rem;
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

    .no-results {
        text-align: center;
        padding: 3rem;
        color: #6b7280;
    }

    .results-header {
        padding: 0.75rem 1rem;
        font-size: 0.85rem;
        color: #6b7280;
        border-bottom: 1px solid #e5e7eb;
        background-color: #f9fafb;
    }

    .path-column {
        width: 70%;
    }

    .value-column {
        width: 30%;
        white-space: nowrap;
        text-align: right;
    }

    .cell-input {
        width: 100%;
        background: transparent;
        border: none;
        font-family: "Fira Code", monospace;
        font-size: 0.85rem;
        padding: 0;
        margin: 0;
        color: inherit;
        cursor: text;
        box-sizing: border-box;
    }

    .cell-input:focus {
        outline: none;
        background-color: rgba(79, 70, 229, 0.1);
    }

    .path-cell {
        text-align: left;
    }

    .value-cell {
        text-align: right;
        color: #4f46e5;
    }
</style>

<script setup>
    import { ref, onUnmounted } from 'vue';
    import { Network } from '../js/network.ts';
    import { App } from '../js/app.ts';

    const searchValue = ref('');
    const searchPath = ref('');
    const results = ref([]);
    const searching = ref(false);
    const searched = ref(false);
    const previousPaths = ref(null);  // null = first search, Set of paths after first search
    const searchCount = ref(0);

    // Live value preview
    const rowValues = ref({});
    let intervalId = null;

    const search = async () => {
        if (!searchValue.value.trim()) return;

        searching.value = true;
        searched.value = true;

        // Always do full search from firmware
        const reply = await Network.send({
            command: 'searchTargetForValue',
            params: { value: searchValue.value, path: searchPath.value || '' }
        });

        if (reply.success) {
            let newPaths = reply.params.result.output;

            if (previousPaths.value !== null) {
                // Filter to only paths that existed in previous results
                newPaths = newPaths.filter(r => previousPaths.value.has(r.value));
            }

            // Store current paths as Set for next search
            previousPaths.value = new Set(newPaths.map(r => r.value));
            results.value = newPaths;
            searchCount.value++;

            // Reset values and fetch immediately
            rowValues.value = {};
            fetchValues();
        } else {
            results.value = [];
        }

        searching.value = false;
    };

    const reset = () => {
        previousPaths.value = null;
        results.value = [];
        searchCount.value = 0;
        searched.value = false;
        rowValues.value = {};
    };

    // Fetch live values for all results (up to 100)
    const fetchValues = async () => {
        if (results.value.length === 0) return;

        // Limit to first 100 results to avoid overloading
        const maxResults = Math.min(results.value.length, 100);
        const pathsWithIndices = [];

        for (let i = 0; i < maxResults; i++) {
            const path = results.value[i]?.value?.replace(/^"|"$/g, '');
            if (path) {
                pathsWithIndices.push({ index: i, path });
            }
        }

        if (pathsWithIndices.length === 0) return;

        try {
            const reply = await Network.send({
                command: 'evaluateMultiple',
                params: { inputs: pathsWithIndices.map(item => item.path) }
            });

            if (reply.success && reply.params.results) {
                const newValues = { ...rowValues.value };
                for (let i = 0; i < pathsWithIndices.length; i++) {
                    const { index } = pathsWithIndices[i];
                    const result = reply.params.results[i];
                    if (result?.output?.length > 0) {
                        newValues[index] = result.output[0].value;
                    } else {
                        newValues[index] = '(no value)';
                    }
                }
                rowValues.value = newValues;
            }
        } catch {
            // Silently ignore errors
        }
    };

    // Cleanup
    onUnmounted(() => {
        if (intervalId) clearInterval(intervalId);
    });

    App.initialize().then(() => {
        App.ready = true;
        // Start polling for live values
        intervalId = setInterval(fetchValues, 1000);
    });
</script>
