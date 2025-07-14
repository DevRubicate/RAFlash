import haxe.extern.EitherType;

import flash.net.LocalConnection;
import flash.events.StatusEvent;
import Network;

class AS2Bridge {
    public static var ready:Bool = false;
    private static var sender:LocalConnection;
    private static var receiver:LocalConnection;
    private static var messageQueue:Map<String, Dynamic> = new Map();

    public static function setupListener() {
        receiver = new LocalConnection();
        receiver.addEventListener(StatusEvent.STATUS, onStatus);
        receiver.client = {
            setup: function():Void {
                ready = true;
            },
            message: function(id:String, message:String):Void {
                if(messageQueue.exists(id)) {
                    messageQueue.get(id)(haxe.Json.parse(message));
                    messageQueue.remove(id);
                }
            },
            trace: function(message:String):Void {
                trace('[AVM1Firmware] ' + message);
            },
            editData: function(data:String):Void {
                Network.command('editData', haxe.Json.parse(data), (message:Dynamic) -> {
                    if(!message.success) {
                        trace('Unable to edit data');
                    }
                });
            },
        };
        receiver.connect('_AS2ToAS3');
    }

    public static function setupSender(path:String, data:Any) {
        // Initialize LocalConnection for communication with AS2
        sender = new LocalConnection();
        sender.addEventListener(StatusEvent.STATUS, onStatus);
        sender.send('_AS3ToAS2', 'setup', path, data);
    }

    private static function getQueueId() {
        var id;
        do {
            id = Std.string(Math.floor(Math.random() * 0xFFFFFF));
        } while(messageQueue.exists(id));
        return id;
    }

    public static function evaluate(formula:Array<String>, callback:(Dynamic)->Void) {
        final id = getQueueId();
        messageQueue.set(id, callback);
        sender.send('_AS3ToAS2', 'evaluate', id, formula);
    }

    public static function editData(data:Dynamic, callback:(Dynamic)->Void) {
        final id = getQueueId();
        messageQueue.set(id, callback);
        sender.send('_AS3ToAS2', 'editData', id, data);
    }

    public static function read(path:String, callback:(Dynamic)->Void) {
        final id = getQueueId();
        messageQueue.set(id, callback);
        sender.send('_AS3ToAS2', 'read', id, path);
    }

    public static function list(path:Array<EitherType<String, Float>>, limit:Int, offset:Int, callback:({value: Array<String>, total:Int, error:String})->Void) {
        final id = getQueueId();
        messageQueue.set(id, callback);
        sender.send('_AS3ToAS2', 'list', id, path, limit, offset);
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
