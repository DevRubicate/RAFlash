<template>
    <div class="container" v-if="App.ready">
        <header class="editor-header">
            <div class="header-form-fields">
                <div class="header-row">
                    <div class="form-group">
                        <label for="title">Title</label>
                        <input type="text" id="title" v-model="App.selectedAsset.name" @change="App.save()">
                    </div>
                    <div class="form-group form-group-small">
                        <label for="id">ID</label>
                        <input type="text" id="id" :value="App.selectedAsset.id" readonly>
                    </div>
                </div>

                <div class="header-row">
                    <div class="form-group">
                        <label for="description">Description</label>
                        <input type="text" id="description" v-model="App.selectedAsset.description" @change="App.save()">
                    </div>
                    <div class="form-group form-group-small">
                        <label for="type">Type</label>
                        <select id="type" v-model="selectedProgressionType">
                            <option v-for="option in progressionOptions" :key="option.value" :value="option.value">{{option.text}}</option>
                        </select>
                    </div>
                </div>

                <div class="header-row">
                    <div class="form-group form-group-x-small">
                        <label for="points">Points</label>
                        <select id="points" v-model="selectedPoints">
                            <option v-for="option in pointsOptions" :key="option.value" :value="option.value">{{option.text}}</option>
                        </select>
                    </div>
                    <div class="spacer"></div>
                    <div class="form-group-checkbox">
                        <input type="checkbox" id="active-check" checked>
                        <label for="active-check">Active</label>
                    </div>
                    <div class="spacer"></div>
                    <div class="form-group form-group-small">
                        <label for="badge">Badge</label>
                        <div class="input-with-button">
                            <input type="text" id="badge" value="64056">
                            <button class="btn btn-secondary btn-compact">Upload</button>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="header-badge-image">
                <img alt="Badge Image">
            </div>
        </header>

        <div class="editor-main">
            <div class="editor-panel left-panel">
                <h3 class="panel-title">Groups</h3>
                <ul class="group-list">
                    <li v-for="(group, index) in selectedAsset.groups" :key="group.id" @click="selectedGroupId = group.id" :class="group.id === selectedGroupId ? 'active' : ''">
                        {{group.type === 'CORE' ? 'Core' : `Alt ${index}`}}
                    </li>
                </ul>
                <div class="button-group">
                    <button class="btn btn-icon" @click="addAltGroup()">+</button>
                    <button class="btn btn-icon" @click="removeAltGroup(selectedGroupId)">-</button>
                </div>
            </div>
            <div class="editor-panel right-panel">
                <div class="panel-header">
                    <h3 class="panel-title">Requirements</h3>
                    <div class="button-group">
                        <div class="form-group-checkbox"><input type="checkbox" id="h-check"><label for="h-check">Highlights</label></div>
                        <div class="form-group-checkbox"><input type="checkbox" id="pr-check"><label for="pr-check">Pause on Reset</label></div>
                        <div class="form-group-checkbox"><input type="checkbox" id="pt-check"><label for="pt-check">Pause on Trigger</label></div>
                    </div>
                </div>
                <div class="table-container">
                    <table class="requirements-table">
                        <thead>
                            <tr>
                                <th>ID</th><th>Flag</th><th>Type</th><th>Memory</th><th>Cmp</th><th>Type</th><th>Mem/Val</th><th>Hits</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(req, index) in selectedGroup.requirements" :key="req.id" @click="selectedRequirementId = req.id" :class="req.id === selectedRequirementId ? 'active' : 'not-active'">
                                <td>{{index+1}}</td>
                                <td><select v-model="req.flag"><option v-for="option in flagOptions" :value="option.value">{{option.text}}</option></select></td>
                                <td><select v-model="req.typeA"><option v-for="option in typeOptions" :value="option.value">{{option.text}}</option></select></td>
                                <td><input v-model="req.addressA"></td>
                                <td><select v-model="req.cmp"><option v-for="option in cmpOptions" :value="option.value">{{option.text}}</option></select></td>
                                <td><select v-model="req.typeB"><option v-for="option in typeOptions" :value="option.value">{{option.text}}</option></select></td>
                                <td><input v-model="req.addressB"></td>
                                <td>{{req.hits}} ({{req.maxHits}})</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <footer class="editor-footer">
            <button class="btn btn-secondary">Copy Definition</button>
            <div class="spacer"></div>
             <div class="button-group">
                <button class="btn btn-new" @click="newRequirement()">New</button>
                <button class="btn btn-remove" @click="removeRequirement()">Remove</button>
             </div>
             <div class="button-group">
                <button class="btn btn-secondary">Copy</button>
                <button class="btn btn-secondary">Paste</button>
             </div>
             <div class="button-group">
                <button class="btn btn-secondary">Move Up</button>
                <button class="btn btn-secondary">Move Down</button>
             </div>
             <div class="spacer"></div>
             <div class="form-group-checkbox"><input type="checkbox" id="dec-check"><label for="dec-check">Show Decimal</label></div>
        </footer>
    </div>
