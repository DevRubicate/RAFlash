package;

import flash.events.*;
import flash.net.Socket;
import haxe.Timer;
using Lambda;

import AS2Bridge;

class Network {
    private static var instance:Network; // Singleton instance

    private var socket:Socket;
    private var reconnectTimer:Timer;
    private var currentMessageId:Int = 0;
    private var callbacks:Map<Int, Dynamic->Void> = new Map();
    private var pending:Array<{command:String, params:Dynamic, callback:Dynamic->Void}> = [];

    private function new() {
        // Private constructor to enforce singleton
        connectToServer();
    }

    public static function connect():Void {
        instance = new Network();
    }

    public static function command(command:String, params:Dynamic, callback:Dynamic->Void):Void {
        if (instance.socket != null && instance.socket.connected) {
            final messageId = instance.currentMessageId++;
            instance.callbacks.set(messageId, callback);
            instance.socket.writeUTFBytes(haxe.Json.stringify(['REQUEST', messageId, {command: command, params: params}])+'\n');
            instance.socket.flush();
        } else {
            instance.pending.push({command: command, params: params, callback: callback});
        }
    }
    public static function reply(messageId:Int, params:Dynamic):Void {
        if (instance.socket != null && instance.socket.connected) {
            instance.socket.writeUTFBytes(haxe.Json.stringify(['RESPONSE', messageId, params])+'\n');
            instance.socket.flush();
        } else {
            trace('Cannot reply, connection is dead');
        }
    }


    private function connectToServer():Void {
        socket = new Socket();
        
        socket.addEventListener(Event.CONNECT, onConnect);
        socket.addEventListener(ProgressEvent.SOCKET_DATA, onDataReceived);
        socket.addEventListener(IOErrorEvent.IO_ERROR, onError);
        socket.addEventListener(SecurityErrorEvent.SECURITY_ERROR, onError);
        socket.addEventListener(Event.CLOSE, onClose);

        try {
            socket.connect('localhost', 8081);
        } catch (e:Dynamic) {
            trace('Connection failed: ' + e);
            scheduleReconnect();
        }
    }

    private function onConnect(e:Event):Void {
        stopReconnectTimer();
        for(a in pending) {
            Network.command(a.command, a.params, a.callback);
        }
        pending = [];
    }

    private function onDataReceived(e:ProgressEvent):Void {
        final segments:Array<String> = socket.readUTFBytes(socket.bytesAvailable).split('\n');
        for(segment in segments) {
            if(segment == '') {
                continue;
            }
            var data:Array<Any>;
            try {
                data = haxe.Json.parse(segment);
            } catch(e) {
                trace('Invalid JSON: '+segment);
                continue;
            }
            if(!Std.isOfType(data, Array)) {
                trace('Invalid JSON (Array): '+segment);
                continue;
            }
            switch(data[0]) {
                case 'RESPONSE': {
                    final id:Int = data[1];
                    final message:Any = data[2];
                    final callbacks = Network.instance.callbacks.get(id);
                    if(callbacks == null) {
                        trace('Could not find callbacks message');
                        continue;
                    }
                    callbacks(message);
                    Network.instance.callbacks.remove(id);
                }
                case 'REQUEST': {
                    final id = data[1];
                    final params:{command:String, params:Any} = data[2];
                    if(params.command != null) {
                        this.onRequest(params.command, id, params.params);
                    } else {
                        this.onRequest('', id, null);
                    }
                }
                default: {
                    trace('Invalid message type');
                }
            }
        }

    }

    public function onRequest(command:String, messageId:Int, params:Dynamic):Void {
        switch(command) {
            case 'ping': {
                Network.reply(messageId, {success: true});
            }
            case 'evaluate': {
                AS2Bridge.evaluate(params, (params:Dynamic) -> {
                    Network.reply(messageId, {success: true, result: params});
                });
            }
            case 'editData': {
                AS2Bridge.editData(params, (params:Dynamic) -> {
                    Network.reply(messageId, {success: true});
                });
            }
            default: {
                trace('Invalid command type "'+command+'"');
                Network.reply(messageId, {success: false});
            }
        }
    }

    private function onError(e:Event):Void {
        trace('Socket error: ' + e.toString());
        scheduleReconnect();
    }

    private function onClose(e:Event):Void {
        trace('Connection closed');
        scheduleReconnect();
    }

    private function scheduleReconnect():Void {
        if (reconnectTimer == null) {
            trace('Scheduling reconnect...');
            reconnectTimer = new Timer(300);
            reconnectTimer.run = function():Void {
                trace('Attempting to reconnect...');
                reconnectTimer.stop();
                reconnectTimer = null;
                connectToServer();
            };
        }
    }

    private function stopReconnectTimer():Void {
        if (reconnectTimer != null) {
            reconnectTimer.stop();
            reconnectTimer = null;
        }
    }
}
