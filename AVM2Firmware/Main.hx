package;

import flash.display.MovieClip;
import flash.display.Loader;
import flash.display.StageAlign;
import flash.display.StageScaleMode;
import flash.net.Socket;
import flash.net.URLRequest;
import flash.events.Event;
import flash.events.IOErrorEvent;
import flash.events.SecurityErrorEvent;
import flash.events.ProgressEvent;
import flash.events.KeyboardEvent;
import flash.ui.Keyboard;
import haxe.Timer;

/**
 * AVM2 Firmware
 *
 * This firmware talks directly to Deno via Socket (newline-terminated JSON).
 * Used for playing AS3 games (AVM2) with direct access to game internals.
 *
 * Protocol:
 * - REQUEST:  ["REQUEST", id, {command, params}]
 * - RESPONSE: ["RESPONSE", id, result]
 * - EVENT:    {type, data}
 */
class Main extends MovieClip {
    private static var instance:Main;

    // Socket connection
    private var socket:Socket;
    private var connected:Bool = false;
    private var messageBuffer:String = "";

    // Game state
    private var gameContainer:MovieClip;
    private var gameRoot:flash.display.DisplayObject;
    private var gameLoaded:Bool = false;
    private var gamePath:String = "";

    // Request tracking
    private var callbacks:Map<Int, Dynamic->Void> = new Map();
    private var currentMessageId:Int = 0;

    // Memory watch
    private var memoryWatchers:Map<String, Dynamic> = new Map();
    private var memoryWatchFrameCount:Int = 0;

    // Reconnection
    private var reconnectAttempts:Int = 0;
    private static inline var MAX_RECONNECT_ATTEMPTS:Int = 15;
    private var disconnectOverlay:flash.display.Sprite = null;
    private var initialSetupDone:Bool = false;

    private static inline var PORT:Int = 18081;

    public function new() {
        super();
        instance = this;

        // Setup stage
        addEventListener(Event.ADDED_TO_STAGE, onAddedToStage);

        // Connect to Deno server
        connectToServer();
    }

    private function onAddedToStage(e:Event):Void {
        removeEventListener(Event.ADDED_TO_STAGE, onAddedToStage);

        stage.align = StageAlign.TOP_LEFT;
        stage.scaleMode = StageScaleMode.NO_SCALE;
        flash.Lib.fscommand("showmenu", "false");
    }

    // === Socket Connection ===

    private function connectToServer():Void {
        // Clean up old socket listeners if reconnecting
        if (socket != null) {
            socket.removeEventListener(Event.CONNECT, onConnect);
            socket.removeEventListener(ProgressEvent.SOCKET_DATA, onDataReceived);
            socket.removeEventListener(IOErrorEvent.IO_ERROR, onError);
            socket.removeEventListener(SecurityErrorEvent.SECURITY_ERROR, onError);
            socket.removeEventListener(Event.CLOSE, onClose);
        }

        socket = new Socket();
        messageBuffer = "";

        socket.addEventListener(Event.CONNECT, onConnect);
        socket.addEventListener(ProgressEvent.SOCKET_DATA, onDataReceived);
        socket.addEventListener(IOErrorEvent.IO_ERROR, onError);
        socket.addEventListener(SecurityErrorEvent.SECURITY_ERROR, onError);
        socket.addEventListener(Event.CLOSE, onClose);

        try {
            socket.connect("127.0.0.1", PORT);
        } catch (e:Dynamic) {
            log("Connection failed: " + e);
            scheduleReconnect();
        }
    }

    private function onConnect(e:Event):Void {
        connected = true;
        reconnectAttempts = 0;
        hideDisconnectOverlay();

        if (!gameLoaded) {
            log("Connected to Deno server");
            sendMessage("ready", {});
        } else {
            log("Reconnected to Deno server");
        }
    }

