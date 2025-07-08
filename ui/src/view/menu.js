import { view }                         from '@js/view.js';
import { Network }                      from '@js/network.js';

view({
    async openAssetList() {
        await Network.sendMessage({command: 'showPopup', params: {url: 'internals/assets/asset-list.html', width: 800, height: 700, params: {}}});
    },
    async openMemoryInspector() {
        await Network.sendMessage({command: 'showPopup', params: {url: 'internals/assets/memory-inspector.html', width: 800, height: 700, params: {}}});
    },
});
