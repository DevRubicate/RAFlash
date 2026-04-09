import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class ValueUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return [
            'VALUE',
            String(this.value),
        ];
    }
}