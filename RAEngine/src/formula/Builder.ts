import { Unit }         from './Unit.ts';
import { Node }         from './Node.ts';
import { NODE_TYPE }    from './NODE_TYPE.ts';

import { AdditionUnit }                 from './unit/AdditionUnit.ts';
import { ArrayAccessUnit }              from './unit/ArrayAccessUnit.ts';
import { ArrayUnit }                    from './unit/ArrayUnit.ts';
import { NotUnit }                      from './unit/NotUnit.ts';
import { DivisionUnit }                 from './unit/DivisionUnit.ts';
import { ExecutableBlockUnit }          from './unit/ExecutableBlockUnit.ts';
import { ExponentUnit }                 from './unit/ExponentUnit.ts';
import { IdentifierUnit }               from './unit/IdentifierUnit.ts';
import { ListUnit }                     from './unit/ListUnit.ts';
import { ModuloUnit }                   from './unit/ModuloUnit.ts';
import { MultiplicationUnit }           from './unit/MultiplicationUnit.ts';
import { ObjectAccessExpressionUnit }   from './unit/ObjectAccessExpressionUnit.ts';
import { RootUnit }                     from './unit/RootUnit.ts';
import { SubtractionUnit }              from './unit/SubtractionUnit.ts';
import { ValueUnit }                    from './unit/ValueUnit.ts';
import { StringUnit }                   from './unit/StringUnit.ts';
import { NullUnit }                     from './unit/NullUnit.ts';
import { ReadGlobalUnit }               from './unit/ReadGlobalUnit.ts';
import { EqualUnit }                    from './unit/EqualUnit.ts';
import { NotEqualUnit }                 from './unit/NotEqualUnit.ts';
import { GreaterThanUnit }              from './unit/GreaterThanUnit.ts';
import { GreaterThanOrEqualUnit }       from './unit/GreaterThanOrEqualUnit.ts';
import { LessThanUnit }                 from './unit/LessThanUnit.ts';
import { LessThanOrEqualUnit }          from './unit/LessThanOrEqualUnit.ts';
import { AndUnit }                      from './unit/AndUnit.ts';
import { OrUnit }                       from './unit/OrUnit.ts';
import { XorUnit }                      from './unit/XorUnit.ts';
import { TernaryUnit }                  from './unit/TernaryUnit.ts';
import { RememberedUnit }               from './unit/RememberedUnit.ts';
import { LenUnit }                      from './unit/LenUnit.ts';

export class Builder {
    input: Node;
    log: Array<string> = [];
    result: Unit | null = null;

    constructor(input: Node) {
        this.input = input;
    }

    build() {
        this.result = Builder.convert(this.input);
        const logAST = (node: Unit, indent = 0) => {
            this.log.push(' '.repeat(indent) + node.constructor.name);
            node.children.forEach((child: any) => logAST(child, indent + 2));
        };
        logAST(this.result);
        return this;
    }

    static convert(node: Node): Unit {
        switch (node.type) {
            case NODE_TYPE.ADDITION: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in ADDITION statement: ${node.children.length}`,
                    );
                }
                const element = new AdditionUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.ARRAY_ACCESS: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in ARRAY_ACCESS statement: ${node.children.length}`,
                    );
                }

