enum NODE_TYPE {

    // Expression Operator
    ADDITION = 'ADDITION',
    SUBTRACTION = 'SUBTRACTION',
    DIVISION = 'DIVISION',
    MULTIPLICATION = 'MULTIPLICATION',
    MODULO = 'MODULO',
    LEFT_PARENTHESIS = 'LEFT_PARENTHESIS',
    RIGHT_PARENTHESIS = 'RIGHT_PARENTHESIS',
    EXPONENT = 'EXPONENT',

    ARRAY = 'ARRAY',
    ARRAY_ACCESS = 'ARRAY_ACCESS',
    OBJECT_ACCESS = 'OBJECT_ACCESS',
    EXECUTABLE_BLOCK = 'EXECUTABLE_BLOCK',
    IDENTIFIER = 'IDENTIFIER',
    ROOT = 'ROOT',
    VALUE = 'VALUE',
    STRING = 'STRING',
    NULL = 'NULL',
    VOID = 'VOID',

    // Variables
    READ_GLOBAL = 'READ_GLOBAL',

    // Comparison Operators
    EQUAL = 'EQUAL',
    NOT_EQUAL = 'NOT_EQUAL',
    GREATER_THAN = 'GREATER_THAN',
    GREATER_THAN_OR_EQUAL = 'GREATER_THAN_OR_EQUAL',
    LESS_THAN = 'LESS_THAN',
    LESS_THAN_OR_EQUAL = 'LESS_THAN_OR_EQUAL',

    // Logical Operators
    AND = 'AND',
    OR = 'OR',
    XOR = 'XOR',
    NOT = 'NOT',

    // Meta
    LIST = 'LIST',
    OBJECT_ACCESS_EXPRESSION = 'OBJECT_ACCESS_EXPRESSION',

    // Conditional
    TERNARY = 'TERNARY',

    // Remembered value
    REMEMBERED = 'REMEMBERED',
}

export { NODE_TYPE };
