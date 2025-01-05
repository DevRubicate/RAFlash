import flash.system.Security;

class Bridge {
    private var lc:LocalConnection;
    private var gameLoader:MovieClip; // Declare gameLoader at the class level

    public function Bridge() {}

    public static function main():Void {
        try {
            // Set up LocalConnection to communicate with AS3
            _root.receiver = new LocalConnection();
            _root.receiver.setup = function(path:String):Void {
                _root.gameLoader = _root.createEmptyMovieClip('gameLoader', _root.getNextHighestDepth());
                _root.gameLoader._lockroot = true;
                _root.gameLoader.loadMovie('http://localhost:8080/' + path);
                _root.sender = new LocalConnection();
                _root.sender.send('_AS2ToAS3', 'setup');
            };
            _root.receiver.read = function(id:String, path:String):Void {
                var vars:Array = [];
                for (var prop in _root.gameLoader._root) {
                    vars.push(prop + ' = ' + _root.gameLoader._root[prop]);
                }
                _root.sender.send('_AS2ToAS3', 'message', id, vars.join('\n'));
            };
            _root.receiver.list = function(id:String, path:Array, limit:Number, offset:Number):Void {
                try {
                    var answer = Bridge.resolve(
                        [_root.gameLoader._root],
                        null,
                        path
                    );

                    if(answer.length == 0) {
                        _root.sender.send('_AS2ToAS3', 'message', id, Bridge.stringify({value: [], total: 0, error: 'No result'}));
                    } else {
                        _root.sender.send('_AS2ToAS3', 'message', id, Bridge.stringify({value: Bridge.formatOutput(answer), total: answer.length, error: null}));
                    }
                } catch(e) {
                    _root.sender.send('_AS2ToAS3', 'message', id, Bridge.stringify({value: [], total: 0, error: e.message}));
                }
            };
            _root.receiver.connect('_AS3ToAS2');
        } catch(e) {
            trace(e);
        }
    }
    public static function createLabelString(labelString:String) {
        labelString = labelString.split('\r\n').join('\n').split('\r').join('\n');

        var newlineIndex = labelString.indexOf('\n');

        if(newlineIndex != -1) {
            labelString = labelString.substring(0, newlineIndex);
        }

        if(labelString.length > 32) {
            labelString = labelString.substring(0, 32);
        }

        return labelString;
    }
    public static function resolve(rootObject:Array, thisObject:Array, path:Array) {
        var stack = [];

        var finalValue;
        if(path.length > 0) {
            var i = -1;
            while(++i < path.length) {
                switch(path[i]) {
                    case 'keyword': {
                        ++i;
                        switch(path[i]) {
                            case 'ROOT':
                                stack.push(rootObject);
                                break;
                            case 'THIS':
                                stack.push(thisObject != null ? thisObject : []);
                                break;
                            case 'CONTEXT':
                                stack.push(thisObject != null ? thisObject : rootObject);
                                break;
                            case 'KEYS':
                                stack.push('KEYS');
                                break;
                            default:
                                trace('Invalid KEYWORD '+path[i]);
                        }
                        break;
                    }
                    case 'operand': {
                        ++i;
                        stack.push([path[i]]);
                        break;
                    }
                    case '+': {
                        var b = stack.pop();
                        var a = stack.pop();
                        if(a.length == 1 && b.length == 1) {
                            var aType = typeof(a[0]);
                            var bType = typeof(b[0]);
                            var aValid = aType == 'string' || (aType == 'number' && !isNaN(a[0]));
                            var bValid = bType == 'string' || (bType == 'number' && !isNaN(b[0]));
                            if(aValid && bValid) {
                                stack.push([a[0] + b[0]]);
                            } else {
                                stack.push([NaN]);
                            }
                        } else {
                            stack.push([NaN]);
                        }
                        break;
                    }
                    case '-': {
                        var b = stack.pop();
                        var a = stack.pop();
                        if(a.length == 1 && b.length == 1) {
                            var aType = typeof(a[0]);
                            var bType = typeof(b[0]);
                            var aValid = aType == 'number' && !isNaN(a[0]);
                            var bValid = bType == 'number' && !isNaN(b[0]);
                            if(aValid && bValid) {
                                stack.push([a[0] - b[0]]);
                            } else {
                                stack.push([NaN]);
                            }
                        } else {
                            stack.push([NaN]);
                        }
                        break;
                    }
                    case '.': {
                        if(stack.length != 2) {
                            trace('invalid stack for . access');
                        }

                        var output = [];

                        var b = stack.pop();
                        var a = stack.pop();

                        if(b === 'KEYS') {
                            for(var j=0; j<a.length; ++j) {
                                for(var propertyName:String in a[j]) {
                                    output.push(propertyName);
                                }
                            }
                        } else {
                            for(var j=0; j<a.length; ++j) {
                                var arr = Bridge.objectGet(a[j], b);
                                for(var l=0; l<arr.length; ++l) {
                                    output.push(arr[l]);
                                }
                            }
                        }





                        stack.push(output);
                        break;
                    }
                    case ',': {
                        var output = [];
                        var b = stack.pop();
                        var a = stack.pop();
                        for(var j=0; j<a.length; ++j) {
                            output.push(a[j]);
                        }
                        for(var j=0; j<b.length; ++j) {
                            output.push(b[j]);
                        }
                        stack.push(output);
                        break;
                    }
                    case '[': {
                        var output = [];
                        var a = stack.pop();
                        for(var j=0; j<a.length; ++j) {
                            var answer = Bridge.resolve(rootObject, [a[j]], path.slice(0, i));
                            if(answer) {
                                output.push(a);
                            }
                        }
                        stack.push(output);
                        break;
                    }
                    case ']': {
                        // We advance i to the path's length so that the loop ends
                        i = path.length;
                        break;
                    }
                    default:
                        trace('COMMAND NOT IMPLEMENTED ' + path[i]);
                }
            }

            finalValue = stack.length > 0 ? stack.pop() : null;
        } else {
            finalValue = [];
            var context = thisObject != null ? thisObject : rootObject;
            for(var j=0; j<context.length; ++j) {
                for(var propertyName:String in context[j]) {
                    finalValue.push(propertyName);
                }
            }
        }

        return finalValue;
    }
    static function objectGet(object, matchers:Array) {
        var output = [];
        for(var i=0; i<matchers.length; ++i) {
            var matcher = matchers[i];
            if(matcher.indexOf('?') == -1 && matcher.indexOf('$') == -1 && matcher.indexOf('@') == -1) {
                if(object[matcher] != undefined) {
                    output.push(object[matcher]);
                }
            } else {
                for(var propertyName:String in object) {
                    if(Bridge.matchWithWildcards(matcher, propertyName)) {
                        output.push(object[propertyName]);
                    }
                }
            }
        }
        return output;
    }
    static function formatOutput(input) {
        var result = [];

        for(var i=0; i<input.length; ++i) {
            var value = input[i];
            if(typeof(value) == 'movieclip') {
                var count:Number = 0;
                for (var key:String in value) {
                    count++;
                }
                result.push('MovieClip {...'+count+'}');
            } else if(value instanceof TextField) {
                result.push('TextField "'+Bridge.createLabelString(value.text)+'"');
            } else if(typeof(value) == 'number') {
                result.push(value);
            } else if(typeof(value) == 'string') {
                result.push(value);
            } else if(value instanceof Date) {
                result.push(value);
            } else if(value instanceof Array) {
                result.push('[...'+value.length+']');
            } else if(value == null) {
                result.push('null');
            } else if(value == undefined) {
                result.push('undefined');
            } else if(value == NaN) {
                result.push('NaN');
            } else if(typeof(value) == 'object') {
                var count:Number = 0;
                for (var key:String in value) {
                    count++;
                }
                result.push('{...'+count+'}');
            } else if(typeof(value) == 'boolean') {
                result.push(value);
            } else if(typeof(value) == 'function') {
                result.push('Function');
            } else {
                result.push('Unknown '+value+')');
            }
        }

        return result;
    }
    static function isObjectLike(input) {
        if(typeof(input) == 'object') {
            return true;
        } else if(typeof(input) == 'movieclip') {
            return true;
        } else {
            return false;
        }
    }
    static function stringify(arg):String {

        var c, i, l, s = '', v;

        switch (typeof arg) {
        case 'object':
            if (arg) {
                if (arg instanceof Array) {
                    for (i = 0; i < arg.length; ++i) {
                        v = stringify(arg[i]);
                        if (s) {
                            s += ',';
                        }
                        s += v;
                    }
                    return '[' + s + ']';
                } else if (typeof arg.toString != 'undefined') {
                    for (i in arg) {
                        v = arg[i];
                        if (typeof v != 'undefined' && typeof v != 'function') {
                            v = stringify(v);
                            if (s) {
                                s += ',';
                            }
                            s += stringify(i) + ':' + v;
                        }
                    }
                    return '{' + s + '}';
                }
            }
            return 'null';
        case 'number':
            return isFinite(arg) ? String(arg) : 'null';
        case 'string':
            l = arg.length;
            s = '"';
            for (i = 0; i < l; i += 1) {
                c = arg.charAt(i);
                if (c >= ' ') {
                    if (c == '\\' || c == '"') {
                        s += '\\';
                    }
                    s += c;
                } else {
                    switch (c) {
                        case '\b':
                            s += '\\b';
                            break;
                        case '\f':
                            s += '\\f';
                            break;
                        case '\n':
                            s += '\\n';
                            break;
                        case '\r':
                            s += '\\r';
                            break;
                        case '\t':
                            s += '\\t';
                            break;
                        default:
                            c = c.charCodeAt();
                            s += '\\u00' + Math.floor(c / 16).toString(16) +
                                (c % 16).toString(16);
                    }
                }
            }
            return s + '"';
        case 'boolean':
            return String(arg);
        default:
            return 'null';
        }
    }
    static function parse(text:String):Object {
        var at = 0;
        var ch = ' ';
        var _value:Function;

        var _error:Function = function (m) {
            throw {
                name: 'JSONError',
                message: m,
                at: at - 1,
                text: text
            };
        }

        var _next:Function = function() {
            ch = text.charAt(at);
            at += 1;
            return ch;
        }

        var _white:Function = function() {
            while (ch) {
                if (ch <= ' ') {
                    _next();
                } else if (ch == '/') {
                    switch (_next()) {
                        case '/':
                            while (_next() && ch != '\n' && ch != '\r') {}
                            break;
                        case '*':
                            _next();
                            for (;;) {
                                if (ch) {
                                    if (ch == '*') {
                                        if (_next() == '/') {
                                            _next();
                                            break;
                                        }
                                    } else {
                                        _next();
                                    }
                                } else {
                                    _error("Unterminated comment");
                                }
                            }
                            break;
                        default:
                            _error("Syntax error");
                    }
                } else {
                    break;
                }
            }
        }

        var _string:Function = function() {
            var i, s = '', t, u;
            var outer:Boolean = false;

            if (ch == '"') {
                while (_next()) {
                    if (ch == '"') {
                        _next();
                        return s;
                    } else if (ch == '\\') {
                        switch (_next()) {
                        case 'b':
                            s += '\b';
                            break;
                        case 'f':
                            s += '\f';
                            break;
                        case 'n':
                            s += '\n';
                            break;
                        case 'r':
                            s += '\r';
                            break;
                        case 't':
                            s += '\t';
                            break;
                        case 'u':
                            u = 0;
                            for (i = 0; i < 4; i += 1) {
                                t = parseInt(_next(), 16);
                                if (!isFinite(t)) {
                                    outer = true;
                                    break;
                                }
                                u = u * 16 + t;
                            }
                            if(outer) {
                                outer = false;
                                break;
                            }
                            s += String.fromCharCode(u);
                            break;
                        default:
                            s += ch;
                        }
                    } else {
                        s += ch;
                    }
                }
            }
            _error("Bad string");
        }

        var _array:Function = function() {
            var a = [];

            if (ch == '[') {
                _next();
                _white();
                if (ch == ']') {
                    _next();
                    return a;
                }
                while (ch) {
                    a.push(_value());
                    _white();
                    if (ch == ']') {
                        _next();
                        return a;
                    } else if (ch != ',') {
                        break;
                    }
                    _next();
                    _white();
                }
            }
            _error("Bad array");
        }

        var _object:Function = function() {
            var k, o = {};

            if (ch == '{') {
                _next();
                _white();
                if (ch == '}') {
                    _next();
                    return o;
                }
                while (ch) {
                    k = _string();
                    _white();
                    if (ch != ':') {
                        break;
                    }
                    _next();
                    o[k] = _value();
                    _white();
                    if (ch == '}') {
                        _next();
                        return o;
                    } else if (ch != ',') {
                        break;
                    }
                    _next();
                    _white();
                }
            }
            _error("Bad object");
        }

        var _number:Function = function() {
            var n = '', v;

            if (ch == '-') {
                n = '-';
                _next();
            }
            while (ch >= '0' && ch <= '9') {
                n += ch;
                _next();
            }
            if (ch == '.') {
                n += '.';
                while (_next() && ch >= '0' && ch <= '9') {
                    n += ch;
                }
            }
            //v = +n;
            v = 1 * n;
            if (!isFinite(v)) {
                _error("Bad number");
            } else {
                return v;
            }
        }

        var _word:Function = function() {
            switch (ch) {
                case 't':
                    if (_next() == 'r' && _next() == 'u' && _next() == 'e') {
                        _next();
                        return true;
                    }
                    break;
                case 'f':
                    if (_next() == 'a' && _next() == 'l' && _next() == 's' &&
                            _next() == 'e') {
                        _next();
                        return false;
                    }
                    break;
                case 'n':
                    if (_next() == 'u' && _next() == 'l' && _next() == 'l') {
                        _next();
                        return null;
                    }
                    break;
            }
            _error("Syntax error");
        }

        _value = function() {
            _white();
            switch (ch) {
                case '{':
                    return _object();
                case '[':
                    return _array();
                case '"':
                    return _string();
                case '-':
                    return _number();
                default:
                    return ch >= '0' && ch <= '9' ? _number() : _word();
            }
        }

        return _value();
    }

