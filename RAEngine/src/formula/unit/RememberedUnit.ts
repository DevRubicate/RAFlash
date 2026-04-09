import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class RememberedUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator):Array<string> {
        const inner = this.children[0].generateMnemonic(generator);
        return [
            'REMEMBER',
            String(inner.length),
            ...inner,
        ];
    }
}
