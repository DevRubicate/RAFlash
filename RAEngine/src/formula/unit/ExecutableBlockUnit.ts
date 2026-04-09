import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class ExecutableBlockUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        const output = [];
        for(let i=0, len=this.children.length; i<len; ++i) {
            output.push(...this.children[i].generateMnemonic(generator));
        }
        return output;
    }
}