    // Static function to start the matching process
    public static function matchWithWildcards(stringA:String, stringB:String):Boolean {
        return Bridge.matches(stringA, stringB, 0, 0);
    }

    // Recursive matching function
    public static function matches(stringA:String, stringB:String, aIndex:Number, bIndex:Number):Boolean {
        if (aIndex == stringA.length) {
            // If both strings are exhausted, it's a match
            return bIndex == stringB.length;
        }

        if (bIndex == stringB.length) {
            // If stringB is exhausted, check if remaining stringA can match an empty string
            var tempAIndex:Number = aIndex;
            while (tempAIndex < stringA.length) {
                var currentChar:String = stringA.charAt(tempAIndex);
                var nextChar:String = (tempAIndex + 1 < stringA.length) ? stringA.charAt(tempAIndex + 1) : "";

                if (currentChar == "*" && (nextChar == "?" || nextChar == "$" || nextChar == "@")) {
                    // Advance past the zero-match wildcard
                    tempAIndex += 2;
                } else {
                    // Remaining characters can't match an empty string
                    return false;
                }
            }
            // All remaining characters are zero-match wildcards
            return true;
        }

        var currentChar:String = stringA.charAt(aIndex);
        var nextChar:String = (aIndex + 1 < stringA.length) ? stringA.charAt(aIndex + 1) : "";

        if (currentChar == "?") {
            // '?' matches any one character
            return Bridge.matches(stringA, stringB, aIndex + 1, bIndex + 1);
        }

        if (currentChar == "$") {
            // '$' matches any one digit
            if (Bridge.isDigit(stringB.charAt(bIndex))) {
                return Bridge.matches(stringA, stringB, aIndex + 1, bIndex + 1);
            } else {
                return false;
            }
        }

        if (currentChar == "@") {
            // '@' matches any one letter
            if (Bridge.isLetter(stringB.charAt(bIndex))) {
                return Bridge.matches(stringA, stringB, aIndex + 1, bIndex + 1);
            } else {
                return false;
            }
        }

        if (currentChar == "*") {
            if (nextChar == "?") {
                // '*?' matches zero or more of any character
                for (var i:Number = bIndex; i <= stringB.length; i++) {
                    if (Bridge.matches(stringA, stringB, aIndex + 2, i)) return true;
                }
                return false;
            } else if (nextChar == "$") {
                // '*$' matches zero or more of any digit
                if (Bridge.matches(stringA, stringB, aIndex + 2, bIndex)) return true;
                var i:Number = bIndex;
                while (i < stringB.length && Bridge.isDigit(stringB.charAt(i))) {
                    i++;
                    if (Bridge.matches(stringA, stringB, aIndex + 2, i)) return true;
                }
                return false;
            } else if (nextChar == "@") {
                // '*@' matches zero or more of any letter
                if (Bridge.matches(stringA, stringB, aIndex + 2, bIndex)) return true;
                var i:Number = bIndex;
                while (i < stringB.length && Bridge.isLetter(stringB.charAt(i))) {
                    i++;
                    if (Bridge.matches(stringA, stringB, aIndex + 2, i)) return true;
                }
                return false;
            }
        }

        // For other cases, do direct character comparison
        if (currentChar == stringB.charAt(bIndex)) {
            return Bridge.matches(stringA, stringB, aIndex + 1, bIndex + 1);
        } else {
            return false;
        }
    }

