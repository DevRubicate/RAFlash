import { MnemonicGenerator } from './MnemonicGenerator.ts';

export abstract class Unit {
    value: string | number | null;
    parent: Unit | null = null;
    children: Array<Unit> = [];
    constructor(value: string | number | null) {
        this.value = value;
    }
    addChildren(...args: Array<Unit>) {
        for (let i = 0; i < args.length; ++i) {
            this.children.push(args[i]);
            args[i].parent = this;
        }
        return this;
    }
    abstract generateMnemonic(generator: MnemonicGenerator):Array<string>;
}