/**
 * Builder Direct Tests
 *
 * Tests Builder.convert() with manually constructed Node trees, verifying
 * the correct Unit types are produced and parent/child relationships are set.
 * Also tests error cases for invalid child counts.
 */

import { assertEquals, assertThrows } from "https://deno.land/std/assert/mod.ts";
import { Builder } from "../src/formula/Builder.ts";
import { Node, N } from "../src/formula/Node.ts";
import { NODE_TYPE } from "../src/formula/NODE_TYPE.ts";

// Unit type imports for instanceof checks
import { AdditionUnit } from "../src/formula/unit/AdditionUnit.ts";
import { SubtractionUnit } from "../src/formula/unit/SubtractionUnit.ts";
import { MultiplicationUnit } from "../src/formula/unit/MultiplicationUnit.ts";
import { DivisionUnit } from "../src/formula/unit/DivisionUnit.ts";
import { ModuloUnit } from "../src/formula/unit/ModuloUnit.ts";
import { ExponentUnit } from "../src/formula/unit/ExponentUnit.ts";
import { ValueUnit } from "../src/formula/unit/ValueUnit.ts";
import { StringUnit } from "../src/formula/unit/StringUnit.ts";
import { NullUnit } from "../src/formula/unit/NullUnit.ts";
import { IdentifierUnit } from "../src/formula/unit/IdentifierUnit.ts";
import { ReadGlobalUnit } from "../src/formula/unit/ReadGlobalUnit.ts";
import { NotUnit } from "../src/formula/unit/NotUnit.ts";
import { EqualUnit } from "../src/formula/unit/EqualUnit.ts";
import { NotEqualUnit } from "../src/formula/unit/NotEqualUnit.ts";
import { GreaterThanUnit } from "../src/formula/unit/GreaterThanUnit.ts";
import { GreaterThanOrEqualUnit } from "../src/formula/unit/GreaterThanOrEqualUnit.ts";
import { LessThanUnit } from "../src/formula/unit/LessThanUnit.ts";
import { LessThanOrEqualUnit } from "../src/formula/unit/LessThanOrEqualUnit.ts";
import { AndUnit } from "../src/formula/unit/AndUnit.ts";
import { OrUnit } from "../src/formula/unit/OrUnit.ts";
import { XorUnit } from "../src/formula/unit/XorUnit.ts";
import { TernaryUnit } from "../src/formula/unit/TernaryUnit.ts";
import { RememberedUnit } from "../src/formula/unit/RememberedUnit.ts";
import { ObjectAccessExpressionUnit } from "../src/formula/unit/ObjectAccessExpressionUnit.ts";
import { ArrayAccessUnit } from "../src/formula/unit/ArrayAccessUnit.ts";
import { ArrayUnit } from "../src/formula/unit/ArrayUnit.ts";
import { RootUnit } from "../src/formula/unit/RootUnit.ts";
import { VoidUnit } from "../src/formula/unit/VoidUnit.ts";
import { ExecutableBlockUnit } from "../src/formula/unit/ExecutableBlockUnit.ts";

// =============================================================================
// Leaf nodes
// =============================================================================

Deno.test("Builder.convert - VALUE node produces ValueUnit with correct value", () => {
    const node = new Node(NODE_TYPE.VALUE, 42);
    const unit = Builder.convert(node);
    assertEquals(unit instanceof ValueUnit, true);
    assertEquals(unit.value, 42);
    assertEquals(unit.children.length, 0);
});

Deno.test("Builder.convert - STRING node produces StringUnit", () => {
    const node = new Node(NODE_TYPE.STRING, "hello");
    const unit = Builder.convert(node);
    assertEquals(unit instanceof StringUnit, true);
    assertEquals(unit.value, "hello");
});

Deno.test("Builder.convert - NULL node produces NullUnit", () => {
    const node = new Node(NODE_TYPE.NULL);
    const unit = Builder.convert(node);
    assertEquals(unit instanceof NullUnit, true);
});

Deno.test("Builder.convert - IDENTIFIER node produces IdentifierUnit", () => {
    const node = new Node(NODE_TYPE.IDENTIFIER, "stage");
    const unit = Builder.convert(node);
    assertEquals(unit instanceof IdentifierUnit, true);
    assertEquals(unit.value, "stage");
});

Deno.test("Builder.convert - IDENTIFIER with alias child", () => {
    const alias = new Node(NODE_TYPE.VALUE, 5);
    const node = new Node(NODE_TYPE.IDENTIFIER, "x");
    node.addChild(alias);

    const unit = Builder.convert(node);
    assertEquals(unit instanceof IdentifierUnit, true);
    assertEquals(unit.children.length, 1);
    assertEquals(unit.children[0] instanceof ValueUnit, true);
    assertEquals(unit.children[0].parent, unit);
});