    // Helper function to check if a character is a digit
    public static function isDigit(char:String):Boolean {
        if (char.length == 0) return false;
        var code:Number = char.charCodeAt(0);
        return code >= 48 && code <= 57; // '0' to '9'
    }

    // Helper function to check if a character is a letter
    public static function isLetter(char:String):Boolean {
        if (char.length == 0) return false;
        var code:Number = char.charCodeAt(0);
        return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); // 'A'-'Z' or 'a'-'z'
    }


    // Helper functions for assertions
     public static function assert(condition:Boolean, message:String):Void {
        if (condition) {
            trace("PASS: " + message);
        } else {
            trace("FAIL: " + message);
        }
    }

     public static function assertEquals(actual:Object, expected:Object, message:String):Void {
        if (actual === expected) {
            trace("PASS: " + message);
        } else {
            trace("FAIL: " + message + " | Expected: " + expected + ", Actual: " + actual);
        }
    }

    public static function runTests() {

        // Running the tests
        trace("Running Tests...");

        // Base Case Handling Tests
        trace("\nBase Case Handling Tests:");
        Bridge.assert(Bridge.matchWithWildcards("", ""), "Both strings empty");
        Bridge.assert(Bridge.matchWithWildcards("*?", ""), "Wildcard *? matches empty string");
        Bridge.assert(Bridge.matchWithWildcards("*$", ""), "Wildcard *$ matches empty string");
        Bridge.assert(Bridge.matchWithWildcards("*@", ""), "Wildcard *@ matches empty string");
        Bridge.assertEquals(Bridge.matchWithWildcards("", "abc"), false, "Empty stringA and non-empty stringB");
        Bridge.assertEquals(Bridge.matchWithWildcards("abc", ""), false, "Non-empty stringA and empty stringB");

        // Exhausted stringB Handling Tests
        trace("\nExhausted stringB Handling Tests:");
        Bridge.assert(Bridge.matchWithWildcards("abc*@def", "abcdef"), "Greedy *@ with zero letters");
        Bridge.assertEquals(Bridge.matchWithWildcards("abc*@def", "abc123def"), false, "Greedy *@ cannot match digits");
        Bridge.assert(Bridge.matchWithWildcards("abc*@def", "abcXYZdef"), "Greedy *@ with letters");
        Bridge.assertEquals(Bridge.matchWithWildcards("abc*@def", "abc"), false, "Greedy *@ with missing 'def'");

        Bridge.assert(Bridge.matchWithWildcards("abc*$def", "abcdef"), "Greedy *$ with zero digits");
        Bridge.assert(Bridge.matchWithWildcards("abc*$def", "abc123def"), "Greedy *$ with matching digits");
        Bridge.assertEquals(Bridge.matchWithWildcards("abc*$def", "abcXYZdef"), false, "Greedy *$ cannot match letters");
        Bridge.assertEquals(Bridge.matchWithWildcards("abc*$def", "abc"), false, "Greedy *$ with missing 'def'");

        Bridge.assert(Bridge.matchWithWildcards("abc*?def", "abcdef"), "Greedy *? with zero characters");
        Bridge.assert(Bridge.matchWithWildcards("abc*?def", "abcXYZdef"), "Greedy *? with matching characters");
        Bridge.assertEquals(Bridge.matchWithWildcards("abc*?def", "abc"), false, "Greedy *? with missing 'def'");

        // Out-of-Bounds stringB Handling Tests
        trace("\nOut-of-Bounds stringB Handling Tests:");
        Bridge.assert(Bridge.matchWithWildcards("abc*$", "abc"), "Out-of-bounds stringB with *$");
        Bridge.assert(Bridge.matchWithWildcards("abc*?", "abc"), "Out-of-bounds stringB with *?");
        Bridge.assert(Bridge.matchWithWildcards("abc*@def", "abcdef"), "Out-of-bounds stringB with *@ and match");
        Bridge.assertEquals(Bridge.matchWithWildcards("abc*@def", "abc"), false, "Out-of-bounds stringB with missing 'def'");

        // Zero-Match Wildcard Tests
        trace("\nZero-Match Wildcard Tests:");
        Bridge.assert(Bridge.matchWithWildcards("abc*?def", "abcdef"), "*? zero match");
        Bridge.assert(Bridge.matchWithWildcards("abc*?def", "abcXYZdef"), "*? multiple match");
        Bridge.assertEquals(Bridge.matchWithWildcards("abc*?def", "abc"), false, "*? zero match with missing 'def'");

        Bridge.assert(Bridge.matchWithWildcards("abc*$def", "abcdef"), "*$ zero match");
        Bridge.assert(Bridge.matchWithWildcards("abc*$def", "abc123def"), "*$ multiple match");
        Bridge.assertEquals(Bridge.matchWithWildcards("abc*$def", "abc"), false, "*$ zero match with missing 'def'");

        Bridge.assert(Bridge.matchWithWildcards("abc*@def", "abcdef"), "*@ zero match");
        Bridge.assert(Bridge.matchWithWildcards("abc*@def", "abcXYZdef"), "*@ multiple match");
        Bridge.assertEquals(Bridge.matchWithWildcards("abc*@def", "abc"), false, "*@ zero match with missing 'def'");

        // Complex Wildcard Scenarios
        trace("\nComplex Wildcard Scenarios:");
        Bridge.assert(Bridge.matchWithWildcards("*?*@*$", "abc123"), "Complex combination of *?*@*$");
        Bridge.assert(Bridge.matchWithWildcards("*?*@*$", "a1b2c3"), "Complex combination of *?*@*$ with interleaving");
        Bridge.assert(Bridge.matchWithWildcards("*?*@*$", ""), "Complex combination of *?*@*$ with empty string");

        Bridge.assertEquals(Bridge.matchWithWildcards("a*$?*@?$", "abc123"), false, "Complex interleaved symbols should fail");

        Bridge.assert(Bridge.matchWithWildcards("*@*$*?", "123abcXYZ"), "Complex overlapping greedy and specific match");
        Bridge.assert(Bridge.matchWithWildcards("*@*$*?", "123abcXYZ456"), "Complex overlapping greedy and specific with additional characters");
        Bridge.assert(Bridge.matchWithWildcards("*@*$*?", "XYZ"), "Complex overlapping greedy and specific with missing sections");


    }



}
