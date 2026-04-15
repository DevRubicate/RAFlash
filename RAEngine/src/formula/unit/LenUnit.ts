import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class LenUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return [
            ...this.children[0].generateMnemonic(generator),
            'LEN',
        ];
    }
}
