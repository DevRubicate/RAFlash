import { Unit }                 from '../Unit.ts';
import { BytecodeGenerator }    from '../BytecodeGenerator.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class ExecutableBlockUnit extends Unit {
    generateBytecode(generator: BytecodeGenerator) {
        throw new Error('Not implemented');
    }
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        const output = [];
        for(let i=0, len=this.children.length; i<len; ++i) {
            output.push(...this.children[i].generateMnemonic(generator));
        }
        return output;
    }
}