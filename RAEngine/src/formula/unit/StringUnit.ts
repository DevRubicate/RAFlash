import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class StringUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return [
            'STRING',
            this.value,
        ];
    }
}