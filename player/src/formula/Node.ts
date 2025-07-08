import { NODE_TYPE } from './NODE_TYPE.ts';
import { CONSUME } from './CONSUME.ts';

class Node {
    type: NODE_TYPE;
    parent: Node | null = null;
    children: Array<Node> = [];
    consumes: Array<CONSUME> = [];
    value: any;
    queue: Array<Node> = [];
    stack: Array<Node> = [];
    constructor(type: NODE_TYPE, value: any = null) {
        this.type = type;
        this.value = value;
    }
    addChild(...args: Array<Node>): Node {
        for (let i = 0; i < args.length; ++i) {
            this.children.push(args[i]);
            args[i].parent = this;
        }
        return this;
    }
    addConsume(...args: Array<CONSUME>): Node {
        this.consumes.push(...args);
        return this;
    }
    addStack(...args: Array<Node>): Node {
        this.stack.push(...args);
        return this;
    }
    addQueue(...args: Array<Node>): Node {
        this.queue.push(...args);
        return this;
    }
}

function createNodeConstructors(enumType: typeof NODE_TYPE) {
    const constructors: Record<
        string,
        (...args: [string, ...Array<Node>] | Array<Node>) => Node
    > = {};

    for (const [key, value] of Object.entries(enumType)) {
        constructors[key] = (...args: [string, ...Array<Node>] | Array<Node>) =>
            args[0] instanceof Node
                ? new Node(value as NODE_TYPE, null).addChild(
                    ...args as Array<Node>,
                )
                : new Node(value as NODE_TYPE, args[0]).addChild(
                    ...args.slice(1) as Array<Node>,
                );
    }

    return constructors;
}

const N = createNodeConstructors(NODE_TYPE);

export { N, Node };
