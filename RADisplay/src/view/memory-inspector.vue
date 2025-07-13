<template>
    <div class="container" v-if="App.ready">
        
        <div class="input-wrapper">
            <textarea 
                id="memory-input-field"
                class="memory-input" 
                v-model="memoryInput" 
                placeholder="Example: .player.health"
                spellcheck="false"
            ></textarea>
            <button class="search-button" @click="evaluate()">Search</button>
        </div>

        <div class="results-wrapper">
            <div class="results-container">
                <div v-if="memoryResult.length === 0" class="no-results">
                    <p>No results found. Try a different expression.</p>
                </div>
                <table class="results-table" v-else>
                    <thead>
                        <tr>
                            <th>Result ({{ memoryResult.length }} found)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(res, index) in memoryResult">
                            <td>{{ res }}</td>
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

    /* ✨ New style for the search button */
    .search-button {
        background-color: #4f46e5; /* Primary blue for the main action */
        color: #ffffff;
        font-weight: 500;
        font-size: 0.9rem;
        border: none;
        border-radius: 0.5rem;
        padding: 0.75rem 1.5rem;
        cursor: pointer;
        transition: background-color 200ms;
        /* Set a height to match the input's initial height */
        height: 60px;
    }

    .search-button:hover {
        background-color: #4338ca; /* A darker blue for the hover state */
    }


    /* === Results Area === */
    /* (No changes needed in this section) */
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
</style>

<script setup>
    import { ref, onMounted } from 'vue';
    import { Network } from '../js/network.ts';
    import { App }          from '../js/app.ts';

    const memoryInput = ref('');
    const memoryResult = ref([]);
    const memoryResultValid = ref(false);

    const evaluate = async () => {
        memoryResultValid.value = false;
        const reply = await Network.send({ command: 'evaluate', params: { input: memoryInput.value } });
        
        if (reply.success) {
            memoryResult.value = reply.params.result.output;
            memoryResultValid.value = true;
        } else {
            memoryResultValid.value = false;
        }
    };

    onMounted(() => {
        evaluate();
    });

    App.initialize().then(() => App.ready = true);
</script>

