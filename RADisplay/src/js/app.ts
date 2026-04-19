import { reactive }                            from 'vue';
import { JSONDiff }                     from './JSONDiff.js';
import { Network, deepCloneRaw }        from './network.js';

interface AppState {
    ready: boolean;
    gameId: string;
    windowId: number;
    flashConnected: boolean;
    // deno-lint-ignore no-explicit-any -- deeply dynamic JSON from server
    data: Record<string, any>;
    // deno-lint-ignore no-explicit-any
    originalData: Record<string, any>;
    windowParams: Record<string, unknown>;
    // deno-lint-ignore no-explicit-any
    selectedAsset: Record<string, any> | null;
    selectedAssetId: number | null;
    selectedGroupId?: number;
    initialize(): Promise<void>;
    getFakeId(): number;
    setData(key: string, value: unknown): void;
    save(): Promise<void>;
}

export const App: AppState = reactive({
    ready: false,
    gameId: "local",
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
        if (!this.selectedAsset) {
            this.selectedGroupId = null;
            return;
        }
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
        // Fires when the engine relaunches Flash (e.g. Reset Game brutal
        // restart) and the new firmware has reached gameLoaded.
        Network.addEventListener('flashConnected', () => {
            App.flashConnected = true;
        });
    },

    getFakeId(): number {
        // Negative IDs are used for local/unpromoted assets that haven't been synced to the server
        return Math.floor(Math.random() * -0xFFFFFF)
    },

    setData(key: string, value: unknown) {
        if (key in this && typeof (this as Record<string, unknown>)[key] === 'function') return;
        this[key] = value;
    },
    _saving: false,
    async save() {
        if (this._saving) return;
        this._saving = true;
        try {
            const diff = JSONDiff.getDataDiff(App.originalData, App.data);
            const response = await Network.send({command: 'editData', params: diff});
            if (!response.success) {
                console.error('App.save: server rejected editData', response.error);
                return;
            }
            App.originalData = deepCloneRaw(App.data) as Record<string, any>;
        } finally {
            this._saving = false;
        }
    },
});
