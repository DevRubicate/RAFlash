import { Unit }         from './Unit.ts';
import { Node }         from './Node.ts';
import { NODE_TYPE }    from './NODE_TYPE.ts';

import { AdditionUnit }                 from './unit/AdditionUnit.ts';
import { ArrayAccessUnit }              from './unit/ArrayAccessUnit.ts';
import { ArrayUnit }                    from './unit/ArrayUnit.ts';
import { CallUnit }                     from './unit/CallUnit.ts';
import { DivisionUnit }                 from './unit/DivisionUnit.ts';
import { ExecutableBlockUnit }          from './unit/ExecutableBlockUnit.ts';
import { ExponentUnit }                 from './unit/ExponentUnit.ts';
import { IdentifierUnit }               from './unit/IdentifierUnit.ts';
import { ListUnit }                     from './unit/ListUnit.ts';
import { MultiplicationUnit }           from './unit/MultiplicationUnit.ts';
import { ObjectAccessExpressionUnit }   from './unit/ObjectAccessExpressionUnit.ts';
import { RootUnit }                     from './unit/RootUnit.ts';
import { SubtractionUnit }              from './unit/SubtractionUnit.ts';
import { ValueUnit }                    from './unit/ValueUnit.ts';
import { StringUnit }                   from './unit/StringUnit.ts';
import { ReadVarUnit }                  from './unit/ReadVarUnit.ts';
import { ReadGlobalUnit }               from './unit/ReadGlobalUnit.ts';
import { VoidUnit }                     from './unit/VoidUnit.ts';
import { WriteVarUnit }                 from './unit/WriteVarUnit.ts';
import { EqualUnit }                    from './unit/EqualUnit.ts';
import { NotEqualUnit }                 from './unit/NotEqualUnit.ts';
import { GreaterThanUnit }              from './unit/GreaterThanUnit.ts';
import { GreaterThanOrEqualUnit }       from './unit/GreaterThanOrEqualUnit.ts';
import { LessThanUnit }                 from './unit/LessThanUnit.ts';
import { LessThanOrEqualUnit }          from './unit/LessThanOrEqualUnit.ts';

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
            case NODE_TYPE.CALL: {
                const element = new CallUnit(null);
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
            case NODE_TYPE.READ_VAR: {
                if (node.children.length !== 1) {
                    throw new Error(
                        `Unexpected number of children in READ_VAR statement: ${node.children.length}`,
                    );
                }

                const element = new ReadVarUnit(null);
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
            case NODE_TYPE.VOID: {
                const element = new VoidUnit(null);
                element.children.push(
                    Builder.convert(node.children[0]),
                );
                element.children[0].parent = element;
                return element;
            }
            case NODE_TYPE.WRITE_VAR: {
                if (node.children.length !== 2) {
                    throw new Error(
                        `Unexpected number of children in WRITE_VAR statement: ${node.children.length}`,
                    );
                }

                const element = new WriteVarUnit(null);
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