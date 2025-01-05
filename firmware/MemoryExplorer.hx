import haxe.extern.EitherType;

import DraggableWindow;

import flash.text.TextField;
import flash.text.TextFormat;
import flash.text.TextFieldAutoSize;
import flash.text.TextFieldType;

import flash.display.Sprite;
import flash.display.SimpleButton;
import flash.events.MouseEvent;
import flash.events.Event;
import Win95Box;
import ListTable;

class MemoryExplorer {
    private var list:Sprite;
    private var listTable:ListTable;
    private var cancelNetwork:Void->Void = null;
    private var pathTextField:TextField;
    private var oldData:{value:Dynamic, label:String, type:String, child: Array<{value:Dynamic, label:String, type:String}>} = null;

    public function new() {
        flash.Lib.current.addEventListener(Event.ENTER_FRAME, onEnterFrame);

        // Define the button states (up, over, down, hitTest)
        var body:Sprite = new Sprite();


        pathTextField = new TextField();
        pathTextField.defaultTextFormat = new TextFormat('_sans', 16, 0x000000); // Font size: 16, Color: black
        pathTextField.autoSize = TextFieldAutoSize.NONE;
        pathTextField.border = true;
        pathTextField.borderColor = 0xFF000000;
        pathTextField.background = true;
        pathTextField.backgroundColor = 0xFFFFFFFF;
        pathTextField.x = 45;
        pathTextField.y = 35;
        pathTextField.width = 300;
        pathTextField.height = 25;
        pathTextField.type = TextFieldType.INPUT;
        pathTextField.text = '.KrinLang.ENGLISH.';
        body.addChild(pathTextField);


        // Create a new SimpleButton
        var backButton:SimpleButton = new SimpleButton();

        // Define the button states (up, over, down, hitTest)
        var upState:Sprite = new Win95Box(25, 25);

        // Add a title text to the header
        var titleText:TextField = new TextField();
        titleText.defaultTextFormat = new TextFormat("_sans", 16, 0xFF000000);
        titleText.autoSize = TextFieldAutoSize.LEFT;
        titleText.text = '<';
        titleText.selectable = false;
        titleText.x = 6;
        titleText.y = 2;
        upState.addChild(titleText);



        var overState:Sprite = new Sprite();
        overState.graphics.beginFill(0xFFFF00); // Yellow for over state
        overState.graphics.drawRect(0, 0, 25, 25);
        overState.graphics.endFill();

        var downState:Sprite = new Sprite();
        downState.graphics.beginFill(0xFF0000); // Red for down state
        downState.graphics.drawRect(0, 0, 25, 25);
        downState.graphics.endFill();

        backButton.upState = upState;
        backButton.overState = overState;
        backButton.downState = downState;
        backButton.hitTestState = upState;

        backButton.y = 35;
        backButton.x = 12;

        // Add event listener for interaction
        backButton.addEventListener(MouseEvent.CLICK, function(event:Event) {
            var i = pathTextField.text.length - 2;
            while(
                i > 0 &&
                pathTextField.text.charAt(i) != '.' &&
                pathTextField.text.charAt(i) != ']' &&
                pathTextField.text.charAt(i) != '['
            ) {
                --i;
            }
            pathTextField.text = pathTextField.text.substring(0, i);
        });


        body.addChild(backButton);









        listTable = new ListTable(340, 450);
        listTable.x = 5;
        listTable.y = 70;

        body.addChild(listTable);

        // Define the button states (up, over, down, hitTest)
        list = new Sprite();
        body.addChild(list);


        var popup:DraggableWindow = new DraggableWindow(body, 350, 500, 'Memory Explorer');
        popup.x = 900; // Initial x position
        popup.y = 100; // Initial y position
        flash.Lib.current.addChild(popup);

        refresh();
    }
    public static function isWhitespace(input) {
        return ' \t\n'.indexOf(input) != -1;
    }
    public static function isDigit(input) {
        return '1234567890'.indexOf(input) != -1;
    }
    public static function isLetter(input) {
        return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz?$@*_'.indexOf(input) != -1;
    }
    public static function isSymbol(input) {
        return '+-&|!=.,<>()[]'.indexOf(input) != -1;
    }

