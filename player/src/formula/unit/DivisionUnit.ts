import { Unit }                 from '../Unit.ts';
import { BytecodeGenerator }    from '../BytecodeGenerator.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class DivisionUnit extends Unit {
    generateBytecode(generator: BytecodeGenerator) {
        throw new Error('Not implemented');
    }
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        return [
            ...this.children[0].generateMnemonic(generator),
            ...this.children[1].generateMnemonic(generator),
            'DIV',
        ];
    }
}