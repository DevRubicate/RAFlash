import { Unit }                 from '../Unit.ts';
import { MnemonicGenerator }    from '../MnemonicGenerator.ts';

export class TernaryUnit extends Unit {
    generateMnemonic(generator: MnemonicGenerator): Array<string> {
        const condition = this.children[0].generateMnemonic(generator);
        const thenBranch = this.children[1].generateMnemonic(generator);
        const elseBranch = this.children[2].generateMnemonic(generator);

        return [
            ...condition,
            'TERNARY',
            String(thenBranch.length),
            ...thenBranch,
            String(elseBranch.length),
            ...elseBranch,
        ];
    }
}
