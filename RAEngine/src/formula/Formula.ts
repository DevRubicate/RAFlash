import { Lexer } from './Lexer.ts';
import { Parser } from './Parser.ts';
import { Builder } from './Builder.ts';
import { MnemonicGenerator } from './MnemonicGenerator.ts';


export class Formula {
    static compile(input:string):any {
        try {
            const tokens = new Lexer(input).tokenize();
            const parseTree = new Parser(tokens, input).output;
            const builder = new Builder(parseTree).build();
            const bytecode = new MnemonicGenerator(builder.output()).generate();
            return bytecode;
        } catch {
            return ['VERSION_1', 'STRING', 'ERROR'];
        }
    }
}