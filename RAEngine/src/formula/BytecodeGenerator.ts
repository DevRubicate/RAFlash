import { Unit }                     from './Unit.ts';

export class BytecodeGenerator {
    ast: Unit;
    output: Array<string> = [];
    constructor(ast:Unit) {
        this.ast = ast;
    }
    generate() {
        this.ast.generateBytecode(this);
        return this.output;
    }
}