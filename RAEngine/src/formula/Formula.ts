import { Lexer } from './Lexer.ts';
import { Parser } from './Parser.ts';
import { Builder } from './Builder.ts';
import { MnemonicGenerator } from './MnemonicGenerator.ts';


export class Formula {
    static compile(input:string):any {
        try {
            const tokens = new Lexer(input).tokenize();
            //console.log(tokens);
            const parseTree = new Parser(tokens, input).output;
            //(function print(node, prefix = '') { console.log(prefix + node.type); node.children?.forEach(child => print(child, prefix + '  ')); })(parseTree);
            const builder = new Builder(parseTree).build();
            const bytecode = new MnemonicGenerator(builder.output()).generate();
            return bytecode;
        } catch(e) {
            return ['VERSION_1', 'VALUE', '0'];
        }
    }
}