// =============================================================================
// Binary operators
// =============================================================================

const binaryTests: Array<{
    type: NODE_TYPE;
    unitClass: new (...args: any[]) => any;
    name: string;
}> = [
    { type: NODE_TYPE.ADDITION, unitClass: AdditionUnit, name: "AdditionUnit" },
    { type: NODE_TYPE.SUBTRACTION, unitClass: SubtractionUnit, name: "SubtractionUnit" },
    { type: NODE_TYPE.MULTIPLICATION, unitClass: MultiplicationUnit, name: "MultiplicationUnit" },
    { type: NODE_TYPE.DIVISION, unitClass: DivisionUnit, name: "DivisionUnit" },
    { type: NODE_TYPE.MODULO, unitClass: ModuloUnit, name: "ModuloUnit" },
    { type: NODE_TYPE.EXPONENT, unitClass: ExponentUnit, name: "ExponentUnit" },
    { type: NODE_TYPE.EQUAL, unitClass: EqualUnit, name: "EqualUnit" },
    { type: NODE_TYPE.NOT_EQUAL, unitClass: NotEqualUnit, name: "NotEqualUnit" },
    { type: NODE_TYPE.GREATER_THAN, unitClass: GreaterThanUnit, name: "GreaterThanUnit" },
    { type: NODE_TYPE.GREATER_THAN_OR_EQUAL, unitClass: GreaterThanOrEqualUnit, name: "GreaterThanOrEqualUnit" },
    { type: NODE_TYPE.LESS_THAN, unitClass: LessThanUnit, name: "LessThanUnit" },
    { type: NODE_TYPE.LESS_THAN_OR_EQUAL, unitClass: LessThanOrEqualUnit, name: "LessThanOrEqualUnit" },
    { type: NODE_TYPE.AND, unitClass: AndUnit, name: "AndUnit" },
    { type: NODE_TYPE.OR, unitClass: OrUnit, name: "OrUnit" },
    { type: NODE_TYPE.XOR, unitClass: XorUnit, name: "XorUnit" },
    { type: NODE_TYPE.OBJECT_ACCESS_EXPRESSION, unitClass: ObjectAccessExpressionUnit, name: "ObjectAccessExpressionUnit" },
    { type: NODE_TYPE.ARRAY_ACCESS, unitClass: ArrayAccessUnit, name: "ArrayAccessUnit" },
];

for (const { type, unitClass, name } of binaryTests) {
    Deno.test(`Builder.convert - ${type} produces ${name} with 2 children`, () => {
        const left = new Node(NODE_TYPE.VALUE, 1);
        const right = new Node(NODE_TYPE.VALUE, 2);
        const node = new Node(type);
        node.addChild(left, right);

        const unit = Builder.convert(node);
        assertEquals(unit instanceof unitClass, true);
        assertEquals(unit.children.length, 2);
        assertEquals(unit.children[0] instanceof ValueUnit, true);
        assertEquals(unit.children[1] instanceof ValueUnit, true);
    });

    Deno.test(`Builder.convert - ${type} sets parent references`, () => {
        const left = new Node(NODE_TYPE.VALUE, 1);
        const right = new Node(NODE_TYPE.VALUE, 2);
        const node = new Node(type);
        node.addChild(left, right);

        const unit = Builder.convert(node);
        assertEquals(unit.children[0].parent, unit);
        assertEquals(unit.children[1].parent, unit);
    });
}

// =============================================================================
// Binary operator error cases - wrong child count
// =============================================================================

const binaryErrorTypes = [
    NODE_TYPE.ADDITION,
    NODE_TYPE.SUBTRACTION,
    NODE_TYPE.MULTIPLICATION,
    NODE_TYPE.DIVISION,
    NODE_TYPE.MODULO,
    NODE_TYPE.EXPONENT,
    NODE_TYPE.EQUAL,
    NODE_TYPE.NOT_EQUAL,
    NODE_TYPE.GREATER_THAN,
    NODE_TYPE.GREATER_THAN_OR_EQUAL,
    NODE_TYPE.LESS_THAN,
    NODE_TYPE.LESS_THAN_OR_EQUAL,
    NODE_TYPE.AND,
    NODE_TYPE.OR,
    NODE_TYPE.XOR,
    NODE_TYPE.OBJECT_ACCESS_EXPRESSION,
    NODE_TYPE.ARRAY_ACCESS,
];

