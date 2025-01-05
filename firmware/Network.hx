package;

import flash.events.*;
import flash.net.Socket;
import haxe.Timer; // Import Haxe Timer
using Lambda;

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
            instance.socket.writeUTFBytes(haxe.Json.stringify(['REQUEST', messageId, {command: command, params: params}]));
            instance.socket.flush();
        } else {
            instance.pending.push({command: command, params: params, callback: callback});
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
        final data:Array<Any> = haxe.Json.parse(socket.readUTFBytes(socket.bytesAvailable));
        if(!Std.isOfType(data, Array)) {
            trace('Invalid message');
            return;
        }

        switch(data[0]) {
            case 'RESPONSE': {
                final id:Int = data[1];
                final message:Any = data[2];
                final callbacks = Network.instance.callbacks.get(id);
                if(callbacks == null) {
                    trace('Could not find callbacks message');
                    return;
                }
                callbacks(message);
                Network.instance.callbacks.remove(id);
            }
            case 'REQUEST': {
                final id = data[1];
                final message = data[2];
                trace('Received REQUEST server: ' + data);
                trace('REQUEST NOT IMPLEMENTED YET');
            }
            default: {
                trace('Invalid message type');
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
