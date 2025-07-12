enum TokenType {
    KEYWORD = 'KEYWORD',
    IDENTIFIER = 'IDENTIFIER',
    NUMBER = 'NUMBER',
    STRING = 'STRING',
    ASSIGN = 'ASSIGN',
    PLUS = 'PLUS',
    MINUS = 'MINUS',
    ASTERISK = 'ASTERISK',
    SLASH = 'SLASH',
    LPAREN = 'LPAREN',
    RPAREN = 'RPAREN',
    LBRACE = 'LBRACE',
    RBRACE = 'RBRACE',
    LEFT_BRACKET = 'LEFT_BRACKET',
    RIGHT_BRACKET = 'RIGHT_BRACKET',
    COMMA = 'COMMA',
    DOT = 'DOT',
    SEMICOLON = 'SEMICOLON',
    EQUAL = 'EQUAL',
    NOT_EQUAL = 'NOT_EQUAL',
    LESS_THAN = 'LESS_THAN',
    LESS_THAN_OR_EQUAL = 'LESS_THAN_OR_EQUAL',
    GREATER_THAN = 'GREATER_THAN',
    GREATER_THAN_OR_EQUAL = 'GREATER_THAN_OR_EQUAL',
    EOF = 'EOF',
}

// Define the type for the various lexer states
type LexerState =
    | 'DEFAULT'
    | 'STRING'
    | 'NUMBER'
    | 'SINGLE_LINE_COMMENT'
    | 'MULTILINE_COMMENT';

// Define the structure of a token
class Token {
    type: TokenType;
    value: string | null;
    row: number;
    column: number;
    constructor(
        type: TokenType,
        value: string | null = null,
        row: number = 0,
        column: number = 0,
    ) {
        this.type = type;
        this.value = value;
        this.row = row;
        this.column = column;
    }
}

class Lexer {
    private input: string;
    private orginalInput: string;
    private position: number;
    private row: number;
    private column: number;
    private tokens: Array<Token>;
    private state: LexerState;
    private stringDelimiter: string | null;
    private commentDepth: number; // To track the nesting level of multi-line comments

    private optionPositionData: boolean;

    public log: Array<string> = [];
    public output: Array<Token>;

    constructor(
        input: string,
        options: { positionData: boolean } = { positionData: true },
    ) {
        this.input = input;
        this.orginalInput = input;
        this.position = 0; // Current position in the input

        this.tokens = [];
        this.state = 'DEFAULT'; // FSM will switch between states
        this.stringDelimiter = null; // Tracks whether we are in a " or ' string
        this.commentDepth = 0; // Track recursive multi-line comments

        this.optionPositionData = options.positionData;
        if (this.optionPositionData) {
            this.row = 1; // Current row (line number)
            this.column = 1; // Current column (position in the line)
        } else {
            this.row = 0;
            this.column = 0;
        }
        this.output = this.tokenize();
        this.log.push(
            ...this.output.map((token) =>
                `${token.type}${token.value ? `(${token.value})` : ''}`
            ),
        );
    }

    // Start the lexing process
    tokenize(): Array<Token> {
        try {
            while (this.position < this.input.length) {
                const char = this.input[this.position];

                // Treat this garbage as if it doesn't exist
                if (char === '\r') {
                    ++this.position;
                    continue;
                }

                switch (this.state) {
                    case 'DEFAULT':
                        this.handleDefaultState(char);
                        break;
                    case 'STRING':
                        this.handleStringState();
                        break;
                    case 'NUMBER':
                        this.handleNumberState(char);
                        break;
                    case 'SINGLE_LINE_COMMENT':
                        this.handleSingleLineCommentState();
                        break;
                    case 'MULTILINE_COMMENT':
                        this.handleMultiLineCommentState();
                        break;
                    default:
                        throw new Error(`Unknown lexer state: ${this.state}`);
                }
            }

            // After processing all input, check for unfinished multi-line comments or strings
            if (this.state === 'MULTILINE_COMMENT' && this.commentDepth > 0) {
                throw new Error(
                    `Unclosed multi-line comment at row ${this.row}, column ${this.column}`,
                );
            }
            if (this.state === 'STRING') {
                throw new Error(
                    `Unclosed string at row ${this.row}, column ${this.column}`,
                );
            }

            return this.tokens;
        } catch (err) {
            if (err instanceof LexerError) {
                throw new Error(
                    `file.munos:${err.row}:${err.column}: SyntaxError: ${err.message}\n${
                        this.orginalInput.split('\n')[err.row - 1]
                    }\n${' '.repeat(err.column - 1) + '^'}`,
                );
            } else {
                throw err;
            }
        }
    }

