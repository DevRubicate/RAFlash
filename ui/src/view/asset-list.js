import { view }                         from '@js/view.js';
import { Network }                      from '@js/network.js';

view({
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
});
