import { reactive }                     from 'vue';
import { JSONDiff }                     from './JSONDiff.js';
import { Network }                      from './network.js';

export const App = reactive({
    ready: false,
    gameId: 1686,

    data: {assets: []},
    originalData: {assets: []},
    windowParams: {},

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

    // methods
    async initialize() {
        await Network.initialize();
    },

    getFakeId() {
        return Math.floor(Math.random() * -0xFFFFFF)
    },

    setData(key, value) {
        this[key] = value;
    },
    async save() {

        const diff = JSONDiff.getDataDiff(App.originalData, App.data);


        await Network.send({command: 'editData', params: diff});
        App.originalData = JSON.parse(JSON.stringify(App.data));
    },
})