    private function onDataReceived(e:ProgressEvent):Void {
        messageBuffer += socket.readUTFBytes(socket.bytesAvailable);

        // Process complete messages (newline-terminated)
        var messages = messageBuffer.split("\n");
        messageBuffer = messages.pop(); // Keep incomplete message in buffer

        for (msg in messages) {
            if (msg == "") continue;
            processMessage(msg);
        }
    }

    private function processMessage(msg:String):Void {
        var data:Array<Dynamic>;
        try {
            data = haxe.Json.parse(msg);
        } catch (e:Dynamic) {
            log("Invalid JSON: " + msg);
            return;
        }

        if (!Std.isOfType(data, Array)) {
            log("Invalid message format");
            return;
        }

        switch (data[0]) {
            case "RESPONSE":
                var id:Int = data[1];
                var result:Dynamic = data[2];
                var callback = callbacks.get(id);
                if (callback != null) {
                    callback(result);
                    callbacks.remove(id);
                }

            case "REQUEST":
                var id:Int = data[1];
                var payload:{command:String, params:Dynamic} = data[2];
                handleRequest(id, payload.command, payload.params);

            default:
                log("Unknown message type: " + data[0]);
        }
    }

    private function onError(e:Event):Void {
        connected = false;
        if (gameLoaded) {
            showDisconnectOverlay(false);
            scheduleReconnect();
        }
        // Before game loads, let Flash handle connection lifecycle naturally
        // (policy file handshake causes a close/reconnect cycle)
    }

    private function onClose(e:Event):Void {
        connected = false;
        if (gameLoaded) {
            showDisconnectOverlay(false);
            scheduleReconnect();
        }
    }

