import { Unit }                 from '../Unit.ts';
import { BytecodeGenerator }    from '../BytecodeGenerator.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class RootUnit extends Unit {
    generateBytecode(generator: BytecodeGenerator) {
        throw new Error('Not implemented');
    }
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return [
            'VERSION_1',
            ...this.children[0].generateMnemonic(generator),
        ];
    }
}