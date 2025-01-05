import haxe.extern.EitherType;

import flash.net.LocalConnection;
import flash.events.StatusEvent;

class AS2Bridge {
    public static var ready:Bool = false;
    private static var sender:LocalConnection;
    private static var receiver:LocalConnection;
    private static var messageQueue:Map<String, Dynamic> = new Map();
    private static var flushQueue:Array<Dynamic> = [];

    public static function setupListener() {
        receiver = new LocalConnection();
        receiver.addEventListener(StatusEvent.STATUS, onStatus);
        receiver.client = {
            setup: function():Void {
                for(f in flushQueue) {
                    if(f.command == 'read') {
                        sender.send('_AS3ToAS2', f.command, f.id, f.param);
                    } else if(f.command == 'list') {
                        sender.send('_AS3ToAS2', f.command, f.id, f.path, f.limit, f.offset);
                    } else {
                        throw 'Not supported yet';
                    }
                }
                flushQueue = [];
                ready = true;
            },
            message: function(id:String, message:String):Void {
                if(messageQueue.exists(id)) {
                    messageQueue.get(id)(haxe.Json.parse(message));
                    messageQueue.remove(id);
                }
            },
        };
        receiver.connect('_AS2ToAS3');
    }

    public static function setupSender(path:String) {
        // Initialize LocalConnection for communication with AS2
        sender = new LocalConnection();
        sender.addEventListener(StatusEvent.STATUS, onStatus);
        sender.send('_AS3ToAS2', 'setup', path);
    }

    private static function getQueueId() {
        var id;
        do {
            id = Std.string(Math.random() * 0xFFFFFF);
        } while(messageQueue.exists(id));
        return id;
    }


    public static function read(path:String, callback:(Dynamic)->Void) {
        final id = getQueueId();
        messageQueue.set(id, callback);
        if(ready) {
            sender.send('_AS3ToAS2', 'read', id, path);
        } else {
            flushQueue.push({command: 'read', id: id, param: path});
        }
    }

    public static function list(path:Array<EitherType<String, Float>>, limit:Int, offset:Int, callback:({value: Array<String>, total:Int, error:String})->Void) {
        final id = getQueueId();
        messageQueue.set(id, callback);
        if(ready) {
            sender.send('_AS3ToAS2', 'list', id, path, limit, offset);
        } else {
            flushQueue.push({command: 'list', id: id, path: path, limit: limit, offset: offset});
        }
        return function() {
            messageQueue.remove(id);
        }
    }

    // Handle StatusEvent
    private static function onStatus(event:StatusEvent):Void {
        if (event.level == 'status') {
            //trace('Message sent successfully.');
        } else if (event.level == 'error') {
            trace('Error sending message: ' + event.code);
        }
    }
}
