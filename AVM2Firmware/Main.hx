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
import flash.events.MouseEvent;
import flash.ui.Keyboard;
import flash.system.LoaderContext;
import flash.system.ApplicationDomain;
import flash.system.Security;
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
    private var reconnectPending:Bool = false;
    private static inline var MAX_RECONNECT_ATTEMPTS:Int = 15;
    private var disconnectOverlay:flash.display.Sprite = null;
    private var initialSetupDone:Bool = false;

    // Child mode: firmware was loaded by injected bytecode inside the game SWF
    // (game is root, firmware is child). Detected from loaderInfo URL query param.
    private var childMode:Bool = false;

    // Recording state — toggled by setRecording command.
    private var recording:Bool = false;
    private var recordingMouseListener:MouseEvent->Void = null;

    // Default port, overridden by URL ?port= param in constructor
    private static var PORT:Int = 18081;

    public function new() {
        super();
        instance = this;

        // Allow loaded game SWFs to be introspected across security boundaries
        Security.allowDomain("*");
        Security.allowInsecureDomain("*");

        // Detect child mode from the firmware URL query parameter.
        // In child mode, the injected bytecode loads us with ?mode=child.
        // Also extract the origin (scheme + host) for building asset image
        // URLs — the firmware must request images from the same domain it
        // was loaded from to avoid cross-domain security blocks.
        try {
            var url:String = flash.Lib.current.loaderInfo.url;
            childMode = (url != null && url.indexOf("mode=child") != -1);
            if (url != null) {
                // Extract "http://host" from "http://host/path?query"
                var schemeEnd:Int = url.indexOf("://");
                if (schemeEnd >= 0) {
                    var pathStart:Int = url.indexOf("/", schemeEnd + 3);
                    Achievement.imageBaseUrl = (pathStart >= 0) ? url.substring(0, pathStart) : url;
                }
                // Extract port from ?port=XXXX (or &port=XXXX)
                var portIdx:Int = url.indexOf("port=");
                if (portIdx >= 0) {
                    var portStr:String = url.substr(portIdx + 5);
                    var ampIdx:Int = portStr.indexOf("&");
                    if (ampIdx >= 0) portStr = portStr.substr(0, ampIdx);
                    var parsed:Null<Int> = Std.parseInt(portStr);
                    if (parsed != null && parsed > 0) PORT = parsed;
                }
            }
        } catch (e:Dynamic) {
            childMode = false;
        }

        // Setup stage
        addEventListener(Event.ADDED_TO_STAGE, onAddedToStage);

        // Connect to Deno server
        connectToServer();
    }

    private function onAddedToStage(e:Event):Void {
        removeEventListener(Event.ADDED_TO_STAGE, onAddedToStage);

        if (!childMode) {
            // Parent mode: firmware owns the stage, set properties
            stage.align = StageAlign.TOP_LEFT;
            stage.scaleMode = StageScaleMode.NO_SCALE;
        }
        // Menu suppression works in both modes
        flash.Lib.fscommand("showmenu", "false");
        var cm = new flash.ui.ContextMenu();
        cm.hideBuiltInItems();
        contextMenu = cm;
        stage.addEventListener(flash.events.MouseEvent.RIGHT_CLICK, function(_:flash.events.MouseEvent):Void {});
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
            try { socket.close(); } catch (e:Dynamic) { /* already closed */ }
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

        if (!initialSetupDone) {
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

        var arr:Array<Dynamic> = cast data;
        if (arr.length < 3) {
            log("Message too short");
            return;
        }

        switch (data[0]) {
            case "RESPONSE":
                if (!Std.isOfType(data[1], Int) && !Std.isOfType(data[1], Float)) return;
                var id:Int = Std.int(data[1]);
                var result:Dynamic = data[2];
                var callback = callbacks.get(id);
                if (callback != null) {
                    callback(result);
                    callbacks.remove(id);
                }

            case "REQUEST":
                var id:Dynamic = data[1];
                var payload:Dynamic = data[2];
                if (payload == null || payload.command == null) return;
                handleRequest(id, payload.command, payload.params);

            default:
                log("Unknown message type: " + data[0]);
        }
    }

    private function onError(e:Event):Void {
        connected = false;
        clearPendingCallbacks();
        if (gameLoaded) {
            showDisconnectOverlay(false);
        }
        // Always attempt reconnect — even before game loads the server may
        // have restarted and we need to re-establish the connection.
        if (initialSetupDone) {
            scheduleReconnect();
        }
    }

    private function onClose(e:Event):Void {
        connected = false;
        clearPendingCallbacks();
        if (gameLoaded) {
            showDisconnectOverlay(false);
        }
        if (initialSetupDone) {
            scheduleReconnect();
        }
    }

    private function clearPendingCallbacks():Void {
        var pending = new Array<Dynamic->Void>();
        for (key in callbacks.keys()) {
            var cb = callbacks.get(key);
            if (cb != null) pending.push(cb);
        }
        callbacks = new Map();
        for (cb in pending) {
            try { cb({success: false, error: "Connection lost"}); } catch (e:Dynamic) {}
        }
    }

    private function scheduleReconnect():Void {
        if (reconnectPending) return;
        reconnectAttempts++;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            showDisconnectOverlay(true);
            return;
        }
        reconnectPending = true;
        Timer.delay(function() {
            reconnectPending = false;
            connectToServer();
        }, 1000);
    }

    // === Message Sending ===

    private function sendMessage(type:String, data:Dynamic):Void {
        if (!connected || socket == null) return;

        var msg = haxe.Json.stringify({type: type, data: data}) + "\n";
        try {
            socket.writeUTFBytes(msg);
            socket.flush();
        } catch (e:Dynamic) {
            connected = false;
            log("sendMessage IO error: " + Std.string(e));
        }
    }

    private function sendResponse(id:Dynamic, result:Dynamic):Void {
        if (!connected || socket == null) return;

        var msg = haxe.Json.stringify(["RESPONSE", id, result]) + "\n";
        try {
            socket.writeUTFBytes(msg);
            socket.flush();
        } catch (e:Dynamic) {
            connected = false;
            log("sendResponse IO error: " + Std.string(e));
        }
    }

    private function sendCommand(command:String, params:Dynamic, callback:Dynamic->Void):Void {
        if (!connected || socket == null) {
            callback({success: false, error: "Not connected"});
            return;
        }

        var id = currentMessageId++;
        callbacks.set(id, callback);

        var msg = haxe.Json.stringify(["REQUEST", id, {command: command, params: params}]) + "\n";
        try {
            socket.writeUTFBytes(msg);
            socket.flush();
        } catch (e:Dynamic) {
            connected = false;
            callbacks.remove(id);
            log("sendCommand IO error: " + Std.string(e));
            callback({success: false, error: "IO error"});
        }
    }

    // === Request Handling ===

    private function handleRequest(id:Dynamic, command:String, params:Dynamic):Void {
        try {
            handleRequestInner(id, command, params);
        } catch (e:Dynamic) {
            log("Error handling command '" + command + "': " + Std.string(e));
            try {
                sendResponse(id, {success: false, error: Std.string(e)});
            } catch (e2:Dynamic) {
                // Last resort — can't even send error response
                trace("[AS3] Fatal: failed to send error response: " + Std.string(e2));
            }
        }
    }

    private function handleRequestInner(id:Dynamic, command:String, params:Dynamic):Void {
        switch (command) {
            case "ping":
                sendResponse(id, {success: true, pong: true});

            case "setup":
                if (initialSetupDone) {
                    // Reconnect: clear stale UI/delta state, re-apply gameConfig from server
                    Achievement.deltaValues = new Map();
                    Toast.clearAll();
                    Measure.clearAll();
                    PrimedBadges.clearAll();
                    Evaluate.clearHooks();
                    if (params.data != null && params.data.gameConfig != null) {
                        untyped AppData.data.gameConfig = params.data.gameConfig;
                    }
                    sendResponse(id, {success: true});
                    sendMessage("syncState", {appData: AppData.data});
                } else {
                    // First connect: accept Deno's data and load game
                    Evaluate.clearHooks();
                    AppData.data = params.data;
                    AppData.originalData = haxe.Json.parse(haxe.Json.stringify(params.data));
                    if (params.settings != null) {
                        Achievement.benchmarkingActive = untyped params.settings.benchmarkingEnabled == true;
                    }
                    initialSetupDone = true;
                    sendResponse(id, {success: true});
                    if (childMode) {
                        // Child mode: game is already loaded — we're a child of it.
                        // Find the game root by walking up the parent chain.
                        gameRoot = resolveChildModeGameRoot();
                        gameLoaded = true;
                        sendMessage("gameLoaded", {bytes: 0});
                        setupKeyListener();
                        addEventListener(Event.ENTER_FRAME, onEnterFrame);
                    } else {
                        loadGame(params.gameUrl);
                    }
                }

            case "evaluate":
                if (params.formula == null) { sendResponse(id, {success: false, error: "Missing formula"}); return; }
                if (gameRoot == null) { sendResponse(id, {success: false, error: "Game not loaded"}); return; }
                var formula:Array<Dynamic> = params.formula;
                Evaluate.ROOT_SENTINEL.__raflash_gameRoot = gameRoot;
                var result = Evaluate.evaluate(formula, 1, formula.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
                var formatted = Evaluate.formatOutput(result != null ? result : [], 0);
                sendResponse(id, {success: true, result: formatted});

            case "evaluateMultiple":
                if (params.formulas == null) { sendResponse(id, {success: false, error: "Missing formulas"}); return; }
                if (gameRoot == null) { sendResponse(id, {success: false, error: "Game not loaded"}); return; }
                var formulas:Array<Dynamic> = params.formulas;
                var results:Array<Dynamic> = [];
                var fi:Int = 0;
                while (fi < formulas.length) {
                    var formulaItem:Array<Dynamic> = formulas[fi];
                    var resultItem = Evaluate.evaluate(formulaItem, 1, formulaItem.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
                    var formattedItem = Evaluate.formatOutput(resultItem != null ? resultItem : [], 0);
                    results.push(formattedItem);
                    fi++;
                }
                sendResponse(id, {success: true, results: results});

            case "editData":
                if (params.changes == null) { sendResponse(id, {success: false, error: "Missing changes"}); return; }
                var changes:Dynamic = params.changes;
                JSONDiff.applyDataDiff(AppData.data, changes);
                // Sync originalData to prevent ping-pong feedback loops
                AppData.originalData = haxe.Json.parse(haxe.Json.stringify(AppData.data));
                // Disable native compiled path until recompilation arrives
                Achievement.nativeAchReady = false;
                sendResponse(id, {success: true});

            case "getData":
                sendResponse(id, {success: true, data: AppData.data});

            case "showToast":
                var toastTitle:String = params.title != null ? params.title : "";
                var toastDesc:String = params.description != null ? params.description : "";
                var toastLabel:String = params.label != null ? params.label : "";
                var toastAlign:String = params.align != null ? params.align : "left";
                var toastImageUrl:String = params.imageUrl != null ? params.imageUrl : "";
                Toast.show(toastTitle, toastDesc, toastLabel, toastAlign, toastImageUrl);
                sendResponse(id, {success: true});

            case "searchTargetForValue":
                var find:String = Std.string(params.value);
                Evaluate.ROOT_SENTINEL.__raflash_gameRoot = gameRoot;
                var startTarget:Dynamic = Evaluate.ROOT_SENTINEL;
                var pathPrefix:String = "root";
                if (params.pathFormula != null) {
                    var pf:Array<Dynamic> = params.pathFormula;
                    if (pf.length > 0) {
                        var pathResult = Evaluate.evaluate(pf, 1, pf.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
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
                if (params.searchMode == "name") {
                    Evaluate.searchTargetForName(startTarget, find.toLowerCase(), pathPrefix, searchOutput, new flash.utils.Dictionary(true));
                } else {
                    Evaluate.searchTargetForValue(startTarget, find, pathPrefix, searchOutput, new flash.utils.Dictionary(true));
                }
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
                } else if (Std.string(params.key) == "benchmarkingEnabled") {
                    Achievement.benchmarkingActive = params.value == true;
                }
                sendResponse(id, {success: true});

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

            case "setRecording":
                recording = (params.recording == true);
                if (recording) {
                    setupRecordingListener();
                } else {
                    teardownRecordingListener();
                }
                sendResponse(id, {success: true});

            case "loadCompiledAvm2":
                // Load native-compiled achievement SWF (AVM2 bytecode)
                var naUrl:String = params.url;
                var naIndices:Array<Dynamic> = params.compiledIndices;
                var naRpIndices:Array<Dynamic> = params.rpCompiledIndices;
                var naId:Dynamic = id;

                // Reset native state
                Achievement.nativeAchReady = false;
                Achievement.nativeAchFnMap = new Map();
                Achievement.nativeAchStorage = [];
                Achievement.nativeRpFnMap = new Map();

                // Build index → function-array-index maps
                var ci:Int = 0;
                while (ci < naIndices.length) {
                    Achievement.nativeAchFnMap.set(Std.int(naIndices[ci]), ci);
                    ci++;
                }
                var ri:Int = 0;
                while (ri < naRpIndices.length) {
                    Achievement.nativeRpFnMap.set(Std.int(naRpIndices[ri]), ri);
                    ri++;
                }

                // Load the compiled SWF into an isolated application domain.
                // The Loader MUST be on the display list to prevent Flash Player
                // from GC-ing the loaded ApplicationDomain (and invalidating all
                // function closures). This mirrors AVM1's approach of hosting the
                // compiled SWF in a persistent MovieClip child.
                // Remove previous loader if present
                if (Achievement.nativeAchLoader != null) {
                    try { instance.removeChild(cast Achievement.nativeAchLoader); } catch (e:Dynamic) {}
                }
                var naLoader:Loader = new Loader();
                naLoader.visible = false;
                instance.addChild(naLoader);
                Achievement.nativeAchLoader = naLoader;
                var naContext:LoaderContext = new LoaderContext(false, new ApplicationDomain(null));
                naLoader.contentLoaderInfo.addEventListener(Event.COMPLETE, function(e:Event):Void {
                    try {
                        var domain:ApplicationDomain = naLoader.contentLoaderInfo.applicationDomain;
                        var cls:Dynamic = domain.getDefinition("__NativeEval");
                        if (cls != null) {
                            var achArr:Dynamic = untyped cls.ach;
                            var rpArr:Dynamic = untyped cls.rp;
                            if (achArr != null) {
                                Achievement.nativeAchFns = achArr;
                                Achievement.nativeRpFns = rpArr;
                                Achievement.nativeAchReady = true;
                                sendResponse(naId, {success: true});
                            } else {
                                sendResponse(naId, {success: false, error: "__NativeEval.ach not defined"});
                            }
                        } else {
                            sendResponse(naId, {success: false, error: "__NativeEval class not found"});
                        }
                    } catch (err:Dynamic) {
                        sendResponse(naId, {success: false, error: "Error accessing __NativeEval: " + Std.string(err)});
                    }
                });
                naLoader.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR, function(e:IOErrorEvent):Void {
                    sendResponse(naId, {success: false, error: "IO error loading compiled SWF: " + e.text});
                });
                naLoader.load(new URLRequest(naUrl), naContext);

            default:
                sendResponse(id, {success: false, error: "Unknown command: " + command});
        }
    }

    // === Game Loading ===

    /**
     * In child mode, the firmware is loaded as a child of the game's root.
     * Walk up the parent chain from this firmware instance until we find the
     * display object whose parent is the Stage — that's the game's root.
     *
     * Display hierarchy in child mode:
     *   Stage
     *     └── GameDocumentClass  ← game root (what we want)
     *          ├── [game content...]
     *          └── Loader (name="__raflash")
     *               └── Main (this firmware)
     */
    private function resolveChildModeGameRoot():flash.display.DisplayObject {
        var current:flash.display.DisplayObject = this;
        while (current.parent != null && !Std.isOfType(current.parent, flash.display.Stage)) {
            current = current.parent;
        }
        return current;
    }

    private function loadGame(?url:String):Void {
        var loader = new Loader();
        loader.contentLoaderInfo.addEventListener(Event.COMPLETE, onGameLoaded);
        loader.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR, onGameLoadError);

        var gameUrl = (url != null) ? url : "http://raflash.local/game.swf";
        var context = new LoaderContext(false, new ApplicationDomain(null));
        loader.load(new URLRequest(gameUrl), context);

        addChild(loader);
    }

    private function onGameLoaded(e:Event):Void {
        gameLoaded = true;

        var loader:Loader = cast(e.target, flash.display.LoaderInfo).loader;
        gameRoot = loader.content;
        var bytes = loader.contentLoaderInfo.bytesTotal;

        sendMessage("gameLoaded", {bytes: bytes});

        // Suppress uncaught error events from the game (IOError, SecurityError, etc.)
        // Try multiple targets since the effective root varies between child/parent mode.
        var _self = this;
        for (target in ([
            untyped gameRoot.loaderInfo,
            untyped gameRoot.stage.loaderInfo,
            untyped flash.Lib.current.loaderInfo
        ] : Array<Dynamic>)) {
            try {
                untyped target.uncaughtErrorEvents.addEventListener(
                    "uncaughtError", function(evt:Dynamic) {
                        untyped evt.preventDefault();
                        try {
                            var err:Dynamic = untyped evt.error;
                            var msg:String = Std.isOfType(err, String) ? err : Std.string(untyped err.message);
                            _self.sendMessage("log", {message: "Suppressed game error: " + msg});
                        } catch (e3:Dynamic) {
                            _self.sendMessage("log", {message: "Suppressed unknown game error"});
                        }
                    }
                );
            } catch (e2:Dynamic) {}
        }

        // Setup F12 key listener and frame loop after game loads
        setupKeyListener();
        addEventListener(Event.ENTER_FRAME, onEnterFrame);
    }

    private function onGameLoadError(e:IOErrorEvent):Void {
        var loader:Loader = cast(e.target, flash.display.LoaderInfo).loader;
        if (loader.parent != null) loader.parent.removeChild(loader);
        log("Failed to load game: " + e.text);
        sendMessage("gameLoadError", {error: e.text});
    }

    // === Frame Loop ===

    private function onEnterFrame(e:Event):Void {
        var frameStart:Float = Achievement.benchmarkingActive ? haxe.Timer.stamp() * 1000 : 0;
        Evaluate.snapshotHooks();
        Achievement.checkAchievements(gameRoot, sendMessage, sendEditData);
        if (Achievement.benchmarkingActive) {
            var wStart:Float = haxe.Timer.stamp() * 1000;
            processWatchers();
            sendMessage("benchmark", {kind: "Watchers", ms: haxe.Timer.stamp() * 1000 - wStart});
            sendMessage("benchmark", {kind: "Frame Total", ms: haxe.Timer.stamp() * 1000 - frameStart});
        } else {
            processWatchers();
        }
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
                var result = Evaluate.evaluate(bytecode, 1, bytecode.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
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
                if (buf == null) {
                    buf = [];
                    watcher.buffer = buf;
                }
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

    // === Recording: capture user clicks and forward paths to the engine ===

    private function setupRecordingListener():Void {
        if (recordingMouseListener != null) return;
        recordingMouseListener = function(e:MouseEvent):Void {
            try {
                if (!recording) return;
                var target:flash.display.DisplayObject = cast e.target;
                var path:String = buildStagePath(target);
                if (path != null) {
                    sendMessage("userInput", {kind: "click", path: path});
                }
            } catch (err:Dynamic) {
                log("recording MOUSE_DOWN error: " + Std.string(err));
            }
        };
        // Capture on MOUSE_DOWN (not UP): click handlers on the target often
        // remove the element (e.g., PLAY button advancing from a title
        // screen), so by MOUSE_UP time event.target may be gone or
        // redirected. Capture phase so we see the real target before any
        // game handler calls stopPropagation.
        stage.addEventListener(MouseEvent.MOUSE_DOWN, recordingMouseListener, true);
    }

    private function teardownRecordingListener():Void {
        if (recordingMouseListener == null) return;
        stage.removeEventListener(MouseEvent.MOUSE_DOWN, recordingMouseListener, true);
        recordingMouseListener = null;
    }

    /**
     * Walk parent chain from target up to gameRoot, emitting "stage.a.b.c".
     * Returns null if gameRoot is never reached (click was on firmware chrome).
     */
    private function buildStagePath(target:flash.display.DisplayObject):String {
        if (target == null || gameRoot == null) return null;
        var segments:Array<String> = [];
        var current:flash.display.DisplayObject = target;
        var guard:Int = 0;
        var reachedGameRoot:Bool = false;
        while (current != null && guard++ < 50) {
            if (current == gameRoot) { reachedGameRoot = true; break; }
            var n:String = current.name;
            if (n == null || n == "") break;
            segments.unshift(n);
            current = current.parent;
        }
        if (!reachedGameRoot) return null;
        if (segments.length == 0) return "stage";
        return "stage." + segments.join(".");
    }

    // === Entry Point ===

    public static function main():Void {
        // Detect child mode early (before Main constructor) to avoid
        // stomping on the game's stage properties.
        var isChild:Bool = false;
        try {
            var url:String = flash.Lib.current.loaderInfo.url;
            isChild = (url != null && url.indexOf("mode=child") != -1);
        } catch (e:Dynamic) {}

        if (!isChild) {
            flash.Lib.current.stage.align = StageAlign.TOP_LEFT;
            flash.Lib.current.stage.scaleMode = StageScaleMode.NO_SCALE;
        }

        var main = new Main();
        flash.Lib.current.addChild(main);
    }
}