for (const type of binaryErrorTypes) {
    Deno.test(`Builder.convert - ${type} throws on 1 child`, () => {
        const node = new Node(type);
        node.addChild(new Node(NODE_TYPE.VALUE, 1));
        assertThrows(() => Builder.convert(node), Error, "Unexpected number of children");
    });

    Deno.test(`Builder.convert - ${type} throws on 3 children`, () => {
        const node = new Node(type);
        node.addChild(
            new Node(NODE_TYPE.VALUE, 1),
            new Node(NODE_TYPE.VALUE, 2),
            new Node(NODE_TYPE.VALUE, 3),
        );
        assertThrows(() => Builder.convert(node), Error, "Unexpected number of children");
    });
}

// =============================================================================
// Unary: NOT
// =============================================================================

Deno.test("Builder.convert - NOT produces NotUnit", () => {
    const child = new Node(NODE_TYPE.VALUE, 1);
    const node = new Node(NODE_TYPE.NOT);
    node.addChild(child);

    const unit = Builder.convert(node);
    assertEquals(unit instanceof NotUnit, true);
    assertEquals(unit.children.length, 1);
});

// =============================================================================
// READ_GLOBAL
// =============================================================================

Deno.test("Builder.convert - READ_GLOBAL with 1 child", () => {
    const child = new Node(NODE_TYPE.IDENTIFIER, "stage");
    const node = new Node(NODE_TYPE.READ_GLOBAL);
    node.addChild(child);

    const unit = Builder.convert(node);
    assertEquals(unit instanceof ReadGlobalUnit, true);
    assertEquals(unit.children.length, 1);
    assertEquals(unit.children[0].parent, unit);
});

Deno.test("Builder.convert - READ_GLOBAL throws on 0 children", () => {
    const node = new Node(NODE_TYPE.READ_GLOBAL);
    assertThrows(() => Builder.convert(node), Error, "Unexpected number of children");
});

Deno.test("Builder.convert - READ_GLOBAL throws on 2 children", () => {
    const node = new Node(NODE_TYPE.READ_GLOBAL);
    node.addChild(new Node(NODE_TYPE.IDENTIFIER, "a"), new Node(NODE_TYPE.IDENTIFIER, "b"));
    assertThrows(() => Builder.convert(node), Error, "Unexpected number of children");
});

// =============================================================================
// TERNARY
// =============================================================================

Deno.test("Builder.convert - TERNARY produces TernaryUnit with 3 children", () => {
    const cond = new Node(NODE_TYPE.VALUE, 1);
    const then = new Node(NODE_TYPE.VALUE, 2);
    const els = new Node(NODE_TYPE.VALUE, 3);
    const node = new Node(NODE_TYPE.TERNARY);
    node.addChild(cond, then, els);

    const unit = Builder.convert(node);
    assertEquals(unit instanceof TernaryUnit, true);
    assertEquals(unit.children.length, 3);
    assertEquals(unit.children[0].parent, unit);
    assertEquals(unit.children[1].parent, unit);
    assertEquals(unit.children[2].parent, unit);
});

Deno.test("Builder.convert - TERNARY throws on 2 children", () => {
    const node = new Node(NODE_TYPE.TERNARY);
    node.addChild(new Node(NODE_TYPE.VALUE, 1), new Node(NODE_TYPE.VALUE, 2));
    assertThrows(() => Builder.convert(node), Error, "Unexpected number of children");
});

// =============================================================================
// REMEMBERED
// =============================================================================

Deno.test("Builder.convert - REMEMBERED produces RememberedUnit", () => {
    const inner = new Node(NODE_TYPE.VALUE, 5);
    const node = new Node(NODE_TYPE.REMEMBERED);
    node.addChild(inner);

    const unit = Builder.convert(node);
    assertEquals(unit instanceof RememberedUnit, true);
    assertEquals(unit.children.length, 1);
    assertEquals(unit.children[0].parent, unit);
});

Deno.test("Builder.convert - REMEMBERED throws on 0 children", () => {
    const node = new Node(NODE_TYPE.REMEMBERED);
    assertThrows(() => Builder.convert(node), Error, "Unexpected number of children");
});

// =============================================================================
// Container nodes: ROOT, ARRAY, EXECUTABLE_BLOCK
// =============================================================================

Deno.test("Builder.convert - ROOT wraps child", () => {
    const child = new Node(NODE_TYPE.VALUE, 1);
    const node = new Node(NODE_TYPE.ROOT);
    node.addChild(child);

    const unit = Builder.convert(node);
    assertEquals(unit instanceof RootUnit, true);
    assertEquals(unit.children.length, 1);
    assertEquals(unit.children[0].parent, unit);
});

