<template>
    <div class="container" v-if="App.ready">
        <header class="editor-header">
            <div class="header-form-fields">
                <div class="header-row">
                    <div class="form-group">
                        <label for="title">Title</label>
                        <input type="text" id="title" v-model="selectedAsset.name" @change="App.save()" spellcheck="true">
                    </div>
                    <div class="form-group form-group-small">
                        <label for="id">ID</label>
                        <input type="text" id="id" :value="selectedAsset.id" readonly>
                    </div>
                </div>

                <div class="header-row">
                    <div class="form-group">
                        <label for="description">Description</label>
                        <input type="text" id="description" v-model="selectedAsset.description" @change="App.save()" spellcheck="true">
                    </div>
                    <div class="form-group form-group-small">
                        <label for="type">Type</label>
                        <select id="type" v-model="selectedProgressionType" @change="onProgressionTypeChange">
                            <option v-for="option in progressionOptions" :key="option.value" :value="option.value">{{option.text}}</option>
                        </select>
                    </div>
                </div>

                <div class="header-row">
                    <div class="form-group form-group-x-small">
                        <label for="points">Points</label>
                        <select id="points" v-model="selectedPoints" @change="onPointsChange">
                            <option v-for="option in pointsOptions" :key="option.value" :value="option.value">{{option.text}}</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="header-badge-image">
                <img :src="selectedAsset.badgeImage" alt="Badge Image">
                <input type="file" ref="fileInput" accept="image/*" @change="onFileSelected" style="display: none">
                <button class="btn btn-secondary btn-compact" @click="fileInput.click()">Upload</button>
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
                        <div class="form-group-checkbox"><input type="checkbox" id="active-check" v-model="isAssetActive"><label for="active-check">Active</label></div>
                    </div>
                </div>
                <div class="table-container" @click="handleTableContainerClick">
                    <table class="requirements-table">
                        <thead>
                            <tr>
                                <th>ID</th><th>Flag</th><th>Type A</th><th>Evaluate A</th><th>Cmp</th><th>Type B</th><th>Evaluate B</th><th>Hits</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(req, index) in selectedGroup?.requirements" :key="req.id" @click="selectedRequirementId = req.id" :class="[req.id === selectedRequirementId ? 'active' : 'not-active']">
                                <td>{{index+1}}</td>
                                <td><select v-model="req.flag" @change="App.save()"><option v-for="option in flagOptions" :value="option.value">{{option.text}}</option></select></td>
                                <td><select v-model="req.typeA" @change="App.save()"><option v-for="option in typeOptions" :value="option.value">{{option.text}}</option></select></td>
                                <td><input v-model="req.addressA" @change="App.save()"></td>
                                <td><select v-model="req.cmp" @change="App.save()"><option v-for="option in cmpOptions" :value="option.value">{{option.text}}</option></select></td>
                                <td><select v-model="req.typeB" @change="App.save()"><option v-for="option in typeOptions" :value="option.value">{{option.text}}</option></select></td>
                                <td><input v-model="req.addressB" @change="App.save()"></td>
                                <td><input type="number" v-model.number="req.maxHits" @change="App.save()" min="0" style="width: 50px"><span v-if="req.maxHits > 0"> ({{req.hits ?? 0}})</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <footer class="editor-footer">
            <div class="footer-buttons">
                <div class="button-group">
                    <button class="btn btn-new" @click="newRequirement()">New</button>
                    <button class="btn btn-remove" @click="removeRequirement()">Remove</button>
                </div>
                <div class="button-group">
                    <button class="btn btn-secondary" :disabled="!selectedRequirement" @click="copyRequirement()">Copy</button>
                    <button class="btn btn-secondary" @click="pasteRequirement()">Paste</button>
                </div>
                <div class="button-group">
                    <button class="btn btn-secondary" @click="moveRequirementUp()">Move Up</button>
                    <button class="btn btn-secondary" @click="moveRequirementDown()">Move Down</button>
                </div>
            </div>
            <button class="btn btn-primary" :disabled="!hasUnsavedChanges" @click="saveAsset()">Save</button>
        </footer>
    </div>
