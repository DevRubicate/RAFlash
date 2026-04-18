import { Lexer } from './Lexer.ts';
import { Parser } from './Parser.ts';
import { Builder } from './Builder.ts';
import { MnemonicGenerator } from './MnemonicGenerator.ts';


export class Formula {
    // Last compilation error, or null if the most recent compile succeeded.
    // Set by compile() on failure; the caller (compileFormula in Main.ts)
    // reads it to surface the real error to the Event Log. Single-threaded
    // runtime means a static field is safe.
    static lastError: string | null = null;

    static compile(input:string):any {
        try {
            const tokens = new Lexer(input).tokenize();
            const parseTree = new Parser(tokens, input).output;
            const builder = new Builder(parseTree).build();
            const bytecode = new MnemonicGenerator(builder.output()).generate();
            Formula.lastError = null;
            return bytecode;
        } catch (e) {
            Formula.lastError = (e instanceof Error) ? e.message : String(e);
            return ['VERSION_1', 'STRING', 'ERROR'];
        }
    }
}