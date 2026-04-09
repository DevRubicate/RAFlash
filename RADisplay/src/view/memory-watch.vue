<template>
    <div class="container" v-if="App.ready">
        <div class="input-wrapper">
            <input
                type="text"
                class="mono-input formula-input"
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
        padding: 0.75rem;
    }

    .input-wrapper {
        flex-shrink: 0;
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .formula-input { flex-grow: 1; }

    .watch-button {
        background-color: var(--c-primary);
        color: #ffffff;
        font-family: var(--font-sans);
        font-weight: 550;
        font-size: 0.8125rem;
        border: none;
        border-radius: var(--radius-md);
        padding: 0 1.125rem;
        cursor: pointer;
        transition: background-color var(--duration) var(--ease);
        min-width: 72px;
    }

    .watch-button:hover {
        background-color: var(--c-primary-hover);
    }

    .watch-button.active {
        background-color: var(--c-danger);
    }

    .watch-button.active:hover {
        background-color: var(--c-danger-hover);
    }

    .clear-button {
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

    .clear-button:hover:not(:disabled) {
        background-color: #44403c;
    }

    .clear-button:disabled {
        background-color: var(--c-border);
        color: var(--c-text-muted);
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
        background-color: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-xs);
    }

    .log-table {
        width: 100%;
        border-collapse: collapse;
    }

    .log-table td {
        padding: 0.375rem 0.75rem;
        text-align: left;
        border-bottom: 1px solid var(--c-border-subtle);
        font-family: var(--font-mono);
        font-size: 0.8125rem;
    }

    .log-table tbody tr:last-child td {
        border-bottom: none;
    }

    .log-table tbody tr:nth-child(even) {
        background-color: var(--c-surface-alt);
    }

    .value-column { width: 100%; color: var(--c-text); }
    .key-column { width: 100%; color: var(--c-text); }

    .no-results {
        text-align: center;
        padding: 2.5rem 1.5rem;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }

    .log-table tbody tr.removed td {
        text-decoration: line-through;
        color: var(--c-text-muted);
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