    private function scheduleReconnect():Void {
        reconnectAttempts++;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            showDisconnectOverlay(true);
            return;
        }
        Timer.delay(function() {
            connectToServer();
        }, 1000);
    }

    // === Message Sending ===

    private function sendMessage(type:String, data:Dynamic):Void {
        if (!connected || socket == null) return;

        var msg = haxe.Json.stringify({type: type, data: data}) + "\n";
        socket.writeUTFBytes(msg);
        socket.flush();
    }

    private function sendResponse(id:Int, result:Dynamic):Void {
        if (!connected || socket == null) return;

        var msg = haxe.Json.stringify(["RESPONSE", id, result]) + "\n";
        socket.writeUTFBytes(msg);
        socket.flush();
    }

    private function sendCommand(command:String, params:Dynamic, callback:Dynamic->Void):Void {
        if (!connected || socket == null) {
            callback({success: false, error: "Not connected"});
            return;
        }

        var id = currentMessageId++;
        callbacks.set(id, callback);

        var msg = haxe.Json.stringify(["REQUEST", id, {command: command, params: params}]) + "\n";
        socket.writeUTFBytes(msg);
        socket.flush();
    }

    // === Request Handling ===

    private function handleRequest(id:Int, command:String, params:Dynamic):Void {
        switch (command) {
            case "ping":
                sendResponse(id, {success: true, pong: true});

            case "setup":
                if (initialSetupDone) {
                    // Reconnect: firmware state is authoritative, push it back to Deno
                    sendResponse(id, {success: true});
                    sendMessage("syncState", {appData: AppData.data});
                } else {
                    // First connect: accept Deno's data and load game
                    AppData.data = params.data;
                    AppData.originalData = haxe.Json.parse(haxe.Json.stringify(params.data));
                    initialSetupDone = true;
                    sendResponse(id, {success: true});
                    loadGame(params.gameUrl);
                }

            case "evaluate":
                var formula:Array<Dynamic> = params.formula;
                var result = Evaluate.evaluate(formula, 1, formula.length, [gameRoot], cast ["stage"], gameRoot);
                var formatted = Evaluate.formatOutput(result != null ? result : [], 0);
                sendResponse(id, {success: true, result: formatted});

            case "evaluateMultiple":
                var formulas:Array<Dynamic> = params.formulas;
                var results:Array<Dynamic> = [];
                var fi:Int = 0;
                while (fi < formulas.length) {
                    var formulaItem:Array<Dynamic> = formulas[fi];
                    var resultItem = Evaluate.evaluate(formulaItem, 1, formulaItem.length, [gameRoot], cast ["stage"], gameRoot);
                    var formattedItem = Evaluate.formatOutput(resultItem != null ? resultItem : [], 0);
                    results.push(formattedItem);
                    fi++;
                }
                sendResponse(id, {success: true, results: results});

            case "editData":
                var changes:Dynamic = params.changes;
                JSONDiff.applyDataDiff(AppData.data, changes);
                // Sync originalData to prevent ping-pong feedback loops
                AppData.originalData = haxe.Json.parse(haxe.Json.stringify(AppData.data));
                sendResponse(id, {success: true});

            case "getData":
                sendResponse(id, {success: true, data: AppData.data});

            case "showToast":
                var toastTitle:String = params.title != null ? params.title : "";
                var toastDesc:String = params.description != null ? params.description : "";
                var toastLabel:String = params.label != null ? params.label : "";
                var toastAlign:String = params.align != null ? params.align : "right";
                var toastImageUrl:String = params.imageUrl != null ? params.imageUrl : "";
                Toast.show(toastTitle, toastDesc, toastLabel, toastAlign, toastImageUrl);
                sendResponse(id, {success: true});

            case "searchTargetForValue":
                var find:String = Std.string(params.value);
                var startTarget:Dynamic = gameRoot;
                var pathPrefix:String = "stage";
                if (params.pathFormula != null) {
                    var pf:Array<Dynamic> = params.pathFormula;
                    if (pf.length > 0) {
                        var pathResult = Evaluate.evaluate(pf, 1, pf.length, [gameRoot], cast ["stage"], gameRoot);
                        if (pathResult != null && pathResult.length > 0) {
                            startTarget = pathResult[0];
                            pathPrefix = Std.string(params.pathString);
                        } else {
                            sendResponse(id, {success: false, error: "Invalid path"});
                            return;
                        }
                    }
                }
                var searchOutput:Array<Dynamic> = [];
                Evaluate.searchTargetForValue(startTarget, find, pathPrefix, searchOutput, []);
                var searchFormatted = Evaluate.formatOutput(searchOutput, 0);
                sendResponse(id, {success: true, result: searchFormatted});

            case "startWatch":
                var watcherId:String = Std.string(params.watcherId);
                memoryWatchers.set(watcherId, {
                    bytecode: params.bytecode,
                    buffer: [],
                    lastFlush: haxe.Timer.stamp()
                });
                sendResponse(id, {success: true});

            case "stopWatch":
                var stopId:String = Std.string(params.watcherId);
                memoryWatchers.remove(stopId);
                sendResponse(id, {success: true});

            case "setRuntimeSetting":
                if (Std.string(params.key) == "processingActive") {
                    Achievement.processingActive = params.value == true;
                }
                sendResponse(id, {success: true});

            case "getTriggeredRequirements":
                var triggeredIds:Array<Dynamic> = [];
                var trAssets:Array<Dynamic> = untyped AppData.data.assets;
                if (trAssets != null) {
                    var ti:Int = 0;
                    while (ti < trAssets.length) {
                        var trAsset:Dynamic = trAssets[ti];
                        var trGroups:Array<Dynamic> = untyped trAsset.groups;
                        if (trGroups != null) {
                            var tg:Int = 0;
                            while (tg < trGroups.length) {
                                var trReqs:Array<Dynamic> = untyped trGroups[tg].requirements;
                                if (trReqs != null) {
                                    var tr:Int = 0;
                                    while (tr < trReqs.length) {
                                        if (untyped trReqs[tr]._triggered == true) {
                                            triggeredIds.push(untyped trReqs[tr].id);
                                            untyped trReqs[tr]._triggered = false;
                                        }
                                        tr++;
                                    }
                                }
                                tg++;
                            }
                        }
                        ti++;
                    }
                }
                sendResponse(id, {success: true, triggered: triggeredIds});

            case "getRichPresenceResult":
                var rpResult:Dynamic = null;
                var rpAssets:Array<Dynamic> = untyped AppData.data.assets;
                if (rpAssets != null) {
                    var ri:Int = 0;
                    while (ri < rpAssets.length) {
                        if (untyped rpAssets[ri].type == "RICH_PRESENCE") {
                            rpResult = untyped rpAssets[ri]._richPresenceResult;
                            break;
                        }
                        ri++;
                    }
                }
                sendResponse(id, {success: true, result: rpResult});

            case "showMeasure":
                var mTitle:String = params.title != null ? Std.string(params.title) : "";
                var mDesc:String = params.description != null ? Std.string(params.description) : "";
                var mProgress:String = params.progress != null ? Std.string(params.progress) : "";
                var mImageUrl:String = params.imageUrl != null ? Std.string(params.imageUrl) : "";
                if (params.assetId != null) {
                    Measure.showOrReset(mTitle, mDesc, mProgress, mImageUrl, params.assetId);
                } else {
                    Measure.show(mTitle, mDesc, mProgress, mImageUrl);
                }
                sendResponse(id, {success: true});

            default:
                sendResponse(id, {success: false, error: "Unknown command: " + command});
        }
    }

    // === Game Loading ===

    private function loadGame(?url:String):Void {
        log("Loading game SWF...");

        var loader = new Loader();
        loader.contentLoaderInfo.addEventListener(Event.COMPLETE, onGameLoaded);
        loader.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR, onGameLoadError);

        var gameUrl = (url != null) ? url : "http://raflash.local/game.swf";
        log("Loading from: " + gameUrl);
        loader.load(new URLRequest(gameUrl));

        addChild(loader);
    }

    private function onGameLoaded(e:Event):Void {
        gameLoaded = true;

        var loader:Loader = cast(e.target, flash.display.LoaderInfo).loader;
        gameRoot = loader.content;
        var bytes = loader.contentLoaderInfo.bytesTotal;

        log("Game loaded successfully! (" + bytes + " bytes)");
        sendMessage("gameLoaded", {bytes: bytes});

        // Setup F12 key listener and frame loop after game loads
        setupKeyListener();
        addEventListener(Event.ENTER_FRAME, onEnterFrame);
    }

    private function onGameLoadError(e:IOErrorEvent):Void {
        log("Failed to load game: " + e.text);
        sendMessage("gameLoadError", {error: e.text});
    }

    // === Frame Loop ===

    private function onEnterFrame(e:Event):Void {
        Achievement.checkAchievements(gameRoot, sendMessage, sendEditData);
        processWatchers();
    }

    private function sendEditData(diff:Dynamic):Void {
        if (diff == null) return;
        var edited:Dynamic = untyped diff.edited;
        if (edited == null || untyped edited.length == 0) return;
        sendMessage("editData", diff);
    }

    private function processWatchers():Void {
        var now:Float = haxe.Timer.stamp();
        memoryWatchFrameCount++;

        for (watcherId in memoryWatchers.keys()) {
            var watcher:Dynamic = memoryWatchers.get(watcherId);

            // Evaluate formula
            var value:Dynamic = null;
            try {
                var bytecode:Array<Dynamic> = watcher.bytecode;
                var result = Evaluate.evaluate(bytecode, 1, bytecode.length, [gameRoot], cast ["stage"], gameRoot);
                value = (result != null && result.length > 0) ? result[0] : null;
            } catch (e:Dynamic) {
                value = "ERROR";
            }

            // Detect if result is a structure (iterable) or a scalar value
            var isStructure:Bool = false;
            if (value != null && value != "ERROR") {
                if (Std.isOfType(value, flash.display.DisplayObjectContainer)) {
                    isStructure = true;
                } else if (Std.isOfType(value, Array)) {
                    isStructure = true;
                } else if (untyped __typeof__(value) == "object") {
                    isStructure = true;
                }
            }

            if (isStructure) {
                // Structure mode: enumerate keys and send (throttled to 1/second)
                if (now - (watcher.lastFlush : Float) >= 1.0) {
                    var keys:Array<Dynamic> = [];
                    if (Std.isOfType(value, Array)) {
                        var arr:Array<Dynamic> = cast value;
                        var j:Int = 0;
                        while (j < arr.length) { keys.push(Std.string(j)); j++; }
                    } else {
                        var props = Evaluate.enumerateProperties(value);
                        var j:Int = 0;
                        while (j < props.keys.length) { keys.push(props.keys[j]); j++; }
                    }
                    sendMessage("watchResults", {
                        watcherId: watcherId,
                        type: "structure",
                        keys: keys
                    });
                    watcher.lastFlush = now;
                }
            } else {
                // Value mode: buffer results and flush every 1 second
                var buf:Array<Dynamic> = watcher.buffer;
                buf.push({frame: memoryWatchFrameCount, value: value});

                if (now - (watcher.lastFlush : Float) >= 1.0) {
                    sendMessage("watchResults", {
                        watcherId: watcherId,
                        type: "value",
                        results: buf
                    });
                    watcher.buffer = [];
                    watcher.lastFlush = now;
                }
            }
        }
    }

    // === Keyboard Handling ===

    private function setupKeyListener():Void {
        stage.addEventListener(KeyboardEvent.KEY_DOWN, onKeyDown);
    }

    private function onKeyDown(e:KeyboardEvent):Void {
        // F12 key
        if (e.keyCode == 123) {
            sendMessage("keypress", {keyCode: 123});
        }
    }

    // === Disconnect Overlay ===

    private function showDisconnectOverlay(permanent:Bool):Void {
        hideDisconnectOverlay();

        var overlay = new flash.display.Sprite();
        var stageWidth:Float = 800;
        var stageHeight:Float = 575;
        try {
            stageWidth = flash.Lib.current.stage.stageWidth;
            stageHeight = flash.Lib.current.stage.stageHeight;
        } catch (e:Dynamic) {}

        var barHeight:Float = permanent ? 50 : 30;
        var bgAlpha:Float = permanent ? 0.9 : 0.75;
        var g = overlay.graphics;
        g.beginFill(0x1F2937, bgAlpha);
        g.drawRect(0, 0, stageWidth, barHeight);
        g.endFill();

        var tf = new flash.text.TextField();
        tf.width = stageWidth;
        tf.height = barHeight;
        tf.selectable = false;
        tf.mouseEnabled = false;

        var fmt = new flash.text.TextFormat();
        fmt.font = "_sans";
        fmt.size = permanent ? 14 : 12;
        fmt.color = 0xFFFFFF;
        fmt.align = flash.text.TextFormatAlign.CENTER;

        tf.defaultTextFormat = fmt;
        tf.text = permanent
            ? "Connection lost. Achievements are not being tracked."
            : "Reconnecting...";
        tf.y = (barHeight - tf.textHeight) / 2 - 2;

        overlay.addChild(tf);
        flash.Lib.current.addChild(overlay);
        disconnectOverlay = overlay;
    }

    private function hideDisconnectOverlay():Void {
        if (disconnectOverlay != null) {
            if (disconnectOverlay.parent != null) {
                disconnectOverlay.parent.removeChild(disconnectOverlay);
            }
            disconnectOverlay = null;
        }
    }

    // === Logging ===

    private function log(msg:String):Void {
        trace("[AS3] " + msg);
        sendMessage("log", {message: msg});
    }

    // === Entry Point ===

    public static function main():Void {
        flash.Lib.current.stage.align = StageAlign.TOP_LEFT;
        flash.Lib.current.stage.scaleMode = StageScaleMode.NO_SCALE;

        var main = new Main();
        flash.Lib.current.addChild(main);
    }
}