                const element = new ArrayAccessUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.ARRAY: {
                const element = new ArrayUnit(null);
                for (let i = 0; i < node.children.length; ++i) {
                    element.children.push(
                        Builder.convert(
                            node.children[i],
                        ),
                    );
                    element.children[i].parent = element;
                }
                return element;
            }
            case NODE_TYPE.NOT: {
                const element = new NotUnit(null);
                for (const child of node.children) {
                    const converted = Builder.convert(child);
                    converted.parent = element;
                    element.children.push(converted);
                }
                return element;
            }
            case NODE_TYPE.EXECUTABLE_BLOCK: {
                const element = new ExecutableBlockUnit(null);
                for (let i = 0; i < node.children.length; ++i) {
                    element.children.push(
                        Builder.convert(
                            node.children[i],
                        ),
                    );
                    element.children[i].parent = element;
                }
                return element;
            }
            case NODE_TYPE.DIVISION: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in DIVISION statement: ${node.children.length}`,
                    );
                }

                const element = new DivisionUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.EXPONENT: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in EXPONENT statement: ${node.children.length}`,
                    );
                }

                const element = new ExponentUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.IDENTIFIER: {
                if (node.children.length > 1) {
                    throw new Error(
                        `Unexpected number of children in IDENTIFIER statement: ${node.children.length}`,
                    );
                }

                const element = new IdentifierUnit(node.value);

                // Identifier alias
                if (node.children.length === 1) {
                    element.children.push(
                        Builder.convert(node.children[0]),
                    );
                    element.children[0].parent = element;
                }

                return element;
            }
            case NODE_TYPE.MULTIPLICATION: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in MULTIPLICATION statement: ${node.children.length}`,
                    );
                }

                const element = new MultiplicationUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.MODULO: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in MODULO statement: ${node.children.length}`,
                    );
                }

                const element = new ModuloUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.OBJECT_ACCESS_EXPRESSION: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in OBJECT_ACCESS_EXPRESSION statement: ${node.children.length}`,
                    );
                }

                const element = new ObjectAccessExpressionUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.READ_GLOBAL: {
                if (node.children.length !== 1) {
                    throw new Error(
                        `Unexpected number of children in READ_GLOBAL statement: ${node.children.length}`,
                    );
                }

                const element = new ReadGlobalUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children[0].parent = element;
                return element;
            }
            case NODE_TYPE.ROOT: {
                const element = new RootUnit(null);
                for (let i = 0; i < node.children.length; ++i) {
                    element.children.push(
                        Builder.convert(node.children[i]),
                    );
                    element.children[i].parent = element;
                }
                return element;
            }
            case NODE_TYPE.SUBTRACTION: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in SUBTRACTION statement: ${node.children.length}`,
                    );
                }

                const element = new SubtractionUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.VALUE: {
                const element = new ValueUnit(node.value);
                return element;
            }
            case NODE_TYPE.STRING: {
                const element = new StringUnit(node.value);
                return element;
            }
            case NODE_TYPE.NULL: {
                const element = new NullUnit(null);
                return element;
            }
            case NODE_TYPE.EQUAL: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in EQUAL statement: ${node.children.length}`,
                    );
                }

                const element = new EqualUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.NOT_EQUAL: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in NOT_EQUAL statement: ${node.children.length}`,
                    );
                }

                const element = new NotEqualUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.GREATER_THAN: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in GREATER_THAN statement: ${node.children.length}`,
                    );
                }

                const element = new GreaterThanUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.GREATER_THAN_OR_EQUAL: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in GREATER_THAN_OR_EQUAL statement: ${node.children.length}`,
                    );
                }

                const element = new GreaterThanOrEqualUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.LESS_THAN: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in LESS_THAN statement: ${node.children.length}`,
                    );
                }

                const element = new LessThanUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.LESS_THAN_OR_EQUAL: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in LESS_THAN_OR_EQUAL statement: ${node.children.length}`,
                    );
                }

                const element = new LessThanOrEqualUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children.push(
                    Builder.convert(node.children[1]),
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                return element;
            }
            case NODE_TYPE.AND: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in AND statement: ${node.children.length}`,
                    );
                }

                const andElement = new AndUnit(null);
                andElement.children.push(Builder.convert(node.children[0]));
                andElement.children.push(Builder.convert(node.children[1]));
                andElement.children[0].parent = andElement;
                andElement.children[1].parent = andElement;
                return andElement;
            }
            case NODE_TYPE.OR: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in OR statement: ${node.children.length}`,
                    );
                }

                const orElement = new OrUnit(null);
                orElement.children.push(Builder.convert(node.children[0]));
                orElement.children.push(Builder.convert(node.children[1]));
                orElement.children[0].parent = orElement;
                orElement.children[1].parent = orElement;
                return orElement;
            }
            case NODE_TYPE.XOR: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in XOR statement: ${node.children.length}`,
                    );
                }

                const xorElement = new XorUnit(null);
                xorElement.children.push(Builder.convert(node.children[0]));
                xorElement.children.push(Builder.convert(node.children[1]));
                xorElement.children[0].parent = xorElement;
                xorElement.children[1].parent = xorElement;
                return xorElement;
            }
            case NODE_TYPE.TERNARY: {
                if (node.children.length !== 3) {
                    throw new Error(
                        `Unexpected number of children in TERNARY statement: ${node.children.length}`,
                    );
                }

                const element = new TernaryUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),  // condition
                );
                element.children.push(
                    Builder.convert(node.children[1]),  // then
                );
                element.children.push(
                    Builder.convert(node.children[2]),  // else
                );
                element.children[0].parent = element;
                element.children[1].parent = element;
                element.children[2].parent = element;
                return element;
            }
            case NODE_TYPE.REMEMBERED: {
                if (node.children.length !== 1) {
                    throw new Error(
                        `Unexpected number of children in REMEMBERED statement: ${node.children.length}`,
                    );
                }

                const element = new RememberedUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children[0].parent = element;
                return element;
            }
            case NODE_TYPE.FUNCTION_CALL: {
                const funcName = node.value;
                if (funcName === 'len') {
                    if (node.children.length !== 1) {
                        throw new Error(
                            `len() expects 1 argument, got ${node.children.length}`,
                        );
                    }
                    const element = new LenUnit(null);
                    element.children.push(
                        Builder.convert(node.children[0]),
                    );
                    element.children[0].parent = element;
                    return element;
                }
                throw new Error(`Unknown function: ${funcName}`);
            }
            default:
                throw new Error(`Invalid node type: ${node.type}`);
        }
    }
    output() {
        if (!this.result) {
            throw new Error('Builder.output: No result');
        }
        return this.result;
    }
}