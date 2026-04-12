<template>
    <div class="container" v-if="App.ready">
        <div class="toolbar">
            <input
                type="text"
                class="filter-input"
                v-model="filterText"
                placeholder="Filter logs..."
                spellcheck="false"
            />
            <span class="entry-count">{{ filteredEntries.length }}</span>
            <button class="clear-button" @click="entries = []" :disabled="entries.length === 0">Clear</button>
        </div>

        <div class="log-wrapper">
            <div class="log-container" ref="logContainer">
                <div v-if="filteredEntries.length === 0" class="empty-state">
                    <p v-if="entries.length === 0">Listening for events...</p>
                    <p v-else>No matching entries.</p>
                </div>
                <table class="log-table" v-else>
                    <tbody>
                        <tr v-for="(entry, index) in filteredEntries" :key="index" :class="'level-' + entry.level">
                            <td class="time-col">{{ formatTime(entry.timestamp) }}</td>
                            <td class="source-col">[{{ entry.source }}]</td>
                            <td class="message-col">{{ entry.message }}</td>
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

    .toolbar {
        flex-shrink: 0;
        display: flex;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0.5rem;
    }

    .filter-input {
        flex: 1;
        background-color: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        padding: 0.4375rem 0.625rem;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        color: var(--c-text);
        transition: border-color var(--duration) var(--ease);
    }

    .filter-input:focus {
        outline: none;
        border-color: var(--c-primary);
    }

    .entry-count {
        font-family: var(--font-mono);
        font-size: 0.75rem;
        color: var(--c-text-muted);
        min-width: 2rem;
        text-align: right;
    }

    .clear-button {
        background-color: var(--c-surface);
        color: var(--c-text);
        border: 1px solid var(--c-border);
        font-family: var(--font-sans);
        font-weight: 550;
        font-size: 0.8125rem;
        border-radius: var(--radius-md);
        padding: 0.4375rem 0.75rem;
        cursor: pointer;
        transition: all var(--duration) var(--ease);
    }

    .clear-button:hover:not(:disabled) {
        background-color: var(--c-surface-alt);
        border-color: #d4d4d0;
    }

    .clear-button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .log-wrapper {
        flex: 1;
        display: flex;
        min-height: 0;
    }

    .log-container {
        flex: 1;
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
        padding: 0.25rem 0.5rem;
        font-family: var(--font-mono);
        font-size: 0.75rem;
        border-bottom: 1px solid var(--c-border-subtle);
        vertical-align: top;
        line-height: 1.5;
        user-select: text;
    }

    .log-table tbody tr:last-child td {
        border-bottom: none;
    }

    .time-col {
        width: 60px;
        color: var(--c-text-muted);
        white-space: nowrap;
    }

    .source-col {
        width: 90px;
        color: var(--c-text-muted);
        white-space: nowrap;
    }

    .message-col {
        color: var(--c-text);
        word-break: break-word;
    }

    .level-warn .message-col { color: var(--c-warning); }
    .level-error .message-col { color: var(--c-danger); }
    .level-error .source-col { color: var(--c-danger); }

    .empty-state {
        text-align: center;
        padding: 2.5rem 1.5rem;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }

    .empty-state p { margin: 0.25rem 0; }
</style>

<script setup>
    import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
    import { Network } from '../js/network.ts';
    import { App } from '../js/app.ts';

    const MAX_ENTRIES = 1000;

    const entries = ref([]);
    const filterText = ref('');
    const logContainer = ref(null);

    const filteredEntries = computed(() => {
        const q = filterText.value.toLowerCase().trim();
        if (!q) return entries.value;
        return entries.value.filter(e =>
            e.source.toLowerCase().includes(q) ||
            e.message.toLowerCase().includes(q)
        );
    });

    const formatTime = (timestamp) => {
        const d = new Date(timestamp);
        return d.toTimeString().slice(0, 8);
    };

    const handleLogEvent = async (params) => {
        entries.value.push({
            timestamp: params.timestamp || Date.now(),
            source: params.source || 'unknown',
            level: params.level || 'info',
            message: params.message || '',
        });

        if (entries.value.length > MAX_ENTRIES) {
            entries.value.splice(0, entries.value.length - MAX_ENTRIES);
        }

        await nextTick();
        if (logContainer.value) {
            logContainer.value.scrollTop = logContainer.value.scrollHeight;
        }
    };

    onMounted(() => {
        Network.addEventListener('logEvent', handleLogEvent);
    });

    onUnmounted(() => {
        Network.removeEventListener('logEvent', handleLogEvent);
    });

    App.initialize().then(() => App.ready = true);
</script>
