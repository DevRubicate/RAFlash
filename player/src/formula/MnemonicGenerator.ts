import { Unit }                     from './Unit.ts';

export class MnemonicGenerator {
    ast: Unit;
    output: Array<string> = [];
    constructor(ast:Unit) {
        this.ast = ast;
    }
    generate() {
        this.output.push(...this.ast.generateMnemonic(this));
        return this.output;
    }
}