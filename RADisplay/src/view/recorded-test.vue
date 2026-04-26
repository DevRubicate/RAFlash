<template>
    <div class="container" v-if="App.ready">
        <div class="header">
            <div class="title">Recorded Test</div>
            <div class="hash" v-if="gameHash">{{ gameHash }}</div>
            <div class="hash-missing" v-else>No game loaded</div>
            <div class="header-actions">
                <button
                    class="restart-button"
                    @click="toggleRestart()"
                    title="When Yes, playback resets the game before running. When No, it plays against the current game state."
                >
                    Restart: {{ playbackRestart ? 'Yes' : 'No' }}
                </button>
                <button
                    class="achievements-button"
                    @click="toggleAchievements()"
                    title="When Yes, recording captures achievement triggers as `achievement <id>` lines and playback verifies they fire within 5s. When No, recording omits them and playback skips existing ones."
                >
                    Achievements: {{ achievementsMode ? 'Yes' : 'No' }}
                </button>
                <button
                    class="realtime-button"
                    @click="toggleRealtime()"
                    :disabled="recording"
                    :title="recording
                        ? 'Realtime mode is fixed for the duration of a recording. Stop the recording to change it.'
                        : 'When Yes (action games), recording inserts `pause <ms>` between clicks to preserve real-world timing. When No (turn-based games), recording inserts `wait <path>` so playback waits for buttons to become visible.'"
                >
                    Realtime: {{ realtimeMode ? 'Yes' : 'No' }}
                </button>
            </div>
        </div>

        <div class="main-wrapper">
            <div class="list-wrapper">
                <div v-if="displayFiles.length === 0" class="empty-state">
                    <div>No <code>.ratest</code> files found for this game.</div>
                </div>
                <ul v-else class="file-list">
                    <li
                        v-for="file in displayFiles"
                        :key="file"
                        :class="{ selected: file === selected }"
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
                                v-if="isDirty(file)"
                                class="file-dirty-mark"
                                title="Unsaved edits"
                            >*</span>
                            <span
                                class="file-name"
                                :title="file"
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
                        v-for="{ step, originalIndex } in displayedSteps"
                        :key="step.uid"
                        :ref="(el) => { if (el && step.uid === currentPlayingUid) playingRowEl = el }"
                        :class="{ summary: step.isSummary, playing: step.uid === currentPlayingUid }"
                    >
                        <span class="step-num">{{ originalIndex + 1 }}</span>
                        <span class="step-source">
                            {{ step.source }}<span class="step-label" v-if="step.label"> — {{ step.label }}</span>
                        </span>
                        <span class="step-actions" v-if="!step.isSummary && canEditSteps">
                            <button
                                class="step-action"
                                :disabled="originalIndex === 0"
                                @click="moveStep(step.uid, -1)"
                                title="Move up"
                            >▲</button>
                            <button
                                class="step-action"
                                :disabled="originalIndex >= steps.length - 1 || steps[originalIndex + 1]?.isSummary"
                                @click="moveStep(step.uid, 1)"
                                title="Move down"
                            >▼</button>
                            <button
                                class="step-action"
                                @click="openEditModal(step)"
                                title="Edit step"
                            >✎</button>
                            <button
                                class="step-action"
                                @click="addStepBelow(step.uid)"
                                title="Insert a new step below"
                            >＋</button>
                        </span>
                        <div class="step-error" v-if="step.error">{{ step.error }}</div>
                    </li>
                </ul>
                <div class="step-filter-row">
                    <input
                        class="step-filter"
                        v-model="filterText"
                        placeholder="Filter steps..."
                    />
                    <button
                        v-if="filterText"
                        class="step-filter-clear"
                        @click="filterText = ''"
                        title="Clear filter"
                    >✕</button>
                </div>
            </div>
        </div>

        <div class="footer">
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
                New Recording
            </button>
            <button
                v-if="!recording && !running"
                class="save-button footer-save"
                :disabled="!canSave"
                @click="saveSelected()"
                title="Flush unsaved changes to disk"
            >
                Save
            </button>
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
                    :class="{ disabled: !canStartRecording }"
                    @click="canStartRecording && contextRerecord()"
                >Rerecord</li>
                <li
                    class="context-menu-item"
                    :class="{ disabled: running || recording }"
                    @click="!(running || recording) && contextRename()"
                >Rename</li>
                <li
                    class="context-menu-item"
                    :class="{ disabled: running || recording || !hasDiscardableChanges(contextMenu.file) }"
                    @click="!(running || recording) && hasDiscardableChanges(contextMenu.file) && contextDiscard()"
                >Discard changes</li>
                <li
                    class="context-menu-item danger"
                    :class="{ disabled: running || recording }"
                    @click="!(running || recording) && contextDelete()"
                >Delete</li>
            </ul>
        </div>

        <div v-if="discardConfirmFile" class="hit-test-modal-backdrop" @click.self="cancelDiscard()">
            <div class="hit-test-modal">
                <div class="hit-test-modal-title">Discard changes?</div>
                <div class="error-body">
                    Revert <strong>{{ discardConfirmFile }}</strong> to the version on disk. Any unsaved edits and pending rename will be lost.
                </div>
                <div class="hit-test-modal-actions">
                    <button class="cancel-button" @click="cancelDiscard()">Cancel</button>
                    <button class="delete-button" @click="confirmDiscard()">Discard</button>
                </div>
            </div>
        </div>

        <div v-if="errorMessage" class="hit-test-modal-backdrop" @click.self="dismissError()">
            <div class="hit-test-modal error-modal">
                <div class="hit-test-modal-title error-title">Error</div>
                <div class="error-body">{{ errorMessage }}</div>
                <div class="hit-test-modal-actions">
                    <button class="confirm-button" @click="dismissError()">OK</button>
                </div>
            </div>
        </div>

        <div v-if="editingStep" class="hit-test-modal-backdrop" @click.self="closeEditModal()">
            <div class="hit-test-modal edit-modal">
                <div class="hit-test-modal-title">Edit step</div>
                <input
                    class="edit-input"
                    type="text"
                    v-model="editDraft"
                    ref="editInputEl"
                    @keydown.enter="confirmEdit()"
                    @keydown.escape="closeEditModal()"
                />
                <div class="edit-modal-actions">
                    <button class="cancel-button" @click="closeEditModal()">Cancel</button>
                    <button class="delete-button" @click="deleteEditingStep()">Delete</button>
                    <button class="confirm-button" :disabled="!editDraft.trim()" @click="confirmEdit()">Save</button>
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
        flex-shrink: 0;
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

    .step-filter-row {
        display: flex;
        gap: 0.25rem;
        align-items: stretch;
        padding: 0.3rem 0.4rem;
        border-top: 1px solid var(--c-border);
        background: var(--c-surface);
    }

    .step-filter {
        flex: 1;
        min-width: 0;
        font-family: var(--font-mono);
        font-size: 0.75rem;
        padding: 0.3rem 0.5rem;
        background: var(--c-bg);
        color: var(--c-text);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        outline: none;
    }

    .step-filter:focus {
        border-color: var(--c-primary);
    }

    .step-filter-clear {
        background: transparent;
        color: var(--c-text-muted);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        font-size: 0.75rem;
        padding: 0 0.5rem;
        cursor: pointer;
    }

    .step-filter-clear:hover {
        color: var(--c-text);
        background: var(--c-primary-soft);
    }

    .step-log li {
        padding: 0.3rem 0.5rem;
        font-family: var(--font-mono);
        font-size: 0.75rem;
        color: var(--c-text);
        border-radius: var(--radius-sm);
        display: grid;
        grid-template-columns: 1.75rem 1fr auto;
        gap: 0.4rem;
        align-items: center;
    }

    .step-log li.summary {
        margin-top: 0.25rem;
        padding-top: 0.5rem;
        border-top: 1px solid var(--c-border);
        font-weight: 600;
    }

    .step-log li.playing {
        background: var(--c-primary-soft);
        box-shadow: inset 2px 0 0 var(--c-primary);
    }

    .step-log li.summary .step-num { visibility: hidden; }

    .step-num {
        font-variant-numeric: tabular-nums;
        color: var(--c-text-muted);
    }

    .step-source {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .step-label {
        color: var(--c-text-muted);
        font-style: italic;
    }

    .step-actions {
        display: inline-flex;
        gap: 0.15rem;
        opacity: 0.4;
        transition: opacity var(--duration) var(--ease);
    }

    .step-log li:hover .step-actions {
        opacity: 1;
    }

    .step-action {
        background: transparent;
        color: var(--c-text-muted);
        border: none;
        font-family: var(--font-sans);
        font-size: 0.75rem;
        line-height: 1;
        padding: 0.15rem 0.3rem;
        border-radius: var(--radius-sm);
        cursor: pointer;
    }

    .step-action:hover:not(:disabled) {
        background: rgba(99, 102, 241, 0.2);
        color: var(--c-text);
    }

    .step-action:disabled {
        opacity: 0.3;
        cursor: not-allowed;
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

    .file-dirty-mark {
        flex-shrink: 0;
        color: #fcd34d;
        font-weight: 700;
        font-size: 0.875rem;
        line-height: 1;
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
    .restart-button,
    .achievements-button,
    .realtime-button,
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
        white-space: nowrap;
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

    .footer-save {
        margin-left: auto;
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

    .restart-button {
        background: #374151;
    }

    .achievements-button {
        background: #374151;
    }

    .realtime-button {
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
    .restart-button:disabled,
    .achievements-button:disabled,
    .realtime-button:disabled,
    .confirm-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .play-button:not(:disabled):hover,
    .pause-button:not(:disabled):hover,
    .step-button:not(:disabled):hover,
    .record-button:not(:disabled):hover,
    .save-button:not(:disabled):hover,
    .restart-button:not(:disabled):hover,
    .achievements-button:not(:disabled):hover,
    .realtime-button:not(:disabled):hover,
    .confirm-button:not(:disabled):hover,
    .cancel-button:hover {
        opacity: 0.85;
    }

    .edit-modal {
        min-width: 480px;
    }

    .edit-input {
        background: var(--c-surface);
        color: var(--c-text);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        padding: 0.45rem 0.625rem;
        font-family: var(--font-mono);
        font-size: 0.8125rem;
    }

    .edit-input:focus {
        outline: none;
        border-color: var(--c-primary);
    }

    .edit-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }

    .delete-button {
        margin-right: auto;
        background: #dc2626;
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

    .delete-button:hover {
        opacity: 0.85;
    }

    .error-modal {
        min-width: 360px;
        max-width: 80%;
    }

    .error-title {
        color: #fca5a5;
    }

    .error-body {
        color: var(--c-text);
        font-size: 0.8125rem;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 50vh;
        overflow-y: auto;
        user-select: text;
    }

</style>

<script setup>
    import { ref, computed, nextTick, watch, onUnmounted } from 'vue';
    import { Network }                 from '../js/network.ts';
    import { App }                     from '../js/app.ts';

    const files = ref([]);
    const selected = ref(null);
    const gameHash = ref(null);
    const dir = ref(null);
    const running = ref(false);
    const paused = ref(false);
    const steps = ref([]);
    const stepLogEl = ref(null);

    // Stable per-step identity, separate from array position. Used for
    // v-for keys so reordering/editing/deleting doesn't confuse Vue's
    // diffing or trigger spurious re-renders of unrelated rows.
    let nextStepUid = 1;
    const newStep = (props) => ({ uid: nextStepUid++, ...props });

    // Substring filter applied to the step log. Case-insensitive, matches
    // against source and label. Empty string means no filtering. Survives
    // file-switches intentionally — the user might be hunting for a
    // pattern across recordings.
    const filterText = ref('');
    const displayedSteps = computed(() => {
        const q = filterText.value.trim().toLowerCase();
        const tagged = steps.value.map((step, originalIndex) => ({ step, originalIndex }));
        if (!q) return tagged;
        return tagged.filter(({ step }) => {
            // Summary rows are runtime status, not editable content; keep
            // them visible regardless so the user always sees the outcome.
            if (step.isSummary) return true;
            const haystack = `${step.source ?? ''} ${step.label ?? ''}`.toLowerCase();
            return haystack.includes(q);
        });
    });

    const recording = ref(false);
    // Rerecord mode: plays back an existing file while also capturing
    // new events (clicks during pause, unexpected achievements) and
    // splicing them into the local `steps` view at the current playback
    // position. The user then clicks Save to commit the modifications.
    const rerecording = ref(false);
    // Uid snapshot of `steps` at rerecord start, indexed by the backend
    // playback's step index. Lets us map a ratestStep(i) event to the
    // right local row after insertions have shifted frontend positions.
    const playbackUids = ref([]);
    // Frontend index where the next captured line during rerecord should
    // land. Updated each time the backend broadcasts a step-start event
    // (to "just after the now-running step") and each time a capture is
    // inserted (so multiple captures at the same pause stack in order).
    let rerecordInsertPosition = 0;
    // uid of the step currently executing. Used to highlight the row and
    // scroll it into view during rerecord, where the full list exists
    // up-front and nothing else would indicate which step is live.
    const currentPlayingUid = ref(null);
    // Last-seen DOM node for the playing row, populated via :ref in the
    // template. Lets us call scrollIntoView without re-querying.
    let playingRowEl = null;
    // The file the current `steps` belong to, if any. Set by previewRatest
    // (selecting a file), by startContinueRecord, and by startNewRecord
    // (backend allocates the filename and returns it in the response).
    const loadedFromFile = ref(null);
    // File list shape from the backend: [{name, onDisk, dirty}]. `dirty`
    // means the backend's ratestBuffers Map has an entry for that file
    // (a new recording, an edited copy of a disk file, or both). `onDisk`
    // tells us whether Discard has anything to fall back to. This is the
    // single source of truth — no more per-file stash, no ephemeral
    // tracking, no "unsaved" flag on the frontend.
    const fileEntry = (name) => files.value.find((f) => f.name === name);
    const isDirty = (file) => !!fileEntry(file)?.dirty;
    const displayFiles = computed(() => files.value.map((f) => f.name));

    // UI-action error surface. Playback errors come through the step log
    // via ratestStep/ratestEnd; this is for things like "delete failed"
    // or "save failed" that don't have a natural row to attach to.
    const errorMessage = ref(null);
    const showError = (msg) => { errorMessage.value = String(msg); };
    const dismissError = () => { errorMessage.value = null; };

    // The file the user is about to discard changes on; null = no prompt.
    const discardConfirmFile = ref(null);

    const stepsCopied = ref(false);
    let stepsCopiedTimer = null;

    // Edit modal: opened from the pencil button; null means closed.
    // editingStep holds the original step object so we can locate it by
    // uid on save (position may have shifted via reorder).
    const editingStep = ref(null);
    const editDraft = ref('');
    const editInputEl = ref(null);
    // True when the modal was opened on a freshly-inserted blank row.
    // Cancel on such a row removes it again so we don't leave empty rows
    // behind when the user changes their mind about adding a step.
    const editingStepIsNew = ref(false);
    const canEditSteps = computed(() => !running.value && !recording.value);

    // Push the current frontend step list as the authoritative buffer
    // content for `file` on the backend. Every UI-side mutation calls
    // this so the backend's ratestBuffers Map stays in sync with what the
    // user sees. Step mutations are gated off during recording (via
    // canEditSteps), so this never races with the backend's own
    // recording-line appends.
    const syncBufferToBackend = async (file) => {
        if (!file) return;
        const lines = steps.value
            .filter((s) => !s.isSummary && typeof s.source === 'string')
            .map((s) => s.source);
        await Network.send({ command: 'setRatestBuffer', params: { file, lines } });
        await refreshList();
    };

    const moveStep = async (uid, delta) => {
        const i = steps.value.findIndex((s) => s.uid === uid);
        if (i < 0) return;
        const j = i + delta;
        if (j < 0 || j >= steps.value.length) return;
        if (steps.value[j].isSummary) return;
        const next = steps.value.slice();
        [next[i], next[j]] = [next[j], next[i]];
        steps.value = next;
        await syncBufferToBackend(selected.value);
    };

    const addStepBelow = async (uid) => {
        const i = steps.value.findIndex((s) => s.uid === uid);
        if (i < 0) return;
        const fresh = newStep({ source: '', phase: 'start' });
        const next = steps.value.slice();
        next.splice(i + 1, 0, fresh);
        steps.value = next;
        await openEditModal(fresh, true);
    };

    const openEditModal = async (step, isNew = false) => {
        editingStep.value = step;
        editDraft.value = step.source ?? '';
        editingStepIsNew.value = isNew;
        await nextTick();
        if (editInputEl.value) {
            editInputEl.value.focus();
            editInputEl.value.select();
        }
    };

    const closeEditModal = async () => {
        // Cancelling on a brand-new row that was never given content
        // discards it — otherwise the user would see a phantom blank row.
        const wasNew = editingStepIsNew.value;
        if (wasNew && editingStep.value) {
            const target = editingStep.value;
            const i = steps.value.findIndex((s) => s.uid === target.uid);
            if (i >= 0 && !(steps.value[i].source ?? '').trim()) {
                steps.value = steps.value.filter((s) => s.uid !== target.uid);
            }
        }
        editingStep.value = null;
        editDraft.value = '';
        editingStepIsNew.value = false;
        // A brand-new row inserted via addStepBelow has already shifted
        // the buffer view; if we kept it (non-empty source) the insertion
        // itself still needs syncing. If we dropped it above, sync reverts
        // the transient insert on the backend too.
        if (wasNew) await syncBufferToBackend(selected.value);
    };

    const confirmEdit = async () => {
        const target = editingStep.value;
        if (!target) return;
        const newSource = editDraft.value.trim();
        if (!newSource) return;
        const i = steps.value.findIndex((s) => s.uid === target.uid);
        let changed = false;
        if (i >= 0 && steps.value[i].source !== newSource) {
            steps.value[i] = { ...steps.value[i], source: newSource };
            changed = true;
        }
        const wasNew = editingStepIsNew.value;
        editingStep.value = null;
        editDraft.value = '';
        editingStepIsNew.value = false;
        if (changed || wasNew) await syncBufferToBackend(selected.value);
    };

    const deleteEditingStep = async () => {
        const target = editingStep.value;
        if (!target) return;
        const i = steps.value.findIndex((s) => s.uid === target.uid);
        let changed = false;
        if (i >= 0) {
            steps.value = steps.value.filter((s) => s.uid !== target.uid);
            changed = true;
        }
        editingStep.value = null;
        editDraft.value = '';
        editingStepIsNew.value = false;
        if (changed) await syncBufferToBackend(selected.value);
    };

    const playbackRestart = ref(true);
    // Per-session toggle (intentionally not persisted): controls whether
    // achievement triggers get captured during recording and asserted
    // during playback. Resets to Yes on every RAFlash launch.
    const achievementsMode = ref(true);
    // Per-session toggle (intentionally not persisted): Yes = action-game
    // mode — recording inserts `pause <ms>` between clicks to preserve
    // real-world timing. No = turn-based mode — recording inserts
    // `wait <path>` so playback waits for buttons to become visible.
    const realtimeMode = ref(true);

    const contextMenu = ref(null);

    // Strip the `.ratest` suffix for display — every file in the list
    // has it, so it's pure noise.
    const stripExt = (name) => (name || '').replace(/\.ratest$/, '');
    const displayName = (file) => stripExt(file);

    // Save is enabled when the selected file has a buffer entry (the
    // backend's dirty flag). Rename and delete no longer gate Save —
    // they hit the backend immediately.
    const canSave = computed(() => selected.value !== null && isDirty(selected.value));

    // Discard only makes sense when both layers exist: a buffer entry
    // (otherwise there's nothing to drop) AND an on-disk version
    // (otherwise there's nothing to revert to).
    const hasDiscardableChanges = (file) => {
        const entry = fileEntry(file);
        return !!entry && entry.onDisk && entry.dirty;
    };

    const renamingFile = ref(null);
    const renameValue = ref('');
    const renameInputEl = ref(null);
    const setRenameInputRef = (el) => { if (el) renameInputEl.value = el; };

    const scrollLogToBottom = () => {
        requestAnimationFrame(() => {
            if (stepLogEl.value) stepLogEl.value.scrollTop = stepLogEl.value.scrollHeight;
        });
    };

    // Scroll the currently-playing row into view. The :ref callback that
    // tracks playingRowEl fires on re-render, so nextTick guarantees
    // the node for the step we just marked playing actually exists
    // before we try to scroll to it.
    const scrollPlayingIntoView = async () => {
        await nextTick();
        if (playingRowEl && typeof playingRowEl.scrollIntoView === 'function') {
            playingRowEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
    };

    // Track (event, handler) pairs so we can remove them on unmount.
    // Without this, a remount would stack handlers and each fire N times.
    const networkListeners = [];
    const listen = (event, handler) => {
        networkListeners.push([event, handler]);
        Network.addEventListener(event, handler);
    };
    onUnmounted(() => {
        for (const [event, handler] of networkListeners) {
            Network.removeEventListener(event, handler);
        }
        networkListeners.length = 0;
    });

    listen('ratestStart', (data) => {
        // The initiating play()/rerecord() call has already pre-loaded
        // the steps and snapshotted playbackUids so the full script is
        // visible before the first ratestStep arrives. All we do here
        // is flip the rerecord flag so the insert logic knows the
        // difference.
        if (data?.rerecord) {
            rerecording.value = true;
        }
    });

    // Completion signal: the engine emits this for every playRatest
    // attempt — successful runs, failures, aborts, and early errors.
    // UI state flips here (not on the playRatest HTTP response) because
    // long recorded test runs exceed the 30s request timeout.
    listen('ratestEnd', (data) => {
        const passed = data.passed ?? 0;
        const failed = data.failed ?? 0;
        const total = data.total ?? 0;
        const error = data.error;
        steps.value.push(newStep({
            phase: failed === 0 ? 'pass' : 'fail',
            source: failed === 0
                ? `Passed ${passed}/${total}`
                : `Failed ${failed}/${total}${error ? ` — ${error}` : ''}`,
            isSummary: true,
        }));
        scrollLogToBottom();
        running.value = false;
        paused.value = false;
        if (rerecording.value) {
            rerecording.value = false;
            playbackUids.value = [];
            rerecordInsertPosition = 0;
        }
        currentPlayingUid.value = null;
        playingRowEl = null;
    });

    listen('ratestStep', (data) => {
        // The engine fires two events per step — `start` before running,
        // then `pass`/`fail`/`ok` (with durationMs/error) after. Backend
        // indices refer to the scaffold captured at playback start;
        // local positions may drift during rerecord as captures get
        // spliced in, so we always route updates through the uid
        // snapshot set up by play()/rerecord().
        const i = data.index;
        if (typeof i !== 'number' || i < 0) return;
        const { index, ...rest } = data;
        void index;
        const targetUid = playbackUids.value[i];
        if (targetUid === undefined) return;
        const pos = steps.value.findIndex((s) => s.uid === targetUid);
        if (pos < 0) return;
        steps.value[pos] = { ...steps.value[pos], ...rest };
        if (rest.phase === 'start') {
            currentPlayingUid.value = targetUid;
            if (rerecording.value) rerecordInsertPosition = pos + 1;
            scrollPlayingIntoView();
        }
    });

    listen('recordingStart', async (data) => {
        // The backend allocated/validated the target filename and seeded
        // its buffer before firing this event. New-record mode wipes the
        // step view; continue mode preserves whatever we pre-loaded.
        const continueMode = !!data?.continueMode;
        const filename = data?.filename ?? null;
        if (!continueMode) {
            steps.value = [];
            loadedFromFile.value = filename;
            if (filename) selected.value = filename;
        }
        recording.value = true;
        await refreshList();
    });

    listen('recordingLine', (data) => {
        const source = String(data?.source ?? '');
        if (!source) return;
        const fresh = newStep({
            source,
            label: data?.label ?? null,
            phase: 'record',
        });
        if (rerecording.value) {
            // Splice into the scaffold at the current playback position
            // (set by the last step-start we saw). Advance the insert
            // marker so back-to-back captures keep their capture order
            // instead of reversing.
            const pos = Math.min(rerecordInsertPosition, steps.value.length);
            const next = steps.value.slice();
            next.splice(pos, 0, fresh);
            steps.value = next;
            rerecordInsertPosition = pos + 1;
            // Rerecord inserts go through the splice path; the backend
            // doesn't auto-append them to any buffer, so push the
            // updated list ourselves to keep state consistent.
            syncBufferToBackend(loadedFromFile.value);
        } else {
            steps.value.push(fresh);
            // Plain recording: the backend has already appended to its
            // buffer natively, so we don't round-trip setRatestBuffer
            // here. refreshList picks up the new dirty flag.
            refreshList();
        }
        scrollLogToBottom();
    });

    listen('recordingStopped', async () => {
        recording.value = false;
        await refreshList();
    });

    listen('recordingCancel', async () => {
        recording.value = false;
        await refreshList();
    });

    listen('recordingSaved', async (data) => {
        recording.value = false;
        loadedFromFile.value = data.file;
        await refreshList();
    });

    watch(selected, async (file) => {
        if (running.value || recording.value) return;
        // Already showing this file — nothing to do.
        if (loadedFromFile.value === file) return;

        if (!file) {
            steps.value = [];
            loadedFromFile.value = null;
            return;
        }

        // The backend returns buffer content if dirty, else disk
        // content — the frontend doesn't need to branch.
        const response = await Network.send({
            command: 'previewRatest',
            params: { file },
        });
        if (selected.value !== file) return;
        if (running.value || recording.value) return;
        steps.value = response.success
            ? (response.params.steps ?? []).map((s) => newStep({
                source: s.source,
                phase: 'start',
            }))
            : [];
        loadedFromFile.value = file;
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
            // Backend list already unions disk + buffer entries; a file
            // that disappears from both layers (e.g., deleted) gets
            // deselected automatically.
            if (selected.value && !files.value.find((f) => f.name === selected.value)) {
                selected.value = null;
            }
        } else {
            files.value = [];
            dir.value = null;
        }
    };

    // Shared prelude for play() and rerecord(): ensure `steps` holds the
    // current script with stable uids (buffer content if dirty, else
    // disk), snapshot those uids so the backend's ratestStep indices can
    // be mapped back to rows even if the list mutates during rerecord,
    // and reset the highlight state. Returns true on success.
    const preparePlayback = async (target) => {
        if (loadedFromFile.value !== target || selected.value !== target) {
            const previewResp = await Network.send({
                command: 'previewRatest',
                params: { file: target },
            });
            if (!previewResp.success) {
                showError(`Couldn't load ${target}: ${previewResp.error ?? 'unknown error'}`);
                return false;
            }
            steps.value = (previewResp.params.steps ?? []).map((s) => newStep({
                source: s.source,
                phase: 'start',
            }));
            loadedFromFile.value = target;
            selected.value = target;
        }
        playbackUids.value = steps.value.map((s) => s.uid);
        rerecordInsertPosition = 0;
        currentPlayingUid.value = null;
        playingRowEl = null;
        return true;
    };

    const play = async (file) => {
        const target = file ?? selected.value;
        if (!target) return;
        if (!(await preparePlayback(target))) return;
        running.value = true;
        paused.value = false;
        // Fire-and-forget: completion is signalled via the 'ratestEnd'
        // event, because the network layer's 30s request timeout would
        // otherwise resolve this promise long before a long test run
        // actually finishes.
        Network.send({
            command: 'playRatest',
            params: { file: target, achievementsEnabled: achievementsMode.value },
        }).catch((err) => console.error('playRatest failed:', err));
    };

    const rerecord = async (file) => {
        const target = file ?? selected.value;
        if (!target) return;
        if (!(await preparePlayback(target))) return;
        running.value = true;
        paused.value = false;
        Network.send({
            command: 'playRatest',
            params: {
                file: target,
                achievementsEnabled: achievementsMode.value,
                rerecordMode: true,
            },
        }).catch((err) => console.error('rerecord failed:', err));
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

    const toggleRestart = async () => {
        const next = !playbackRestart.value;
        await persistSettingPatch({ playbackRestart: next });
        playbackRestart.value = next;
    };

    const toggleAchievements = () => {
        achievementsMode.value = !achievementsMode.value;
    };

    const toggleRealtime = () => {
        realtimeMode.value = !realtimeMode.value;
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
        // The backend allocates the "New Recording N.ratest" filename,
        // seeds an empty buffer, and echoes it in the response. The
        // recordingStart event handler mirrors it into selected/loaded.
        const response = await Network.send({
            command: 'startRecording',
            params: {
                achievementsEnabled: achievementsMode.value,
                realtimeEnabled: realtimeMode.value,
            },
        });
        if (!response.success) {
            showError(`Couldn't start recording: ${response.error ?? 'unknown error'}`);
        }
    };

    const startContinueRecord = async (file) => {
        // Backend seeds its buffer from disk when the file isn't already
        // buffered, so no pre-load is needed here. The previewRatest
        // below populates the UI step list from the (now-seeded) buffer.
        const response = await Network.send({
            command: 'startRecording',
            params: {
                continueMode: true,
                filename: file,
                achievementsEnabled: achievementsMode.value,
                realtimeEnabled: realtimeMode.value,
            },
        });
        if (!response.success) {
            showError(`Couldn't continue recording: ${response.error ?? 'unknown error'}`);
            return;
        }
        const previewResp = await Network.send({
            command: 'previewRatest',
            params: { file },
        });
        if (previewResp.success) {
            steps.value = (previewResp.params.steps ?? []).map((s) => newStep({
                source: s.source,
                phase: 'start',
            }));
        }
        loadedFromFile.value = file;
        selected.value = file;
    };

    const stopRecord = async () => {
        // Just stops capture; the buffer survives in backend memory until
        // the user clicks Save (or starts another recording / picks a file).
        const response = await Network.send({ command: 'stopRecording', params: {} });
        if (!response.success) {
            showError(`Couldn't stop recording: ${response.error ?? 'unknown error'}`);
        }
    };

    // Save flushes the backend's ephemeral buffer for the selected file
    // to disk. The filename is always known (backend assigned it at
    // record time or it came from the file list), so there's no prompt.
    // Rename is now immediate (handled by renameRatest) and doesn't
    // piggyback on Save.
    const saveSelected = async () => {
        if (!selected.value || !canSave.value) return;
        const resp = await Network.send({
            command: 'saveRatest',
            params: { filename: selected.value },
        });
        if (!resp.success) {
            showError(`Save failed: ${resp.error ?? 'unknown error'}`);
            return;
        }
        await refreshList();
    };

    const askRename = async (file) => {
        renameValue.value = displayName(file);
        renamingFile.value = file;
        await nextTick();
        if (renameInputEl.value) {
            renameInputEl.value.focus();
            renameInputEl.value.select();
        }
    };

    const confirmRename = async () => {
        const from = renamingFile.value;
        if (!from) return;
        const raw = renameValue.value.trim();
        renamingFile.value = null;
        renameValue.value = '';
        if (!raw) return;
        const to = raw.endsWith('.ratest') ? raw : `${raw}.ratest`;
        if (to === from) return;
        // Rename is immediate on both layers — backend renames disk
        // file + buffer key atomically, so the UI list reflects it on
        // the next refreshList.
        const resp = await Network.send({
            command: 'renameRatest',
            params: { from, to },
        });
        if (!resp.success) {
            showError(`Couldn't rename ${from} to ${to}: ${resp.error ?? 'unknown error'}`);
            return;
        }
        if (selected.value === from) selected.value = to;
        if (loadedFromFile.value === from) loadedFromFile.value = to;
        await refreshList();
    };

    const cancelRename = () => {
        renamingFile.value = null;
        renameValue.value = '';
    };

    const doDelete = async (file) => {
        // Backend handles both layers atomically — drops the buffer
        // entry (if any) and removes the on-disk file (if any).
        const response = await Network.send({
            command: 'deleteRatest',
            params: { file },
        });
        if (!response.success) {
            showError(`Couldn't delete ${file}: ${response.error ?? 'unknown error'}`);
            return;
        }
        if (selected.value === file) selected.value = null;
        if (loadedFromFile.value === file) {
            loadedFromFile.value = null;
            steps.value = [];
        }
        await refreshList();
    };

    const requestDiscard = (file) => {
        if (!hasDiscardableChanges(file)) return;
        discardConfirmFile.value = file;
    };

    const cancelDiscard = () => {
        discardConfirmFile.value = null;
    };

    // Discard drops the backend's buffer entry for `file`; the next
    // previewRatest returns the on-disk version. Only files with a
    // disk-side counterpart are eligible (hasDiscardableChanges
    // enforces this), so we always have something to reload.
    const confirmDiscard = async () => {
        const file = discardConfirmFile.value;
        discardConfirmFile.value = null;
        if (!file) return;

        const discardResp = await Network.send({
            command: 'discardRatestBuffer',
            params: { file },
        });
        if (!discardResp.success) {
            showError(`Couldn't discard ${file}: ${discardResp.error ?? 'unknown error'}`);
            return;
        }

        if (loadedFromFile.value === file) {
            const resp = await Network.send({
                command: 'previewRatest',
                params: { file },
            });
            if (!resp.success) {
                showError(`Couldn't reload ${file}: ${resp.error ?? 'unknown error'}`);
                return;
            }
            steps.value = (resp.params.steps ?? []).map((s) => newStep({
                source: s.source,
                phase: 'start',
            }));
        }
        await refreshList();
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

    const contextRerecord = () => {
        const file = contextMenu.value?.file;
        closeContextMenu();
        if (file) rerecord(file);
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

    const contextDiscard = () => {
        const file = contextMenu.value?.file;
        closeContextMenu();
        if (file) requestDiscard(file);
    };

    App.initialize().then(async () => {
        App.ready = true;
        const settings = await Network.send({ command: 'getSettings', params: {} });
        if (settings.success) {
            gameHash.value = settings.params.gameHash ?? null;
            if (typeof settings.params.playbackRestart === 'boolean') {
                playbackRestart.value = settings.params.playbackRestart;
            }
        }
        await refreshList();
    });
</script>
