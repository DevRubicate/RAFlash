import { reactive }                            from 'vue';
import { JSONDiff }                     from './JSONDiff.js';
import { Network }                      from './network.js';

// deno-lint-ignore no-explicit-any -- App.data is deeply dynamic JSON from server
export const App: Record<string, any> = reactive({
    ready: false,
    gameId: 1686,
    windowId: 0,  // Set during network initialization
    // True until RAEngine broadcasts `flashDisconnected` (i.e. Flash Player
    // exited or crashed). Components bind `:disabled="!App.flashConnected"`
    // on actions that need a live Flash Player. Game Behavior / Settings
    // stay editable so the user can recover from a sitelocked game.
    flashConnected: true,

    data: {assets: [], codeNotes: []},
    originalData: {assets: [], codeNotes: []},
    windowParams: {} as Record<string, unknown>,

    selectedAsset: null,
    set selectedAssetId(value: number | null) {
        this.selectedAsset = this.data.assets.find((asset: Record<string, unknown>) => asset.id === value) ?? null;
        const groupId = this.selectedAsset.groups.find((group: Record<string, unknown>) => group.type === 'CORE')?.id;
        if(groupId) {
            this.selectedGroupId = groupId;
        }
    },
    get selectedAssetId(): number | null {
        return this.selectedAsset?.id ?? null;
    },

    // methods
    async initialize() {
        await Network.initialize();
        // Listen for the engine's broadcast that Flash Player is gone. This
        // flips the global UI gate so every component can degrade in unison
        // without having to subscribe individually.
        Network.addEventListener('flashDisconnected', () => {
            App.flashConnected = false;
        });
    },

    getFakeId(): number {
        return Math.floor(Math.random() * -0xFFFFFF)
    },

    setData(key: string, value: unknown) {
        this[key] = value;
    },
    async save() {
        const diff = JSONDiff.getDataDiff(App.originalData, App.data);
        await Network.send({command: 'editData', params: diff});
        App.originalData = JSON.parse(JSON.stringify(App.data));
    },
});
