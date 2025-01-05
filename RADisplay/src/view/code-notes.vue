<template>
    <div class="container" v-if="App.ready">
        <div class="header">
            <button class="add-button" @click="addNote">+ Add</button>
            <input
                type="text"
                class="search-input"
                v-model="searchQuery"
                placeholder="Search notes..."
                spellcheck="false"
            />
        </div>

        <div class="table-wrapper">
            <div class="table-container" ref="scrollContainer">
                <table class="notes-table" v-if="codeNotes.length > 0">
                    <thead>
                        <tr>
                            <th class="note-column">Note</th>
                            <th class="path-column">Path</th>
                            <th class="value-column">Value</th>
                            <th class="actions-column"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="{ note, originalIndex } in filteredCodeNotes" :key="note.id" :data-index="originalIndex">
                            <td class="note-column">
                                <input
                                    type="text"
                                    v-model="note.note"
                                    @change="save"
                                    placeholder="Description..."
                                    spellcheck="false"
                                />
                            </td>
                            <td class="path-column">
                                <input
                                    type="text"
                                    v-model="note.path"
                                    @change="save"
                                    placeholder="stage.player.health"
                                    spellcheck="false"
                                />
                            </td>
                            <td class="value-column">{{ rowValues[originalIndex] ?? '-' }}</td>
                            <td class="actions-column">
                                <button class="move-button" @click="moveUp(originalIndex)" :disabled="originalIndex === 0">▲</button>
                                <button class="move-button" @click="moveDown(originalIndex)" :disabled="originalIndex === codeNotes.length - 1">▼</button>
                                <button class="delete-button" @click="deleteNote(originalIndex)">x</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div v-else class="empty-state">
                    <p>No code notes yet.</p>
                    <p>Click "+ Add" to create one.</p>
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
        padding: 0.5rem;
        box-sizing: border-box;
    }

    .header {
        flex-shrink: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.25rem;
    }

    .add-button {
        background-color: #4f46e5;
        color: #ffffff;
        font-weight: 500;
        font-size: 0.75rem;
        border: none;
        border-radius: 0.25rem;
        padding: 0.25rem 0.5rem;
        cursor: pointer;
        transition: background-color 200ms;
    }

    .add-button:hover {
        background-color: #4338ca;
    }

    .search-input {
        background-color: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 0.25rem;
        padding: 0.2rem 0.5rem;
        font-size: 0.75rem;
        width: 150px;
    }

    .search-input:focus {
        outline: none;
        border-color: #4f46e5;
    }

    .table-wrapper {
        flex-grow: 1;
        display: flex;
        min-height: 0;
    }

    .table-container {
        flex-grow: 1;
        overflow-y: auto;
        background-color: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 0.25rem;
    }

    .notes-table {
        width: 100%;
        border-collapse: collapse;
    }

    .notes-table th {
        padding: 0.2rem 0.4rem;
        text-align: left;
        border-bottom: 1px solid #e5e7eb;
        font-family: "Fira Code", monospace;
        font-size: 0.65rem;
        background-color: #f9fafb;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        position: sticky;
        top: 0;
    }

    .notes-table td {
        padding: 0.1rem 0.25rem;
        border-bottom: 1px solid #f3f4f6;
        font-family: "Fira Code", monospace;
        font-size: 0.75rem;
    }

    .notes-table tbody tr:last-child td {
        border-bottom: none;
    }

    .notes-table tbody tr:nth-child(even) {
        background-color: #fafafa;
    }

    .notes-table tbody tr:hover {
        background-color: #eef2ff;
    }

    .note-column {
        width: 28%;
    }

    .path-column {
        width: 47%;
    }

    .value-column {
        width: 15%;
        color: #4f46e5;
        padding-left: 0.4rem !important;
    }

    .actions-column {
        width: 10%;
        text-align: right;
        white-space: nowrap;
    }

    .notes-table input {
        width: 100%;
        background-color: transparent;
        border: 1px solid transparent;
        border-radius: 0.15rem;
        padding: 0.1rem 0.25rem;
        font-family: "Fira Code", monospace;
        font-size: 0.75rem;
        box-sizing: border-box;
        transition: border-color 200ms, background-color 200ms;
    }

    .notes-table input:hover {
        background-color: #ffffff;
        border-color: #d1d5db;
    }

    .notes-table input:focus {
        outline: none;
        background-color: #ffffff;
        border-color: #4f46e5;
    }

    .delete-button {
        background-color: transparent;
        color: #9ca3af;
        border: none;
        padding: 0 0.2rem;
        cursor: pointer;
        font-size: 0.7rem;
        transition: color 200ms;
    }

    .delete-button:hover {
        color: #ef4444;
    }

    .move-button {
        background-color: transparent;
        color: #9ca3af;
        border: none;
        padding: 0 0.1rem;
        cursor: pointer;
        font-size: 0.55rem;
        transition: color 200ms;
    }

    .move-button:hover:not(:disabled) {
        color: #4f46e5;
    }

    .move-button:disabled {
        color: #e5e7eb;
        cursor: default;
    }

    .empty-state {
        text-align: center;
        padding: 2rem;
        color: #6b7280;
        font-size: 0.85rem;
    }