Deno.test("Builder.convert - ARRAY with multiple children", () => {
    const node = new Node(NODE_TYPE.ARRAY);
    node.addChild(
        new Node(NODE_TYPE.VALUE, 1),
        new Node(NODE_TYPE.VALUE, 2),
        new Node(NODE_TYPE.VALUE, 3),
    );

    const unit = Builder.convert(node);
    assertEquals(unit instanceof ArrayUnit, true);
    assertEquals(unit.children.length, 3);
    for (const child of unit.children) {
        assertEquals(child.parent, unit);
    }
});

Deno.test("Builder.convert - EXECUTABLE_BLOCK with children", () => {
    const node = new Node(NODE_TYPE.EXECUTABLE_BLOCK);
    node.addChild(new Node(NODE_TYPE.VALUE, 1), new Node(NODE_TYPE.VALUE, 2));

    const unit = Builder.convert(node);
    assertEquals(unit instanceof ExecutableBlockUnit, true);
    assertEquals(unit.children.length, 2);
});

// =============================================================================
// VOID
// =============================================================================

Deno.test("Builder.convert - VOID wraps child", () => {
    const child = new Node(NODE_TYPE.VALUE, 1);
    const node = new Node(NODE_TYPE.VOID);
    node.addChild(child);

    const unit = Builder.convert(node);
    assertEquals(unit instanceof VoidUnit, true);
    assertEquals(unit.children.length, 1);
    assertEquals(unit.children[0].parent, unit);
});

// =============================================================================
// IDENTIFIER error case
// =============================================================================

Deno.test("Builder.convert - IDENTIFIER throws on 2+ children", () => {
    const node = new Node(NODE_TYPE.IDENTIFIER, "x");
    node.addChild(new Node(NODE_TYPE.VALUE, 1), new Node(NODE_TYPE.VALUE, 2));
    assertThrows(() => Builder.convert(node), Error, "Unexpected number of children");
});

// =============================================================================
// Invalid node type
// =============================================================================

Deno.test("Builder.convert - throws on unknown node type", () => {
    const node = new Node("INVALID_TYPE" as NODE_TYPE);
    assertThrows(() => Builder.convert(node), Error, "Invalid node type");
});

// =============================================================================
// Builder.build() and output()
// =============================================================================

Deno.test("Builder.build() populates result and log", () => {
    const root = new Node(NODE_TYPE.ROOT);
    root.addChild(new Node(NODE_TYPE.VALUE, 42));

    const builder = new Builder(root);
    builder.build();

    assertEquals(builder.result instanceof RootUnit, true);
    assertEquals(builder.log.length > 0, true);
    assertEquals(builder.log[0], "RootUnit");
    assertEquals(builder.log[1], "  ValueUnit");
});

Deno.test("Builder.output() returns result after build", () => {
    const root = new Node(NODE_TYPE.ROOT);
    root.addChild(new Node(NODE_TYPE.VALUE, 1));

    const builder = new Builder(root);
    builder.build();
    const result = builder.output();
    assertEquals(result instanceof RootUnit, true);
});

Deno.test("Builder.output() throws before build", () => {
    const root = new Node(NODE_TYPE.ROOT);
    root.addChild(new Node(NODE_TYPE.VALUE, 1));

    const builder = new Builder(root);
    assertThrows(() => builder.output(), Error, "No result");
});

// =============================================================================
// Recursive conversion - nested expression tree
// =============================================================================

Deno.test("Builder.convert - nested expression: (1 + 2) * 3", () => {
    // Build: MULTIPLICATION(ADDITION(VALUE(1), VALUE(2)), VALUE(3))
    const add = new Node(NODE_TYPE.ADDITION);
    add.addChild(new Node(NODE_TYPE.VALUE, 1), new Node(NODE_TYPE.VALUE, 2));

    const mul = new Node(NODE_TYPE.MULTIPLICATION);
    mul.addChild(add, new Node(NODE_TYPE.VALUE, 3));

    const unit = Builder.convert(mul);
    assertEquals(unit instanceof MultiplicationUnit, true);
    assertEquals(unit.children[0] instanceof AdditionUnit, true);
    assertEquals(unit.children[1] instanceof ValueUnit, true);

    const addUnit = unit.children[0];
    assertEquals(addUnit.children[0] instanceof ValueUnit, true);
    assertEquals((addUnit.children[0] as ValueUnit).value, 1);
    assertEquals(addUnit.children[1] instanceof ValueUnit, true);
    assertEquals((addUnit.children[1] as ValueUnit).value, 2);
});
