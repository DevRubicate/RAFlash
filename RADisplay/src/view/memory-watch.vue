<template>
    <div class="container" v-if="App.ready">
        <div class="input-wrapper">
            <input
                type="text"
                class="formula-input"
                v-model="formula"
                placeholder="Formula (e.g., stage.player.x)"
                spellcheck="false"
                :disabled="watching"
                @keyup.enter="toggleWatch"
            />
            <button class="watch-button" :class="{ active: watching }" @click="toggleWatch">
                {{ watching ? 'Stop' : 'Watch' }}
            </button>
            <button class="clear-button" @click="clearLog" :disabled="log.length === 0">
                Clear
            </button>
        </div>

        <div class="log-wrapper">
            <div class="log-container" ref="logContainer">
                <div v-if="log.length === 0" class="no-results">
                    <p>Enter a formula and click Watch to start logging values every frame.</p>
                </div>
                <table class="log-table" v-else>
                    <tbody>
                        <!-- Value mode -->
                        <template v-if="mode === 'value' || mode === 'unknown'">
                            <tr v-for="(entry, index) in log" :key="index">
                                <td class="value-column">{{ formatValue(entry.value) }}</td>
                            </tr>
                        </template>

                        <!-- Structure mode -->
                        <template v-else-if="mode === 'structure'">
                            <tr v-for="(entry, index) in log" :key="index"
                                :class="{ 'removed': seenKeys.get(entry.key)?.removed }">
                                <td class="key-column">{{ entry.key }}</td>
                            </tr>
                        </template>
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

    .formula-input {
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

    .formula-input:focus {
        outline: none;
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
    }

    .formula-input:disabled {
        background-color: #f3f4f6;
        color: #6b7280;
    }

    .watch-button {
        background-color: #4f46e5;
        color: #ffffff;
        font-weight: 500;
        font-size: 0.9rem;
        border: none;
        border-radius: 0.5rem;
        padding: 0.75rem 1.5rem;
        cursor: pointer;
        transition: background-color 200ms;
        min-width: 80px;
    }

    .watch-button:hover {
        background-color: #4338ca;
    }

    .watch-button.active {
        background-color: #dc2626;
    }

    .watch-button.active:hover {
        background-color: #b91c1c;
    }

    .clear-button {
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

    .clear-button:hover:not(:disabled) {
        background-color: #4b5563;
    }

    .clear-button:disabled {
        background-color: #d1d5db;
        color: #9ca3af;
        cursor: not-allowed;
    }

    .log-wrapper {
        flex-grow: 1;
        display: flex;
        min-height: 0;
    }

    .log-container {
        flex-grow: 1;
        overflow-y: auto;
        background-color: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 0.5rem;
    }

    .log-table {
        width: 100%;
        border-collapse: collapse;
    }

    .log-table td {
        padding: 0.5rem 1rem;
        text-align: left;
        border-bottom: 1px solid #e5e7eb;
        font-family: "Fira Code", monospace;
        font-size: 0.85rem;
    }

    .log-table tbody tr:last-child td {
        border-bottom: none;
    }

    .log-table tbody tr:nth-child(even) {
        background-color: #f9fafb;
    }

    .value-column {
        width: 100%;
        color: #111827;
    }

    .no-results {
        text-align: center;
        padding: 3rem;
        color: #6b7280;
    }

    .key-column {
        width: 100%;
        color: #111827;
    }

    .log-table tbody tr.removed td {
        text-decoration: line-through;
        color: #9ca3af;
    }
</style>

<script setup>
    import { ref, onMounted, onUnmounted, nextTick } from 'vue';
    import { Network } from '../js/network.ts';
    import { App } from '../js/app.ts';

    const formula = ref('');
    const watching = ref(false);
    const log = ref([]);
    const logContainer = ref(null);
    const watcherId = ref(null);
    const mode = ref('unknown'); // 'unknown' | 'value' | 'structure'
    const seenKeys = ref(new Map()); // Map<string, { removed: boolean }>

    const toggleWatch = async () => {
        if (watching.value) {
            await stopWatch();
        } else {
            await startWatch();
        }
    };

    const startWatch = async () => {
        if (!formula.value.trim()) return;

        // Reset state for new watch
        log.value = [];
        seenKeys.value.clear();
        mode.value = 'unknown';

        watcherId.value = crypto.randomUUID();

        const reply = await Network.send({
            command: 'startWatch',
            params: { watcherId: watcherId.value, formula: formula.value }
        });

        if (reply.success) {
            watching.value = true;
        }
    };

    const stopWatch = async () => {
        if (!watcherId.value) return;

        await Network.send({
            command: 'stopWatch',
            params: { watcherId: watcherId.value }
        });

        watching.value = false;
        watcherId.value = null;
    };

    const clearLog = () => {
        // Only clear the visual log, keep seenKeys intact so old entries
        // don't reappear as "new" - seenKeys acts as the shadow copy
        log.value = [];
        // Don't clear seenKeys - we still remember what we've seen
        // Don't reset mode - we know what type of data we're watching
    };

    const formatValue = (value) => {
        if (value === null || value === undefined) {
            return 'null';
        }
        if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        return String(value);
    };

    const handleWatchResults = async (params) => {
        if (params.watcherId !== watcherId.value) return;

        const logLengthBefore = log.value.length;

        if (params.type === 'structure') {
            // Structure mode: track keys
            mode.value = 'structure';
            const currentKeys = new Set(params.keys);

            // Mark removed keys (keys we've seen before that are no longer present)
            for (const [key, state] of seenKeys.value) {
                if (!currentKeys.has(key) && !state.removed) {
                    state.removed = true;
                }
            }

            // Add new keys
            for (const key of params.keys) {
                if (!seenKeys.value.has(key)) {
                    seenKeys.value.set(key, { removed: false });
                    log.value.push({ key });
                }
            }
        } else {
            // Value mode: add entry only if different from last value
            mode.value = 'value';
            for (const entry of params.results) {
                const formattedValue = formatValue(entry.value);
                const lastEntry = log.value[log.value.length - 1];

                // Only add if different from previous value
                if (!lastEntry || formatValue(lastEntry.value) !== formattedValue) {
                    log.value.push({ value: entry.value });
                }
            }
        }

        // Only auto-scroll if new entries were added
        if (log.value.length > logLengthBefore) {
            await nextTick();
            if (logContainer.value) {
                logContainer.value.scrollTop = logContainer.value.scrollHeight;
            }
        }
    };

    onMounted(() => {
        Network.addEventListener('watchResults', handleWatchResults);
    });

    onUnmounted(() => {
        Network.removeEventListener('watchResults', handleWatchResults);
        // Stop watching if window is closed while watching
        if (watching.value && watcherId.value) {
            Network.send({
                command: 'stopWatch',
                params: { watcherId: watcherId.value }
            });
        }
    });

    App.initialize().then(() => App.ready = true);
</script>
