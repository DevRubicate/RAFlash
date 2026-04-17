<template>
    <div class="container" v-if="App.ready">
        <div class="header">
            <div class="title">Tests</div>
            <div class="hash" v-if="gameHash">{{ gameHash }}</div>
            <div class="hash-missing" v-else>No game loaded</div>
        </div>

        <div class="main-wrapper">
            <div class="list-wrapper">
                <div v-if="files.length === 0" class="empty-state">
                    <div>No <code>.ratest</code> files found for this game.</div>
                    <div class="hint" v-if="dir">Drop them in <code>{{ dir }}</code></div>
                </div>
                <ul v-else class="file-list">
                    <li
                        v-for="file in files"
                        :key="file"
                        :class="{ selected: file === selected }"
                        @click="selected = file"
                    >
                        {{ file }}
                    </li>
                </ul>
            </div>

            <div class="log-wrapper" v-if="steps.length > 0">
                <div class="log-header">Steps</div>
                <ul class="step-log" ref="stepLogEl">
                    <li
                        v-for="step in steps"
                        :key="step.index"
                        :class="'phase-' + step.phase"
                    >
                        <span class="step-num">{{ step.index + 1 }}/{{ step.total }}</span>
                        <span class="step-icon">{{ phaseIcon(step.phase) }}</span>
                        <span class="step-source">{{ step.source }}</span>
                        <span class="step-ms" v-if="step.durationMs != null">{{ step.durationMs }}ms</span>
                        <div class="step-error" v-if="step.error">{{ step.error }}</div>
                    </li>
                </ul>
            </div>
        </div>

        <div class="footer">
            <button
                class="play-button"
                :disabled="!canPlay"
                @click="play()"
            >
                <span v-if="running">Running...</span>
                <span v-else>Play</span>
            </button>
            <div class="status" :class="statusClass">{{ statusText }}</div>
        </div>
    </div>
</template>

