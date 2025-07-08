import { BytecodeGenerator } from './BytecodeGenerator.ts';
import { MnemonicGenerator } from './MnemonicGenerator.ts';

export abstract class Unit {
    value: any;
    parent: Unit | null = null;
    children: Array<Unit> = [];
    constructor(value:any) {
        this.value = value;
    }
    addChildren(...args: Array<Unit>) {
        for (let i = 0; i < args.length; ++i) {
            this.children.push(args[i]);
            args[i].parent = this;
        }
        return this;
    }
    abstract generateBytecode(generator: BytecodeGenerator):any;
    abstract generateMnemonic(generator: MnemonicGenerator):Array<string>;
}