</style>

<script setup>
    import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
    import { Network } from '../js/network.ts';
    import { App } from '../js/app.ts';

    // Search filter
    const searchQuery = ref('');

    // Computed reference to codeNotes in App.data
    const codeNotes = computed(() => App.data.codeNotes || []);

    // Filtered notes with original indices preserved
    const filteredCodeNotes = computed(() => {
        const query = searchQuery.value.toLowerCase().trim();
        return codeNotes.value
            .map((note, index) => ({ note, originalIndex: index }))
            .filter(({ note }) => !query || note.note.toLowerCase().includes(query));
    });

    // Visibility tracking for live value updates
    const scrollContainer = ref(null);
    const rowValues = ref({});
    const visibleRows = ref(new Set());
    let observer = null;
    let intervalId = null;
    let nextId = 1;

    // Helper to check if element is visible within container
    const isElementVisible = (element, container) => {
        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        return elementRect.top < containerRect.bottom && elementRect.bottom > containerRect.top;
    };

    // Manually populate visible rows (IntersectionObserver may not fire immediately for already-visible elements)
    const populateInitialVisibleRows = () => {
        if (!scrollContainer.value) return;
        const rows = scrollContainer.value.querySelectorAll('tr[data-index]');
        rows.forEach(row => {
            if (isElementVisible(row, scrollContainer.value)) {
                const index = parseInt(row.dataset.index);
                visibleRows.value.add(index);
            }
        });
    };

    const addNote = () => {
        if (!App.data.codeNotes) {
            App.data.codeNotes = [];
        }
        App.data.codeNotes.push({
            id: nextId++,
            note: '',
            path: ''
        });
        save();
    };

    const deleteNote = (index) => {
        App.data.codeNotes.splice(index, 1);
        save();
    };

    const moveUp = (index) => {
        if (index <= 0) return;
        const notes = App.data.codeNotes;
        [notes[index - 1], notes[index]] = [notes[index], notes[index - 1]];
        save();
    };

    const moveDown = (index) => {
        if (index >= App.data.codeNotes.length - 1) return;
        const notes = App.data.codeNotes;
        [notes[index], notes[index + 1]] = [notes[index + 1], notes[index]];
        save();
    };

    const save = async () => {
        await Network.send({
            command: 'editData',
            params: {
                edited: [['codeNotes', JSON.parse(JSON.stringify(App.data.codeNotes))]]
            }
        });
    };

    // Setup observer and interval on mount
    onMounted(() => {
        // Initialize nextId from existing notes
        if (App.data.codeNotes) {
            const maxId = Math.max(0, ...App.data.codeNotes.map(n => n.id || 0));
            nextId = maxId + 1;
        }

        observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const index = parseInt(entry.target.dataset.index);
                if (entry.isIntersecting) {
                    visibleRows.value.add(index);
                } else {
                    visibleRows.value.delete(index);
                }
            });
        }, { root: scrollContainer.value, threshold: 0 });

        // Observe initial rows (watch with immediate:true runs before mount, so we need to do it here too)
        const rows = scrollContainer.value?.querySelectorAll('tr[data-index]');
        rows?.forEach(row => observer?.observe(row));

        // Manually check initial visibility (IntersectionObserver may not fire immediately)
        populateInitialVisibleRows();

        intervalId = setInterval(async () => {
            const visibleIndices = [...visibleRows.value];
            if (visibleIndices.length === 0) return;

            // Collect all paths for visible rows
            const pathsWithIndices = visibleIndices
                .map(index => ({ index, path: codeNotes.value[index]?.path }))
                .filter(item => item.path);

            if (pathsWithIndices.length === 0) return;

            const reply = await Network.send({
                command: 'evaluateMultiple',
                params: { inputs: pathsWithIndices.map(item => item.path) }
            });

            if (reply.success && reply.params.results) {
                for (let i = 0; i < pathsWithIndices.length; i++) {
                    const { index } = pathsWithIndices[i];
                    const result = reply.params.results[i];
                    if (result?.output?.length > 0) {
                        rowValues.value[index] = result.output[0].value;
                    } else {
                        rowValues.value[index] = '-';
                    }
                }
            }
        }, 1000);
    });

    // Observe rows when codeNotes array length changes (add/remove)
    watch(() => codeNotes.value.length, async () => {
        rowValues.value = {};
        visibleRows.value = new Set();

        await nextTick();

        observer?.disconnect();

        const rows = scrollContainer.value?.querySelectorAll('tr[data-index]');
        rows?.forEach(row => observer?.observe(row));

        // Manually check initial visibility (IntersectionObserver may not fire immediately)
        populateInitialVisibleRows();
    });

    // Set up visibility tracking after App.ready becomes true (DOM is rendered)
    watch(() => App.ready, (ready) => {
        if (ready) {
            nextTick(() => {
                const rows = scrollContainer.value?.querySelectorAll('tr[data-index]');
                rows?.forEach(row => observer?.observe(row));
                populateInitialVisibleRows();
            });
        }
    });

    // Cleanup
    onUnmounted(() => {
        observer?.disconnect();
        if (intervalId) clearInterval(intervalId);
    });

    App.initialize().then(() => App.ready = true);
</script>
