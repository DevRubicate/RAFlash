import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class GreaterThanUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return [
            ...this.children[0].generateMnemonic(generator),
            ...this.children[1].generateMnemonic(generator),
            'GREATER',
        ];
    }
}