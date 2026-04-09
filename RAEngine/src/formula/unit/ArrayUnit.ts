import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class ArrayUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        throw new Error('Not implemented');
    }
}