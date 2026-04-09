import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class NotUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return [
            ...this.children[0].generateMnemonic(generator),
            'NOT',
        ];
    }
}
