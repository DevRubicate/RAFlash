<template>
    <div class="container" v-if="App.ready">
        <div class="toolbar">
            <button class="tool-button" @click="reset" :disabled="sortedRows.length === 0">Reset</button>
        </div>

        <div class="table-wrapper">
            <div class="table-container">
                <div v-if="sortedRows.length === 0" class="empty-state">
                    <p>Waiting for benchmark data...</p>
                </div>
                <table class="bench-table" v-else>
                    <thead>
                        <tr>
                            <th class="kind-col">Kind</th>
                            <th class="num-col">Current</th>
                            <th class="num-col">Min</th>
                            <th class="num-col">Max</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in sortedRows" :key="row.kind" :class="{ 'row-total': row.kind === TOTAL_KIND }">
                            <td class="kind-col">{{ row.kind }}</td>
                            <td class="num-col" :class="msClass(row.current)">{{ fmt(row.current) }}</td>
                            <td class="num-col dim">{{ fmt(row.min) }}</td>
                            <td class="num-col dim">{{ fmt(row.max) }}</td>
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
        display: flex;
        flex-direction: column;
        height: 100vh;
        box-sizing: border-box;
    }

    .toolbar {
        flex-shrink: 0;
        display: flex;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0.5rem;
    }

    .tool-button {
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

    .tool-button:hover:not(:disabled) {
        background-color: var(--c-surface-alt);
        border-color: #d4d4d0;
    }

    .tool-button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .table-wrapper {
        flex: 1;
        display: flex;
        min-height: 0;
    }

    .table-container {
        flex: 1;
        overflow-y: auto;
        background-color: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-xs);
    }

    .bench-table {
        width: 100%;
        border-collapse: collapse;
    }

    .bench-table th {
        position: sticky;
        top: 0;
        background-color: var(--c-surface-alt);
        padding: 0.5rem 0.75rem;
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--c-text-muted);
        border-bottom: 1px solid var(--c-border);
        user-select: none;
    }

    .bench-table td {
        padding: 0.375rem 0.75rem;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        border-bottom: 1px solid var(--c-border-subtle);
        line-height: 1.5;
        user-select: text;
    }

    .bench-table tbody tr:last-child td {
        border-bottom: none;
    }

    .kind-col {
        text-align: left;
        color: var(--c-text);
    }

    .num-col {
        text-align: right;
        white-space: nowrap;
    }

    .dim {
        color: var(--c-text-muted);
    }

    .ms-ok { color: var(--c-text); }
    .ms-warn { color: var(--c-warning); }
    .ms-slow { color: var(--c-danger); }

    .row-total td { font-weight: 700; }
    .row-total { border-bottom: 2px solid var(--c-border); }

    .empty-state {
        text-align: center;
        padding: 2.5rem 1.5rem;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }

    .empty-state p { margin: 0.25rem 0; }
</style>

<script setup>
    import { reactive, computed, onMounted, onUnmounted } from 'vue';
    import { Network } from '../js/network.ts';
    import { App } from '../js/app.ts';

    const rows = reactive({});

    const TOTAL_KIND = 'Frame Total';

    const sortedRows = computed(() => {
        return Object.values(rows).sort((a, b) => {
            if (a.kind === TOTAL_KIND) return -1;
            if (b.kind === TOTAL_KIND) return 1;
            return a.kind.localeCompare(b.kind);
        });
    });

    const fmt = (v) => v != null ? v.toFixed(1) + ' ms' : '—';

    const msClass = (v) => {
        if (v >= 8) return 'ms-slow';
        if (v >= 4) return 'ms-warn';
        return 'ms-ok';
    };

    const reset = () => {
        for (const key in rows) {
            delete rows[key];
        }
    };

    const handleBenchmark = (data) => {
        const kind = data.kind;
        const ms = Number(data.ms);
        if (!kind) return;

        if (rows[kind]) {
            rows[kind].current = ms;
            if (ms < rows[kind].min) rows[kind].min = ms;
            if (ms > rows[kind].max) rows[kind].max = ms;
        } else {
            // Outer `rows` is already reactive; nested reactive() is redundant
            // and only adds proxy overhead (Vue auto-unwraps anyway).
            rows[kind] = { kind, current: ms, min: ms, max: ms };
        }
    };

    onMounted(() => {
        Network.addEventListener('benchmark', handleBenchmark);
    });

    onUnmounted(() => {
        Network.removeEventListener('benchmark', handleBenchmark);
    });

    App.initialize().then(() => App.ready = true);
</script>
