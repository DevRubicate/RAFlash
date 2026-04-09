import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class ReadGlobalUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return [
            ...this.children[0].generateMnemonic(generator),
            'READ_GLOBAL',
        ];
    }
}