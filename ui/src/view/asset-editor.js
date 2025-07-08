import { view }                         from '@js/view.js';

view({
    selectedPoints: null,
    pointsOptions: [
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
    ],

    selectedProgressionType: null,
    progressionOptions: [
        { value: 0,     text: ''            },
        { value: 1,     text: 'Missable'    },
        { value: 2,     text: 'Progression' },
        { value: 3,     text: 'Win'         },
    ],

    flagOptions: [
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
    ],

    typeOptions: [
        { value: 0,     text: 'Mem'         },
        { value: 1,     text: 'Value'       },
        { value: 2,     text: 'Delta'       },
        { value: 3,     text: 'Prior'       },
        { value: 4,     text: 'BCD'         },
        { value: 5,     text: 'Float'       },
        { value: 6,     text: 'Invert'      },
        { value: 7,     text: 'Recall'      },
    ],

    cmpOptions: [
        { value: 0,     text: '='       },
        { value: 1,     text: '<'       },
        { value: 2,     text: '<='      },
        { value: 3,     text: '>'       },
        { value: 4,     text: '>='      },
        { value: 5,     text: '!='      },
    ],

    async addAltGroup() {
        if(!!this.selectedAsset) {
            this.selectedAsset.groups.push({
                id: this.getFakeId(),
                type: 'ALT',
                requirements: []
            });
            if(this.selectedAsset.groups.length === 1) {
                this.selectedAsset.groups.push({
                    id: this.getFakeId(),
                    type: 'ALT',
                    requirements: []
                });
            }
            await this.save();
        }
    },
    async removeAltGroup(id) {
        const index = this.selectedAsset.groups.findIndex(group => group.id === id);
        if(index !== -1) {
            if(this.selectedAsset.groups[index].type === 'CORE') {
                await alertDialog('', 'The core group cannot be removed.');
                return;
            }

            if(this.selectedAsset.groups[index].requirements.length !== 0) {
                const confirm = await confirmDialog(`Are you sure you want to delete Alt ${index+1}?`, 'The group is not empty, and this operation cannot be reverted.');
                if(!confirm) {
                    return;
                }
            }

            this.selectedAsset.groups.splice(index, 1);
            this.selectedGroupId = this.selectedAsset.groups[index]?.id ?? this.selectedAsset.groups[index - 1]?.id
            await this.save();
        }
    },

    async newRequirement() {

    },
    async removeRequirement() {

    },
    selectedGroup: null,
    set selectedGroupId(value) {
        this.selectedGroup = this.selectedAsset.groups.find(group => group.id === value) ?? null;
    },
    get selectedGroupId() {
        return this.selectedGroup?.id ?? null;
    },
    selectedRequirement: null,
    set selectedRequirementId(value) {
        this.selectedRequirement = this.selectedGroup.requirements.find(req => req.id === value) ?? null;
    },
    get selectedRequirementId() {
        return this.selectedRequirement?.id ?? null;
    },
});