<style>
    .container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        padding: 0.75rem;
        gap: 0.5rem;
        box-sizing: border-box;
    }

    .header {
        flex-shrink: 0;
        display: flex;
        align-items: baseline;
        gap: 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--c-border);
    }

    .title {
        font-weight: 600;
        font-size: 0.9375rem;
        color: var(--c-text);
    }

    .hash {
        font-family: var(--font-mono);
        font-size: 0.75rem;
        color: var(--c-text-muted);
    }

    .hash-missing {
        font-size: 0.75rem;
        color: var(--c-text-muted);
        font-style: italic;
    }

    .main-wrapper {
        flex: 1;
        min-height: 0;
        display: flex;
        gap: 0.5rem;
    }

    .list-wrapper {
        flex: 0 0 220px;
        overflow-y: auto;
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
    }

    .log-wrapper {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        overflow: hidden;
    }

    .log-header {
        padding: 0.4rem 0.625rem;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--c-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        border-bottom: 1px solid var(--c-border);
    }

    .step-log {
        list-style: none;
        margin: 0;
        padding: 0.25rem;
        overflow-y: auto;
        flex: 1;
    }

    .step-log li {
        padding: 0.3rem 0.5rem;
        font-family: var(--font-mono);
        font-size: 0.75rem;
        color: var(--c-text);
        border-radius: var(--radius-sm);
        display: grid;
        grid-template-columns: 3.5rem 1rem 1fr auto;
        gap: 0.4rem;
        align-items: baseline;
    }

    .step-log li.phase-start { color: var(--c-text-muted); }
    .step-log li.phase-pass { color: #86efac; }
    .step-log li.phase-ok { color: var(--c-text); }
    .step-log li.phase-fail { color: #fca5a5; background: rgba(239, 68, 68, 0.08); }

    .step-num {
        font-variant-numeric: tabular-nums;
        color: var(--c-text-muted);
    }

    .step-icon {
        text-align: center;
    }

    .step-source {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .step-ms {
        color: var(--c-text-muted);
        font-variant-numeric: tabular-nums;
    }

    .step-error {
        grid-column: 2 / -1;
        margin-top: 0.2rem;
        color: #fca5a5;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .empty-state {
        padding: 1.5rem;
        text-align: center;
        color: var(--c-text-muted);
        font-size: 0.8125rem;
    }

    .empty-state code {
        font-family: var(--font-mono);
        font-size: 0.75rem;
        color: var(--c-text);
    }

    .empty-state .hint {
        margin-top: 0.5rem;
        font-size: 0.75rem;
    }

    .file-list {
        list-style: none;
        margin: 0;
        padding: 0.25rem;
    }

    .file-list li {
        padding: 0.4375rem 0.625rem;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        color: var(--c-text);
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition: background var(--duration) var(--ease);
    }

    .file-list li:hover {
        background: rgba(255, 255, 255, 0.05);
    }

    .file-list li.selected {
        background: rgba(99, 102, 241, 0.25);
        color: #c7d2fe;
    }

    .footer {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding-top: 0.5rem;
        border-top: 1px solid var(--c-border);
    }

    .play-button {
        background: var(--c-primary);
        color: white;
        border: none;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        font-weight: 600;
        padding: 0.5rem 1.25rem;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: opacity var(--duration) var(--ease);
    }

    .play-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .play-button:not(:disabled):hover {
        opacity: 0.85;
    }

    .status {
        flex: 1;
        font-size: 0.8125rem;
        color: var(--c-text-muted);
    }

    .status.passed {
        color: #86efac;
    }

    .status.failed {
        color: #fca5a5;
    }
</style>

<script setup>
    import { ref, computed } from 'vue';
    import { Network }       from '../js/network.ts';
    import { App }           from '../js/app.ts';

    const files = ref([]);
    const selected = ref(null);
    const gameHash = ref(null);
    const dir = ref(null);
    const running = ref(false);
    const result = ref(null);
    const steps = ref([]);
    const stepLogEl = ref(null);

    const phaseIcon = (phase) => {
        if (phase === 'pass') return '✓';
        if (phase === 'fail') return '✗';
        if (phase === 'ok') return '·';
        return '…';
    };

    const scrollLogToBottom = () => {
        requestAnimationFrame(() => {
            if (stepLogEl.value) stepLogEl.value.scrollTop = stepLogEl.value.scrollHeight;
        });
    };

    Network.addEventListener('ratestStart', () => {
        steps.value = [];
    });

    Network.addEventListener('ratestStep', (data) => {
        const existing = steps.value.findIndex((s) => s.index === data.index);
        if (existing >= 0) {
            steps.value[existing] = { ...steps.value[existing], ...data };
        } else {
            steps.value.push({ ...data });
        }
        scrollLogToBottom();
    });

    const canPlay = computed(() =>
        !running.value && selected.value !== null && App.flashConnected,
    );

    const statusText = computed(() => {
        if (!App.flashConnected) return 'Flash Player is not running — reload the game to run tests.';
        if (running.value) return 'Playing... game will reset and actions will execute.';
        if (!result.value) return 'Select a test and press Play.';
        const { passed, failed, total, error } = result.value;
        if (failed === 0) return `Passed ${passed}/${total}`;
        return `Failed ${failed}/${total} — ${error ?? ''}`;
    });

    const statusClass = computed(() => {
        if (running.value || !App.flashConnected) return '';
        if (!result.value) return '';
        return result.value.failed === 0 ? 'passed' : 'failed';
    });

    const refreshList = async () => {
        const response = await Network.send({ command: 'listRatests', params: {} });
        if (response.success) {
            files.value = response.params.files ?? [];
            dir.value = response.params.dir ?? null;
            if (selected.value && !files.value.includes(selected.value)) selected.value = null;
        } else {
            files.value = [];
            dir.value = null;
        }
    };

    const play = async () => {
        if (!selected.value) return;
        running.value = true;
        result.value = null;
        steps.value = [];
        try {
            const response = await Network.send({
                command: 'playRatest',
                params: { file: selected.value },
            });
            if (response.success) {
                result.value = response.params;
            } else {
                result.value = { passed: 0, failed: 1, total: 1, error: response.error ?? 'Unknown error' };
            }
        } finally {
            running.value = false;
        }
    };

    App.initialize().then(async () => {
        App.ready = true;
        const settings = await Network.send({ command: 'getSettings', params: {} });
        if (settings.success) gameHash.value = settings.params.gameHash ?? null;
        await refreshList();
    });
</script>