    // Handle the default state, switching to other states if necessary
    private handleDefaultState(char: string): void {
        if (this.isWhitespace(char) || this.isNewline(char)) {
            // Advance the position when encountering whitespace to avoid an infinite loop
            this.advancePosition();
        } else if (this.isLetter(char)) {
            this.handleIdentifierOrKeyword();
        } else if (this.isDigit(char) || char === '0') {
            this.state = 'NUMBER';
            this.handleNumberState(char); // Switch to NUMBER state
        } else if (char === '"' || char === "'") {
            this.state = 'STRING';
            this.stringDelimiter = char; // Store whether it's " or '
        } else if (char === '/' && this.peekChar() === '/') {
            this.state = 'SINGLE_LINE_COMMENT';
        } else if (char === '/' && this.peekChar() === '*') {
            this.state = 'MULTILINE_COMMENT';
            this.commentDepth = 1; // Initialize the comment nesting level
            this.advancePosition(); // Move past the initial /*
        } else {
            this.handleSymbol(char); // Handle operators and punctuation
        }
    }

    // Handle identifiers and keywords
    private handleIdentifierOrKeyword(): void {
        let value = '';
        const tokenRow = this.row; // Capture the current row for the token
        const tokenColumn = this.column; // Capture the current column for the token

        while (this.isLetterOrDigit(this.input[this.position])) {
            value += this.input[this.position];
            this.advancePosition();
        }

        const type = this.isKeyword(value)
            ? TokenType.KEYWORD
            : TokenType.IDENTIFIER;
        this.tokens.push(new Token(type, value, tokenRow, tokenColumn));
    }

    // Handle numbers (decimal, hex, binary)
    private handleNumberState(char: string): void {
        let value = '';
        const tokenRow = this.row; // Capture the current row for the token
        const tokenColumn = this.column; // Capture the current column for the token

        const base =
            char === '0' && (this.peekChar() === 'x' || this.peekChar() === 'b')
                ? (this.peekChar() === 'x' ? 16 : 2)
                : 10;

        if (base !== 10) {
            value += this.input[this.position]; // 0
            this.advancePosition();
            value += this.input[this.position]; // x or b
            this.advancePosition();
        }

        while (
            this.position < this.input.length &&
            this.isDigit(this.input[this.position], base)
        ) {
            value += this.input[this.position];
            this.advancePosition();
        }

        this.tokens.push(
            new Token(TokenType.NUMBER, value, tokenRow, tokenColumn),
        );
        this.state = 'DEFAULT'; // Go back to default state
    }

