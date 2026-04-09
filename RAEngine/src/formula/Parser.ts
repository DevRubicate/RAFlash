import { NODE_TYPE }            from './NODE_TYPE.ts';
import { CONSUME }              from './CONSUME.ts';
import { Token, TokenType }     from './Lexer.ts';
import { Node }                 from './Node.ts';

const OperatorDetails: Partial<
    {
        [key in NODE_TYPE]: {
            type: 'BINARY' | 'UNARY';
            associativity: 'LEFT' | 'RIGHT';
            precedence: number;
        };
    }
> = {
    [NODE_TYPE.OBJECT_ACCESS]: {
        type: 'UNARY',
        associativity: 'LEFT',
        precedence: 4,
    },
    [NODE_TYPE.OBJECT_ACCESS_EXPRESSION]: {
        type: 'UNARY',
        associativity: 'LEFT',
        precedence: 4,
    },
    [NODE_TYPE.ARRAY_ACCESS]: {
        type: 'UNARY',
        associativity: 'LEFT',
        precedence: 4,
    },
    [NODE_TYPE.ADDITION]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 1,
    },
    [NODE_TYPE.SUBTRACTION]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 1,
    },
    [NODE_TYPE.MULTIPLICATION]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 2,
    },
    [NODE_TYPE.DIVISION]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 2,
    },
    [NODE_TYPE.EXPONENT]: {
        type: 'BINARY',
        associativity: 'RIGHT',
        precedence: 3,
    },
    [NODE_TYPE.EQUAL]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 1
    },
    [NODE_TYPE.NOT_EQUAL]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 1,
    },
    [NODE_TYPE.GREATER_THAN]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 1,
    },
    [NODE_TYPE.GREATER_THAN_OR_EQUAL]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 1,
    },
    [NODE_TYPE.LESS_THAN]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 1,
    },
    [NODE_TYPE.LESS_THAN_OR_EQUAL]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 1,
    },
    [NODE_TYPE.AND]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 0,
    },
    [NODE_TYPE.OR]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 0,
    },
    [NODE_TYPE.XOR]: {
        type: 'BINARY',
        associativity: 'LEFT',
        precedence: 0,
    },
    [NODE_TYPE.NOT]: {
        type: 'UNARY',
        associativity: 'RIGHT',
        precedence: 3,
    },
};

class Parser {
    input: Array<Token>;
    originalInput: string;
    position: number = 0;
    currentNode: Node;
    eofToken: Token;

    log: Array<string> = [];
    output: Node;

