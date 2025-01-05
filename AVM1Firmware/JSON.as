/**
 * Provides static methods for converting ActionScript objects to and from the 
 * JavaScript Object Notation (JSON) format.
 */
class JSON {

    /**
     * Private constructor to prevent instantiation of this static utility class.
     */
    private function JSON() {}

    /**
     * Converts an ActionScript object into a JSON-formatted string.
     * This implementation sorts object keys to ensure a consistent output,
     * which is useful for comparisons and debugging.
     *
     * @param   obj The ActionScript object to serialize (e.g., Object, Array, String, Number).
     * @return  A string containing the JSON representation of the supplied object.
     */
    public static function stringify(obj:Object):String {
        if (obj === null) {
            return "null";
        }
        
        var type:String = typeof(obj);
        
        if (type == "string") {
            // -- CORRECTION: Replaced regex literals with split().join() for AS2 compatibility. --
            var s:String = obj.split("\\").join("\\\\"); // Escape backslashes
            s = s.split('"').join('\\"');   // Escape double quotes
            s = s.split('\n').join('\\n');   // Escape newlines
            s = s.split('\r').join('\\r');   // Escape carriage returns
            s = s.split('\t').join('\\t');   // Escape tabs
            return '"' + s + '"';
        }
        
        if (type == "number" || type == "boolean") {
            return String(obj);
        }
        
        if (type == "object") {
            if (obj instanceof Array) {
                // Handle Arrays: recursively stringify each element.
                var a:Array = new Array();
                for (var i:Number = 0; i < obj.length; i++) {
                    a.push(JSON.stringify(obj[i]));
                }
                return '[' + a.join(',') + ']';
            } else {
                // Handle Objects: get all keys, sort them, and recursively stringify key-value pairs.
                var props:Array = new Array();
                var keys:Array = new Array();
                for (var k:String in obj) {
                    // Filter out functions and undefined values.
                    if (typeof(obj[k]) != "function" && typeof(obj[k]) != "undefined") {
                        keys.push(k);
                    }
                }
                keys.sort(); 
                
                for (var i:Number = 0; i < keys.length; i++) {
                    var key:String = keys[i];
                    props.push(JSON.stringify(key) + ':' + JSON.stringify(obj[key]));
                }
                return '{' + props.join(',') + '}';
            }
        }
        
        // Return null for any other unsupported types.
        return "null";
    }

    /**
     * Parses a JSON-formatted string and returns a corresponding ActionScript object.
     *
     * @param   text    The JSON string to parse.
     * @return  An ActionScript object (Object, Array, etc.) represented by the string.
     * @throws  An error if the string is not valid JSON.
     */
    public static function parse(text:String):Object {
        var at:Number = 0;
        var ch:String = ' ';

        // --- Helper Functions for Parsing ---

        // Throws a syntax error.
        var error:Function = function (m:String):Void {
            throw new Error("JSON Parse Error: " + m + " at character " + at);
        };

        // Gets the next character from the text.
        var next:Function = function ():String {
            ch = text.charAt(at);
            at += 1;
            return ch;
        };
        
        // Skips whitespace.
        var white:Function = function ():Void {
            while (ch && ch <= ' ') {
                next();
            }
        };

        // Parses a string value.
        var string:Function = function ():String {
            var s:String = '';
            if (ch == '"') {
                while (next()) {
                    if (ch == '"') {
                        next();
                        return s;
                    }
                    if (ch == '\\') {
                        switch (next()) {
                            case '"':  s += '"'; break;
                            case '\\': s += '\\'; break;
                            case '/':  s += '/'; break;
                            case 'b':  s += '\b'; break;
                            case 'f':  s += '\f'; break;
                            case 'n':  s += '\n'; break;
                            case 'r':  s += '\r'; break;
                            case 't':  s += '\t'; break;
                            default:   error("Bad escape sequence");
                        }
                    } else {
                        s += ch;
                    }
                }
            }
            error("Bad string");
        };
        
        // Parses a number value.
        var number:Function = function ():Number {
            var n:String = '';
            if (ch == '-') {
                n = '-';
                next();
            }
            while (ch >= '0' && ch <= '9') {
                n += ch;
                next();
            }
            if (ch == '.') {
                n += '.';
                while (next() && ch >= '0' && ch <= '9') {
                    n += ch;
                }
            }
            var v:Number = Number(n);
            if (!isFinite(v)) {
                error("Bad number");
            } else {
                return v;
            }
        };

        // Parses a literal (true, false, or null).
        var word:Function = function ():Object {
            switch (ch) {
                case 't':
                    if (next() == 'r' && next() == 'u' && next() == 'e') {
                        next();
                        return true;
                    }
                    break;
                case 'f':
                    if (next() == 'a' && next() == 'l' && next() == 's' && next() == 'e') {
                        next();
                        return false;
                    }
                    break;
                case 'n':
                    if (next() == 'u' && next() == 'l' && next() == 'l') {
                        next();
return null;
                    }
                    break;
            }
            error("Unexpected literal '" + ch + "'");
        };

        var value; // Forward declaration

        // Parses an array value.
        var array:Function = function ():Array {
            var a:Array = [];
            if (ch == '[') {
                next();
                white();
                if (ch == ']') {
                    next();
                    return a;
                }
                while (ch) {
                    a.push(value());
                    white();
                    if (ch == ']') {
                        next();
                        return a;
                    }
                    if (ch != ',') {
                        error("Expected ',' or ']' in array");
                    }
                    next();
                    white();
                }
            }
            error("Bad array");
        };

        // Parses an object value.
        var object:Function = function ():Object {
            var k:String;
            var o:Object = {};
            if (ch == '{') {
                next();
                white();
                if (ch == '}') {
                    next();
                    return o;
                }
                while (ch) {
                    k = string();
                    white();
                    if (ch != ':') {
                        error("Expected ':' in object");
                    }
                    next();
                    o[k] = value();
                    white();
                    if (ch == '}') {
                        next();
                        return o;
                    }
                    if (ch != ',') {
                        error("Expected ',' or '}' in object");
                    }
                    next();
                    white();
                }
            }
            error("Bad object");
        };

        // The main value parsing function; decides which specific parser to use.
        value = function ():Object {
            white();
            switch (ch) {
                case '{': return object();
                case '[': return array();
                case '"': return string();
                case '-': return number();
                default:
                    return (ch >= '0' && ch <= '9') ? number() : word();
            }
        };

        // --- Start the Parsing Process ---
        return value();
    }
}