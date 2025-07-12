import flash.system.Security;
import JSON;
import JSONDiff;
import AppData;

class Main {
    private static var receiver:LocalConnection;
    private static var sender:LocalConnection;

    public function Main() {}

    public static function main():Void {
        try {
            // Set up LocalConnection to communicate with AS3
            Main.receiver = new LocalConnection();
            Main.receiver.setup = function(path:String, data:Object):Void {
                // Note that trace does not work here in the setup callback because
                // the two-way connection is not yet established
                AppData.data = data.appData;
                _root.gameContainer = _root.createEmptyMovieClip('gameContainer', _root.getNextHighestDepth());
                _root.gameContainer.gameLoader = _root.gameContainer.createEmptyMovieClip('gameLoader', 1);
                _root.gameContainer.gameLoader._lockroot = true;
                _root.gameContainer.gameLoader.loadMovie('http://localhost:8080/' + path);
                _root.gameContainer.onEnterFrame = Main.onFrame;
                Main.sender = new LocalConnection();
                Main.sender.send('_AS2ToAS3', 'setup');
            };
            Main.receiver.evaluate = function(id:String, formula:Array):Void {
                var result = Main.evaluate(formula, 1, formula.length, [_root.gameContainer.gameLoader._root], ['stage']);
                var formatted = Main.formatOutput(result, 0);
                Main.sender.send(
                    '_AS2ToAS3',
                    'message',
                    id,
                    JSON.stringify(formatted)
                );
            };
            Main.receiver.editData = function(id:String, changes:Object):Void {
                JSONDiff.applyDiff(AppData.data, changes);
            };
            Main.receiver.connect('_AS3ToAS2');
        } catch(e) {
            Main.trace(e);
        }
    }
    static function trace(message:String):Void {
        Main.sender.send('_AS2ToAS3', 'trace', message);
    }
    static function editData(data:Object) {
        Main.sender.send('_AS2ToAS3', 'editData', JSON.stringify(data));
    }
    static function onFrame():Void {
        Main.checkAchievements();
    }
    static function evaluate(formula:Array, start:Number, end:Number, context:Array, keys:Array):Array {
        var stack:Array = [];
        for(var i=start; i<end; ++i) {
            var token:String = formula[i];
            switch(token) {
                case 'VALUE': {
                    stack.push([parseInt(formula[++i], 10)]);
                    break;
                }
                case 'IDENTIFIER': {
                    var identifier:String = formula[++i];
                    stack.push([identifier]);
                    break;
                }
                case 'ADD': {
                    var b = stack.pop();
                    var a = stack.pop();

                    var length = Math.max(a.length, b.length);

                    if(a.length > 0 && b.length == 0) {
                        // If b has no values we just return a
                        stack.push(a);
                    } else if(b.length > 0 && a.length == 0) {
                        // If a has no values we just return b
                        stack.push(b);
                    } else if(a.lenth != b.length && a.length != 1 && b.length != 1) {
                        // If the combination of values is invalid we return NaN
                        var result = [];
                        for(var j=0; j<length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    } else {
                        var aPlural = a.length != 1;
                        var bPlural = b.length != 1;
                        var result = [];
                        for(var j=0; j<length; ++j) {
                            var aValue = aPlural ? a[j] : a[0];
                            var bValue = bPlural ? b[j] : b[0];
                            if(typeof(aValue) == 'string' || typeof(bValue) == 'string') {
                                // If either value is a string, we do a string concatenation
                                result.push(String(aValue) + String(bValue));
                            } else if(typeof(aValue) == 'number' && typeof(bValue) == 'number') {
                                // If both values are numbers, we do a numeric addition
                                result.push(aValue + bValue);
                            } else {
                                // Otherwise this is an invalid operation and returns NaN
                                result.push(NaN);
                            }
                        }
                        stack.push(result);
                    }
                    break;
                }
                case 'SUB': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] - b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] - b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] - b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'MUL': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] * b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] * b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] * b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'DIV': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] / b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] / b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] / b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'MOD': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] % b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] % b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] % b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'POW': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(Math.pow(a[0], b[j]));
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(Math.pow(a[j], b[0]));
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(Math.pow(a[j], b[j]));
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'EQUAL': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] == b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] == b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] == b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'NOT_EQUAL': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] != b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] != b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] != b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'GREATER': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] > b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] > b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] > b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'GREATER_EQUAL': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] >= b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] >= b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] >= b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'LESSER': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] < b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] < b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] < b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'LESSER_EQUAL': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] <= b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] <= b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] <= b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'AND': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] && b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] && b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] && b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'OR': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] || b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] || b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] || b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'XOR': {
                    var b = stack.pop();
                    var a = stack.pop();
                    if(a.length == 1) {
                        var result = [];
                        for(var j=0; j<b.length; ++j) {
                            result.push(a[0] ^ b[j]);
                        }
                        stack.push(result);
                    } else if(b.length == 1) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] ^ b[0]);
                        }
                        stack.push(result);
                    } else if(a.length == b.length) {
                        var result = [];
                        for(var j=0; j<a.length; ++j) {
                            result.push(a[j] ^ b[j]);
                        }
                        stack.push(result);
                    } else {
                        Main.trace('Invalid number of entries for '+token);
                        return null;
                    }
                    break;
                }
                case 'READ_VAR': {
                    var identifier = stack.pop();
                    stack.push([555]);
                    break;
                }
                case 'READ_GLOBAL': {
                    var identifiers = stack.pop();
                    if(identifiers.length == 1) {
                        // switch case for different globals here
                        switch(identifiers[0]) {
                            case 'stage': {
                                stack.push(_root.gameLoader._root);
                                break;
                            }
                            case 'this': {
                                stack.push(context);
                                break;
                            }
                            case 'key': {
                                stack.push(keys);
                                break;
                            }
                            default: {
                                Main.trace('Invalid global identifier ' + identifiers[0]);
                                return null;
                            }
                        }
                    } else {
                        Main.trace('Invalid global identifier ' + identifiers);
                    }
                    break;
                }
                case 'OBJECT_ACCESS': {
                    var targets = stack.pop();
                    var amount = parseInt(formula[i+1], 10); // amount of opcodes that will be executed

                    var result = [];

                    // Iterate over each target in case there are multiple
                    for(var j=0; j<targets.length; ++j) {
                        var target = targets[j];

                        var childThis = [];
                        var childKeys = [];

                        // Grab all properties of the target
                        for(var propertyName:String in target) {
                            childThis.push(target[propertyName]);
                            childKeys.push(propertyName);
                        }

                        // Start a new evaluate run with the amount opcodes that was specified, returning an array
                        // of booleans.
                        var filteredResult = Main.evaluate(formula, i+2, i+amount+2, childThis, childKeys);

                        // For each boolean, if it was true, this property makes the cut
                        for(var k=0; k<filteredResult.length; ++k) {
                            if(filteredResult[k] == true) {
                                result.push(target[childKeys[k]]);
                            }
                        }
                    }

                    stack.push(
                        result
                    );

                    // Advance past the object access expression
                    i += amount+1;
                    break;
                }
                default: {
                    Main.trace('Invalid token '+token);
                    return null;
                }
            }
        }

        if(stack.length == 1) {
            return stack[0];
        } else {
            Main.trace('Unbalanced formula: '+JSON.stringify(stack));
            return null;
        }
    }
    static function formatOutput(input, level) {
        var singular = input.length == 1;
        var output = [];
        var suggestion = [];
        for(var i=0; i<input.length; ++i) {
            var value = input[i];
            if(typeof(value) == 'movieclip') {
                if(level == 0 && singular) {
                    for (var key:String in value) {
                        output.push(key + ': ' + Main.formatOutput([value[key]], level+1).output.join(''));
                    }
                } else {
                    var count:Number = 0;
                    for (var key:String in value) {
                        count++;
                    }
                    output.push('[MovieClip ...'+count+']');
                }
            } else if(value instanceof TextField) {
                output.push('[TextField "'+Main.createLabelString(value.text)+'"]');
            } else if(typeof(value) == 'number') {
                output.push(value);
            } else if(typeof(value) == 'string') {
                output.push('"'+value+'"');
            } else if(value instanceof Date) {
                output.push('[Date "'+value+'"]');
            } else if(value instanceof Array) {
                output.push('[Array ...'+value.length+']');
            } else if(value == null) {
                output.push('null');
            } else if(value == undefined) {
                output.push('undefined');
            } else if(value == NaN) {
                output.push('NaN');
            } else if(typeof(value) == 'object') {
                if(level == 0 && singular) {
                    for (var key:String in value) {
                        output.push(key + ': ' + Main.formatOutput([value[key]], level+1).output.join(''));
                    }
                } else {
                    var count:Number = 0;
                    for (var key:String in value) {
                        count++;
                    }
                    output.push('[Object ...'+count+']');
                }
            } else if(typeof(value) == 'boolean') {
                output.push(value);
            } else if(typeof(value) == 'function') {
                output.push('[Function]');
            } else {
                output.push('Unknown '+value+')');
            }
        }
        return {
            output: output,
            suggestion: suggestion
        }
    }
    static function createLabelString(labelString:String) {
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
    static function checkAchievements():Void {
        var globalDiff = {added: [], removed: [], edited: []};
        for(var i=0; i<AppData.data.assets.length; ++i) {
            var achievement:Object = AppData.data.assets[i];
            for(var j=0; j<achievement.groups.length; ++j) {
                var group:Object = achievement.groups[j];

                var allPassed = true;

                for(var k=0; k<group.requirements.length; ++k) {
                    var requirement:Object = group.requirements[k];
                    var resultA = Main.evaluate(requirement.compiledA, 1, requirement.compiledA.length, [_root.gameContainer.gameLoader._root], ['stage']);
                    var resultB = Main.evaluate(requirement.compiledB, 1, requirement.compiledB.length, [_root.gameContainer.gameLoader._root], ['stage']);

                    // The evaluate function can return multiple values. However, for the achievement system we only
                    // allow for one value at a time, so if the length isn't 1, we fail all and any test.
                    if(resultA.length != 1 || resultB.length != 1) {
                        allPassed = false;
                        continue;
                    }

                    switch(requirement.cmp) {
                        case '=': {
                            if(resultA[0] != resultB[0]) {
                                allPassed = false;
                                continue;
                            }
    /*
                            // update hits
                            globalDiff = JSONDiff.mergeDataDiff(
                                JSONDiff.updateAndGetDiff(AppData.data, 'assets/'+i+'/groups/'+j+'/requirements/'+k+'/hits', (requirement.hits || 0) + 1),
                                globalDiff
                            );

                            // update maxHits
                            globalDiff = JSONDiff.mergeDataDiff(
                                JSONDiff.updateAndGetDiff(AppData.data, 'assets/'+i+'/groups/'+j+'/requirements/'+k+'/maxHits', (requirement.maxHits || 0) + 1),
                                globalDiff
                            );
*/
                            break;
                        }
                        default: {
                            throw 'Not supported yet';
                        }
                    }

                }
            }
        }
        //Main.editData(globalDiff);
    }
}