</template>

<style>
    /* === Core Layout & Theme === */
    :root {
        --primary-color: #4f46e5;
        --primary-color-light: #eef2ff;
        --primary-color-dark: #4338ca;
        --text-dark: #111827;
        --text-medium: #374151;
        --text-light: #6b7280;
        --border-color: #d1d5db;
        --border-color-light: #e5e7eb;
        --bg-light: #f9fafb;
        --bg-white: #ffffff;
    }

    *, *::before, *::after {
        box-sizing: border-box;
    }

    html, body {
        height: 100%;
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        background-color: var(--bg-light);
        color: var(--text-medium);
        font-size: 14px;
        overflow: hidden;
    }

    .container {
        display: flex;
        flex-direction: column;
        height: 100vh;
    }

    .spacer { flex: 1 1 auto; }

    /* === Form Controls === */
    .form-group {
        display: flex;
        flex-direction: column;
        flex: 1; 
    }
    .form-group label {
        font-size: 0.8rem;
        font-weight: 500;
        color: var(--text-light);
        margin-bottom: 0.25rem;
    }
    .form-group-small { flex: 0 1 130px; }
    .form-group-x-small { flex: 0 1 130px; }
    .form-group-fixed-width { flex: 0 0 auto; }

    .input-with-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    /* New rule to make the input inside this group flexible */
    .input-with-button input {
        flex: 1 1 auto; /* Allows the input to grow and shrink */
        min-width: 0;   /* Allows the input to shrink below its default size */
    }

    .form-group input[type="text"],
    .form-group select {
        width: 100%;
        background-color: var(--bg-white);
        border: 1px solid var(--border-color);
        border-radius: 0.375rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.9rem;
        transition: border-color 200ms, box-shadow 200ms;
    }
    .form-group input[type="text"]:focus,
    .form-group select:focus {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
    }
    .form-group input[readonly] {
        background-color: var(--bg-light);
        cursor: not-allowed;
    }

    .form-group-checkbox {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        white-space: nowrap;
        padding-bottom: 0.5rem;
    }
    .form-group-checkbox input[type="checkbox"] {
        width: 1rem;
        height: 1rem;
        border-radius: 0.25rem;
        border: 1px solid var(--border-color);
        accent-color: var(--primary-color);
    }
    .form-group-checkbox label {
        margin-bottom: 0;
    }

    /* === Button Styles === */
    .btn {
        border: 1px solid transparent;
        border-radius: 0.375rem;
        padding: 0.5rem 1rem;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 200ms, border-color 200ms;
        white-space: nowrap;
    }
    .btn-primary {
        background-color: var(--primary-color);
        color: var(--bg-white);
    }
    .btn-primary:hover { background-color: var(--primary-color-dark); }
    .btn-secondary {
        background-color: var(--bg-white);
        color: var(--text-medium);
        border-color: var(--border-color);
    }
    .btn-secondary:hover { border-color: var(--text-medium); }

    /* New class for a thinner button */
    .btn-compact {
        padding-left: 0.75rem;
        padding-right: 0.75rem;
    }

    .button-group { display: flex; gap: 0.75rem; }
    .btn-icon {
        font-size: 1.25rem;
        font-weight: bold;
        padding: 0.25rem 0.75rem;
    }

    /* === Header === */
    .editor-header {
        display: flex;
        gap: 1.5rem;
        background-color: var(--bg-white);
        padding: 1rem;
        border-bottom: 1px solid var(--border-color-light);
        flex-shrink: 0;
    }

    .header-form-fields {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .header-row {
        display: flex;
        gap: 1.5rem;
        align-items: flex-end;
    }

    .header-badge-image {
        width: 128px;
        height: 128px;
        flex-shrink: 0;
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        padding: 0.5rem;
        background-color: var(--bg-white);
        align-self: center;
    }

    .header-badge-image img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }


    /* === Main Content === */
    .editor-main {
        flex: 1 1 auto;
        display: flex;
        gap: 1rem;
        padding: 1rem;
        min-height: 0;
    }
    .editor-panel {
        background-color: var(--bg-white);
        border: 1px solid var(--border-color-light);
        border-radius: 0.5rem;
        display: flex;
        flex-direction: column;
    }
    .panel-title {
        font-size: 1rem;
        font-weight: 600;
        margin: 0;
        color: var(--text-dark);
    }

    /* === Left Panel (Groups) === */
    .left-panel {
        flex: 0 0 200px;
        padding: 1rem;
    }
    .group-list {
        list-style: none;
        padding: 0;
        margin: 1rem 0;
        flex: 1;
        overflow-y: auto;
        border: 1px solid var(--border-color-light);
        border-radius: 0.375rem;
    }
    .group-list li {
        padding: 0.5rem 0.75rem;
        cursor: pointer;
        border-bottom: 1px solid var(--border-color-light);
    }
    .group-list li:last-child { border-bottom: none; }
    .group-list li:hover { background-color: var(--bg-light); }
    .group-list li.active {
        background-color: var(--primary-color-light);
        color: var(--primary-color-dark);
        font-weight: 600;
    }

    /* === Right Panel (Requirements) === */
    .right-panel {
        flex: 1 1 auto;
        min-width: 0;
    }
    .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
        border-bottom: 1px solid var(--border-color-light);
    }
    .table-container {
        flex: 1;
        overflow-y: auto;
    }
    .requirements-table {
        width: 100%;
        border-collapse: collapse;
    }
    .requirements-table th, 
    .requirements-table td {
        padding: 0.5rem;
        text-align: left;
        border-bottom: 1px solid var(--border-color-light);
        white-space: nowrap;
    }
    .requirements-table th {
        background-color: var(--bg-light);
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-light);
        position: sticky;
        top: 0;
        z-index: 1;
    }
    .requirements-table tbody tr:hover { background-color: var(--bg-light); }
    .requirements-table tbody tr.active {
        background-color: var(--primary-color);
        color: var(--bg-white);
    }

    /* Table Inputs */
    .requirements-table input,
    .requirements-table select {
        width: 100%;
        border: 1px solid transparent;
        background: transparent;
        padding: 0.25rem;
        border-radius: 0.25rem;
        font-family: inherit;
        font-size: inherit;
        color: inherit;
    }
    .requirements-table tr.active input,
    .requirements-table tr.active select {
        background-color: rgba(0,0,0,0.2);
    }
    .requirements-table tr.active select:focus,
    .requirements-table tr.active input:focus {
        background-color: rgba(0,0,0,0.3);
    }
    .requirements-table tr.not-active input, 
    .requirements-table tr.not-active select {
        pointer-events: none;
    }

    /* === Footer === */
    .editor-footer {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.75rem 1rem;
        background-color: var(--bg-white);
        border-top: 1px solid var(--border-color-light);
    }
