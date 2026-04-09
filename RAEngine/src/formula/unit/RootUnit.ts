import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class RootUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return [
            'VERSION_1',
            ...this.children[0].generateMnemonic(generator),
        ];
    }
}