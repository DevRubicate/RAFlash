<template>
    <div class="container" v-if="App.ready">

        <div class="input-wrapper">
            <input
                type="text"
                class="mono-input path-input"
                v-model="searchPath"
                placeholder="Starting path (such as stage.enemies)"
                spellcheck="false"
            />
        </div>
        <div class="search-mode">
            <label class="radio-label">
                <input type="radio" value="value" v-model="searchMode" />
                Value
            </label>
            <label class="radio-label">
                <input type="radio" value="name" v-model="searchMode" />
                Name
            </label>
        </div>
        <div class="input-wrapper">
            <input
                type="text"
                class="mono-input search-input"
                v-model="searchValue"
                :placeholder="searchMode === 'value' ? 'Search for a value (such as Mario or M*io)' : 'Search for a property name (such as health)'"
                spellcheck="false"
                @keyup.enter="search"
            />
            <button class="search-button" @click="search" :disabled="searching || (previousPaths !== null && previousPaths.size === 0)">
                {{ searching ? 'Searching...' : previousPaths === null ? 'Search (all)' : `Search (${previousPaths.size})` }}
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
        padding: 0.75rem;
    }

    .input-wrapper {
        flex-shrink: 0;
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.375rem;
    }

    .path-input { flex-grow: 1; }
    .search-input { flex-grow: 1; padding: 0.5rem 0.75rem; }

    .search-mode {
        display: flex;
        gap: 0.75rem;
        margin-bottom: 0.25rem;
    }

    .radio-label {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.8125rem;
        color: var(--c-text-secondary);
        cursor: pointer;
    }

    .search-button {
        background-color: #6366f1;
        color: #ffffff;
        font-family: var(--font-sans);
        font-weight: 550;
        font-size: 0.8125rem;
        border: none;
        border-radius: var(--radius-md);
        padding: 0 1.125rem;
        white-space: nowrap;
        cursor: pointer;
        transition: background-color var(--duration) var(--ease);
    }

    .search-button:hover:not(:disabled) {
        background-color: var(--c-primary);
    }

    .search-button:disabled {
        background-color: var(--c-text-muted);
        cursor: not-allowed;
    }

    .reset-button {
        background-color: var(--c-text-secondary);
        color: #ffffff;
        font-family: var(--font-sans);
        font-weight: 550;
        font-size: 0.8125rem;
        border: none;
        border-radius: var(--radius-md);
        padding: 0 0.875rem;
        cursor: pointer;
        transition: background-color var(--duration) var(--ease);
    }

    .reset-button:hover:not(:disabled) {
        background-color: #44403c;
    }

    .reset-button:disabled {
        background-color: var(--c-border);
        color: var(--c-text-muted);
        cursor: not-allowed;
    }

    .results-wrapper {
        flex-grow: 1;
        display: flex;
        min-height: 0;
        margin-top: 0.375rem;
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

    .no-results {
        text-align: center;
        padding: 2.5rem 1.5rem;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }

    .results-header {
        padding: 0.5rem 0.75rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--c-text-muted);
        border-bottom: 1px solid var(--c-border-subtle);
        background-color: var(--c-surface-alt);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .path-column { width: 70%; }

    .value-column {
        width: 30%;
        white-space: nowrap;
        text-align: right;
    }

    .cell-input {
        width: 100%;
        background: transparent;
        border: none;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        padding: 0;
        margin: 0;
        color: inherit;
        cursor: text;
    }

    .cell-input:focus {
        outline: none;
        background-color: rgba(79, 70, 229, 0.08);
        border-radius: 2px;
    }

    .path-cell { text-align: left; }

    .value-cell {
        text-align: right;
        color: var(--c-primary);
    }
</style>

<script setup>
    import { ref, onUnmounted } from 'vue';
    import { Network } from '../js/network.ts';
    import { App } from '../js/app.ts';

    const searchValue = ref('');
    const searchPath = ref('');
    const searchMode = ref('value');
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
            params: { value: searchValue.value, path: searchPath.value || '', searchMode: searchMode.value }
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
