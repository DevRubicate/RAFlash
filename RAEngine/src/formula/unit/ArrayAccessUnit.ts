import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class ArrayAccessUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {




        const filterCriteria = this.children[1].generateMnemonic(generator);
        return [
            ...this.children[0].generateMnemonic(generator),
            'ARRAY_ACCESS',
            String(filterCriteria.length),
            ...filterCriteria,
        ];
    }
}