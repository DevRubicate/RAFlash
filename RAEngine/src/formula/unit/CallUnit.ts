import { Unit }                 from '../Unit.ts';
import { BytecodeGenerator }    from '../BytecodeGenerator.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class CallUnit extends Unit {
    generateBytecode(generator: BytecodeGenerator) {
        throw new Error('Not implemented');
    }
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        throw new Error('Not implemented');
    }
}