    // Handle string literals, raise an error if the string isn't closed
    private handleStringState(): void {
        let str = '';
        const tokenRow = this.row; // Capture the current row for the token
        const tokenColumn = this.column; // Capture the current column for the token

        this.advancePosition(); // Skip the opening quote

        while (
            this.position < this.input.length &&
            this.input[this.position] !== this.stringDelimiter
        ) {
            if (this.input[this.position] === '\\') {
                this.advancePosition(); // Handle escape sequences by skipping the backslash

                if (this.position < this.input.length) {
                    // Handle escaped character (e.g., \' or \")
                    const escapedChar = this.input[this.position];
                    if (escapedChar === 'n') {
                        str += '\n';
                    } else if (escapedChar === 't') {
                        str += '\t';
                    } else if (escapedChar === 'r') {
                        str += '\r';
                    } else if (escapedChar === '\\') {
                        str += '\\';
                    } else if (escapedChar === this.stringDelimiter) {
                        str += this.stringDelimiter;
                    } else {
                        str += escapedChar; // Default for any other escaped char
                    }

                    this.advancePosition();
                }
            } else {
                str += this.input[this.position];
                this.advancePosition();
            }
        }

        if (this.input[this.position] !== this.stringDelimiter) {
            throw new Error(
                `Unclosed string at row ${this.row}, column ${this.column}`,
            );
        }

        // Move past the closing quote
        this.advancePosition();

        this.tokens.push(
            new Token(TokenType.STRING, str, tokenRow, tokenColumn),
        );
        this.state = 'DEFAULT'; // Return to default state
    }

    // Handle single-line comments
    private handleSingleLineCommentState(): void {
        while (
            this.input[this.position] !== '\n' &&
            this.input[this.position] !== null
        ) {
            this.advancePosition();
        }
        this.state = 'DEFAULT'; // Return to default state after comment
    }

    // Handle multi-line comments, including recursive nested comments
    private handleMultiLineCommentState(): void {
        // Skip the opening /* characters (we already confirmed these)
        this.advancePosition(); // Move past both the '/' and '*'
        this.advancePosition();

        while (this.position < this.input.length) {
            const char = this.input[this.position];

            if (char === '/' && this.peekChar() === '*') {
                this.commentDepth++; // Nested multi-line comment found
                this.advancePosition();
            } else if (char === '*' && this.peekChar() === '/') {
                this.commentDepth--; // Closing a multi-line comment
                this.advancePosition(); // Move past the '*'
                if (this.commentDepth === 0) {
                    this.advancePosition(); // Move past the '/' to fully exit the comment
                    this.state = 'DEFAULT'; // Exit comment if depth is 0
                    break;
                }
            }

            this.advancePosition();
        }

        if (this.position >= this.input.length && this.commentDepth > 0) {
            throw new Error(
                `Unclosed multi-line comment at row ${this.row}, column ${this.column}`,
            );
        }
    }

    // Handle symbols (operators, punctuation)
    private handleSymbol(char: string): void {
        const tokenRow = this.row; // Capture the current row for the token
        const tokenColumn = this.column; // Capture the current column for the token

        switch (char) {
            case '=':
                if (this.peekChar() === '=') {
                    this.tokens.push(
                        new Token(TokenType.EQUAL, null, tokenRow, tokenColumn),
                    );
                    this.advancePosition();
                } else {
                    this.tokens.push(
                        new Token(
                            TokenType.ASSIGN,
                            null,
                            tokenRow,
                            tokenColumn,
                        ),
                    );
                }
                break;
            case '!=':
                this.tokens.push(
                    new Token(TokenType.NOT_EQUAL, null, tokenRow, tokenColumn),
                );
                break;
            case '<':
                this.tokens.push(
                    new Token(TokenType.LESS_THAN, null, tokenRow, tokenColumn),
                );
                break;
            case '<=':
                this.tokens.push(
                    new Token(
                        TokenType.LESS_THAN_OR_EQUAL,
                        null,
                        tokenRow,
                        tokenColumn,
                    ),
                );
                break;
            case '>':
                this.tokens.push(
                    new Token(
                        TokenType.GREATER_THAN,
                        null,
                        tokenRow,
                        tokenColumn,
                    ),
                );
                break;
            case '>=':
                this.tokens.push(
                    new Token(
                        TokenType.GREATER_THAN_OR_EQUAL,
                        null,
                        tokenRow,
                        tokenColumn,
                    ),
                );
                break;
            case '+':
                this.tokens.push(
                    new Token(TokenType.PLUS, null, tokenRow, tokenColumn),
                );
                break;
            case '-':
                this.tokens.push(
                    new Token(TokenType.MINUS, null, tokenRow, tokenColumn),
                );
                break;
            case '*':
                this.tokens.push(
                    new Token(TokenType.ASTERISK, null, tokenRow, tokenColumn),
                );
                break;
            case '/':
                this.tokens.push(
                    new Token(TokenType.SLASH, null, tokenRow, tokenColumn),
                );
                break;
            case '(':
                this.tokens.push(
                    new Token(TokenType.LPAREN, null, tokenRow, tokenColumn),
                );
                break;
            case ')':
                this.tokens.push(
                    new Token(TokenType.RPAREN, null, tokenRow, tokenColumn),
                );
                break;
            case '{':
                this.tokens.push(
                    new Token(TokenType.LBRACE, null, tokenRow, tokenColumn),
                );
                break;
            case '}':
                this.tokens.push(
                    new Token(TokenType.RBRACE, null, tokenRow, tokenColumn),
                );
                break;
            case ',':
                this.tokens.push(
                    new Token(TokenType.COMMA, null, tokenRow, tokenColumn),
                );
                break;
            case '.':
                this.tokens.push(
                    new Token(TokenType.DOT, null, tokenRow, tokenColumn),
                );
                break;
            case ';':
                this.tokens.push(
                    new Token(TokenType.SEMICOLON, null, tokenRow, tokenColumn),
                );
                break;
            case '[':
                this.tokens.push(
                    new Token(
                        TokenType.LEFT_BRACKET,
                        null,
                        tokenRow,
                        tokenColumn,
                    ),
                );
                break;
            case ']':
                this.tokens.push(
                    new Token(
                        TokenType.RIGHT_BRACKET,
                        null,
                        tokenRow,
                        tokenColumn,
                    ),
                );
                break;
            default:
                throw new LexerError(
                    `Unrecognized symbol: "${char}"`,
                    tokenRow,
                    tokenColumn,
                );
        }

        this.advancePosition();
    }

