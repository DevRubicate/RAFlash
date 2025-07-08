import { view }                         from '@js/view.js';
import { Network }                      from '@js/network.js';

view({
    memoryInput: '',
    memoryResult: [],
    memoryResultValid: false,

    async evaluate() {
        this.memoryResultValid = false;
        const reply = await Network.sendMessage({command: 'evaluate', params: {input: this.memoryInput}});
        if(reply.success) {
            this.memoryResult = reply.params.result.output;
            this.memoryResultValid = true;
        } else {
            this.memoryResultValid = false;
        }
    },
});
