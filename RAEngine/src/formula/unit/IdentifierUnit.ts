import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class IdentifierUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return [
            'IDENTIFIER',
            String(this.value),
        ];
    }
}