    public static var KEYWORDS = ['ROOT', 'THIS', 'CONTEXT', 'KEYS'];
    public static function lexer(input:String):Array<EitherType<String, Float>> {



        var tokens:Array<{category:String, type:String, value:EitherType<String, Float>, ?associativity:String, ?precedence:Int}> = [];
        var current = '';
        var meta = [];
        var position = 0;
        var state = 'NEUTRAL';
        var substate = null;
        var delimiter = null;
        while(position < input.length + 1) {
            var char:String = position < input.length ? input.charAt(position) : ' ';
            if(state == 'NEUTRAL') {
                if(isWhitespace(char)) {
                    // We ignore this whitespace as if it didn't exist
                    ++position;
                } else if(isLetter(char) || isDigit(char)) {
                    // This token is a string or number, so let's jump into that state
                    state = 'STRING_OR_NUMBER';
                    // We assume that the token is a number until proven otherwise
                    substate = 'NUMBER';
                    // If this is a string it does not have a delimiter
                    delimiter = null;
                } else if(char == '"' || char == "'") {
                    // This token is a string, so let's jump into that state
                    state = 'STRING';
                    // Record what type of string delimiter we are using
                    delimiter = char;
                    // Advance past the string delimiter
                    ++position;
                } else if(isSymbol(char)) {
                    state = 'SYMBOL';
                } else if(char == null) {
                    break;
                } else {
                    trace('lexer: Unable to process '+char);
                    break;
                }
            } else if(state == 'STRING_OR_NUMBER') {
                if(isDigit(char)) {
                    // Add this digit to the current
                    current += char;
                    // Advance past the digit
                    ++position;
                } else if(isLetter(char)) {
                    // Oh this was a string after all, not a number. Switch over to string parsing
                    // instead without advancing past this char.
                    state = 'STRING';
                    delimiter = null;
                } else {
                    // We encountered something that was neither a letter or digit, that means
                    // that this number token is complete.
                    tokens.push({category: 'operand', type: 'NUMBER', value: Std.parseFloat(current)});
                    current = '';
                    state = 'NEUTRAL';
                }
            } else if(state == 'STRING') {
                if(char == delimiter) {
                    // We encountered the string delimiter, that means that this token is over.
                    tokens.push({category: 'operand', type: 'STRING', value: current});
                    current = '';
                    state = 'NEUTRAL';
                    // Advance past the string delimiter
                    ++position;
                } else if(char == '\\') {
                    // We encountered a potential escape character
                    if(position + 1 < input.length) {
                        current += input.charAt(position+1);
                        // Advance past the escaped character
                        ++position;
                    } else {
                        // Ouch there were no more characters, the escape character is void
                    }
                    // Advance past the slash
                    ++position;
                } else if(delimiter != null || isLetter(char) || isDigit(char)) {
                    // If there is is delimiter, or the char we are looking at is a normal letter
                    // then we append the char to our string.
                    current += char;

                    // Advance past the char
                    ++position;
                } else {
                    // The only way we got here is if there was no delimiter and we came across a
                    // non-letter char, so that means the string has ended.

                    // However, we have some special cases where in non-delimiter strings can be
                    // special keywords such as root and this, so we check for that here.
                    if(KEYWORDS.contains(current)) {
                        tokens.push({category: 'operand', type: 'KEYWORD', value: current});
                        current = '';
                        state = 'NEUTRAL';
                    } else {
                        tokens.push({category: 'operand', type: 'STRING', value: current});
                        current = '';
                        state = 'NEUTRAL';
                    }
                }
            } else if(state == 'SYMBOL') {
                if(isSymbol(char)) {
                    current += char;
                    // Advance past the char
                    ++position;
                } else {
                    // We encountered a non-symbol character, that means that our symbol is now
                    // complete and should be made into a token.
                    var symbolLength;
                    if(current.substring(0, 1) == '+') {
                        tokens.push({category: 'operator', type: 'PLUS', value: '+', precedence: 1, associativity: 'LEFT'});
                        symbolLength = 1;
                    } else if(current.substring(0, 1) == '-') {
                        tokens.push({category: 'operator', type: 'MINUS', value: '-', precedence: 1, associativity: 'LEFT'});
                        symbolLength = 1;
                    } else if(current.substring(0, 2) == '&&') {
                        tokens.push({category: 'operator', type: 'LOGICAL_AND', value: '&&', precedence: -1, associativity: 'LEFT'});
                        symbolLength = 2;
                    } else if(current.substring(0, 1) == '&') {
                        tokens.push({category: 'operator', type: 'BITWISE_AND', value: '&', precedence: -3, associativity: 'LEFT'});
                        symbolLength = 1;
                    } else if(current.substring(0, 2) == '||') {
                        tokens.push({category: 'operator', type: 'LOGICAL_OR', value: '||', precedence: -1, associativity: 'LEFT'});
                        symbolLength = 2;
                    } else if(current.substring(0, 1) == '|') {
                        tokens.push({category: 'operator', type: 'BITWISE_OR', value: '|', precedence: -3, associativity: 'LEFT'});
                        symbolLength = 1;
                    } else if(current.substring(0, 2) == '!=') {
                        tokens.push({category: 'operator', type: 'NOT_EQUAL', value: '!=', precedence: 0, associativity: 'LEFT'});
                        symbolLength = 2;
                    } else if(current.substring(0, 1) == '!') {
                        tokens.push({category: 'operator', type: 'NOT', value: '!', precedence: 5, associativity: 'RIGHT'});
                        symbolLength = 1;
                    } else if(current.substring(0, 2) == '==') {
                        tokens.push({category: 'operator', type: 'EQUAL', value: '==', precedence: 0, associativity: 'LEFT'});
                        symbolLength = 2;
                    } else if(current.substring(0, 2) == '<=') {
                        tokens.push({category: 'operator', type: 'GREATER_EQUAL', value: '<=', precedence: 0, associativity: 'LEFT'});
                        symbolLength = 2;
                    } else if(current.substring(0, 1) == '<') {
                        tokens.push({category: 'operator', type: 'GREATER', value: '<', precedence: 0, associativity: 'LEFT'});
                        symbolLength = 1;
                    } else if(current.substring(0, 2) == '>=') {
                        tokens.push({category: 'operator', type: 'LESSER_EQUAL', value: '>=', precedence: 0, associativity: 'LEFT'});
                        symbolLength = 2;
                    } else if(current.substring(0, 1) == '>') {
                        tokens.push({category: 'operator', type: 'LESSER', value: '>', precedence: 0, associativity: 'LEFT'});
                        symbolLength = 1;
                    } else if(current.substring(0, 1) == '.') {
                        tokens.push({category: 'operator', type: 'DOT', value: '.', precedence: 5, associativity: 'LEFT'});
                        symbolLength = 1;
                    } else if(current.substring(0, 1) == ',') {
                        tokens.push({category: 'operator', type: 'COMMA', value: ',', precedence: -10, associativity: 'LEFT'});
                        symbolLength = 1;
                    } else if(current.substring(0, 1) == '(') {
                        tokens.push({category: 'parenthesis', type: 'LEFT_PARENTHESIS', value: '('});
                        symbolLength = 1;
                    } else if(current.substring(0, 1) == ')') {
                        tokens.push({category: 'parenthesis', type: 'RIGHT_PARENTHESIS', value: ')'});
                        symbolLength = 1;
                    } else if(current.substring(0, 1) == '[') {
                        tokens.push({category: 'bracket', type: 'LEFT_BRACKET', value: '['});
                        symbolLength = 1;
                    } else if(current.substring(0, 1) == ']') {
                        tokens.push({category: 'bracket', type: 'RIGHT_BRACKET', value: ']'});
                        symbolLength = 1;
                    } else {
                        trace('Invalid symbol ' + current);
                        break;
                    }

                    // Reverse back for each character we ended up not using for the symbol
                    position -= current.length - symbolLength;
                    current = '';
                    state = 'NEUTRAL';
                }
            } else {
                throw 'invalid state';
            }
        }

        final RPN = [];
        final stack = [];

        var i = -1;
        while(++i < tokens.length) {
            final token = tokens[i];

            if(token.category == 'operand') {
                RPN.push(token);
            } else if(token.category == 'parenthesis') {
                if(token.type == 'LEFT_PARENTHESIS') {
                    stack.push(token);
                } else if(token.type == 'RIGHT_PARENTHESIS') {
                    while(
                        stack.length > 0 &&
                        stack[stack.length - 1].type != 'LEFT_PARENTHESIS'
                    ) {
                        RPN.push(stack.pop());
                    }
                    stack.pop();
                }
            } else if(token.category == 'bracket') {
                if(token.type == 'LEFT_BRACKET') {
                    while(
                        stack.length > 0 &&
                        (
                            stack[stack.length - 1].category == 'operator'
                        )
                    ) {
                        RPN.push(stack.pop());
                    }

                    stack.push(token);
                    RPN.push(token);
                } else if(token.type == 'RIGHT_BRACKET') {
                    while(
                        stack.length > 0 &&
                        stack[stack.length - 1].type != 'LEFT_BRACKET'
                    ) {
                        RPN.push(stack.pop());
                    }
                    stack.pop();
                    RPN.push(token);
                }
            } else if(token.category == 'operator') {
                while(
                    stack.length > 0 &&
                    (
                        stack[stack.length - 1].category == 'operator' &&
                        (
                            token.associativity == 'LEFT' &&
                            token.precedence <= stack[stack.length - 1].precedence
                        ) ||
                        (
                            token.associativity == 'RIGHT' &&
                            token.precedence < stack[stack.length - 1].precedence
                        )
                    )
                ) {
                    RPN.push(stack.pop());
                }
                switch(token.type) {
                    case 'DOT':
                        final before = tokens[i-1];
                        final after = tokens[i+1];
                        if(before == null || (before.category != 'operand' && before.category != 'parenthesis')) {
                            RPN.push({category: 'operand', type: 'KEYWORD', value: 'CONTEXT'});
                        }
                        if(after == null || (after.category != 'operand' && after.category != 'parenthesis')) {
                            RPN.push({category: 'operand', type: 'KEYWORD', value: 'KEYS'});
                        }
                    default:
                }
                stack.push(token);
            } else {
                throw 'invalid type';
            }
        }
        while(stack.length > 0) {
            RPN.push(stack.pop());
        }



        final output = [];

        var i = -1;
        while(++i < RPN.length) {
            final token = RPN[i];
            if(token.category == 'operand') {
                if(token.type == 'KEYWORD') {
                    output.push('keyword');
                    output.push(token.value);
                } else {
                    output.push('operand');
                    output.push(token.value);
                }
            } else if(token.category == 'operator') {
                output.push(token.value);
            } else if(token.category == 'bracket') {
                output.push(token.value);
            } else {
                throw 'invalid token '+token.category;
            }
        }
        return output;
    }

    public function refresh() {
        if(cancelNetwork == null) {

            var path;
            try {
                path = MemoryExplorer.lexer(pathTextField.text);
            } catch(err) {
                throw err;
            }


            final offset = listTable.getVisibleOffset();

            cancelNetwork = Network.list(path, 19, offset, function(message) {
                if(message.error != null) {
                    listTable.setData([message.error]);
                } else {
                    listTable.setData(message.value);
                }
                cancelNetwork = null;
            });
        }
    }
    public function onEnterFrame(event:Event) {
        refresh();
    }
}