    // Peek at the next character
    private peekChar(): string | null {
        return this.position + 1 < this.input.length
            ? this.input[this.position + 1]
            : null;
    }

    // Advance the position and update row/column tracking
    private advancePosition(): void {
        if (this.optionPositionData) {
            if (this.input[this.position] === '\n') {
                this.row++;
                this.column = 1; // New line, reset column to 1
            } else {
                this.column++;
            }
        }
        this.position++;
    }

    // Check if the character is a letter
    private isLetter(char: string): boolean {
        if (!!char) {
            return /[a-zA-Z_]/.test(char);
        } else {
            return false;
        }
    }

    // Check if the character is a digit (optional base: 10 for decimal, 16 for hex, 2 for binary)
    private isDigit(char: string, base: number = 10): boolean {
        if (base === 16) return /[0-9a-fA-F]/.test(char);
        if (base === 2) return /[01]/.test(char);
        return /[0-9]/.test(char);
    }

    // Check if the character is a letter or digit
    private isLetterOrDigit(char: string): boolean {
        return this.isLetter(char) || this.isDigit(char);
    }

    // Check if the character is whitespace
    private isWhitespace(char: string): boolean {
        return [' ', '\t'].includes(char);
    }

    // Check if the value is a keyword
    private isKeyword(value: string): boolean {
        const keywords = ['if', 'else', 'function', 'return', 'var', 'import'];
        return keywords.includes(value);
    }

    private isNewline(char: string): boolean {
        return char === '\n';
    }
}

class LexerError extends Error {
    row: number;
    column: number;
    constructor(message: string, row: number, column: number) {
        super(message);
        this.name = 'LexerError';
        this.row = row;
        this.column = column;
    }
}

function createTokenConstructors(enumType: typeof TokenType) {
    const constructors: Record<string, (tokenValue?: string | null) => Token> =
        {};
    for (const [key, value] of Object.entries(enumType)) {
        constructors[key] = (arg: string | null = null) =>
            new Token(value as TokenType, arg);
    }
    return constructors;
}

const T = createTokenConstructors(TokenType);

// Export the Lexer class as the default export
export { Lexer, T, Token, TokenType };
