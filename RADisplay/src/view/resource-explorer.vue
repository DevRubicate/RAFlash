<template>
    <div class="container" v-if="App.ready">
        <div class="bar bar-top">
            <input
                type="text"
                class="mono-input filter-input"
                v-model="filterText"
                placeholder="Filter resources..."
                spellcheck="false"
            />
            <select class="category-select" v-model="selectedCategory">
                <option value="all">All</option>
                <option value="string">Strings</option>
                <option value="frameLabel">Frame Labels</option>
                <option value="export">Exports</option>
                <option value="textField">Text Fields</option>
            </select>
            <span class="result-count" v-if="!loading">{{ filteredRows.length }} result{{ filteredRows.length !== 1 ? 's' : '' }}</span>
        </div>

        <div class="scroll-panel">
            <div v-if="loading" class="empty-state">
                <p>Scanning SWF...</p>
            </div>
            <div v-else-if="filteredRows.length === 0" class="empty-state">
                <p v-if="allRows.length === 0">No resources found.</p>
                <p v-else>No matches for current filter.</p>
            </div>
            <table class="data-table" v-else>
                <thead>
                    <tr>
                        <th class="col-category">Category</th>
                        <th class="col-value">Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(row, index) in filteredRows" :key="index">
                        <td class="col-category">
                            <span class="category-badge" :class="'badge-' + row.category">{{ row.label }}</span>
                        </td>
                        <td class="col-value mono-cell">{{ row.value }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<style>
    .filter-input {
        flex: 1;
    }

    .category-select {
        background-color: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
        padding: 0.4375rem 0.625rem;
        font-family: var(--font-sans);
        font-size: 0.8125rem;
        color: var(--c-text);
        cursor: pointer;
    }

    .category-select:focus {
        outline: none;
        border-color: var(--c-primary);
        box-shadow: var(--shadow-ring);
    }

    .result-count {
        font-size: 0.75rem;
        color: var(--c-text-muted);
        white-space: nowrap;
    }

    .col-category {
        width: 120px;
    }

    .mono-cell {
        font-family: var(--font-mono);
        user-select: text;
        word-break: break-all;
    }

    .category-badge {
        display: inline-block;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.02em;
    }

    .badge-string {
        background-color: #eef2ff;
        color: #3730a3;
    }

    .badge-frameLabel {
        background-color: #ecfdf5;
        color: #065f46;
    }

    .badge-export {
        background-color: #fefce8;
        color: #854d0e;
    }

    .badge-textField {
        background-color: #fdf2f8;
        color: #9d174d;
    }
</style>

<script setup>
    import { ref, computed } from 'vue';
    import { Network } from '../js/network.ts';
    import { App } from '../js/app.ts';

    const loading = ref(true);
    const filterText = ref('');
    const selectedCategory = ref('all');
    const resources = ref({ strings: [], frameLabels: [], exports: [], textFields: [] });

    const categoryLabels = {
        string: 'String',
        frameLabel: 'Frame Label',
        export: 'Export',
        textField: 'Text Field',
    };

    const allRows = computed(() => {
        const rows = [];
        for (const s of resources.value.strings) {
            rows.push({ category: 'string', label: categoryLabels.string, value: s });
        }
        for (const fl of resources.value.frameLabels) {
            rows.push({ category: 'frameLabel', label: categoryLabels.frameLabel, value: fl });
        }
        for (const ex of resources.value.exports) {
            rows.push({ category: 'export', label: categoryLabels.export, value: ex });
        }
        for (const tf of resources.value.textFields) {
            const display = tf.text ? `${tf.variable} = "${tf.text}"` : tf.variable;
            rows.push({ category: 'textField', label: categoryLabels.textField, value: display });
        }
        return rows;
    });

    const filteredRows = computed(() => {
        let rows = allRows.value;
        if (selectedCategory.value !== 'all') {
            rows = rows.filter(r => r.category === selectedCategory.value);
        }
        if (filterText.value.trim()) {
            const needle = filterText.value.trim().toLowerCase();
            rows = rows.filter(r => r.value.toLowerCase().includes(needle));
        }
        return rows;
    });

    const scan = async () => {
        loading.value = true;
        const response = await Network.send({ command: 'scanSwfResources', params: {} });
        if (response.success) {
            resources.value = response.params.resources;
        }
        loading.value = false;
    };

    App.initialize().then(() => {
        App.ready = true;
        scan();
    });
</script>
