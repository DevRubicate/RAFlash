import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class NullUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return ['NULL'];
    }
}