    constructor(input: Array<Token>, originalInput: string) {
        this.input = input;
        this.originalInput = originalInput;
        this.output = new Node(NODE_TYPE.ROOT).addConsume(CONSUME.MAIN);
        this.currentNode = this.output;
 
        // Create an EOF token
        const originalSplit = originalInput.split('\n');
        this.eofToken = {
            type: TokenType.EOF,
            value: 'EOF',
            row: originalSplit.length,
            column: originalSplit[originalSplit.length - 1].length,
        };

        try {
            this.process();
        } catch (err) {
            if (err instanceof ParseError) {
                this.printError(err);
            } else {
                throw err;
            }
        }

        // Make sure the last statement in the program returns a value
        if(this.currentNode.children.length > 0) {
            const nodes = [];
            for(let i=0, len=this.currentNode.children[0].children.length; i<len; ++i) {
                nodes.push(this.currentNode.children[0].children.pop()!);
            }

            for(let i=nodes.length-1; i>=0; --i) {
                if(i > 0) {
                    this.currentNode.children[0].children.push(new Node(NODE_TYPE.VOID).addChild(nodes[i]));
                } else {
                    this.currentNode.children[0].children.push(nodes[i]);
                }
            }
        } else {
            this.currentNode.children[0] = new Node(NODE_TYPE.READ_GLOBAL).addChild(new Node(NODE_TYPE.IDENTIFIER, 'this'));
        }

        const logNode = (node: Node, indent = 0) => {
            this.log.push(' '.repeat(indent) + node.type);
            node.children.forEach((child: any) => logNode(child, indent + 2));
        };
        logNode(this.output);
    }
    replaceCurrentNode(node: Node) {
        this.currentNode.addChild(node);
        this.currentNode = node;
    }
    printError(err: ParseError) {
        let printValue = '';
        let printSize = 0;
        switch (err.token.type) {
            case TokenType.STRING: {
                printValue = `string "${err.token.value}"`;
                printSize = String(err.token.value).length + 2;
                break;
            }
            case TokenType.EOF: {
                printValue = `end of file`;
                printSize = 0;
                break;
            }
            default: {
                printValue = err.token.type;
                printSize = String(err.token.value).length;
                break;
            }
        }

        throw new Error(
            `file.munos:${err.token.row}:${err.token.column}: ParseError: ${
                err.message.replace('%s', printValue)
            }\n${this.originalInput.split('\n')[err.token.row - 1]}\n${
                ' '.repeat(Math.max(0, err.token.column - 1)) +
                '^'.repeat(printSize)
            }`,
        );
    }
    process() {
        outer: while (true) {
            const consumes = this.currentNode.consumes.pop() ?? null;
            switch (consumes) {
                case null: {
                    // Special handling for TERNARY: children[0]=condition, children[1]=then (already added)
                    // Queue contains the else expression
                    if (this.currentNode.type === NODE_TYPE.TERNARY && this.currentNode.children.length === 2) {
                        // Flush stack to queue
                        while (this.currentNode.stack.length) {
                            this.currentNode.queue.push(
                                this.currentNode.stack.pop()!,
                            );
                        }

                        // Evaluate queue to form the else-expression
                        const elseStack: Array<Node> = [];
                        for (let qi = 0; qi < this.currentNode.queue.length; ++qi) {
                            const qnode = this.currentNode.queue[qi];
                            const opDetails = OperatorDetails[qnode.type];
                            if (qnode.type === NODE_TYPE.VALUE ||
                                qnode.type === NODE_TYPE.STRING ||
                                qnode.type === NODE_TYPE.NULL ||
                                qnode.type === NODE_TYPE.READ_GLOBAL ||
                                qnode.type === NODE_TYPE.REMEMBERED ||
                                qnode.type === NODE_TYPE.TERNARY) {
                                elseStack.push(qnode);
                            } else if (opDetails && opDetails.type === 'BINARY') {
                                const b = elseStack.pop()!;
                                const a = elseStack.pop()!;
                                a.parent = qnode;
                                b.parent = qnode;
                                qnode.children.push(a);
                                qnode.children.push(b);
                                elseStack.push(qnode);
                            } else if (opDetails && opDetails.type === 'UNARY') {
                                const a = elseStack.pop()!;
                                a.parent = qnode;
                                qnode.children.unshift(a);
                                elseStack.push(qnode);
                            }
                        }

                        // Add else-expression as child[2]
                        if (elseStack.length === 1) {
                            const elseExpr = elseStack[0];
                            elseExpr.parent = this.currentNode;
                            this.currentNode.children.push(elseExpr);
                        }

                        this.currentNode.queue.length = 0;
                        this.currentNode.stack.length = 0;

                        // Move back up the tree
                        if (!this.currentNode.parent) {
                            break outer;
                        }
                        this.currentNode = this.currentNode.parent;
                        break;
                    }

                    if(this.currentNode.queue.length > 0 || this.currentNode.stack.length > 0) {
                        // Pop all the remaining tokens from the stack to the queue
                        while (this.currentNode.stack.length) {
                            this.currentNode.queue.push(
                                this.currentNode.stack.pop()!,
                            );
                        }

                        // Now we need to evaluate the expression and turn it into an AST
                        const evaluationStack: Array<Node> = [];

                        for (let i = 0; i < this.currentNode.queue.length; ++i) {
                            const node = this.currentNode.queue[i];
                            
                            const operatorDetails = OperatorDetails[node.type];
                            if (node.type === NODE_TYPE.VALUE) {
                                evaluationStack.push(node);
                            } else if (node.type === NODE_TYPE.STRING) {
                                evaluationStack.push(node);
                            } else if (node.type === NODE_TYPE.NULL) {
                                evaluationStack.push(node);
                            } else if (node.type === NODE_TYPE.READ_GLOBAL) {
                                evaluationStack.push(node);
                            } else if (node.type === NODE_TYPE.TERNARY) {
                                evaluationStack.push(node);
                            } else if (node.type === NODE_TYPE.REMEMBERED) {
                                evaluationStack.push(node);
                            } else if (
                                operatorDetails && operatorDetails.type === 'BINARY'
                            ) {
                                const b = evaluationStack.pop();
                                const a = evaluationStack.pop();

                                if (!a || !b) {
                                    throw new Error(
                                        `Unexpected item in expression: "${node.type}"`,
                                    );
                                }

                                a.parent = node;
                                b.parent = node;
                                node.children.push(a);
                                node.children.push(b);
                                evaluationStack.push(node);
                            } else if(
                                operatorDetails && operatorDetails.type === 'UNARY'
                            ) {
                                const a = evaluationStack.pop();
                                if (!a) {
                                    throw new Error(
                                        `Unexpected item in expression: "${node.type}"`,
                                    );
                                }
                                a.parent = node;
                                node.children.unshift(a);
                                evaluationStack.push(node);
                            } else {
                                throw new Error(
                                    `Unexpected node type in expression: "${node.type}"`,
                                );
                            }
                        }

                        if (evaluationStack.length !== 1) {
                            throw new Error(
                                `Unexpected unbalanced evaluation stack`,
                            );
                        }

                        this.currentNode.queue.length = 0;
                        this.currentNode.stack.length = 0;

                        this.replaceCurrentNode(evaluationStack.pop()!);
                    }

                    // If there is no consumes left, we are done with this node, so we move back up the tree
                    if (!this.currentNode.parent) {
                        break outer;
                    }

                    this.currentNode = this.currentNode.parent;
                    break;
                }
                case CONSUME.SEMICOLON: {
                    switch (this.peakToken().type) {
                        case TokenType.SEMICOLON: {
                            // Move past the semicolon token
                            this.advanceToken();
                            break;
                        }
                        default:
                            throw new ParseError(
                                `Unexpected %s, expected semicolon`,
                                this.peakToken(),
                            );
                    }
                    break;
                }
                case CONSUME.MAIN: {
                    if (this.peakToken().type !== TokenType.EOF) {
                        this.replaceCurrentNode(
                            new Node(NODE_TYPE.EXECUTABLE_BLOCK)
                                .addConsume(
                                    CONSUME.MAIN_CONTINUE,
                                    CONSUME.STATEMENT,
                                ),
                        );
                    }
                    break;
                }
                case CONSUME.MAIN_CONTINUE: {
                    if (this.peakToken().type === TokenType.SEMICOLON) {
                        this.advanceToken();
                        if (this.peakToken().type === TokenType.EOF) {
                            break;
                        }
                        this.currentNode.addConsume(
                            CONSUME.MAIN_CONTINUE,
                            CONSUME.STATEMENT,
                        );
                    } else if (this.peakToken().type !== TokenType.EOF) {
                        throw new ParseError(
                            `Unexpected %s in main`,
                            this.peakToken(),
                        );
                    }
                    break;
                }
                case CONSUME.EXECUTABLE_BLOCK: {
                    if (this.peakToken().type !== TokenType.RBRACE) {
                        this.replaceCurrentNode(
                            new Node(NODE_TYPE.EXECUTABLE_BLOCK)
                                .addConsume(
                                    CONSUME.BLOCK_CONTINUE,
                                    CONSUME.STATEMENT,
                                ),
                        );
                    } else {
                        this.replaceCurrentNode(
                            new Node(NODE_TYPE.EXECUTABLE_BLOCK),
                        );
                    }
                    break;
                }
                case CONSUME.BLOCK_CONTINUE: {
                    if (this.peakToken().type === TokenType.SEMICOLON) {
                        this.advanceToken();
                        if (this.peakToken().type === TokenType.RBRACE) {
                            break;
                        }
                        this.currentNode.addConsume(
                            CONSUME.BLOCK_CONTINUE,
                            CONSUME.STATEMENT,
                        );
                    } else if (this.peakToken().type !== TokenType.RBRACE) {
                        throw new ParseError(
                            `Unexpected %s in block`,
                            this.peakToken(),
                        );
                    }
                    break;
                }
                case CONSUME.STATEMENT: {
                    switch (this.peakToken().type) {
                        case TokenType.KEYWORD: {
                            switch (this.peakToken().value) {
                                default: {
                                    throw new ParseError(
                                        `Unimplemented keyword in statement`,
                                        this.peakToken(),
                                    );
                                }
                            }
                            break;
                        }
                        case TokenType.IDENTIFIER: {
                            this.currentNode
                                .addConsume(
                                    CONSUME.EXPRESSION,
                                );
                            break;
                        }
                        default: {
                            // We don't know what this is so treat it like a expression
                            this.currentNode
                                .addConsume(
                                    CONSUME.EXPRESSION,
                                );
                        }
                    }
                    break;
                }
                case CONSUME.STRING: {
                    if (this.peakToken().type !== TokenType.STRING) {
                        throw new ParseError(
                            `Expected string but found %s`,
                            this.peakToken(),
                        );
                    }
                    this.replaceCurrentNode(
                        new Node(NODE_TYPE.STRING, this.peakToken().value),
                    );
                    // Move past the token
                    this.advanceToken();
                    break;
                }
                case CONSUME.PARAMETER_LIST: {
                    if (this.peakToken().type !== TokenType.RPAREN) {
                        this.replaceCurrentNode(
                            new Node(NODE_TYPE.LIST)
                                .addConsume(
                                    CONSUME.PARAMETER_LIST_CONTINUE,
                                    CONSUME.IDENTIFIER,
                                ),
                        );
                    } else {
                        this.replaceCurrentNode(
                            new Node(NODE_TYPE.LIST),
                        );
                    }
                    break;
                }
                case CONSUME.PARAMETER_LIST_CONTINUE: {
                    if (this.peakToken().type === TokenType.COMMA) {
                        this.currentNode.addConsume(
                            CONSUME.PARAMETER_LIST_CONTINUE,
                            CONSUME.IDENTIFIER,
                        );
                        // Move past the comma token
                        this.advanceToken();
                    } else if (this.peakToken().type !== TokenType.RPAREN) {
                        throw new ParseError(
                            `Unexpected %s in function parameter declaration`,
                            this.peakToken(),
                        );
                    }
                    break;
                }
                case CONSUME.IDENTIFIER: {
                    if (this.peakToken().type !== TokenType.IDENTIFIER) {
                        throw new ParseError(
                            `Expected identifier but found %s`,
                            this.peakToken(),
                        );
                    }
                    this.replaceCurrentNode(
                        new Node(NODE_TYPE.IDENTIFIER, this.peakToken().value),
                    );
                    // Move past the identifier token
                    this.advanceToken();
                    break;
                }
                case CONSUME.IDENTIFIER_LIST: {
                    if (this.peakToken().type === TokenType.IDENTIFIER) {
                        this.replaceCurrentNode(
                            new Node(NODE_TYPE.LIST)
                                .addConsume(
                                    CONSUME.IDENTIFIER_LIST_CONTINUE,
                                    CONSUME.IDENTIFIER,
                                ),
                        );
                    } else {
                        // Empty list since there wasn't a single identifier
                        this.replaceCurrentNode(
                            new Node(NODE_TYPE.LIST),
                        );
                    }
                    break;
                }
                case CONSUME.IDENTIFIER_LIST_CONTINUE: {
                    if (this.peakToken().type === TokenType.COMMA) {
                        this.currentNode.addConsume(
                            CONSUME.IDENTIFIER_LIST_CONTINUE,
                            CONSUME.IDENTIFIER,
                        );
                        // Move past the comma token
                        this.advanceToken();
                    }
                    break;
                }
                case CONSUME.IDENTIFIER_OR_START_BRACKET: {
                    if (this.peakToken().type === TokenType.IDENTIFIER) {
                        // When we are given a simple identifier, it means the shortcut syntax is being used.
                        // In these cases, the user is trying to compare the value of "this" against the identifier.
                        this.replaceCurrentNode(
                            new Node(NODE_TYPE.EQUAL, null).addChild(
                                new Node(NODE_TYPE.READ_GLOBAL)
                                    .addChild(
                                        new Node(NODE_TYPE.IDENTIFIER, 'key'),
                                    ),
                                new Node(NODE_TYPE.IDENTIFIER, this.peakToken().value),
                            )
                        );
                        // Move past the identifier token
                        this.advanceToken();
                    } else if(this.peakToken().type === TokenType.LEFT_BRACKET) {
                        this.currentNode.addConsume(CONSUME.EXPRESSION);
                        // Move past the parenthesis token
                        this.advanceToken();
                    }
                    break;
                }
                case CONSUME.START_BRACKET: {
                    if (this.peakToken().type !== TokenType.LEFT_BRACKET) {
                        throw new ParseError(
                            `Expected [ but found %s`,
                            this.peakToken(),
                        );
                    }
                    // Move past the parenthesis token
                    this.advanceToken();
                    break;
                }
                case CONSUME.END_BRACKET: {
                    if (this.peakToken().type !== TokenType.RIGHT_BRACKET) {
                        throw new ParseError(
                            `Expected ] but found %s`,
                            this.peakToken(),
                        );
                    }
                    // Move past the parenthesis token
                    this.advanceToken();
                    break;
                }
                case CONSUME.START_PARENTHESIS: {
                    if (this.peakToken().type !== TokenType.LPAREN) {
                        throw new ParseError(
                            `Expected ( but found %s`,
                            this.peakToken(),
                        );
                    }
                    // Move past the parenthesis token
                    this.advanceToken();
                    break;
                }
                case CONSUME.END_PARENTHESIS: {
                    if (this.peakToken().type !== TokenType.RPAREN) {
                        throw new ParseError(
                            `Expected ) but found %s`,
                            this.peakToken(),
                        );
                    }
                    // Move past the parenthesis token
                    this.advanceToken();
                    break;
                }
                case CONSUME.START_CURLY_BRACKET: {
                    if (this.peakToken().type !== TokenType.LBRACE) {
                        throw new ParseError(
                            `Expected { but found %s`,
                            this.peakToken(),
                        );
                    }
                    // Move past the parenthesis token
                    this.advanceToken();
                    break;
                }
                case CONSUME.END_CURLY_BRACKET: {
                    if (this.peakToken().type !== TokenType.RBRACE) {
                        throw new ParseError(
                            `Expected } but found %s`,
                            this.peakToken(),
                        );
                    }
                    // Move past the parenthesis token
                    this.advanceToken();
                    break;
                }
                case CONSUME.EXPRESSION_LIST: {
                    switch (this.peakToken().type) {
                        case TokenType.RPAREN:
                        case TokenType.RIGHT_BRACKET: {
                            this.replaceCurrentNode(
                                new Node(NODE_TYPE.LIST),
                            );
                            break;
                        }
                        default: {
                            this.replaceCurrentNode(
                                new Node(NODE_TYPE.LIST)
                                    .addConsume(
                                        CONSUME.EXPRESSION_LIST_CONTINUE,
                                        CONSUME.EXPRESSION,
                                    ),
                            );
                            break;
                        }
                    }
                    break;
                }
                case CONSUME.EXPRESSION_LIST_CONTINUE: {
                    switch (this.peakToken().type) {
                        case TokenType.COMMA: {
                            this.currentNode.addConsume(
                                CONSUME.EXPRESSION_LIST_CONTINUE,
                                CONSUME.EXPRESSION,
                            );
                            // Move past the comma token
                            this.advanceToken();
                            break;
                        }
                        case TokenType.RPAREN:
                        case TokenType.RIGHT_BRACKET: {
                            // We ran into something that ends the expression.
                            break;
                        }
                        default: {
                            throw new ParseError(
                                `Unexpected %s, expected expression`,
                                this.peakToken(),
                            );
                        }
                    }
                    break;
                }
                case CONSUME.EXPRESSION: {
                    switch (this.peakToken().type) {
                        case TokenType.IDENTIFIER: {
                            this.currentNode.addQueue(
                                new Node(NODE_TYPE.READ_GLOBAL)
                                    .addChild(
                                        new Node(
                                            NODE_TYPE.IDENTIFIER,
                                            this.peakToken().value,
                                        ),
                                    ),
                            );
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(
                                CONSUME.EXPRESSION_OPERATOR,
                            );
                            break;
                        }
                        case TokenType.NUMBER: {
                            this.currentNode.addQueue(
                                new Node(
                                    NODE_TYPE.VALUE,
                                    this.peakToken().value,
                                ),
                            );
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(
                                CONSUME.EXPRESSION_OPERATOR,
                            );
                            break;
                        }
                        case TokenType.STRING: {
                            this.currentNode.addQueue(
                                new Node(
                                    NODE_TYPE.STRING,
                                    this.peakToken().value,
                                ),
                            );
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(
                                CONSUME.EXPRESSION_OPERATOR,
                            );
                            break;
                        }
                        case TokenType.NULL: {
                            this.currentNode.addQueue(
                                new Node(NODE_TYPE.NULL, null),
                            );
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(
                                CONSUME.EXPRESSION_OPERATOR,
                            );
                            break;
                        }
                        case TokenType.MINUS: {
                            this.currentNode.addQueue(
                                new Node(
                                    NODE_TYPE.VALUE,
                                    this.peakToken().value,
                                ),
                            );
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(
                                CONSUME.EXPRESSION_OPERATOR,
                            );
                            break;
                        }
                        case TokenType.NOT: {
                            this.currentNode.addStack(
                                new Node(NODE_TYPE.NOT),
                            );
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.LBRACE: {
                            // Remembered value: {expr} — store marker on stack
                            const rememberMarker = new Node(NODE_TYPE.REMEMBERED);
                            rememberMarker.value = this.currentNode.queue.length;
                            this.currentNode.addStack(rememberMarker);
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.LPAREN: {
                            // Store queue length so ternary knows where paren expression starts
                            const parenNode = new Node(NODE_TYPE.LEFT_PARENTHESIS);
                            parenNode.value = this.currentNode.queue.length;
                            this.currentNode.addStack(parenNode);
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.RPAREN: {
                            // Determine how many stack entries until we find the matching left parenthesis
                            let i = this.currentNode.stack.length - 1;
                            while (
                                i >= 0 &&
                                this.currentNode.stack[i].type !==
                                    NODE_TYPE.LEFT_PARENTHESIS
                            ) {
                                --i;
                            }

                            if (i >= 0) {
                                // Move the nodes from the stack to the expression
                                for (let j = 0; j < i; ++j) {
                                    this.currentNode.addQueue(
                                        this.currentNode.stack.pop()!,
                                    );
                                }

                                // Finally we remove the left parenthesis from the stack
                                this.currentNode.stack.pop();

                                // Move past the token
                                this.advanceToken();
                                this.currentNode.addConsume(
                                    CONSUME.EXPRESSION_OPERATOR,
                                );
                            } else {
                                // We reached the end of the stack yet there is no left parenthesis. This means that the
                                // right parenthesis was actually not part of the expression at all, but something outside
                                // the expression. For example the right parenthesis of a function call's argument list.
                                // Therefore we will end the expression here.
                            }
                            break;
                        }
                        case TokenType.LEFT_BRACKET: {
                            // Array declaration
                            const arrayAccessNode = new Node(
                                NODE_TYPE.ARRAY,
                            );
                            this.currentNode.addQueue(arrayAccessNode);
                            this.replaceCurrentNode(arrayAccessNode);

                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(
                                CONSUME.EXPRESSION_LIST,
                            );
                            break;
                        }
                        case TokenType.DOT: {
                            // There is a DOT operator where we would not expect a DOT operator. This might either
                            // be a syntax error or an implicit "this." expression. To figure out which it is we will
                            // examine the queue to see if this is at the very start of the queue.

                            if(this.currentNode.queue.length != 0) {
                                // The queue was not empty, so this is a syntax error, as the DOT operator was not at the
                                // start of the expression.
                                throw new ParseError(
                                    `Unexpected %s in expression`,
                                    this.peakToken(),
                                );
                            } else {
                                // The queue was empty, so this is an implicit "this." expression.
                                this.currentNode.addQueue(
                                    new Node(NODE_TYPE.READ_GLOBAL)
                                        .addChild(
                                            new Node(
                                                NODE_TYPE.IDENTIFIER,
                                                'this',
                                            ),
                                        ),
                                );

                                // Once we are done with this dot access, we should continue parsing the expression
                                // by looking for an operator (or end of expression)
                                this.currentNode.addConsume(
                                    CONSUME.EXPRESSION_OPERATOR,
                                );

                                // Create the OBJECT_ACCESS_EXPRESSION node
                                const objectAccessNode = new Node(NODE_TYPE.OBJECT_ACCESS_EXPRESSION)
                                    .addConsume(
                                        CONSUME.IDENTIFIER_OR_START_BRACKET,
                                    );

                                // Add the call node to the expression queue so that when we are done parsing the 
                                // object access node it's ready in the queue to be used as part of the expression.
                                this.currentNode.addQueue(objectAccessNode);

                                // Add the current node as the parent of the object access node so that once we are
                                // done parsing the call node we go back to parsing this expression
                                objectAccessNode.parent = this.currentNode;

                                // Change the currentNode to the object access node so we can begin consuming everything
                                // it needs. Note that we have not added the object access node to the children of the
                                // current node, because it is not supposed to be there. Instead it is treated as part
                                // of the expression.
                                this.currentNode = objectAccessNode;

                                // Move past the DOT token
                                this.advanceToken();
                            }
                            break;
                        }
                        default:
                            throw new ParseError(
                                `Unexpected %s in expression`,
                                this.peakToken(),
                            );
                    }
                    break;
                }
                case CONSUME.EXPRESSION_OPERATOR: {
                    let operator: NODE_TYPE | null = null;

                    switch (this.peakToken().type) {
                        case TokenType.DOT: {
                            // Object access
                            const objectAccessExpressionNode = new Node(
                                NODE_TYPE.OBJECT_ACCESS_EXPRESSION,
                            );
                            this.currentNode.addQueue(objectAccessExpressionNode);
                            // After we are done with the object access expression, we should continue parsing the outer expression
                            this.currentNode.addConsume(
                                CONSUME.EXPRESSION_OPERATOR,
                            );

                            objectAccessExpressionNode.parent = this.currentNode;
                            this.currentNode = objectAccessExpressionNode;

                            // Move past the token
                            this.advanceToken();

                            // Parse the object access expression
                            this.currentNode.addConsume(
                                CONSUME.IDENTIFIER_OR_START_BRACKET,
                            );

                            break;
                        }
                        case TokenType.PLUS: {
                            operator = NODE_TYPE.ADDITION;
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.MINUS: {
                            operator = NODE_TYPE.SUBTRACTION;
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.ASTERISK: {
                            operator = NODE_TYPE.MULTIPLICATION;
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.SLASH: {
                            operator = NODE_TYPE.DIVISION;
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.EQUAL: {
                            operator = NODE_TYPE.EQUAL;
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.NOT_EQUAL: {
                            operator = NODE_TYPE.NOT_EQUAL;
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.LESS_THAN: {
                            operator = NODE_TYPE.LESS_THAN;
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.LESS_THAN_OR_EQUAL: {
                            operator = NODE_TYPE.LESS_THAN_OR_EQUAL;
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.GREATER_THAN: {
                            operator = NODE_TYPE.GREATER_THAN;
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.GREATER_THAN_OR_EQUAL: {
                            operator = NODE_TYPE.GREATER_THAN_OR_EQUAL;
                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.AND: {
                            operator = NODE_TYPE.AND;
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.OR: {
                            operator = NODE_TYPE.OR;
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.XOR: {
                            operator = NODE_TYPE.XOR;
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.LEFT_BRACKET: {
                            // Array access
                            const arrayAccessNode = new Node(
                                NODE_TYPE.ARRAY_ACCESS,
                            );
                            this.currentNode.addQueue(arrayAccessNode);
                            
                            // After we are done with the array access expression, we should continue parsing the outer expression
                            this.currentNode.addConsume(
                                CONSUME.EXPRESSION_OPERATOR,
                            );

                            arrayAccessNode.parent = this.currentNode;
                            this.currentNode = arrayAccessNode;

                            // Move past the token
                            this.advanceToken();
                            this.currentNode.addConsume(CONSUME.EXPRESSION);
                            break;
                        }
                        case TokenType.RIGHT_BRACKET: {
                            if (
                                this.currentNode.parent?.type ===
                                    NODE_TYPE.ARRAY
                            ) {
                                this.advanceToken();
                            } else if (
                                this.currentNode.type === NODE_TYPE.ARRAY_ACCESS
                            ) {
                                this.advanceToken();
                            } else if (
                                this.currentNode.type === NODE_TYPE.OBJECT_ACCESS_EXPRESSION
                            ) {
                                this.advanceToken();
                            } else {
                                throw new ParseError(
                                    `Unexpected %s in expression`,
                                    this.peakToken(),
                                );
                            }
                            break;
                        }
                        case TokenType.RPAREN: {
                            // Look for matching LEFT_PARENTHESIS on stack
                            let parenIdx = this.currentNode.stack.length - 1;
                            while (
                                parenIdx >= 0 &&
                                this.currentNode.stack[parenIdx].type !== NODE_TYPE.LEFT_PARENTHESIS
                            ) {
                                --parenIdx;
                            }

                            if (parenIdx >= 0) {
                                // Pop operators above LEFT_PARENTHESIS to queue
                                while (this.currentNode.stack.length > parenIdx + 1) {
                                    this.currentNode.queue.push(
                                        this.currentNode.stack.pop()!,
                                    );
                                }
                                // Pop the LEFT_PARENTHESIS
                                this.currentNode.stack.pop();
                                // Advance past )
                                this.advanceToken();
                                // Continue looking for operators
                                this.currentNode.addConsume(CONSUME.EXPRESSION_OPERATOR);
                            }
                            // If no LEFT_PARENTHESIS found, just break - the ) belongs to outer context
                            break;
                        }
                        case TokenType.RBRACE: {
                            // End of remembered value — find matching REMEMBERED marker on stack
                            let remIdx = this.currentNode.stack.length - 1;
                            while (
                                remIdx >= 0 &&
                                this.currentNode.stack[remIdx].type !== NODE_TYPE.REMEMBERED
                            ) {
                                --remIdx;
                            }

                            if (remIdx >= 0) {
                                // Pop operators above REMEMBERED marker to queue
                                while (this.currentNode.stack.length > remIdx + 1) {
                                    this.currentNode.queue.push(
                                        this.currentNode.stack.pop()!,
                                    );
                                }

                                // Pop the REMEMBERED marker
                                const marker = this.currentNode.stack.pop()!;
                                const queueStart = marker.value as number;

                                // Extract inner RPN queue items
                                const innerRPN = this.currentNode.queue.splice(queueStart);

                                // Evaluate RPN into a single expression tree
                                const evalStack: Array<Node> = [];
                                for (const qnode of innerRPN) {
                                    const opDetails = OperatorDetails[qnode.type];
                                    if (qnode.type === NODE_TYPE.VALUE ||
                                        qnode.type === NODE_TYPE.STRING ||
                                        qnode.type === NODE_TYPE.NULL ||
                                        qnode.type === NODE_TYPE.READ_GLOBAL ||
                                        qnode.type === NODE_TYPE.REMEMBERED ||
                                        qnode.type === NODE_TYPE.TERNARY) {
                                        evalStack.push(qnode);
                                    } else if (opDetails && opDetails.type === 'BINARY') {
                                        const b = evalStack.pop()!;
                                        const a = evalStack.pop()!;
                                        a.parent = qnode;
                                        b.parent = qnode;
                                        qnode.children.push(a);
                                        qnode.children.push(b);
                                        evalStack.push(qnode);
                                    } else if (opDetails && opDetails.type === 'UNARY') {
                                        const a = evalStack.pop()!;
                                        a.parent = qnode;
                                        qnode.children.unshift(a);
                                        evalStack.push(qnode);
                                    }
                                }

                                // Build REMEMBERED node wrapping the single evaluated expression
                                const rememberedNode = new Node(NODE_TYPE.REMEMBERED);
                                if (evalStack.length === 1) {
                                    rememberedNode.addChild(evalStack[0]);
                                }
                                this.currentNode.addQueue(rememberedNode);

                                // Advance past }
                                this.advanceToken();
                                // Continue looking for operators
                                this.currentNode.addConsume(CONSUME.EXPRESSION_OPERATOR);
                            }
                            break;
                        }
                        case TokenType.COLON: {
                            // COLON ends the current expression (ternary then-branch)
                            // Evaluate what we have and add it as a child, then let TERNARY_ELSE handle the colon
                            if (this.currentNode.type === NODE_TYPE.TERNARY) {
                                // Flush stack to queue
                                while (this.currentNode.stack.length) {
                                    this.currentNode.queue.push(
                                        this.currentNode.stack.pop()!,
                                    );
                                }

                                // Evaluate queue to form the then-expression
                                const thenStack: Array<Node> = [];
                                for (let qi = 0; qi < this.currentNode.queue.length; ++qi) {
                                    const qnode = this.currentNode.queue[qi];
                                    const opDetails = OperatorDetails[qnode.type];
                                    if (qnode.type === NODE_TYPE.VALUE ||
                                        qnode.type === NODE_TYPE.STRING ||
                                        qnode.type === NODE_TYPE.NULL ||
                                        qnode.type === NODE_TYPE.READ_GLOBAL ||
                                        qnode.type === NODE_TYPE.REMEMBERED ||
                                        qnode.type === NODE_TYPE.TERNARY) {
                                        thenStack.push(qnode);
                                    } else if (opDetails && opDetails.type === 'BINARY') {
                                        const b = thenStack.pop()!;
                                        const a = thenStack.pop()!;
                                        a.parent = qnode;
                                        b.parent = qnode;
                                        qnode.children.push(a);
                                        qnode.children.push(b);
                                        thenStack.push(qnode);
                                    } else if (opDetails && opDetails.type === 'UNARY') {
                                        const a = thenStack.pop()!;
                                        a.parent = qnode;
                                        qnode.children.unshift(a);
                                        thenStack.push(qnode);
                                    }
                                }

                                // Add then-expression as child[1]
                                if (thenStack.length === 1) {
                                    const thenExpr = thenStack[0];
                                    thenExpr.parent = this.currentNode;
                                    this.currentNode.children.push(thenExpr);
                                }

                                // Clear queue and stack
                                this.currentNode.queue.length = 0;
                                this.currentNode.stack.length = 0;

                                // Don't advance token - let TERNARY_ELSE handle the colon
                            }
                            break;
                        }
                        case TokenType.QUESTION: {
                            // Ternary operator: pop operators from stack until LEFT_PARENTHESIS (lowest precedence)
                            // Also find the queue start index if we're inside parentheses
                            let queueStartIndex = 0;
                            while (this.currentNode.stack.length) {
                                const top = this.currentNode.stack[this.currentNode.stack.length - 1];
                                // Stop at LEFT_PARENTHESIS - it's a barrier
                                if (top.type === NODE_TYPE.LEFT_PARENTHESIS) {
                                    // Get the queue index where this paren's expression started
                                    queueStartIndex = top.value as number;
                                    break;
                                }
                                this.currentNode.queue.push(
                                    this.currentNode.stack.pop()!,
                                );
                            }

                            // Evaluate the queue FROM queueStartIndex to form the condition expression
                            const conditionStack: Array<Node> = [];
                            for (let qi = queueStartIndex; qi < this.currentNode.queue.length; ++qi) {
                                const qnode = this.currentNode.queue[qi];
                                const opDetails = OperatorDetails[qnode.type];
                                if (qnode.type === NODE_TYPE.VALUE ||
                                    qnode.type === NODE_TYPE.STRING ||
                                    qnode.type === NODE_TYPE.NULL ||
                                    qnode.type === NODE_TYPE.READ_GLOBAL ||
                                    qnode.type === NODE_TYPE.REMEMBERED ||
                                    qnode.type === NODE_TYPE.TERNARY) {
                                    conditionStack.push(qnode);
                                } else if (opDetails && opDetails.type === 'BINARY') {
                                    const b = conditionStack.pop()!;
                                    const a = conditionStack.pop()!;
                                    a.parent = qnode;
                                    b.parent = qnode;
                                    qnode.children.push(a);
                                    qnode.children.push(b);
                                    conditionStack.push(qnode);
                                } else if (opDetails && opDetails.type === 'UNARY') {
                                    const a = conditionStack.pop()!;
                                    a.parent = qnode;
                                    qnode.children.unshift(a);
                                    conditionStack.push(qnode);
                                }
                            }

                            // Truncate queue to queueStartIndex (preserve items before the paren)
                            this.currentNode.queue.length = queueStartIndex;

                            // Create TERNARY node with condition as first child
                            const ternaryNode = new Node(NODE_TYPE.TERNARY);
                            if (conditionStack.length === 1) {
                                const conditionNode = conditionStack[0];
                                conditionNode.parent = ternaryNode;
                                ternaryNode.children.push(conditionNode);
                            }

                            this.currentNode.addQueue(ternaryNode);

                            // After we're done with ternary, continue parsing outer expression
                            this.currentNode.addConsume(
                                CONSUME.EXPRESSION_OPERATOR,
                            );

                            ternaryNode.parent = this.currentNode;
                            this.currentNode = ternaryNode;

                            // Move past ?
                            this.advanceToken();

                            // Parse "then" expression, expect ":", parse "else" expression
                            this.currentNode.addConsume(
                                CONSUME.TERNARY_ELSE,
                                CONSUME.EXPRESSION,
                            );
                            break;
                        }
                        default:
                            break;
                    }

                    if (!!operator) {
                        // If the token is an operator, then we add it to the stack. However, we need to check if the operator
                        // precedence rules causes it to push other operators from the stack onto the queue first.
                        const operatorDetails = OperatorDetails[operator];
                        if (!operatorDetails) {
                            throw new ParseError(
                                `Unexpected %s in expression`,
                                this.peakToken(),
                            );
                        }

                        if (operatorDetails.associativity === 'LEFT') {
                            while (this.currentNode.stack.length) {
                                const token = this.currentNode
                                    .stack[
                                        this.currentNode.stack.length - 1
                                    ];
                                // LEFT_PARENTHESIS is a barrier - stop precedence popping
                                if (token.type === NODE_TYPE.LEFT_PARENTHESIS) {
                                    break;
                                }
                                const neighbourOperator =
                                    OperatorDetails[token.type];
                                if (!neighbourOperator) {
                                    throw new ParseError(
                                        `Unexpected %s in expression`,
                                        this.peakToken(),
                                    );
                                }
                                if (
                                    neighbourOperator.precedence >=
                                        operatorDetails.precedence
                                ) {
                                    this.currentNode.queue.push(
                                        this.currentNode.stack.pop()!,
                                    );
                                } else {
                                    break;
                                }
                            }
                        } else if (operatorDetails.associativity === 'RIGHT') {
                            while (this.currentNode.stack.length) {
                                const token = this.currentNode
                                    .stack[
                                        this.currentNode.stack.length - 1
                                    ];
                                // LEFT_PARENTHESIS is a barrier - stop precedence popping
                                if (token.type === NODE_TYPE.LEFT_PARENTHESIS) {
                                    break;
                                }
                                const neighbourOperator =
                                    OperatorDetails[token.type];
                                if (!neighbourOperator) {
                                    throw new ParseError(
                                        `Unexpected %s in expression`,
                                        this.peakToken(),
                                    );
                                }
                                if (
                                    neighbourOperator.precedence >
                                        operatorDetails.precedence
                                ) {
                                    this.currentNode.queue.push(
                                        this.currentNode.stack.pop()!,
                                    );
                                } else {
                                    break;
                                }
                            }
                        }

                        // Finally add our new operator to the stack
                        this.currentNode.stack.push(new Node(operator));
                    }
                    break;
                }
                case CONSUME.TERNARY_ELSE: {
                    if (this.peakToken().type !== TokenType.COLON) {
                        throw new ParseError(
                            `Expected : but found %s`,
                            this.peakToken(),
                        );
                    }
                    this.advanceToken(); // consume :
                    this.currentNode.addConsume(CONSUME.EXPRESSION); // else-expression
                    break;
                }
                default:
                    throw new Error(`Unimplemented consumes: ${consumes}`);
            }
        }
    }
    peakToken(offset: number = 0) {
        return this.input[this.position + offset] ?? this.eofToken;
    }
    advanceToken() {
        ++this.position;
    }
}

class ParseError extends Error {
    token: Token;
    constructor(message: string, token: Token) {
        super(message);
        this.name = 'ParseError';
        this.token = token;
    }
}

export { Parser };
