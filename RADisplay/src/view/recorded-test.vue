<template>
    <div class="container" v-if="App.ready">
        <div class="header">
            <div class="title">Recorded Test</div>
            <div class="hash" v-if="gameHash">{{ gameHash }}</div>
            <div class="hash-missing" v-else>No game loaded</div>
            <div class="header-actions">
                <button
                    class="delay-button"
                    @click="openDelayModal()"
                    title="Edit the global delay inserted between every playback step"
                >
                    Delay: {{ playbackDelayMs }}
                </button>
                <button
                    class="restart-button"
                    @click="toggleRestart()"
                    title="When Yes, playback resets the game before running. When No, it plays against the current game state."
                >
                    Restart: {{ playbackRestart ? 'Yes' : 'No' }}
                </button>
            </div>
        </div>

        <div class="main-wrapper">
            <div class="list-wrapper">
                <div v-if="files.length === 0" class="empty-state">
                    <div>No <code>.ratest</code> files found for this game.</div>
                </div>
                <ul v-else class="file-list">
                    <li
                        v-for="file in files"
                        :key="file"
                        :class="{
                            selected: file === selected,
                            'pending-rename': isPendingRename(file),
                        }"
                        @click="renamingFile === file ? null : (selected = file)"
                        @contextmenu.prevent="renamingFile === file ? null : openContextMenu(file, $event)"
                    >
                        <input
                            v-if="renamingFile === file"
                            class="rename-input"
                            v-model="renameValue"
                            :ref="setRenameInputRef"
                            @keydown.enter.stop="confirmRename()"
                            @keydown.escape.stop="cancelRename()"
                            @blur="confirmRename()"
                            @click.stop
                        />
                        <template v-else>
                            <span
                                class="file-name"
                                :title="isPendingRename(file) ? `Pending rename from ${file}` : file"
                            >{{ displayName(file) }}</span>
                            <button
                                class="file-menu"
                                @click.stop="openContextMenu(file, $event)"
                                title="Actions"
                            >⋮</button>
                        </template>
                    </li>
                </ul>
            </div>

            <div class="log-wrapper" v-if="steps.length > 0">
                <div class="log-header">
                    <span>{{ recording ? 'Recording' : 'Steps' }}</span>
                    <button class="log-copy" @click="copySteps()" title="Copy steps as ratest source">
                        {{ stepsCopied ? 'Copied' : 'Copy' }}
                    </button>
                </div>
                <ul class="step-log" ref="stepLogEl">
                    <li
                        v-for="step in steps"
                        :key="step.index"
                        :class="['phase-' + step.phase, { summary: step.isSummary }]"
                    >
                        <span class="step-num">{{ step.index + 1 }}</span>
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
                <div class="status">Name the recording, or Cancel to keep editing.</div>
            </template>
            <template v-else>
                <button
                    v-if="!recording && !running"
                    class="save-button"
                    :disabled="!canSave"
                    @click="openSavePrompt()"
                    title="Persist changes for the current selection (and any in-memory recording) to disk"
                >
                    Save
                </button>
                <button
                    v-if="running"
                    class="play-button active"
                    @click="stop()"
                >
                    Stop
                </button>
                <button
                    v-if="running"
                    class="pause-button"
                    :class="{ active: paused }"
                    @click="paused ? resume() : pause()"
                >
                    <span v-if="paused">Resume</span>
                    <span v-else>Pause</span>
                </button>
                <button
                    v-if="running && paused"
                    class="step-button"
                    @click="advance()"
                    title="Run the next step, then stay paused"
                >
                    Step
                </button>
                <button
                    v-if="recording"
                    class="record-button active"
                    @click="stopRecord()"
                >
                    Stop Recording
                </button>
                <button
                    v-if="!recording && !running"
                    class="record-button"
                    :disabled="!canRecord"
                    @click="startNewRecord()"
                >
                    New Record
                </button>
                <div class="status" :class="statusClass">{{ statusText }}</div>
            </template>
        </div>

        <div
            v-if="contextMenu"
            class="context-menu-backdrop"
            @mousedown="closeContextMenu()"
            @contextmenu.prevent="closeContextMenu()"
        >
            <ul
                class="context-menu"
                :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
                @mousedown.stop
                @contextmenu.prevent.stop
            >
                <li
                    class="context-menu-item"
                    :class="{ disabled: !canRunRatest }"
                    @click="canRunRatest && contextPlay()"
                >Play</li>
                <li
                    class="context-menu-item"
                    :class="{ disabled: !canStartRecording }"
                    @click="canStartRecording && contextContinueRecord()"
                >Continue Recording</li>
                <li
                    class="context-menu-item"
                    :class="{ disabled: running || recording }"
                    @click="!(running || recording) && contextRename()"
                >Rename</li>
                <li
                    class="context-menu-item danger"
                    :class="{ disabled: running || recording }"
                    @click="!(running || recording) && contextDelete()"
                >Delete</li>
            </ul>
        </div>

        <div v-if="delayModalOpen" class="hit-test-modal-backdrop" @click.self="cancelDelayModal()">
            <div class="hit-test-modal">
                <div class="hit-test-modal-title">Inter-step playback delay</div>
                <input
                    class="delay-input"
                    type="number"
                    min="0"
                    step="10"
                    v-model.number="delayDraft"
                    ref="delayInputEl"
                    @keydown.enter="confirmDelayModal()"
                    @keydown.escape="cancelDelayModal()"
                />
                <div class="hit-test-modal-actions">
                    <button class="confirm-button" @click="confirmDelayModal()">Save</button>
                    <button class="cancel-button" @click="cancelDelayModal()">Cancel</button>
                </div>
            </div>
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
        align-items: center;
        gap: 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--c-border);
    }

    .header-actions {
        margin-left: auto;
        display: flex;
        gap: 0.5rem;
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
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
    }

    .log-copy {
        font: inherit;
        font-size: 0.6875rem;
        letter-spacing: 0.05em;
        padding: 0.1rem 0.5rem;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--c-text-muted);
        cursor: pointer;
    }

    .log-copy:hover {
        background: var(--c-primary-soft);
        color: var(--c-text);
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
        grid-template-columns: 1.75rem 1.25rem 1fr auto;
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
        color: #ffffff;
    }

    .file-list li.pending-rename .file-name {
        font-weight: 700;
    }

    .file-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .file-menu {
        flex-shrink: 0;
        background: transparent;
        color: var(--c-text-muted);
        border: none;
        font-family: var(--font-sans);
        font-size: 1rem;
        line-height: 1;
        font-weight: 700;
        padding: 0.125rem 0.375rem;
        border-radius: var(--radius-sm);
        cursor: pointer;
        opacity: 0.5;
        transition: opacity var(--duration) var(--ease), background var(--duration) var(--ease), color var(--duration) var(--ease);
    }

    .file-list li:hover .file-menu {
        opacity: 0.85;
    }

    .file-menu:hover {
        opacity: 1 !important;
        background: rgba(99, 102, 241, 0.2);
        color: var(--c-text);
    }

    .context-menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
    }

    .context-menu {
        position: fixed;
        list-style: none;
        margin: 0;
        padding: 0.25rem;
        min-width: 180px;
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        z-index: 101;
    }

    .context-menu-item {
        padding: 0.45rem 0.75rem;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        color: var(--c-text);
        cursor: pointer;
        border-radius: var(--radius-sm);
        user-select: none;
    }

    .context-menu-item:hover:not(.disabled) {
        background: rgba(99, 102, 241, 0.2);
    }

    .context-menu-item.disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .context-menu-item.danger {
        color: #fca5a5;
    }

    .context-menu-item.danger:hover:not(.disabled) {
        background: rgba(239, 68, 68, 0.18);
    }

    .rename-input {
        flex: 1;
        min-width: 0;
        background: var(--c-bg, #111);
        color: var(--c-text);
        border: 1px solid var(--c-primary);
        border-radius: var(--radius-sm);
        padding: 0.2rem 0.375rem;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        outline: none;
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
    .pause-button,
    .step-button,
    .record-button,
    .save-button,
    .delay-button,
    .restart-button,
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

    .save-button {
        background: var(--c-primary);
    }

    .pause-button {
        background: #374151;
    }

    .pause-button.active {
        background: var(--c-primary);
    }

    .step-button {
        background: #374151;
    }

    .delay-button {
        background: #374151;
    }

    .restart-button {
        background: #374151;
    }

    .hit-test-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10;
    }

    .hit-test-modal {
        min-width: 320px;
        max-width: 80%;
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }

    .hit-test-modal-title {
        font-weight: 600;
        font-size: 0.875rem;
        color: var(--c-text);
    }

    .hit-test-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }

    .confirm-button {
        background: var(--c-primary);
    }

    .cancel-button {
        background: #374151;
    }

    .play-button:disabled,
    .pause-button:disabled,
    .step-button:disabled,
    .record-button:disabled,
    .save-button:disabled,
    .delay-button:disabled,
    .restart-button:disabled,
    .confirm-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .play-button:not(:disabled):hover,
    .pause-button:not(:disabled):hover,
    .step-button:not(:disabled):hover,
    .record-button:not(:disabled):hover,
    .save-button:not(:disabled):hover,
    .delay-button:not(:disabled):hover,
    .restart-button:not(:disabled):hover,
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

    .delay-input {
        align-self: flex-start;
        width: 120px;
        background: var(--c-surface);
        color: var(--c-text);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        padding: 0.45rem 0.625rem;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
    }

    .delay-input:focus {
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

    .status.unsaved {
        color: #fcd34d;
    }
</style>

<script setup>
    import { ref, computed, nextTick, watch } from 'vue';
    import { Network }                 from '../js/network.ts';
    import { App }                     from '../js/app.ts';

    const files = ref([]);
    const selected = ref(null);
    const gameHash = ref(null);
    const dir = ref(null);
    const running = ref(false);
    const paused = ref(false);
    const result = ref(null);
    const steps = ref([]);
    const stepLogEl = ref(null);

    const recording = ref(false);
    // The originating file for a "Continue Record" session — sticks around
    // after stopRecording so Save knows where to overwrite. Null means a
    // fresh recording that needs a filename prompt on Save.
    const recordingSource = ref(null);
    // True once any new event has been captured during the active recording.
    // Drives the Save button's enabled state and only clears on save/discard.
    const unsavedRecording = ref(false);
    const pendingSave = ref(false);
    const saveFilename = ref('');
    const saveInputEl = ref(null);
    const lastSaved = ref(null);

    const stepsCopied = ref(false);
    let stepsCopiedTimer = null;

    const playbackDelayMs = ref(200);
    const playbackRestart = ref(true);
    const delayModalOpen = ref(false);
    const delayDraft = ref(200);
    const delayInputEl = ref(null);

    const contextMenu = ref(null);

    // Pending renames queued by the user; flushed only when the affected
    // file is selected and the user clicks Save. Keyed by the on-disk
    // filename, never the display name. Deletes are NOT pending — they hit
    // disk immediately because there's no row left to "select to save".
    const pendingRenames = ref({});

    const displayName = (file) => pendingRenames.value[file] || file;
    const isPendingRename = (file) => Object.prototype.hasOwnProperty.call(pendingRenames.value, file);
    const selectedHasPendingRename = computed(() =>
        selected.value !== null && isPendingRename(selected.value),
    );
    // Save is per-file: it covers the in-memory recording (which has its
    // own implicit focus) plus the pending rename of the selected row.
    // Other rows' pending renames stay queued until those rows are selected.
    const canSave = computed(() => unsavedRecording.value || selectedHasPendingRename.value);

    const renamingFile = ref(null);
    const renameValue = ref('');
    const renameInputEl = ref(null);
    const setRenameInputRef = (el) => { if (el) renameInputEl.value = el; };

    const phaseIcon = (phase) => {
        if (phase === 'pass') return '✅';
        if (phase === 'fail') return '❌';
        if (phase === 'ok') return '▪️';
        if (phase === 'record') return '🔴';
        return '⏳';
    };

    const scrollLogToBottom = () => {
        requestAnimationFrame(() => {
            if (stepLogEl.value) stepLogEl.value.scrollTop = stepLogEl.value.scrollHeight;
        });
    };

    Network.addEventListener('ratestStart', () => {
        steps.value = [];
    });

    // Completion signal: the engine emits this for every playRatest
    // attempt — successful runs, failures, aborts, and early errors.
    // UI state flips here (not on the playRatest HTTP response) because
    // long recorded test runs exceed the 30s request timeout.
    Network.addEventListener('ratestEnd', (data) => {
        const res = {
            passed: data.passed ?? 0,
            failed: data.failed ?? 0,
            total: data.total ?? 0,
            error: data.error,
        };
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
        running.value = false;
        paused.value = false;
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

    Network.addEventListener('recordingStart', (data) => {
        // In continue mode keep the previewed steps so the user sees the
        // existing recording with the new captures appended below.
        const appending = !!data?.appendTo;
        if (!appending) steps.value = [];
        recording.value = true;
        recordingSource.value = data?.appendTo ?? null;
        unsavedRecording.value = false;
        result.value = null;
        lastSaved.value = null;
    });

    Network.addEventListener('recordingEvent', (data) => {
        const source = data.kind === 'click'
            ? `click ${data.path}`
            : `assertTriggered ${data.id}${data.name ? ` (${data.name})` : ''}`;
        const phase = data.kind === 'triggered' ? 'pass' : 'record';
        // Backend indices restart at 0 for each recording session, so when
        // appending we offset past whatever was already in the step list.
        const nextIndex = steps.value.length > 0
            ? Math.max(...steps.value.map((s) => s.index)) + 1
            : data.index;
        steps.value.push({
            index: nextIndex,
            source,
            phase,
        });
        unsavedRecording.value = true;
        scrollLogToBottom();
    });

    Network.addEventListener('recordingStopped', () => {
        // Capture ended but the buffer survives on the backend until the
        // user clicks Save (or starts another recording, which discards).
        recording.value = false;
    });

    Network.addEventListener('recordingCancel', () => {
        recording.value = false;
        recordingSource.value = null;
        unsavedRecording.value = false;
    });

    Network.addEventListener('recordingSaved', (data) => {
        recording.value = false;
        recordingSource.value = null;
        unsavedRecording.value = false;
        lastSaved.value = data.file;
    });

    watch(selected, async (file) => {
        if (running.value || recording.value) return;
        // Switching files while there's an unsaved buffer discards it —
        // the Save button was visible and ignored, so we treat that as intent.
        if (unsavedRecording.value || recordingSource.value) {
            await Network.send({ command: 'cancelRecording', params: {} });
        }
        if (!file) {
            steps.value = [];
            return;
        }
        const response = await Network.send({
            command: 'previewRatest',
            params: { file },
        });
        if (selected.value !== file) return;
        if (running.value || recording.value) return;
        steps.value = response.success ? (response.params.steps ?? []) : [];
    });

    const canRecord = computed(() =>
        !running.value && App.flashConnected,
    );

    // Context-menu items act on the right-clicked file rather than
    // `selected`, so the gates here don't depend on selection.
    const canRunRatest = computed(() =>
        !running.value && !recording.value && App.flashConnected,
    );

    const canStartRecording = computed(() =>
        !running.value && !recording.value && App.flashConnected,
    );

    const statusText = computed(() => {
        if (!App.flashConnected) return 'Flash Player is not running — reload the game to run recorded tests.';
        if (recording.value) {
            if (recordingSource.value) return `Recording — appending to ${recordingSource.value}. Press Stop when done.`;
            return 'Recording — click in the game to capture actions. Press Stop when done.';
        }
        if (running.value) return 'Playing... game will reset and actions will execute.';
        if (canSave.value) {
            const bits = [];
            if (unsavedRecording.value) {
                bits.push(recordingSource.value
                    ? `recording for ${recordingSource.value}`
                    : 'recording');
            }
            if (selectedHasPendingRename.value) {
                bits.push(`rename ${selected.value} → ${pendingRenames.value[selected.value]}`);
            }
            return `Pending: ${bits.join(', ')}. Click Save to commit.`;
        }
        if (lastSaved.value) return `Saved ${lastSaved.value}`;
        return '';
    });

    const statusClass = computed(() => {
        if (recording.value) return 'recording';
        if (canSave.value) return 'unsaved';
        return '';
    });

    const copySteps = async () => {
        const text = steps.value
            .filter((s) => !s.isSummary && s.source)
            .map((s) => s.source)
            .join('\n');
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            stepsCopied.value = true;
            if (stepsCopiedTimer) clearTimeout(stepsCopiedTimer);
            stepsCopiedTimer = setTimeout(() => { stepsCopied.value = false; }, 1500);
        } catch (err) {
            console.error('Failed to copy steps:', err);
        }
    };

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

    const play = (file) => {
        const target = file ?? selected.value;
        if (!target) return;
        if (selected.value !== target) selected.value = target;
        running.value = true;
        paused.value = false;
        result.value = null;
        lastSaved.value = null;
        steps.value = [];
        // Fire-and-forget: completion is signalled via the 'ratestEnd'
        // event, because the network layer's 30s request timeout would
        // otherwise resolve this promise long before a long test run
        // actually finishes.
        Network.send({
            command: 'playRatest',
            params: { file: target },
        }).catch((err) => console.error('playRatest failed:', err));
    };

    const stop = async () => {
        await Network.send({ command: 'abortRatest', params: {} });
    };

    const pause = async () => {
        const resp = await Network.send({ command: 'pauseRatest', params: {} });
        if (resp.success) paused.value = true;
    };

    const resume = async () => {
        const resp = await Network.send({ command: 'resumeRatest', params: {} });
        if (resp.success) paused.value = false;
    };

    const advance = async () => {
        await Network.send({ command: 'advanceRatest', params: {} });
    };

    const openDelayModal = () => {
        delayDraft.value = playbackDelayMs.value;
        delayModalOpen.value = true;
        nextTick(() => delayInputEl.value?.select?.());
    };

    const cancelDelayModal = () => {
        delayModalOpen.value = false;
    };

    const confirmDelayModal = async () => {
        const n = Math.max(0, Math.floor(Number(delayDraft.value) || 0));
        await persistSettingPatch({ playbackDelayMs: n });
        playbackDelayMs.value = n;
        delayModalOpen.value = false;
    };

    const toggleRestart = async () => {
        const next = !playbackRestart.value;
        await persistSettingPatch({ playbackRestart: next });
        playbackRestart.value = next;
    };

    // Round-trip through getSettings so we don't clobber other fields
    // on the way back: saveSettings replaces the whole blob.
    const persistSettingPatch = async (patch) => {
        const current = await Network.send({ command: 'getSettings', params: {} });
        if (!current.success) return;
        const next = { ...current.params, ...patch };
        // Strip read-only fields the engine appends on read.
        delete next.version;
        delete next.isRaflash;
        delete next.hasRaflash;
        delete next.gameHash;
        await Network.send({ command: 'saveSettings', params: { settings: next } });
    };

    const startNewRecord = async () => {
        const response = await Network.send({ command: 'startRecording', params: {} });
        if (!response.success) {
            result.value = { passed: 0, failed: 1, total: 1, error: response.error ?? 'startRecording failed' };
        }
    };

    const startContinueRecord = async (file) => {
        if (selected.value !== file) selected.value = file;
        const response = await Network.send({
            command: 'startRecording',
            params: { appendTo: file },
        });
        if (!response.success) {
            result.value = { passed: 0, failed: 1, total: 1, error: response.error ?? 'startRecording failed' };
        }
    };

    const stopRecord = async () => {
        // Just stops capture; the buffer survives in backend memory until
        // the user clicks Save (or starts another recording / picks a file).
        const response = await Network.send({ command: 'stopRecording', params: {} });
        if (!response.success) {
            result.value = { passed: 0, failed: 1, total: 1, error: response.error ?? 'stopRecording failed' };
        }
    };

    const openSavePrompt = async () => {
        if (!canSave.value) return;
        // A fresh recording with no source file needs a name before we can
        // flush. A pending rename alone doesn't need a prompt.
        if (unsavedRecording.value && !recordingSource.value) {
            const now = new Date();
            const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
            saveFilename.value = `recording-${stamp}`;
            pendingSave.value = true;
            await nextTick();
            if (saveInputEl.value) {
                saveInputEl.value.focus();
                saveInputEl.value.select();
            }
            return;
        }
        await saveSelected();
    };

    // Per-file save: flush the in-memory recording (which has its own
    // implicit focus) and the pending rename of the currently selected
    // row. Pending renames for OTHER rows stay queued until those rows
    // are selected and Save is clicked.
    //
    // Order matters when both apply: the recording targets the original
    // on-disk filename, so save it before renaming.
    const saveSelected = async (recordingFilename) => {
        if (unsavedRecording.value) {
            const params = recordingFilename ? { filename: recordingFilename } : {};
            const resp = await Network.send({ command: 'saveRecording', params });
            if (!resp.success) {
                result.value = { passed: 0, failed: 1, total: 1, error: resp.error ?? 'saveRecording failed' };
                return;
            }
        }

        if (selected.value && isPendingRename(selected.value)) {
            const from = selected.value;
            const to = pendingRenames.value[from];
            const resp = await Network.send({
                command: 'renameRatest',
                params: { from, to },
            });
            if (resp.success) {
                const next = { ...pendingRenames.value };
                delete next[from];
                pendingRenames.value = next;
                selected.value = to;
            } else {
                result.value = { passed: 0, failed: 1, total: 1, error: `rename ${from} → ${to}: ${resp.error ?? 'failed'}` };
            }
        }

        await refreshList();
    };

    const confirmSave = async () => {
        const name = saveFilename.value.trim();
        if (!name) return;
        pendingSave.value = false;
        saveFilename.value = '';
        await saveSelected(name);
    };

    const cancelSave = () => {
        // Dismiss the prompt only — the buffer stays so the user can save
        // later (or trigger discard by selecting a different file).
        pendingSave.value = false;
        saveFilename.value = '';
    };

    const askRename = async (file) => {
        // Seed from the pending name so re-renaming an already-renamed file
        // shows what the user last typed, not the stale on-disk name.
        renameValue.value = displayName(file).replace(/\.ratest$/, '');
        renamingFile.value = file;
        await nextTick();
        if (renameInputEl.value) {
            renameInputEl.value.focus();
            renameInputEl.value.select();
        }
    };

    const confirmRename = () => {
        const from = renamingFile.value;
        if (!from) return;
        const raw = renameValue.value.trim();
        renamingFile.value = null;
        renameValue.value = '';
        if (!raw) return;
        const to = raw.endsWith('.ratest') ? raw : `${raw}.ratest`;
        if (to === from) {
            // Renaming back to the original name clears any pending rename.
            if (isPendingRename(from)) {
                const next = { ...pendingRenames.value };
                delete next[from];
                pendingRenames.value = next;
            }
            return;
        }
        pendingRenames.value = { ...pendingRenames.value, [from]: to };
    };

    const cancelRename = () => {
        renamingFile.value = null;
        renameValue.value = '';
    };

    const doDelete = async (file) => {
        const response = await Network.send({
            command: 'deleteRatest',
            params: { file },
        });
        if (response.success) {
            if (selected.value === file) selected.value = null;
            // Drop any queued rename for the file that no longer exists.
            if (isPendingRename(file)) {
                const next = { ...pendingRenames.value };
                delete next[file];
                pendingRenames.value = next;
            }
            await refreshList();
        } else {
            result.value = { passed: 0, failed: 1, total: 1, error: response.error ?? 'deleteRatest failed' };
        }
    };

    const openContextMenu = (file, event) => {
        selected.value = file;
        contextMenu.value = { file, x: event.clientX, y: event.clientY };
    };

    const closeContextMenu = () => {
        contextMenu.value = null;
    };

    const contextPlay = () => {
        const file = contextMenu.value?.file;
        closeContextMenu();
        if (file) play(file);
    };

    const contextContinueRecord = () => {
        const file = contextMenu.value?.file;
        closeContextMenu();
        if (file) startContinueRecord(file);
    };

    const contextRename = () => {
        const file = contextMenu.value?.file;
        closeContextMenu();
        if (file) askRename(file);
    };

    const contextDelete = () => {
        const file = contextMenu.value?.file;
        closeContextMenu();
        if (file) doDelete(file);
    };

    App.initialize().then(async () => {
        App.ready = true;
        const settings = await Network.send({ command: 'getSettings', params: {} });
        if (settings.success) {
            gameHash.value = settings.params.gameHash ?? null;
            if (typeof settings.params.playbackDelayMs === 'number') {
                playbackDelayMs.value = settings.params.playbackDelayMs;
            }
            if (typeof settings.params.playbackRestart === 'boolean') {
                playbackRestart.value = settings.params.playbackRestart;
            }
        }
        await refreshList();
    });
</script>