</style>

<script setup>
    import { ref, computed } from 'vue';
    import { App }          from '../js/app.js';

    const pointsOptions = [
        { value: 0,     text: '0'   },
        { value: 1,     text: '1'   },
        { value: 2,     text: '2'   },
        { value: 3,     text: '3'   },
        { value: 4,     text: '4'   },
        { value: 5,     text: '5'   },
        { value: 10,    text: '10'  },
        { value: 25,    text: '25'  },
        { value: 50,    text: '50'  },
        { value: 100,   text: '100' },
    ];
    const progressionOptions = [
        { value: 0,     text: ''            },
        { value: 1,     text: 'Missable'    },
        { value: 2,     text: 'Progression' },
        { value: 3,     text: 'Win'         },
    ];
    const flagOptions = [
        { value: 0,     text: 'Pause If'        },
        { value: 1,     text: 'Reset If'        },
        { value: 2,     text: 'Reset Next If'   },
        { value: 3,     text: 'Add Source'      },
        { value: 4,     text: 'Sub Source'      },
        { value: 5,     text: 'Add Hits'        },
        { value: 6,     text: 'Sub Hits'        },
        { value: 7,     text: 'Add Address'     },
        { value: 8,     text: 'And Next'        },
        { value: 9,     text: 'Or Next'         },
        { value: 10,    text: 'Measured'        },
        { value: 11,    text: 'Measured If'     },
        { value: 12,    text: 'Trigger'         },
        { value: 13,    text: 'Remember'        },
    ];
    const typeOptions = [
        { value: 0,     text: 'Mem'         },
        { value: 1,     text: 'Value'       },
        { value: 2,     text: 'Delta'       },
        { value: 3,     text: 'Prior'       },
        { value: 4,     text: 'BCD'         },
        { value: 5,     text: 'Float'       },
        { value: 6,     text: 'Invert'      },
        { value: 7,     text: 'Recall'      },
    ];
    const cmpOptions = [
        { value: 0,     text: '='       },
        { value: 1,     text: '<'       },
        { value: 2,     text: '<='      },
        { value: 3,     text: '>'       },
        { value: 4,     text: '>='      },
        { value: 5,     text: '!='      },
    ];

    const selectedPoints = ref(null);
    const selectedProgressionType = ref(null);
    const selectedGroup = ref(null);
    const selectedRequirement = ref(null);
    const selectedAsset = ref({ groups: [] }); 

    const selectedGroupId = computed({
        get() {
            return selectedGroup.value?.id ?? null;
        },
        set(value) {
            selectedGroup.value = selectedAsset.value.groups.find(group => group.id === value) ?? null;
        }
    });

    const selectedRequirementId = computed({
        get() {
            return selectedRequirement.value?.id ?? null;
        },
        set(value) {
            if (selectedGroup.value) {
                selectedRequirement.value = selectedGroup.value.requirements.find(req => req.id === value) ?? null;
            }
        }
    });

    const addAltGroup = async () => {
        if (selectedAsset.value) {
            selectedAsset.value.groups.push({
                id: App.getFakeId(), type: 'ALT', requirements: []
            });
            if (selectedAsset.value.groups.length === 1) {
                selectedAsset.value.groups.push({
                    id: App.getFakeId(), type: 'ALT', requirements: []
                });
            }
        }
    };

    const removeAltGroup = async (id) => {
        const index = selectedAsset.value.groups.findIndex(group => group.id === id);
        if (index !== -1) {
            if (selectedAsset.value.groups[index].type === 'CORE') {
                return;
            }
            if (selectedAsset.value.groups[index].requirements.length !== 0) {
                // const confirm = await confirmDialog(...);
                // if (!confirm) return;
            }
            selectedAsset.value.groups.splice(index, 1);
            selectedGroupId.value = selectedAsset.value.groups[index]?.id ?? selectedAsset.value.groups[index - 1]?.id;
        }
    };

    const newRequirement = async () => { };
    const removeRequirement = async () => {  };

    App.initialize().then(() => App.ready = true);
</script>