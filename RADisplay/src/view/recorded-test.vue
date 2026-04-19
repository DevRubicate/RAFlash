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
                <button
                    class="achievements-button"
                    @click="toggleAchievements()"
                    title="When Yes, recording captures achievement triggers as `achievement <id>` lines and playback verifies they fire within 5s. When No, recording omits them and playback skips existing ones."
                >
                    Achievements: {{ achievementsMode ? 'Yes' : 'No' }}
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
                                v-if="isDirty(file)"
                                class="file-dirty-mark"
                                title="Unsaved edits"
                            >*</span>
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
                        v-for="{ step, originalIndex } in displayedSteps"
                        :key="step.uid"
                        :class="{ summary: step.isSummary }"
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

    .file-list li.pending-rename .file-name {
        font-weight: 700;
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
    .delay-button,
    .restart-button,
    .achievements-button,
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

    .achievements-button {
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
    import { ref, computed, nextTick, watch } from 'vue';
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
    // The file the current `steps` belong to, if any. Set by previewRatest
    // (selecting a file), by startContinueRecord (explicit pre-load),
    // and by saveRatest (after a successful save). null means a brand-new
    // recording with no on-disk home yet — Save prompts for a name.
    const loadedFromFile = ref(null);
    // True whenever `steps` differs from disk — set by capture/edit/
    // delete/reorder/insert, cleared on save or fresh-load.
    const unsavedRecording = ref(false);
    // Per-file stash of dirty step arrays, keyed by on-disk filename.
    // Populated when switching away from a dirty file, drained when
    // switching back. Lets the user move between files mid-edit without
    // losing in-memory work.
    const unsavedSteps = ref({});
    // Files that exist only in memory — a New Record session in flight.
    // They show up in the list alongside on-disk files so the user can
    // see what they're recording, but Save turns them into real files.
    // Cleared entries on: save (file hits disk), delete, discard.
    const ephemeralFiles = ref([]);
    const isEphemeral = (file) => ephemeralFiles.value.includes(file);
    // Displayed list: on-disk files first, then ephemerals. Preserves
    // backend sort for disk files (currently alphabetical) so the newly
    // minted ephemeral lands at the bottom of the list where it's easy
    // to find.
    const displayFiles = computed(() => {
        const disk = files.value.filter((f) => !ephemeralFiles.value.includes(f));
        return [...disk, ...ephemeralFiles.value];
    });
    const isDirty = (file) => isEphemeral(file) || (file === loadedFromFile.value
        ? unsavedRecording.value
        : Object.prototype.hasOwnProperty.call(unsavedSteps.value, file));
    const pendingSave = ref(false);
    const saveFilename = ref('');
    const saveInputEl = ref(null);

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

    const moveStep = (uid, delta) => {
        const i = steps.value.findIndex((s) => s.uid === uid);
        if (i < 0) return;
        const j = i + delta;
        if (j < 0 || j >= steps.value.length) return;
        if (steps.value[j].isSummary) return;
        const next = steps.value.slice();
        [next[i], next[j]] = [next[j], next[i]];
        steps.value = next;
        unsavedRecording.value = true;
    };

    const addStepBelow = async (uid) => {
        const i = steps.value.findIndex((s) => s.uid === uid);
        if (i < 0) return;
        const fresh = newStep({ source: '', phase: 'start' });
        const next = steps.value.slice();
        next.splice(i + 1, 0, fresh);
        steps.value = next;
        unsavedRecording.value = true;
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

    const closeEditModal = () => {
        // Cancelling on a brand-new row that was never given content
        // discards it — otherwise the user would see a phantom blank row.
        if (editingStepIsNew.value && editingStep.value) {
            const target = editingStep.value;
            const i = steps.value.findIndex((s) => s.uid === target.uid);
            if (i >= 0 && !(steps.value[i].source ?? '').trim()) {
                steps.value = steps.value.filter((s) => s.uid !== target.uid);
            }
        }
        editingStep.value = null;
        editDraft.value = '';
        editingStepIsNew.value = false;
    };

    const confirmEdit = () => {
        const target = editingStep.value;
        if (!target) return;
        const newSource = editDraft.value.trim();
        if (!newSource) return;
        const i = steps.value.findIndex((s) => s.uid === target.uid);
        if (i >= 0 && steps.value[i].source !== newSource) {
            steps.value[i] = { ...steps.value[i], source: newSource };
            unsavedRecording.value = true;
        }
        editingStep.value = null;
        editDraft.value = '';
        editingStepIsNew.value = false;
    };

    const deleteEditingStep = () => {
        const target = editingStep.value;
        if (!target) return;
        const i = steps.value.findIndex((s) => s.uid === target.uid);
        if (i >= 0) {
            steps.value = steps.value.filter((s) => s.uid !== target.uid);
            unsavedRecording.value = true;
        }
        editingStep.value = null;
        editDraft.value = '';
        editingStepIsNew.value = false;
    };

    const playbackDelayMs = ref(200);
    const playbackRestart = ref(true);
    // Per-session toggle (intentionally not persisted): controls whether
    // achievement triggers get captured during recording and asserted
    // during playback. Resets to Yes on every RAFlash launch.
    const achievementsMode = ref(true);
    const delayModalOpen = ref(false);
    const delayDraft = ref(200);
    const delayInputEl = ref(null);

    const contextMenu = ref(null);

    // Pending renames queued by the user; flushed only when the affected
    // file is selected and the user clicks Save. Keyed by the on-disk
    // filename, never the display name. Deletes are NOT pending — they hit
    // disk immediately because there's no row left to "select to save".
    const pendingRenames = ref({});

    // Strip the `.ratest` suffix for display — every file in the list has
    // it, so it's pure noise. Renames are entered without it too.
    const stripExt = (name) => (name || '').replace(/\.ratest$/, '');
    const displayName = (file) => stripExt(pendingRenames.value[file] || file);
    const isPendingRename = (file) => Object.prototype.hasOwnProperty.call(pendingRenames.value, file);
    const selectedHasPendingRename = computed(() =>
        selected.value !== null && isPendingRename(selected.value),
    );
    // Save is per-file: it covers the in-memory recording (which has its
    // own implicit focus) plus the pending rename of the selected row.
    // Other rows' pending renames stay queued until those rows are selected.
    const canSave = computed(() => unsavedRecording.value || selectedHasPendingRename.value);

    // Covers both content drift (in-memory steps diverged from disk) and
    // metadata drift (a pending rename waiting for Save). "Discard changes"
    // clears both, so both count when deciding whether to enable the menu.
    // Ephemeral files have no disk version to revert to, so Discard makes
    // no sense for them — they can only be removed via Delete.
    const hasDiscardableChanges = (file) =>
        !isEphemeral(file) && (isDirty(file) || isPendingRename(file));

    const renamingFile = ref(null);
    const renameValue = ref('');
    const renameInputEl = ref(null);
    const setRenameInputRef = (el) => { if (el) renameInputEl.value = el; };

    const scrollLogToBottom = () => {
        requestAnimationFrame(() => {
            if (stepLogEl.value) stepLogEl.value.scrollTop = stepLogEl.value.scrollHeight;
        });
    };

    Network.addEventListener('ratestStart', (data) => {
        // Rerecord preserves the loaded steps — those ARE the scaffold
        // the playback iterates over, and they'll be mutated in place
        // with insertions. For regular playback we clear and let
        // ratestStep events repopulate from scratch.
        if (data?.rerecord) {
            rerecording.value = true;
            playbackUids.value = steps.value.map((s) => s.uid);
            rerecordInsertPosition = 0;
            return;
        }
        steps.value = [];
    });

    // Completion signal: the engine emits this for every playRatest
    // attempt — successful runs, failures, aborts, and early errors.
    // UI state flips here (not on the playRatest HTTP response) because
    // long recorded test runs exceed the 30s request timeout.
    Network.addEventListener('ratestEnd', (data) => {
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
    });

    Network.addEventListener('ratestStep', (data) => {
        // The engine fires two events per step — `start` before running,
        // then `pass`/`fail`/`ok` (with durationMs/error) after. On the
        // first we append, on the second we update in place. play() wipes
        // the log before kickoff so indices always begin at 0.
        const i = data.index;
        if (typeof i !== 'number' || i < 0) return;
        const { index, ...rest } = data;
        void index;
        if (rerecording.value) {
            // Backend indices refer to the playback scaffold at start;
            // local positions may have shifted because of inserts. Route
            // the update through the uid snapshot so the right row
            // updates even after splices.
            const targetUid = playbackUids.value[i];
            if (targetUid !== undefined) {
                const pos = steps.value.findIndex((s) => s.uid === targetUid);
                if (pos >= 0) {
                    steps.value[pos] = { ...steps.value[pos], ...rest };
                    if (rest.phase === 'start') {
                        rerecordInsertPosition = pos + 1;
                    }
                }
            }
            scrollLogToBottom();
            return;
        }
        if (i < steps.value.length) {
            steps.value[i] = { ...steps.value[i], ...rest };
        } else {
            steps.value.push(newStep(rest));
        }
        scrollLogToBottom();
    });

    Network.addEventListener('recordingStart', (data) => {
        // Continue mode preserves the steps that were loaded from the
        // selected file; new-record mode starts from a clean slate, but
        // we stash any unsaved edits on the previously loaded file first
        // so the user doesn't lose them on switch-back.
        const continueMode = !!data?.continueMode;
        if (!continueMode) {
            stashCurrentIfDirty();
            steps.value = [];
            loadedFromFile.value = null;
        }
        recording.value = true;
        unsavedRecording.value = false;
    });

    Network.addEventListener('recordingLine', (data) => {
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
        } else {
            steps.value.push(fresh);
        }
        unsavedRecording.value = true;
        scrollLogToBottom();
    });

    Network.addEventListener('recordingStopped', () => {
        recording.value = false;
    });

    Network.addEventListener('recordingCancel', () => {
        recording.value = false;
        unsavedRecording.value = false;
    });

    Network.addEventListener('recordingSaved', (data) => {
        recording.value = false;
        unsavedRecording.value = false;
        loadedFromFile.value = data.file;
        // The just-saved file is now in sync with disk; drop any stale
        // stash entry it may have had.
        if (Object.prototype.hasOwnProperty.call(unsavedSteps.value, data.file)) {
            const next = { ...unsavedSteps.value };
            delete next[data.file];
            unsavedSteps.value = next;
        }
        // Graduate an ephemeral to a real on-disk file: refreshList will
        // pick it up from disk on the next cycle, so the display entry
        // should come from `files`, not `ephemeralFiles`.
        if (ephemeralFiles.value.includes(data.file)) {
            ephemeralFiles.value = ephemeralFiles.value.filter((f) => f !== data.file);
        }
    });

    // Stash the currently-loaded file's dirty steps so they can be
    // restored on switch-back. Called from the watcher and from the
    // recordingStart handler when a new (non-continue) recording wipes
    // the live state.
    const stashCurrentIfDirty = () => {
        if (unsavedRecording.value && loadedFromFile.value) {
            unsavedSteps.value = {
                ...unsavedSteps.value,
                [loadedFromFile.value]: steps.value.slice(),
            };
        }
    };

    watch(selected, async (file) => {
        if (running.value || recording.value) return;
        // Already showing this file — nothing to do. If the user just
        // re-clicked the selected row, the watcher wouldn't fire anyway;
        // this guard catches the case where startContinueRecord pre-loads
        // the file and only then bumps `selected`, which would otherwise
        // race with our explicit load below.
        if (loadedFromFile.value === file) return;

        stashCurrentIfDirty();
        unsavedRecording.value = false;

        if (!file) {
            steps.value = [];
            loadedFromFile.value = null;
            return;
        }

        // Restore from the per-file stash if it has entries — the user
        // had edits in flight on this file before navigating away.
        if (Object.prototype.hasOwnProperty.call(unsavedSteps.value, file)) {
            steps.value = unsavedSteps.value[file].slice();
            loadedFromFile.value = file;
            unsavedRecording.value = true;
            const next = { ...unsavedSteps.value };
            delete next[file];
            unsavedSteps.value = next;
            return;
        }

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
            // An ephemeral recording has no disk row yet but still belongs
            // in the list. Only clear the selection if the file is missing
            // from BOTH disk and the ephemeral set.
            if (selected.value && !files.value.includes(selected.value) && !isEphemeral(selected.value)) {
                selected.value = null;
            }
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
        steps.value = [];
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
        // Ephemerals have no on-disk content to play back — guard to
        // match contextPlay's behavior.
        if (isEphemeral(target)) {
            showError(`Save "${displayName(target)}" before rerecording it.`);
            return;
        }
        // Pre-load the script so its steps (with stable uids) are present
        // in the view before playback starts broadcasting ratestStart.
        // Matches the startContinueRecord loading pattern.
        if (loadedFromFile.value !== target || selected.value !== target) {
            const previewResp = await Network.send({
                command: 'previewRatest',
                params: { file: target },
            });
            if (!previewResp.success) {
                showError(`Couldn't load ${target}: ${previewResp.error ?? 'unknown error'}`);
                return;
            }
            steps.value = (previewResp.params.steps ?? []).map((s) => newStep({
                source: s.source,
                phase: 'start',
            }));
            loadedFromFile.value = target;
            selected.value = target;
            unsavedRecording.value = false;
        }
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

    const toggleAchievements = () => {
        achievementsMode.value = !achievementsMode.value;
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

    // Allocate "New Recording N.ratest" with N chosen to not collide with
    // anything already known: disk files, pending rename targets, or other
    // in-flight ephemerals. Rename targets count so you can't queue
    // "New Recording 1" as a rename and then get a fresh New Record that
    // shadows it.
    const allocateNewRecordingName = () => {
        const taken = new Set([
            ...files.value,
            ...ephemeralFiles.value,
            ...Object.values(pendingRenames.value),
        ]);
        for (let n = 1; ; n++) {
            const candidate = `New Recording ${n}.ratest`;
            if (!taken.has(candidate)) return candidate;
        }
    };

    const startNewRecord = async () => {
        const response = await Network.send({
            command: 'startRecording',
            params: { achievementsEnabled: achievementsMode.value },
        });
        if (!response.success) {
            showError(`Couldn't start recording: ${response.error ?? 'unknown error'}`);
            return;
        }
        // The recordingStart event has already fired by the time this
        // resolves and reset loadedFromFile to null. Auto-assign an
        // ephemeral name now so the session shows up in the file list
        // and Save writes straight to disk without prompting.
        const name = allocateNewRecordingName();
        ephemeralFiles.value = [...ephemeralFiles.value, name];
        loadedFromFile.value = name;
        selected.value = name;
        // Mark dirty so the *-asterisk and Save button show up even
        // before the first recorded interaction arrives.
        unsavedRecording.value = true;
    };

    const startContinueRecord = async (file) => {
        // The file's steps must already be in `steps` before we kick the
        // backend, since recordingStart with continueMode=true preserves
        // whatever's currently in the log. Load synchronously here rather
        // than racing the selected-file watcher.
        if (loadedFromFile.value !== file || selected.value !== file) {
            const previewResp = await Network.send({
                command: 'previewRatest',
                params: { file },
            });
            if (!previewResp.success) {
                showError(`Couldn't load ${file}: ${previewResp.error ?? 'unknown error'}`);
                return;
            }
            steps.value = (previewResp.params.steps ?? []).map((s) => newStep({
                source: s.source,
                phase: 'start',
            }));
            loadedFromFile.value = file;
            selected.value = file;
        }
        const response = await Network.send({
            command: 'startRecording',
            params: { continueMode: true, achievementsEnabled: achievementsMode.value },
        });
        if (!response.success) {
            showError(`Couldn't continue recording: ${response.error ?? 'unknown error'}`);
        }
    };

    const stopRecord = async () => {
        // Just stops capture; the buffer survives in backend memory until
        // the user clicks Save (or starts another recording / picks a file).
        const response = await Network.send({ command: 'stopRecording', params: {} });
        if (!response.success) {
            showError(`Couldn't stop recording: ${response.error ?? 'unknown error'}`);
        }
    };

    // Resolve the on-disk filename to write to. A previewed-or-continued
    // file is the target; a brand-new recording with no source needs the
    // filename prompt.
    const saveTargetFile = computed(() => loadedFromFile.value);

    const openSavePrompt = async () => {
        if (!canSave.value) return;
        if (unsavedRecording.value && !saveTargetFile.value) {
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

    // Per-file save: flush the in-memory steps (a recording, an edit, or
    // both) plus the pending rename for the selected row. Pending renames
    // for OTHER rows stay queued until those rows are selected.
    //
    // Order matters when both a write and a rename apply: write to the
    // current on-disk name first, then rename, otherwise the write would
    // target a stale path.
    const saveSelected = async (recordingFilename) => {
        if (unsavedRecording.value) {
            const filename = recordingFilename || saveTargetFile.value;
            if (!filename) {
                showError('No filename to save to.');
                return;
            }
            const lines = steps.value
                .filter((s) => !s.isSummary && typeof s.source === 'string')
                .map((s) => s.source);
            const resp = await Network.send({
                command: 'saveRatest',
                params: { filename, lines },
            });
            if (!resp.success) {
                showError(`Save failed: ${resp.error ?? 'unknown error'}`);
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
                if (loadedFromFile.value === from) loadedFromFile.value = to;
            } else {
                showError(`Couldn't rename ${from} to ${to}: ${resp.error ?? 'unknown error'}`);
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
        // displayName already strips the .ratest suffix.
        renameValue.value = displayName(file);
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
        // Ephemerals live only in the frontend — there's no on-disk file
        // for the backend to delete. Strip the local bookkeeping so the
        // row disappears, then bail out.
        if (isEphemeral(file)) {
            ephemeralFiles.value = ephemeralFiles.value.filter((f) => f !== file);
            if (selected.value === file) selected.value = null;
            if (loadedFromFile.value === file) {
                loadedFromFile.value = null;
                steps.value = [];
                unsavedRecording.value = false;
            }
            if (Object.prototype.hasOwnProperty.call(unsavedSteps.value, file)) {
                const next = { ...unsavedSteps.value };
                delete next[file];
                unsavedSteps.value = next;
            }
            return;
        }
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
            // Drop any stashed unsaved edits — they referred to a file
            // that no longer exists.
            if (Object.prototype.hasOwnProperty.call(unsavedSteps.value, file)) {
                const next = { ...unsavedSteps.value };
                delete next[file];
                unsavedSteps.value = next;
            }
            await refreshList();
        } else {
            showError(`Couldn't delete ${file}: ${response.error ?? 'unknown error'}`);
        }
    };

    const requestDiscard = (file) => {
        if (!hasDiscardableChanges(file)) return;
        discardConfirmFile.value = file;
    };

    const cancelDiscard = () => {
        discardConfirmFile.value = null;
    };

    // Reload `file` from disk, throwing away any pending rename and any
    // in-memory step edits (live or stashed). Only files that actually
    // exist on disk can be discarded — saveless new recordings don't have
    // a list row and therefore can't reach this path.
    const confirmDiscard = async () => {
        const file = discardConfirmFile.value;
        discardConfirmFile.value = null;
        if (!file) return;

        if (isPendingRename(file)) {
            const next = { ...pendingRenames.value };
            delete next[file];
            pendingRenames.value = next;
        }
        if (Object.prototype.hasOwnProperty.call(unsavedSteps.value, file)) {
            const next = { ...unsavedSteps.value };
            delete next[file];
            unsavedSteps.value = next;
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
            unsavedRecording.value = false;
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
        if (!file) return;
        // Ephemerals haven't been written to disk yet, so the backend
        // has nothing to load. Surface a readable message instead of
        // letting playRatest fail with a cryptic file-not-found error.
        if (isEphemeral(file)) {
            showError(`Save "${displayName(file)}" before playing it.`);
            return;
        }
        play(file);
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
