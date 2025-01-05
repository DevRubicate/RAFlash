import { createApp }                    from 'https://unpkg.com/petite-vue?module';
import { Network }                      from './network.js';
import { getDiff }                      from './json-diff.js';
import { alertDialog, confirmDialog }   from './dialog.js';

const appData = {
    ready: false,
    gameId: 1686,
  
    data: {assets: []},
    originalData: {assets: []},
  
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
  
    selectedAsset: null,
    set selectedAssetId(value) {
        this.selectedAsset = this.data.assets.find(asset => asset.id === value) ?? null;
        const groupId = this.selectedAsset.groups.find(group => group.type === 'CORE')?.id;
        if(groupId) {
            this.selectedGroupId = groupId;
        }
    },
    get selectedAssetId() {
        return this.selectedAsset?.id ?? null;
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
  
    // methods
    async newAsset() {
        const id = this.getFakeId();
        this.data.assets.push({
            id,
            type: 'LOCAL',
            points: 0,
            name: '',
            description: '',
            state: 'Paused',
            category: 'Core',
            changes: false,
            groups: [
                {
                    id: this.getFakeId(),
                    type: 'CORE',
                    requirements: []
                },
            ],
        });
  
        await this.save();
  
        await Network.sendMessage({command: 'showPopup', params: {url: 'internals/assets/asset-editor.html', width: 800, height: 700, params: {selectedAssetId: id}}});
    },
    async cloneAsset() {
        await Network.sendMessage({command: 'showPopup', params: {url: 'internals/assets/asset-editor.html', width: 800, height: 700, params: {}}});
    },
    async openAsset(id) {
        await Network.sendMessage({command: 'showPopup', params: {url: 'internals/assets/asset-editor.html', width: 800, height: 700, params: {selectedAssetId: id}}});
    },
  
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
  
    getFakeId() {
        return Math.floor(Math.random() * -0xFFFFFF)
    },
  
    setData(key, value) {
        this[key] = value;
    },
    applyDataDiff(diff) {
      // Helper function to set a value in the object by path
      function setValue(obj, path, value) {
        const keys = path.split('/');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
          const key = keys[i].replace(/\[\]$/, ''); // Remove array brackets if present
          current = current[key] = current[key] || (keys[i + 1].match(/\[\]$/) ? [] : {});
        }
        const finalKey = keys[keys.length - 1].replace(/\[\]$/, '');
        current[finalKey] = value;
      }
  
      // Helper function to remove a value from the object by path
      function removeValue(obj, path) {
        const keys = path.split('/');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
          const key = keys[i].replace(/\[\]$/, '');
          if (!(key in current)) return; // Path does not exist
          current = current[key];
        }
        const finalKey = keys[keys.length - 1].replace(/\[\]$/, '');
        delete current[finalKey];
      }
  
      // Apply added changes
      if (diff.added) {
        for (const [path, value] of diff.added) {
          setValue(this.data, path, value);
        }
      }
  
      // Apply removed changes
      if (diff.removed) {
        for (const [path] of diff.removed) {
          removeValue(this.data, path);
        }
      }
  
      // Apply edited changes
      if (diff.edited) {
        for (const [path, , newValue] of diff.edited) {
          setValue(this.data, path, newValue);
        }
      }
    },
    async save() {
        await Network.sendMessage({command: 'editData', params: getDiff(appData.originalData, appData.data)});
        appData.originalData = JSON.parse(JSON.stringify(appData.data));
    },
};

const app = createApp(appData);
app.mount();



function handleMessage(data) {
    try {
        switch(data.command) {
            case 'setup': {
                console.log('setup', data);

                appData.setData('data', data.params.data);
                appData.originalData = JSON.parse(JSON.stringify(data.params.data));

                const keys = Object.keys(data.params.params);
                for(let i=0; i<keys.length; ++i) {
                    const key = keys[i];
                    appData.setData(key, data.params.params[key]);
                }

                appData.setData('ready', true);
                break;
            }
            case 'editData':
                appData.applyDataDiff(data.params);
                break;
            default:
                console.error(`Unrecognized command ${data.command}`);
                break;
        }
        return {success: true};
    } catch(err) {
        console.error(err);
        return {success: false}
    }
}
Network.onMessage(handleMessage);

// Get the windowId from the URL
const url = new URL(window.location.href);
const windowId = Number(url.searchParams.get('windowId'));
Network.sendMessage({command: 'setup', params: {windowId}})
.then((response) => {
    if(!response.success) {
        throw new Error('Unable to get data');
    }
    console.log(response);
    handleMessage({command: 'setup', params: response.params});
});
Network.connect();