</template>

<style>
    /* === Header === */
    .editor-header {
        display: flex;
        gap: 1.25rem;
        background-color: var(--c-surface);
        padding: 0.75rem 0.875rem;
        border-bottom: 1px solid var(--c-border);
        flex-shrink: 0;
    }

    .header-form-fields {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
    }

    .header-row {
        display: flex;
        gap: 1rem;
        align-items: flex-end;
    }

    .header-badge-image {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.375rem;
        flex-shrink: 0;
        align-self: center;
    }

    .header-badge-image img {
        width: 96px;
        height: 96px;
        object-fit: contain;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-lg);
        padding: 0.375rem;
        background-color: var(--c-surface);
        box-shadow: var(--shadow-xs);
    }

    .form-group-checkbox {
        padding-bottom: 0.375rem;
    }

    .input-with-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .input-with-button input {
        flex: 1 1 auto;
        min-width: 0;
    }

    /* === Main Content === */
    .editor-main {
        flex: 1 1 auto;
        display: flex;
        gap: 0.625rem;
        padding: 0.625rem;
        min-height: 0;
    }

    .editor-panel {
        background-color: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-lg);
        display: flex;
        flex-direction: column;
        box-shadow: var(--shadow-xs);
    }

    .panel-title {
        font-size: 0.8125rem;
        font-weight: 600;
        margin: 0;
        color: var(--c-text);
    }

    /* === Left Panel (Groups) === */
    .left-panel {
        flex: 0 0 170px;
        padding: 0.75rem;
    }

    .group-list {
        list-style: none;
        padding: 0;
        margin: 0.625rem 0;
        flex: 1;
        overflow-y: auto;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-md);
    }

    .group-list li {
        padding: 0.4375rem 0.625rem;
        cursor: pointer;
        font-size: 0.8125rem;
        border-bottom: 1px solid var(--c-border-subtle);
        transition: background-color 80ms var(--ease);
    }

    .group-list li:last-child { border-bottom: none; }
    .group-list li:hover { background-color: var(--c-surface-alt); }

    .group-list li.active {
        background-color: var(--c-primary-soft);
        color: var(--c-primary-text);
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
        padding: 0.625rem 0.75rem;
        border-bottom: 1px solid var(--c-border);
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
        padding: 0.375rem 0.5rem;
        text-align: left;
        border-bottom: 1px solid var(--c-border-subtle);
        white-space: nowrap;
    }

    .requirements-table th {
        background-color: var(--c-surface-alt);
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--c-text-muted);
        position: sticky;
        top: 0;
        z-index: 1;
    }

    .requirements-table tbody tr {
        transition: background-color 80ms var(--ease);
    }

    .requirements-table tbody tr:hover { background-color: var(--c-surface-alt); }

    .requirements-table tbody tr.active {
        background-color: #334155;
        color: #ffffff;
    }

    /* Table Inputs */
    .requirements-table input,
    .requirements-table select {
        width: 100%;
        border: 1px solid transparent;
        background: transparent;
        padding: 0.1875rem 0.25rem;
        border-radius: 3px;
        font-family: var(--font-sans);
        font-size: inherit;
        color: inherit;
    }

    .requirements-table tr.active input,
    .requirements-table tr.active select {
        background-color: rgba(0, 0, 0, 0.2);
    }

    .requirements-table tr.active select:focus,
    .requirements-table tr.active input:focus {
        background-color: rgba(0, 0, 0, 0.3);
    }

    .requirements-table tr.not-active input,
    .requirements-table tr.not-active select {
        pointer-events: none;
    }

    /* === Footer === */
    .editor-footer {
        flex-shrink: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0.875rem;
        background-color: var(--c-surface);
        border-top: 1px solid var(--c-border);
    }

    .footer-buttons {
        display: flex;
        gap: 1rem;
    }

    .btn-new { background-color: #6366f1; color: #ffffff; }
    .btn-new:hover:not(:disabled) { background-color: var(--c-primary); }
    .btn-remove { background-color: var(--c-surface); color: var(--c-danger); border-color: var(--c-danger); }
    .btn-remove:hover:not(:disabled) { background-color: var(--c-danger); color: #ffffff; }
</style>

<script setup>
    import { ref, computed } from 'vue';
    import { App }          from '../js/app.ts';
    import { Network }      from '../js/network.ts';

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
        { value: null,          text: ''            },
        { value: 'MISSABLE',    text: 'Missable'    },
        { value: 'PROGRESSION', text: 'Progression' },
        { value: 'WIN',         text: 'Win'         },
    ];
    const flagOptions = [
        { value: null,              text: ''                },
        { value: 'PAUSE_IF',        text: 'Pause If'        },
        { value: 'RESET_IF',        text: 'Reset If'        },
        { value: 'RESET_NEXT_IF',   text: 'Reset Next If'   },
        { value: 'ADD_SOURCE',      text: 'Add Source'      },
        { value: 'SUB_SOURCE',      text: 'Sub Source'      },
        { value: 'ADD_HITS',        text: 'Add Hits'        },
        { value: 'SUB_HITS',        text: 'Sub Hits'        },
        { value: 'AND_NEXT',        text: 'And Next'        },
        { value: 'OR_NEXT',         text: 'Or Next'         },
        { value: 'MEASURED',        text: 'Measured'        },
        { value: 'MEASURED_IF',     text: 'Measured If'     },
        { value: 'TRIGGER',         text: 'Trigger'         },
    ];
    const typeOptions = [
        { value: 'VALUE',       text: 'Value'       },
        { value: 'DELTA',       text: 'Delta'       },
    ];
    const cmpOptions = [
        { value: '==',    text: '=='      },
        { value: '<',     text: '<'       },
        { value: '<=',    text: '<='      },
        { value: '>',     text: '>'       },
        { value: '>=',    text: '>='      },
        { value: '!=',    text: '!='      },
    ];

    const selectedPoints = ref(null);
    const selectedProgressionType = ref(null);
    const selectedGroup = ref(null);
    const selectedRequirement = ref(null);
    const selectedAssetId = ref(null);
    const fileInput = ref(null);
    const saving = ref(false);

    // Computed that always looks up the asset from App.data.assets
    // This ensures reactivity when external changes occur
    const selectedAsset = computed(() => {
        if (!App.data?.assets || selectedAssetId.value === null) {
            return { groups: [] };
        }
        return App.data.assets.find(a => a.id === selectedAssetId.value) || { groups: [] };
    });

    // Check if asset has unsaved changes (new assets always need saving)
    const hasUnsavedChanges = computed(() => {
        const asset = selectedAsset.value;
        if (!asset) return false;
        return !asset._saved || asset._modified === true;
    });

    const saveAsset = async () => {
        if (selectedAssetId.value === null) return;
        await Network.send({ command: 'saveAssets', params: { ids: [selectedAssetId.value] } });
    };

    const onFileSelected = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            selectedAsset.value.badgeImage = e.target.result;
            App.save();
        };
        reader.readAsDataURL(file);
    };

    const onProgressionTypeChange = () => {
        selectedAsset.value.progressionType = selectedProgressionType.value;
        App.save();
    };

    const onPointsChange = () => {
        selectedAsset.value.points = selectedPoints.value;
        App.save();
    };

    const handleTableContainerClick = (event) => {
        // Only deselect if clicking on empty space (not on a row)
        if (!event.target.closest('tbody tr')) {
            selectedRequirementId.value = null;
        }
    };

    const isAssetActive = computed({
        get() {
            return selectedAsset.value?.state === 'ACTIVE';
        },
        set(value) {
            const asset = App.data.assets.find(a => a.id === selectedAssetId.value);
            if (asset) {
                asset.state = value ? 'ACTIVE' : 'INACTIVE';
                App.save();
            }
        }
    });

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

    const newRequirement = async () => {
        if (!selectedGroup.value || saving.value) return;

        saving.value = true;
        try {
            const newReq = {
                id: App.getFakeId(),
                flag: null,
                typeA: 'VALUE',
                addressA: '',
                cmp: '=',
                typeB: 'VALUE',
                addressB: '0',
                maxHits: 0
            };

            selectedGroup.value.requirements.push(newReq);
            selectedRequirementId.value = newReq.id;
            await App.save();
        } finally {
            saving.value = false;
        }
    };

    const removeRequirement = async () => {
        if (!selectedGroup.value || !selectedRequirement.value || saving.value) return;

        saving.value = true;
        try {
            const index = selectedGroup.value.requirements.findIndex(
                r => r.id === selectedRequirement.value.id
            );

            if (index !== -1) {
                selectedGroup.value.requirements.splice(index, 1);
                // Select adjacent requirement or clear selection
                selectedRequirementId.value =
                    selectedGroup.value.requirements[index]?.id ??
                    selectedGroup.value.requirements[index - 1]?.id ??
                    null;
                await App.save();
            }
        } finally {
            saving.value = false;
        }
    };

    const moveRequirementUp = () => {
        if (!selectedGroup.value || !selectedRequirement.value) return;

        const reqs = selectedGroup.value.requirements;
        const index = reqs.findIndex(r => r.id === selectedRequirement.value.id);

        if (index > 0) {
            [reqs[index - 1], reqs[index]] = [reqs[index], reqs[index - 1]];
            App.save();
        }
    };

    const moveRequirementDown = () => {
        if (!selectedGroup.value || !selectedRequirement.value) return;

        const reqs = selectedGroup.value.requirements;
        const index = reqs.findIndex(r => r.id === selectedRequirement.value.id);

        if (index !== -1 && index < reqs.length - 1) {
            [reqs[index], reqs[index + 1]] = [reqs[index + 1], reqs[index]];
            App.save();
        }
    };

    const copyRequirement = async () => {
        if (!selectedRequirement.value) return;

        // Serialize requirement (excluding internal fields)
        const req = selectedRequirement.value;
        const data = {
            _raflash_requirement: true,
            flag: req.flag,
            typeA: req.typeA,
            addressA: req.addressA,
            cmp: req.cmp,
            typeB: req.typeB,
            addressB: req.addressB,
            maxHits: req.maxHits
        };

        try {
            await navigator.clipboard.writeText(JSON.stringify(data));
        } catch {
            // Silently fail
        }
    };

    const pasteRequirement = async () => {
        if (!selectedGroup.value || saving.value) return;

        saving.value = true;
        try {
            const text = await navigator.clipboard.readText();
            const data = JSON.parse(text);

            // Validate it's a requirement
            if (!data._raflash_requirement) return;

            const newReq = {
                id: App.getFakeId(),
                flag: data.flag ?? null,
                typeA: data.typeA ?? 'MEM',
                addressA: data.addressA ?? '',
                cmp: data.cmp ?? '=',
                typeB: data.typeB ?? 'VALUE',
                addressB: data.addressB ?? '0',
                maxHits: data.maxHits ?? 0
            };

            const reqs = selectedGroup.value.requirements;

            if (selectedRequirement.value) {
                // Insert after selected requirement
                const index = reqs.findIndex(r => r.id === selectedRequirement.value.id);
                if (index !== -1) {
                    reqs.splice(index + 1, 0, newReq);
                } else {
                    reqs.push(newReq);
                }
            } else {
                // Add at the end
                reqs.push(newReq);
            }

            selectedRequirementId.value = newReq.id;
            await App.save();
        } catch {
            // Silently fail on any error (parse, clipboard access, etc.)
        } finally {
            saving.value = false;
        }
    };

    App.initialize().then(() => {
        const asset = App.data.assets.find((a) => a.id === App.windowParams.selectedAssetId);
        if (!asset) {
            console.error('Asset not found:', App.windowParams.selectedAssetId);
            return;
        }
        selectedAssetId.value = asset.id;
        selectedGroup.value = asset.groups.find((g) => g.type === 'CORE');
        selectedPoints.value = asset.points;
        selectedProgressionType.value = asset.progressionType;
        App.ready = true;

    });
</script>