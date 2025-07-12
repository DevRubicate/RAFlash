import { Unit }                 from '../Unit.ts';
import { BytecodeGenerator }    from '../BytecodeGenerator.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class ObjectAccessExpressionUnit extends Unit {
    generateBytecode(generator: BytecodeGenerator) {
        throw new Error('Not implemented');
    }
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        const filterCriteria = this.children[1].generateMnemonic(generator)
        return [
            ...this.children[0].generateMnemonic(generator),
            'OBJECT_ACCESS',
            String(filterCriteria.length),
            ...filterCriteria,
        ];
    }
}