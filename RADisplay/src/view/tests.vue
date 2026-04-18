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
                        :class="{ selected: file === selected, 'delete-pending': confirmingDelete === file }"
                        @click="selected = file"
                    >
                        <span class="file-name">{{ file }}</span>
                        <button
                            v-if="confirmingDelete === file"
                            class="file-delete confirm"
                            @click.stop="doDelete(file)"
                            title="Confirm delete"
                        >Delete?</button>
                        <button
                            v-else
                            class="file-delete"
                            @click.stop="askDelete(file)"
                            title="Delete file"
                        >×</button>
                    </li>
                </ul>
            </div>

            <div class="log-wrapper" v-if="steps.length > 0">
                <div class="log-header">{{ recording ? 'Recording' : 'Steps' }}</div>
                <ul class="step-log" ref="stepLogEl">
                    <li
                        v-for="step in steps"
                        :key="step.index"
                        :class="['phase-' + step.phase, { summary: step.isSummary }]"
                    >
                        <span class="step-num">{{ step.index + 1 }}<span v-if="step.total">/{{ step.total }}</span></span>
                        <span class="step-icon">{{ phaseIcon(step.phase) }}</span>
                        <span class="step-source">{{ step.source }}</span>
                        <span class="step-ms" v-if="step.durationMs != null">{{ step.durationMs }}ms</span>
                        <div class="step-error" v-if="step.error">{{ step.error }}</div>
                    </li>
                </ul>
            </div>
        </div>

        <div class="footer">
            <template v-if="pendingSave">
                <input
                    class="filename-input"
                    v-model="saveFilename"
                    ref="saveInputEl"
                    placeholder="filename"
                    @keydown.enter="confirmSave()"
                    @keydown.escape="cancelSave()"
                />
                <button class="confirm-button" :disabled="!saveFilename.trim()" @click="confirmSave()">Save</button>
                <button class="cancel-button" @click="cancelSave()">Cancel</button>
                <div class="status">Name the recording, or Cancel to discard.</div>
            </template>
            <template v-else>
                <button
                    class="play-button"
                    :class="{ active: running }"
                    :disabled="running ? false : !canPlay"
                    @click="running ? stop() : play()"
                >
                    <span v-if="running">Stop</span>
                    <span v-else>Play</span>
                </button>
                <button
                    class="record-button"
                    :class="{ active: recording }"
                    :disabled="!canRecord"
                    @click="toggleRecord()"
                >
                    <span v-if="recording">Stop Recording</span>
                    <span v-else>Record</span>
                </button>
                <div class="status" :class="statusClass">{{ statusText }}</div>
            </template>
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

    .step-log,
    .step-log * {
        user-select: text;
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

    .step-log li.summary {
        margin-top: 0.25rem;
        padding-top: 0.5rem;
        border-top: 1px solid var(--c-border);
        font-weight: 600;
    }

    .step-log li.summary .step-num { visibility: hidden; }

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
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .file-list li:hover {
        background: rgba(255, 255, 255, 0.05);
    }

    .file-list li.selected {
        background: rgba(99, 102, 241, 0.25);
        color: #c7d2fe;
    }

    .file-list li.delete-pending {
        background: rgba(239, 68, 68, 0.12);
    }

    .file-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .file-delete {
        flex-shrink: 0;
        background: transparent;
        color: var(--c-text-muted);
        border: none;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        font-weight: 600;
        padding: 0.125rem 0.375rem;
        border-radius: var(--radius-sm);
        cursor: pointer;
        opacity: 0;
        transition: opacity var(--duration) var(--ease), background var(--duration) var(--ease), color var(--duration) var(--ease);
    }

    .file-list li:hover .file-delete {
        opacity: 0.6;
    }

    .file-delete:hover {
        opacity: 1 !important;
        background: rgba(239, 68, 68, 0.2);
        color: #fca5a5;
    }

    .file-delete.confirm {
        opacity: 1;
        background: #dc2626;
        color: white;
    }

    .file-delete.confirm:hover {
        background: #ef4444;
    }

    .footer {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding-top: 0.5rem;
        border-top: 1px solid var(--c-border);
    }

    .play-button,
    .record-button,
    .confirm-button,
    .cancel-button {
        color: white;
        border: none;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        font-weight: 600;
        padding: 0.5rem 1.25rem;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: opacity var(--duration) var(--ease), background var(--duration) var(--ease);
    }

    .play-button {
        background: var(--c-primary);
    }

    .play-button.active {
        background: #dc2626;
    }

    .record-button {
        background: #374151;
    }

    .record-button.active {
        background: #dc2626;
    }

    .confirm-button {
        background: var(--c-primary);
    }

    .cancel-button {
        background: #374151;
    }

    .play-button:disabled,
    .record-button:disabled,
    .confirm-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .play-button:not(:disabled):hover,
    .record-button:not(:disabled):hover,
    .confirm-button:not(:disabled):hover,
    .cancel-button:hover {
        opacity: 0.85;
    }

    .filename-input {
        flex: 0 0 240px;
        background: var(--c-surface);
        color: var(--c-text);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        padding: 0.45rem 0.625rem;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
    }

    .filename-input:focus {
        outline: none;
        border-color: var(--c-primary);
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

    .status.recording {
        color: #fca5a5;
    }
</style>

<script setup>
    import { ref, computed, nextTick } from 'vue';
    import { Network }                 from '../js/network.ts';
    import { App }                     from '../js/app.ts';

    const files = ref([]);
    const selected = ref(null);
    const gameHash = ref(null);
    const dir = ref(null);
    const running = ref(false);
    const result = ref(null);
    const steps = ref([]);
    const stepLogEl = ref(null);

    const recording = ref(false);
    const pendingSave = ref(false);
    const saveFilename = ref('');
    const saveInputEl = ref(null);
    const lastSaved = ref(null);

    const confirmingDelete = ref(null);
    let confirmingDeleteTimer = null;

    const phaseIcon = (phase) => {
        if (phase === 'pass') return '✓';
        if (phase === 'fail') return '✗';
        if (phase === 'ok') return '·';
        if (phase === 'record') return '●';
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

    Network.addEventListener('recordingStart', () => {
        steps.value = [];
        recording.value = true;
        result.value = null;
        lastSaved.value = null;
    });

    Network.addEventListener('recordingEvent', (data) => {
        const source = data.kind === 'click'
            ? `click ${data.path}`
            : `assertTriggered ${data.id}${data.name ? ` (${data.name})` : ''}`;
        const phase = data.kind === 'triggered' ? 'pass' : 'record';
        steps.value.push({
            index: data.index,
            source,
            phase,
        });
        scrollLogToBottom();
    });

    Network.addEventListener('recordingCancel', () => {
        recording.value = false;
    });

    Network.addEventListener('recordingSaved', (data) => {
        recording.value = false;
        lastSaved.value = data.file;
    });

    const canPlay = computed(() =>
        !running.value && !recording.value && selected.value !== null && App.flashConnected,
    );

    const canRecord = computed(() =>
        !running.value && App.flashConnected,
    );

    const statusText = computed(() => {
        if (!App.flashConnected) return 'Flash Player is not running — reload the game to run tests.';
        if (recording.value) return 'Recording — click in the game to capture actions. Press Stop when done.';
        if (running.value) return 'Playing... game will reset and actions will execute.';
        if (lastSaved.value) return `Saved ${lastSaved.value}`;
        if (result.value) return '';
        return 'Select a test and press Play, or press Record to author a new one.';
    });

    const statusClass = computed(() => {
        if (recording.value) return 'recording';
        return '';
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
        lastSaved.value = null;
        steps.value = [];
        try {
            const response = await Network.send({
                command: 'playRatest',
                params: { file: selected.value },
            });
            const res = response.success
                ? response.params
                : { passed: 0, failed: 1, total: 1, error: response.error ?? 'Unknown error' };
            result.value = res;
            const { passed, failed, total, error } = res;
            const nextIndex = steps.value.length > 0
                ? Math.max(...steps.value.map((s) => s.index)) + 1
                : 0;
            steps.value.push({
                index: nextIndex,
                phase: failed === 0 ? 'pass' : 'fail',
                source: failed === 0
                    ? `Passed ${passed}/${total}`
                    : `Failed ${failed}/${total}${error ? ` — ${error}` : ''}`,
                isSummary: true,
            });
            scrollLogToBottom();
        } finally {
            running.value = false;
        }
    };

    const stop = async () => {
        await Network.send({ command: 'abortRatest', params: {} });
    };

    const toggleRecord = async () => {
        if (recording.value) {
            // Open the filename prompt; the recording keeps running until the
            // user confirms or cancels so they can still abandon gracefully.
            const now = new Date();
            const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
            saveFilename.value = `recording-${stamp}`;
            pendingSave.value = true;
            await nextTick();
            if (saveInputEl.value) {
                saveInputEl.value.focus();
                saveInputEl.value.select();
            }
        } else {
            const response = await Network.send({ command: 'startRecording', params: {} });
            if (!response.success) {
                result.value = { passed: 0, failed: 1, total: 1, error: response.error ?? 'startRecording failed' };
            }
        }
    };

    const confirmSave = async () => {
        const name = saveFilename.value.trim();
        if (!name) return;
        const response = await Network.send({
            command: 'stopRecording',
            params: { filename: name },
        });
        pendingSave.value = false;
        saveFilename.value = '';
        if (response.success) {
            await refreshList();
            selected.value = response.params.file;
        } else {
            result.value = { passed: 0, failed: 1, total: 1, error: response.error ?? 'stopRecording failed' };
        }
    };

    const cancelSave = async () => {
        pendingSave.value = false;
        saveFilename.value = '';
        await Network.send({ command: 'cancelRecording', params: {} });
    };

    const askDelete = (file) => {
        confirmingDelete.value = file;
        if (confirmingDeleteTimer) clearTimeout(confirmingDeleteTimer);
        // Auto-revert after 3s so an abandoned click doesn't stay armed.
        confirmingDeleteTimer = setTimeout(() => {
            confirmingDelete.value = null;
        }, 3000);
    };

    const doDelete = async (file) => {
        if (confirmingDeleteTimer) clearTimeout(confirmingDeleteTimer);
        confirmingDelete.value = null;
        const response = await Network.send({
            command: 'deleteRatest',
            params: { file },
        });
        if (response.success) {
            if (selected.value === file) selected.value = null;
            await refreshList();
        }
    };

    App.initialize().then(async () => {
        App.ready = true;
        const settings = await Network.send({ command: 'getSettings', params: {} });
        if (settings.success) gameHash.value = settings.params.gameHash ?? null;
        await refreshList();
    });
</script>
