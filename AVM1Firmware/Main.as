/**
 * AVM1 Firmware - Direct Deno Communication
 *
 * AS2 firmware that communicates directly with Deno via XMLSocket.
 * Used for playing AS2 games (AVM1) with direct access to game internals.
 *
 * Compiled with MTASC, run via Flash Player launched by Deno.
 */
import JSON;
import JSONDiff;
import AppData;
import Toast;
import PrimedBadges;

class Main {
    // Socket connection to Deno server
    private static var socket:XMLSocket;
    private static var connected:Boolean = false;

    // Game container
    private static var gameContainer:MovieClip;
    private static var gameLoaded:Boolean = false;

    // Configuration
    private static var PORT:Number = 18081;

    // Profiling
    private static var profilingData:Object = {};
    private static var lastProfilingReport:Number = 0;
    private static var PROFILING_INTERVAL:Number = 5000;  // 5 seconds

    // Optimization tracking
    private static var objAccessOptimized:Number = 0;
    private static var objAccessGeneric:Number = 0;
    private static var arrAccessOptimized:Number = 0;
    private static var arrAccessGeneric:Number = 0;

    // Extended profiling
    private static var totalFrameTimeMs:Number = 0;
    private static var diffOpsTimeMs:Number = 0;
    private static var stageCountTimeMs:Number = 0;
    private static var frameCount:Number = 0;

    // Badge image preload cache
    private static var badgeImageCache:Object = {};
    private static var preloadQueue:Array = [];
    private static var currentPreloadId:Number = 0;
    private static var preloadContainer:MovieClip;

    // Runtime settings (from UI checkboxes)
    private static var processingActive:Boolean = true;

    // Delta values storage - keyed by requirement ID
    // Format: { reqId: { prevA: value, prevB: value } }
    private static var deltaValues:Object = {};

    // Remembered values for {expr} syntax — persists across evaluation frames
    private static var rememberedValues:Object = {};

    // Memory Watch: active watchers keyed by watcherId
    // Format: { watcherId: { bytecode: Array, buffer: Array, lastFlush: Number } }
    private static var memoryWatchers:Object = {};
    private static var memoryWatchFrameCount:Number = 0;

    // Rich Presence throttling (evaluate once per second, not every frame)
    private static var lastRichPresenceTime:Number = 0;
    private static var RICH_PRESENCE_INTERVAL:Number = 1000; // 1 second

    // Socket receive buffer for fragmented messages
    private static var receiveBuffer:String = "";

    // Reconnection
    private static var reconnectTimer:Number = -1;
    private static var reconnectAttempts:Number = 0;
    private static var MAX_RECONNECT_ATTEMPTS:Number = 15;
    private static var disconnectOverlay:MovieClip = null;
    private static var initialSetupDone:Boolean = false;

    /**
     * Initialize the firmware.
     * Called from AVM1Entry.main() for production, or can be called directly in tests.
     */
    public static function init():Void {
        Stage.scaleMode = "noScale";
        Stage.align = "TL";
        fscommand("showmenu", "false");
        var cm:ContextMenu = new ContextMenu();
        cm.hideBuiltInItems();
        _root.menu = cm;
        connectToServer();
    }

    private static function connectToServer():Void {
        socket = new XMLSocket();
        receiveBuffer = "";

        socket.onConnect = function(success:Boolean):Void {
            if (success) {
                Main.connected = true;
                Main.reconnectAttempts = 0;
                if (Main.reconnectTimer != -1) {
                    clearInterval(Main.reconnectTimer);
                    Main.reconnectTimer = -1;
                }
                Main.hideDisconnectOverlay();

                if (!Main.gameLoaded) {
                    Main.sendMessage("ready", {});
                } else {
                    trace("[AS2] Reconnected to Deno server");
                }
            } else {
                if (Main.gameLoaded) {
                    Main.scheduleReconnect();
                }
            }
        };

        socket.onData = function(data:String):Void {
            Main.handleData(data);
        };

        socket.onClose = function():Void {
            Main.connected = false;
            if (Main.gameLoaded) {
                Main.showDisconnectOverlay(false);
                Main.scheduleReconnect();
            }
            // Before game loads, let Flash handle connection lifecycle naturally
            // (policy file handshake causes a close/reconnect cycle)
        };

        socket.connect("127.0.0.1", PORT);
    }

    private static function scheduleReconnect():Void {
        if (reconnectTimer != -1) return;
        reconnectTimer = setInterval(function():Void {
            Main.reconnectAttempts++;
            if (Main.reconnectAttempts > Main.MAX_RECONNECT_ATTEMPTS) {
                clearInterval(Main.reconnectTimer);
                Main.reconnectTimer = -1;
                Main.showDisconnectOverlay(true);
                return;
            }
            Main.connectToServer();
        }, 1000);
    }

    private static function showDisconnectOverlay(permanent:Boolean):Void {
        hideDisconnectOverlay();

        var stageW:Number = Stage.width;
        var barHeight:Number = permanent ? 50 : 30;
        var bgAlpha:Number = permanent ? 90 : 75;

        var mc:MovieClip = _root.createEmptyMovieClip("_disconnectOverlay", 999800);
        mc.beginFill(0x1F2937, bgAlpha);
        mc.moveTo(0, 0);
        mc.lineTo(stageW, 0);
        mc.lineTo(stageW, barHeight);
        mc.lineTo(0, barHeight);
        mc.lineTo(0, 0);
        mc.endFill();

        mc.createTextField("label", 1, 0, 0, stageW, barHeight);
        var tf:TextField = mc.label;
        var fmt:TextFormat = new TextFormat();
        fmt.font = "_sans";
        fmt.size = permanent ? 14 : 12;
        fmt.color = 0xFFFFFF;
        fmt.align = "center";
        tf.setNewTextFormat(fmt);
        tf.selectable = false;
        tf.text = permanent
            ? "Connection lost. Achievements are not being tracked."
            : "Reconnecting...";

        disconnectOverlay = mc;
    }

    private static function hideDisconnectOverlay():Void {
        if (disconnectOverlay != null) {
            disconnectOverlay.removeMovieClip();
            disconnectOverlay = null;
        }
    }

    /**
     * Load the game SWF from the server
     */
    private static function loadGame(url:String):Void {
        // Create container for the game (low depth so loading text renders on top)
        gameContainer = _root.createEmptyMovieClip("gameContainer", _root.getNextHighestDepth());
        var gameLoader:MovieClip = gameContainer.createEmptyMovieClip("gameLoader", 1);
        gameLoader._lockroot = true;

        // Load game from server (or spoofed domain URL for sitelock bypass)
        var gameUrl:String = (url != undefined && url != null) ? url : "http://raflash.local/game.swf";
        gameLoader.loadMovie(gameUrl);

        // Monitor loading progress and check achievements
        _root.onEnterFrame = function():Void {
            Main.onFrame();
        };
    }

    /**
     * Per-frame handler for loading progress and achievements
     */
    private static function onFrame():Void {
        if (!gameLoaded) {
            checkLoadProgress();
        } else {
            checkAchievements();
            processWatchers();
        }
    }

    /**
     * Check if game has finished loading
     */
    private static function checkLoadProgress():Void {
        var loader:MovieClip = gameContainer.gameLoader;
        var bytesLoaded:Number = loader.getBytesLoaded();
        var bytesTotal:Number = loader.getBytesTotal();

        if (bytesTotal > 0 && bytesLoaded >= bytesTotal && !gameLoaded) {
            gameLoaded = true;
            sendMessage("gameLoaded", { bytes: bytesTotal });

            // Set up F12 key listener after game loads
            var keyListener:Object = {};
            keyListener.onKeyDown = function():Void {
                if (Key.getCode() == 123) { // F12
                    Main.sendMessage("keypress", { keyCode: 123 });
                }
            };
            Key.addListener(keyListener);

            // Start preloading badge images in background
            startBadgePreload();
        }
    }

    /**
     * Handle incoming data from socket
     */
    private static function handleData(data:String):Void {
        // XMLSocket fires onData once per null-terminated message, so each call
        // is a complete message. However, very large messages may arrive fragmented
        // across multiple onData calls — buffer and try to parse.
        if (data.length == 0) return;

        receiveBuffer += data;

        try {
            var parsed:Object = JSON.parse(receiveBuffer);

            // Parse succeeded — clear buffer and process
            receiveBuffer = "";

            if (parsed instanceof Array && parsed.length >= 3) {
                var parsedArr:Array = Array(parsed);
                var type:String = String(parsedArr[0]);
                var id:String = String(parsedArr[1]);
                var payload:Object = parsedArr[2];

                if (type == "REQUEST") {
                    handleRequest(id, payload);
                }
            }
        } catch (e:Error) {
            // Parse failed — likely an incomplete fragment, keep buffering.
            // If buffer is too large, it's unrecoverable — clear and log.
            if (receiveBuffer.length > 1000000) {
                log("Buffer overflow (" + receiveBuffer.length + " bytes), discarding. First 80 chars: " + receiveBuffer.substring(0, 80));
                receiveBuffer = "";
            }
        }
    }

    /**
     * Handle a request from the server
     */
    private static function handleRequest(id:String, payload:Object):Void {
        var command:String = String(payload.command);
        var params:Object = payload.params || {};

        switch (command) {
            case "ping":
                sendResponse(id, { success: true, result: "pong" });
                break;

            case "setup":
                if (initialSetupDone) {
                    // Reconnect: firmware state is authoritative, push it back to Deno
                    sendResponse(id, { success: true });
                    sendMessage("syncState", { appData: AppData.data });
                } else {
                    // First connect: accept Deno's data and load game
                    AppData.data = params.data;
                    AppData.originalData = JSON.parse(JSON.stringify(params.data));
                    initialSetupDone = true;
                    sendResponse(id, { success: true });
                    loadGame(params.gameUrl);
                }
                break;

            case "evaluate":
                var formula:Array = params.formula;
                var result:Array = evaluate(formula, 1, formula.length, [gameContainer.gameLoader._root], ["stage"]);
                var formatted:Object = formatOutput(result, 0);
                sendResponse(id, { success: true, result: formatted });
                break;

            case "evaluateMultiple":
                var formulas:Array = params.formulas;
                var results:Array = [];
                for (var f:Number = 0; f < formulas.length; f++) {
                    var formulaItem:Array = formulas[f];
                    var resultItem:Array = evaluate(formulaItem, 1, formulaItem.length, [gameContainer.gameLoader._root], ["stage"]);
                    var formattedItem:Object = formatOutput(resultItem, 0);
                    results.push(formattedItem);
                }
                sendResponse(id, { success: true, results: results });
                break;

            case "getRichPresenceResult":
                var rpAssetId:Number = Number(params.assetId);
                var rpResult:String = null;

                for (var rpi:Number = 0; rpi < AppData.data.assets.length; rpi++) {
                    var rpAsset:Object = AppData.data.assets[rpi];
                    if (rpAsset.id == rpAssetId && rpAsset.type == "RICH_PRESENCE") {
                        rpResult = rpAsset._richPresenceResult;
                        break;
                    }
                }

                sendResponse(id, { success: true, result: rpResult });
                break;

            case "searchTargetForValue":
                var find:String = String(params.value);
                var searchResult:Array = [];

                // Determine starting target and path prefix
                var startTarget:Object;
                var pathPrefix:String;

                if (params.pathFormula != null && params.pathFormula.length > 0) {
                    // Evaluate the path formula to get starting target
                    var pathResult:Array = evaluate(params.pathFormula, 1, params.pathFormula.length, [gameContainer.gameLoader._root], ["stage"]);
                    if (pathResult != null && pathResult.length > 0) {
                        startTarget = pathResult[0];
                        pathPrefix = String(params.pathString);
                    } else {
                        // Path evaluation failed
                        sendResponse(id, { success: false, error: "Invalid path" });
                        break;
                    }
                } else {
                    // Default: start from stage
                    startTarget = gameContainer.gameLoader._root;
                    pathPrefix = "stage";
                }

                if (params.searchMode == "name") {
                    searchTargetForName(startTarget, find.toLowerCase(), pathPrefix, searchResult, []);
                } else {
                    searchTargetForValue(startTarget, find, pathPrefix, searchResult, []);
                }
                var searchFormatted:Object = formatOutput(searchResult, 0);
                sendResponse(id, { success: true, result: searchFormatted });
                break;

            case "editData":
                var changes:Object = params.changes;
                JSONDiff.applyDataDiff(AppData.data, changes);
                // IMPORTANT: Update originalData to prevent ping-pong!
                // Without this, checkAchievements() would see the incoming changes as "new"
                // and send them back to the server, causing an infinite loop.
                AppData.originalData = JSON.parse(JSON.stringify(AppData.data));
                sendResponse(id, { success: true });
                break;

            case "getData":
                // Return current app data
                sendResponse(id, { success: true, data: AppData.data });
                break;

            case "showToast":
                var toastTitle:String = String(params.title || "");
                var toastDesc:String = String(params.description || "");
                var toastLabel:String = String(params.label || "");
                var toastAlign:String = String(params.align || "right");
                var toastImageUrl:String = String(params.imageUrl || "");
                Toast.show(toastTitle, toastDesc, toastLabel, toastAlign, toastImageUrl);
                sendResponse(id, { success: true });
                break;

            case "showMeasure":
                var measureTitle:String = String(params.title || "");
                var measureDesc:String = String(params.description || "");
                var measureProgress:String = String(params.progress || "1/5");
                var measureImageUrl:String = String(params.imageUrl || "");
                Measure.show(measureTitle, measureDesc, measureProgress, measureImageUrl);
                sendResponse(id, { success: true });
                break;

            case "setRuntimeSetting":
                if (params.key == "processingActive") {
                    processingActive = (params.value == true);
                }
                sendResponse(id, { success: true });
                break;

            case "startWatch":
                var watcherId:String = String(params.watcherId);
                memoryWatchers[watcherId] = {
                    bytecode: params.bytecode,
                    buffer: [],
                    lastFlush: getTimer()
                };
                sendResponse(id, { success: true });
                break;

            case "stopWatch":
                var watcherIdStop:String = String(params.watcherId);
                delete memoryWatchers[watcherIdStop];
                sendResponse(id, { success: true });
                break;

            default:
                sendResponse(id, { success: false, error: "Unknown command: " + command });
        }
    }

    /**
     * Send a response to a request
     */
    private static function sendResponse(id:String, data:Object):Void {
        var message:Array = ["RESPONSE", id, data];
        var json:String = JSON.stringify(message);
        socket.send(json + chr(0));
    }

    /**
     * Send an unsolicited message to the server
     */
    private static function sendMessage(type:String, data:Object):Void {
        var message:Object = { type: type, data: data };
        var json:String = JSON.stringify(message);
        socket.send(json + chr(0));
    }

    /**
     * Send edit data changes to the server
     */
    private static function sendEditData(data:Object):Void {
        if (!JSONDiff.isPointlessDiff(data)) {
            sendMessage("editData", data);
        }
    }

    /**
     * Log a message to the Deno server console
     */
    public static function log(message:String):Void {
        sendMessage("log", { message: message });
    }

    // ========================================================================
    // Badge Image Preloading
    // ========================================================================

    /**
     * Start preloading badge images in background
     */
    private static function startBadgePreload():Void {
        // Create off-screen container for preloaded images
        preloadContainer = _root.createEmptyMovieClip("preloadContainer", -16383);
        preloadContainer._visible = false;

        // Queue all assets with badge images
        for (var i:Number = 0; i < AppData.data.assets.length; i++) {
            var asset:Object = AppData.data.assets[i];
            if (asset.badgeImage) {
                preloadQueue.push(asset.id);
            }
        }

        // Start loading first image
        preloadNext();
    }

    /**
     * Load next badge image from queue
     */
    private static function preloadNext():Void {
        if (preloadQueue.length == 0) return;

        var assetId:Number = Number(preloadQueue.shift());
        currentPreloadId = assetId;

        var holder:MovieClip = preloadContainer.createEmptyMovieClip("img_" + assetId, preloadContainer.getNextHighestDepth());

        var loader:MovieClipLoader = new MovieClipLoader();
        var listener:Object = {};

        listener.onLoadInit = function(target:MovieClip):Void {
            Main.badgeImageCache[Main.currentPreloadId] = target;
            Main.preloadNext();
        };

        listener.onLoadError = function(target:MovieClip, error:String):Void {
            // Skip failed images, continue preloading
            Main.preloadNext();
        };

        loader.addListener(listener);
        loader.loadClip("http://raflash.local/asset-image/" + assetId, holder);
    }

    /**
     * Get cached badge image for an asset
     */
    public static function getBadgeImage(assetId:Number):MovieClip {
        return badgeImageCache[assetId];
    }

    // ========================================================================
    // DiffBuilder - Lightweight direct diff construction
    // ========================================================================

    private static var diffEdits:Array = [];

    /**
     * Record a change: updates the object AND tracks the diff path
     */
    private static function diffSet(target:Object, key:String, value, path:String):Void {
        target[key] = value;
        diffEdits.push([path, value]);
    }

    /**
     * Build diff and clear pending edits
     */
    private static function diffFlush():Object {
        if (diffEdits.length == 0) return null;
        var diff:Object = { edited: diffEdits.slice() };
        diffEdits = [];
        return diff;
    }

    /**
     * Check if there are pending changes
     */
    private static function diffHasPending():Boolean {
        return diffEdits.length > 0;
    }

    /**
     * Store a delta value for a requirement (firmware-local, not transmitted)
     */
    private static function storeDeltaValue(reqId:Number, side:String, value):Void {
        if (deltaValues[reqId] == null) {
            deltaValues[reqId] = {};
        }
        if (side == "A") {
            deltaValues[reqId].hasA = true;
            deltaValues[reqId].prevA = value;
        } else {
            deltaValues[reqId].hasB = true;
            deltaValues[reqId].prevB = value;
        }
    }

    /**
     * Clear all delta values for an asset's requirements
     */
    private static function clearAssetDeltaValues(asset:Object):Void {
        for (var gj:Number = 0; gj < asset.groups.length; ++gj) {
            var grp:Object = asset.groups[gj];
            for (var rk:Number = 0; rk < grp.requirements.length; ++rk) {
                var req:Object = grp.requirements[rk];
                delete deltaValues[req.id];
            }
        }
    }

    // ========================================================================
    // Requirement Condition Evaluation Helper
    // ========================================================================

    /**
     * Evaluate a single requirement's condition.
     * Handles formula evaluation, caching, and delta types.
     * Returns {passed: Boolean, valid: Boolean}
     *
     * @param requirement The requirement object to evaluate
     * @param frameCache Cache object for formula results this frame
     */
    private static function evaluateRequirementCondition(requirement:Object, frameCache:Object, accumulator:Number):Object {
        // Check if compiled formulas exist
        if (requirement.compiledA == null || requirement.compiledB == null) {
            return {passed: false, valid: false};
        }

        // Use addressA/addressB as cache keys
        var cacheKeyA:String = requirement.addressA;
        var cacheKeyB:String = requirement.addressB;

        // Evaluate current values (with caching)
        var currentA:Array = frameCache[cacheKeyA];
        if (currentA == null) {
            currentA = evaluate(requirement.compiledA, 1, requirement.compiledA.length, [gameContainer.gameLoader._root], ["stage"]);
            frameCache[cacheKeyA] = currentA;
        }

        var currentB:Array = frameCache[cacheKeyB];
        if (currentB == null) {
            currentB = evaluate(requirement.compiledB, 1, requirement.compiledB.length, [gameContainer.gameLoader._root], ["stage"]);
            frameCache[cacheKeyB] = currentB;
        }

        // Evaluate failed
        if (currentA == null || currentB == null) {
            return {passed: false, valid: false};
        }

        // Only allow single-value results (empty array is valid for null comparison)
        if (currentA.length > 1 || currentB.length > 1) {
            return {passed: false, valid: false};
        }

        // Handle Delta type for A side
        var resultA:Array;
        if (requirement.typeA == "DELTA") {
            var deltaData:Object = deltaValues[requirement.id];
            if (deltaData == null || !deltaData.hasA) {
                storeDeltaValue(requirement.id, "A", currentA.length == 1 ? currentA[0] : undefined);
                return {passed: false, valid: false};
            }
            resultA = (deltaData.prevA === undefined) ? [] : [deltaData.prevA];
            storeDeltaValue(requirement.id, "A", currentA.length == 1 ? currentA[0] : undefined);
        } else {
            resultA = currentA;
        }

        // Handle Delta type for B side
        var resultB:Array;
        if (requirement.typeB == "DELTA") {
            var deltaBData:Object = deltaValues[requirement.id];
            if (deltaBData == null || !deltaBData.hasB) {
                storeDeltaValue(requirement.id, "B", currentB.length == 1 ? currentB[0] : undefined);
                return {passed: false, valid: false};
            }
            resultB = (deltaBData.prevB === undefined) ? [] : [deltaBData.prevB];
            storeDeltaValue(requirement.id, "B", currentB.length == 1 ? currentB[0] : undefined);
        } else {
            resultB = currentB;
        }

        // Resolve values: empty array means "not found" (null-like)
        var aEmpty:Boolean = (resultA.length == 0);
        var bEmpty:Boolean = (resultB.length == 0);
        var aIsNull:Boolean = aEmpty || resultA[0] === null;
        var bIsNull:Boolean = bEmpty || resultB[0] === null;

        // Null comparison: mirror the EQUAL opcode's null-aware logic
        if (aIsNull || bIsNull) {
            var bothNull:Boolean = (aIsNull && bIsNull);
            var passed:Boolean = false;
            switch (requirement.cmp) {
                case "==": passed = bothNull; break;
                case "!=": passed = !bothNull; break;
                default:   passed = false; break;
            }
            return {passed: passed, valid: true, valueA: 0};
        }

        var rawA = resultA[0];
        var rawB = resultB[0];

        // Add accumulator from AddSource/SubSource chain to left side
        if (accumulator != 0) {
            rawA = Number(rawA) + accumulator;
        }

        // Evaluate condition
        var passed:Boolean = false;
        switch (requirement.cmp) {
            case "==": passed = (rawA == rawB); break;
            case "!=": passed = (rawA != rawB); break;
            case ">":  passed = (rawA > rawB); break;
            case ">=": passed = (rawA >= rawB); break;
            case "<":  passed = (rawA < rawB); break;
            case "<=": passed = (rawA <= rawB); break;
        }

        return {passed: passed, valid: true, valueA: rawA};
    }

    /**
     * Evaluate a requirement's left-side value for AddSource/SubSource accumulation.
     * Returns the numeric value, or NaN if invalid.
     */
    private static function evaluateRequirementValueA(requirement:Object, frameCache:Object):Number {
        if (requirement.compiledA == null) return NaN;

        var cacheKeyA:String = requirement.addressA;
        var currentA:Array = frameCache[cacheKeyA];
        if (currentA == null) {
            currentA = evaluate(requirement.compiledA, 1, requirement.compiledA.length, [gameContainer.gameLoader._root], ["stage"]);
            frameCache[cacheKeyA] = currentA;
        }

        if (currentA == null || currentA.length != 1) return NaN;

        // Handle Delta type
        if (requirement.typeA == "DELTA") {
            var deltaData:Object = deltaValues[requirement.id];
            if (deltaData == null || !deltaData.hasA) {
                storeDeltaValue(requirement.id, "A", currentA[0]);
                return NaN;
            }
            var prev:Number = Number(deltaData.prevA);
            storeDeltaValue(requirement.id, "A", currentA[0]);
            return prev;
        }

        return Number(currentA[0]);
    }

    /**
     * Evaluate a chain of AndNext/OrNext requirements ending at a terminal.
     * Returns the combined result of the chain.
     *
     * @param group The group containing the requirements
     * @param startIndex The index of the first AndNext/OrNext in the chain
     * @param frameCache Cache object for formula results this frame
     * @param skipIndices Object with indices to skip (e.g., pauseIfIndices)
     * @return Object {chainResult: Boolean, terminalIndex: Number, valid: Boolean}
     */
    private static function evaluateChain(group:Object, startIndex:Number, frameCache:Object, skipIndices:Object):Object {
        var k:Number = startIndex;
        var req:Object = group.requirements[k];

        // Evaluate the first condition
        var evalResult:Object = evaluateRequirementCondition(req, frameCache, 0);
        if (!evalResult.valid) {
            // If first condition is invalid, find terminal and return false
            while (k + 1 < group.requirements.length) {
                k++;
                // Skip indices we should skip
                while (k < group.requirements.length && skipIndices[k]) k++;
                if (k >= group.requirements.length) break;
                var nextReq:Object = group.requirements[k];
                if (nextReq.flag != "AND_NEXT" && nextReq.flag != "OR_NEXT") {
                    return {chainResult: false, terminalIndex: k, valid: false};
                }
            }
            return {chainResult: false, terminalIndex: k, valid: false};
        }

        var chainResult:Boolean = evalResult.passed;
        var currentOp:String = req.flag;  // "AND_NEXT" or "OR_NEXT"

        // Walk the chain
        while (k + 1 < group.requirements.length) {
            k++;
            // Skip indices we should skip
            while (k < group.requirements.length && skipIndices[k]) k++;
            if (k >= group.requirements.length) {
                // Chain ended without terminal - invalid
                return {chainResult: false, terminalIndex: k - 1, valid: false};
            }

            var nextReq:Object = group.requirements[k];
            var nextEval:Object = evaluateRequirementCondition(nextReq, frameCache, 0);

            // Apply the operator from the previous requirement
            if (currentOp == "AND_NEXT") {
                chainResult = chainResult && (nextEval.valid && nextEval.passed);
            } else {  // OR_NEXT
                chainResult = chainResult || (nextEval.valid && nextEval.passed);
            }

            // Check if this is the terminal (not AndNext/OrNext)
            if (nextReq.flag != "AND_NEXT" && nextReq.flag != "OR_NEXT") {
                return {chainResult: chainResult, terminalIndex: k, valid: true};
            }

            // Continue chain - update operator for next iteration
            currentOp = nextReq.flag;
        }

        // Reached end of requirements without terminal - invalid
        return {chainResult: false, terminalIndex: k, valid: false};
    }

    // ========================================================================
    // Formula Evaluation Engine (ported from Main.as)
    // ========================================================================

    /**
     * Evaluate a compiled formula expression
     * This is a stack-based bytecode interpreter supporting:
     * - Arithmetic: ADD, SUB, MUL, DIV, MOD, POW
     * - Comparison: EQUAL, NOT_EQUAL, GREATER, GREATER_EQUAL, LESSER, LESSER_EQUAL
     * - Boolean: AND, OR, XOR
     * - Access: READ_GLOBAL, OBJECT_ACCESS, ARRAY_ACCESS
     */
    private static function evaluate(formula:Array, start:Number, end:Number, context:Array, keys:Array):Array {
        var stack:Array = [];
        for (var i:Number = start; i < end; ++i) {
            var token:String = formula[i];
            switch (token) {
                case "VALUE": {
                    stack.push([parseInt(formula[++i], 10)]);
                    break;
                }
                case "STRING": {
                    stack.push([formula[++i]]);
                    break;
                }
                case "NULL": {
                    stack.push([null]);
                    break;
                }
                case "IDENTIFIER": {
                    var identifier:String = formula[++i];
                    stack.push([identifier]);
                    break;
                }
                case "ADD": {
                    var b = stack.pop();
                    var a = stack.pop();

                    var length = Math.max(a.length, b.length);

                    if (a.length > 0 && b.length == 0) {
                        stack.push(a);
                    } else if (b.length > 0 && a.length == 0) {
                        stack.push(b);
                    } else if (a.length != b.length && a.length != 1 && b.length != 1) {
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    } else {
                        var aPlural = a.length != 1;
                        var bPlural = b.length != 1;
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            var aValue = aPlural ? a[j] : a[0];
                            var bValue = bPlural ? b[j] : b[0];
                            if (typeof(aValue) == "string" || typeof(bValue) == "string") {
                                result.push(String(aValue) + String(bValue));
                            } else if (typeof(aValue) == "number" && typeof(bValue) == "number") {
                                result.push(aValue + bValue);
                            } else {
                                result.push(NaN);
                            }
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "SUB": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] - b[j]);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] - b[0]);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] - b[j]);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "MUL": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] * b[j]);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] * b[0]);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] * b[j]);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "DIV": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] / b[j]);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] / b[0]);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] / b[j]);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "MOD": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] % b[j]);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] % b[0]);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] % b[j]);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "POW": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(Math.pow(a[0], b[j]));
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(Math.pow(a[j], b[0]));
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(Math.pow(a[j], b[j]));
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "EQUAL": {
                    var b = stack.pop();
                    var a = stack.pop();
                    // null comparison: check if array is empty
                    if (b.length == 1 && b[0] === null) {
                        stack.push([a.length == 0 ? 1 : 0]);
                        break;
                    }
                    if (a.length == 1 && a[0] === null) {
                        stack.push([b.length == 0 ? 1 : 0]);
                        break;
                    }
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] == b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] == b[0] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] == b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "NOT_EQUAL": {
                    var b = stack.pop();
                    var a = stack.pop();
                    // null comparison: check if array is not empty
                    if (b.length == 1 && b[0] === null) {
                        stack.push([a.length > 0 ? 1 : 0]);
                        break;
                    }
                    if (a.length == 1 && a[0] === null) {
                        stack.push([b.length > 0 ? 1 : 0]);
                        break;
                    }
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] != b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] != b[0] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] != b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "GREATER": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] > b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] > b[0] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] > b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "GREATER_EQUAL": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] >= b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] >= b[0] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] >= b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "LESSER": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] < b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] < b[0] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] < b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "LESSER_EQUAL": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] <= b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] <= b[0] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] <= b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "AND": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] && b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] && b[0] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] && b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "OR": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(a[0] || b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] || b[0] ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(a[j] || b[j] ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "XOR": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push((a[0] ^ b[j]) ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push((a[j] ^ b[0]) ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push((a[j] ^ b[j]) ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        log("Invalid number of entries for " + token);
                        return null;
                    }
                    break;
                }
                case "READ_GLOBAL": {
                    var identifiers = stack.pop();
                    if (identifiers.length == 1) {
                        switch (identifiers[0]) {
                            case "stage": {
                                stack.push([gameContainer.gameLoader._root]);
                                break;
                            }
                            case "this": {
                                stack.push(context);
                                break;
                            }
                            case "key": {
                                stack.push(keys);
                                break;
                            }
                            case "stage_frame": {
                                stack.push([gameContainer.gameLoader._root._currentframe]);
                                break;
                            }
                            default: {
                                log("Invalid global identifier " + identifiers[0]);
                                return null;
                            }
                        }
                    } else {
                        log("Invalid global identifier " + identifiers);
                    }
                    break;
                }
                case "OBJECT_ACCESS": {
                    var targets = stack.pop();
                    var amount = parseInt(formula[i + 1], 10);

                    // Flatten Array targets so .prop maps over array elements
                    // e.g. stage.allTitles.charTitle → allTitles is an Array,
                    // so expand its elements as individual targets
                    var flatTargets = [];
                    for (var j = 0; j < targets.length; ++j) {
                        if (targets[j] instanceof Array) {
                            for (var k = 0; k < targets[j].length; ++k) {
                                flatTargets.push(targets[j][k]);
                            }
                        } else {
                            flatTargets.push(targets[j]);
                        }
                    }
                    targets = flatTargets;

                    var result = [];

                    // OPTIMIZATION: Detect simple property access pattern
                    // Pattern: IDENTIFIER key, READ_GLOBAL, IDENTIFIER <name>, EQUAL (length 6)
                    if (amount == 6 &&
                        formula[i + 2] == "IDENTIFIER" &&
                        formula[i + 3] == "key" &&
                        formula[i + 4] == "READ_GLOBAL" &&
                        formula[i + 5] == "IDENTIFIER" &&
                        formula[i + 7] == "EQUAL") {

                        var propName:String = formula[i + 6];
                        for (var j = 0; j < targets.length; ++j) {
                            var value = targets[j][propName];
                            if (value !== undefined) {
                                result.push(value);
                            }
                        }
                        objAccessOptimized++;
                        stack.push(result);
                        i += amount + 1;
                        break;
                    }
                    objAccessGeneric++;

                    // Generic implementation: enumerate all properties and filter
                    for (var j = 0; j < targets.length; ++j) {
                        var target = targets[j];

                        var childThis = [];
                        var childKeys = [];

                        for (var propertyName:String in target) {
                            childThis.push(target[propertyName]);
                            childKeys.push(propertyName);
                        }

                        var filteredResult = evaluate(formula, i + 2, i + amount + 2, childThis, childKeys);

                        for (var k = 0; k < filteredResult.length; ++k) {
                            if (filteredResult[k] == true) {
                                result.push(target[childKeys[k]]);
                            }
                        }
                    }

                    stack.push(result);
                    i += amount + 1;
                    break;
                }
                case "ARRAY_ACCESS": {
                    var targets = stack.pop();
                    var amount = parseInt(formula[i + 1], 10);

                    var result = [];

                    // OPTIMIZATION: Detect simple numeric index pattern
                    // Pattern: VALUE <n> (length 2)
                    if (amount == 2 && formula[i + 2] == "VALUE") {
                        var idx:Number = parseInt(formula[i + 3], 10);
                        for (var j = 0; j < targets.length; ++j) {
                            var value = targets[j][idx];
                            if (value !== undefined) {
                                result.push(value);
                            }
                        }
                        arrAccessOptimized++;
                        stack.push(result);
                        i += amount + 1;
                        break;
                    }
                    arrAccessGeneric++;

                    // Generic implementation: filter array elements by condition
                    // Enumerate elements as (this=values, key=indices), evaluate
                    // condition per-element, keep elements where result is true
                    for (var j = 0; j < targets.length; ++j) {
                        var target = targets[j];

                        var childThis = [];
                        var childKeys = [];

                        for (var k = 0; k < target.length; ++k) {
                            childThis.push(target[k]);
                            childKeys.push(k);
                        }

                        var filteredResult = evaluate(formula, i + 2, i + amount + 2, childThis, childKeys);

                        for (var k = 0; k < filteredResult.length; ++k) {
                            if (filteredResult[k] == true) {
                                result.push(target[childKeys[k]]);
                            }
                        }
                    }

                    stack.push(result);
                    i += amount + 1;
                    break;
                }
                case "REMEMBER": {
                    var remLen:Number = parseInt(formula[++i], 10);
                    var remStart:Number = i + 1;
                    var remEnd:Number = remStart + remLen;
                    i = remEnd - 1; // -1 because loop will ++i

                    // Build key from inner bytecode for deduplication
                    var remKey:String = "";
                    for (var rk:Number = remStart; rk < remEnd; rk++) {
                        remKey += formula[rk] + "|";
                    }

                    var remResult:Array = evaluate(formula, remStart, remEnd, context, keys);

                    if (remResult != null && remResult.length > 0) {
                        // Valid result — store and use
                        rememberedValues[remKey] = remResult;
                        stack.push(remResult);
                    } else if (rememberedValues[remKey] != undefined) {
                        // Empty/null result — use remembered value
                        stack.push(rememberedValues[remKey]);
                    } else {
                        // No remembered value available — push empty
                        stack.push([]);
                    }
                    break;
                }
                case "TERNARY": {
                    // Parse embedded bytecode lengths
                    var thenLen:Number = parseInt(formula[++i], 10);
                    var thenStart:Number = i + 1;
                    var thenEnd:Number = thenStart + thenLen;

                    var elseLen:Number = parseInt(formula[thenEnd], 10);
                    var elseStart:Number = thenEnd + 1;
                    var elseEnd:Number = elseStart + elseLen;
                    i = elseEnd - 1; // -1 because loop will ++i

                    var condition:Array = Array(stack.pop());

                    // Evaluate both branches
                    var thenResult:Array = evaluate(formula, thenStart, thenEnd, context, keys);
                    var elseResult:Array = evaluate(formula, elseStart, elseEnd, context, keys);

                    // Element-wise selection based on condition
                    var result:Array = [];
                    var len:Number = condition.length;
                    for (var j:Number = 0; j < len; j++) {
                        var cond = condition[j];
                        var isTruthy:Boolean = (cond != 0 && cond != false && cond != null && cond != "");
                        var thenVal = (thenResult.length == 1) ? thenResult[0] : thenResult[j];
                        var elseVal = (elseResult.length == 1) ? elseResult[0] : elseResult[j];
                        result.push(isTruthy ? thenVal : elseVal);
                    }
                    stack.push(result);
                    break;
                }
                default: {
                    // Silently fail on invalid tokens
                    return null;
                }
            }
        }

        if (stack.length == 1) {
            return stack[0];
        } else {
            // Silently fail on unbalanced formulas
            return null;
        }
    }

    // ========================================================================
    // Value Search (ported from Main.as)
    // ========================================================================

    /**
     * Check if a string matches a pattern with * wildcards and | OR operator
     * * matches zero or more characters
     * | separates alternatives (e.g., "6|8" matches "6" or "8")
     */
    private static function matchesWildcard(str:String, pattern:String):Boolean {
        // OR matching: split by | and try each alternative
        if (pattern.indexOf("|") != -1) {
            var alternatives:Array = pattern.split("|");
            for (var i:Number = 0; i < alternatives.length; i++) {
                if (matchesWildcard(str, alternatives[i])) {
                    return true;
                }
            }
            return false;
        }

        // Fast path: match-all wildcard
        if (pattern == "*") {
            return true;
        }

        // Fast path: no wildcards, use direct equality
        if (pattern.indexOf("*") == -1) {
            return str == pattern;
        }

        // Split pattern by * to get literal parts
        var parts:Array = pattern.split("*");

        // Early rejection: find longest static part and check if it exists in string
        var longestPart:String = "";
        for (var i:Number = 0; i < parts.length; i++) {
            if (parts[i].length > longestPart.length) {
                longestPart = parts[i];
            }
        }
        if (longestPart.length > 0 && str.indexOf(longestPart) == -1) {
            return false; // Longest part not found, no match possible
        }

        // Full wildcard matching
        var pos:Number = 0;
        for (var i:Number = 0; i < parts.length; i++) {
            var part:String = parts[i];
            if (part.length == 0) continue; // Empty part from consecutive ** or leading/trailing *

            var idx:Number = str.indexOf(part, pos);
            if (idx == -1) return false;

            // First part must be at start (unless pattern starts with *)
            if (i == 0 && pattern.charAt(0) != "*" && idx != 0) return false;

            pos = idx + part.length;
        }

        // Last part must be at end (unless pattern ends with *)
        if (parts.length > 0 && pattern.charAt(pattern.length - 1) != "*") {
            var lastPart:String = parts[parts.length - 1];
            if (lastPart.length > 0 && str.lastIndexOf(lastPart) + lastPart.length != str.length) {
                return false;
            }
        }

        return true;
    }

    /**
     * Recursively search for a value in a target object
     * @param visited Array to track visited objects (prevents infinite loops from circular references)
     */
    private static function searchTargetForValue(target:Object, value:String, path:String, output:Array, visited:Array):Void {
        // Circular reference protection for objects and movieclips
        if (typeof(target) == "movieclip" || typeof(target) == "object") {
            for (var v:Number = 0; v < visited.length; v++) {
                if (visited[v] === target) {
                    return; // Already visited, skip to prevent infinite loop
                }
            }
            visited.push(target);
        }

        if (typeof(target) == "movieclip") {
            for (var key:String in target) {
                searchTargetForValue(target[key], value, path + "." + key, output, visited);
            }
        } else if (target instanceof TextField) {
            if (matchesWildcard(target.text, value)) {
                output.push(path);
            }
        } else if (typeof(target) == "number") {
            if (matchesWildcard(String(target), value)) {
                output.push(path);
            }
        } else if (typeof(target) == "string") {
            if (matchesWildcard(String(target), value)) {
                output.push(path);
            }
        } else if (target instanceof Date) {
            if (matchesWildcard(String(target), value)) {
                output.push(path);
            }
        } else if (target instanceof Array) {
            for (var j:Number = 0, len:Number = target.length; j < len; ++j) {
                searchTargetForValue(target[j], value, path + "[" + j + "]", output, visited);
            }
        } else if (target == null) {
            if ("null" == value) {
                output.push(path);
            }
        } else if (target == undefined) {
            if ("undefined" == value) {
                output.push(path);
            }
        } else if (target == NaN) {
            if ("NaN" == value) {
                output.push(path);
            }
        } else if (typeof(target) == "object") {
            for (var key:String in target) {
                searchTargetForValue(target[key], value, path + "." + key, output, visited);
            }
        } else if (typeof(target) == "boolean") {
            if (matchesWildcard(String(target), value.toLowerCase())) {
                output.push(path);
            }
        } else if (typeof(target) == "function") {
            if ("[function]" == value.toLowerCase()) {
                output.push(path);
            }
        }
    }

    /**
     * Recursively search for property names containing a substring
     * @param visited Array to track visited objects (prevents infinite loops from circular references)
     */
    private static function searchTargetForName(target:Object, nameLower:String, path:String, output:Array, visited:Array):Void {
        // Circular reference protection for objects and movieclips
        if (typeof(target) == "movieclip" || typeof(target) == "object") {
            for (var v:Number = 0; v < visited.length; v++) {
                if (visited[v] === target) {
                    return;
                }
            }
            visited.push(target);
        }

        if (typeof(target) == "movieclip" || typeof(target) == "object") {
            for (var key:String in target) {
                var childPath:String = path + "." + key;
                if (key.toLowerCase().indexOf(nameLower) >= 0) {
                    output.push(childPath);
                }
                searchTargetForName(target[key], nameLower, childPath, output, visited);
            }
        } else if (target instanceof Array) {
            for (var j:Number = 0, len:Number = target.length; j < len; ++j) {
                searchTargetForName(target[j], nameLower, path + "[" + j + "]", output, visited);
            }
        }
    }

    // ========================================================================
    // Output Formatting (ported from Main.as)
    // ========================================================================

    /**
     * Format evaluation results for display in devtools
     */
    private static function formatOutput(input:Array, level:Number):Object {
        var singular:Boolean = input.length == 1;
        var output:Array = [];
        for (var i:Number = 0; i < input.length; ++i) {
            var value:Object = input[i];
            if (typeof(value) == "movieclip") {
                if (level == 0 && singular) {
                    for (var key:String in value) {
                        output.push({value: key + ": " + formatOutput([value[key]], level + 1).output[0].value});
                    }
                } else {
                    var count:Number = 0;
                    for (var key:String in value) {
                        count++;
                    }
                    output.push({value: "[MovieClip ..." + count + "]"});
                }
            } else if (value instanceof TextField) {
                output.push({value: "[TextField \"" + createLabelString(value.text) + "\"]"});
            } else if (typeof(value) == "number") {
                output.push({value: value});
            } else if (typeof(value) == "string") {
                output.push({value: "\"" + value + "\""});
            } else if (value instanceof Date) {
                output.push({value: "[Date \"" + value + "\"]"});
            } else if (value instanceof Array) {
                if (level == 0 && singular) {
                    for (var j:Number = 0, len:Number = value.length; j < len; ++j) {
                        output.push({value: j + ": " + formatOutput([value[j]], level + 1).output[0].value});
                    }
                } else {
                    output.push({value: "[Array ..." + value.length + "]"});
                }
            } else if (value == null) {
                output.push({value: "null"});
            } else if (value == undefined) {
                output.push({value: "undefined"});
            } else if (value == NaN) {
                output.push({value: "NaN"});
            } else if (typeof(value) == "object") {
                if (level == 0 && singular) {
                    for (var key:String in value) {
                        output.push({value: key + ": " + formatOutput([value[key]], level + 1).output[0].value});
                    }
                } else {
                    var count:Number = 0;
                    for (var key:String in value) {
                        count++;
                    }
                    output.push({value: "[Object ..." + count + "]"});
                }
            } else if (typeof(value) == "boolean") {
                output.push({value: value});
            } else if (typeof(value) == "function") {
                output.push({value: "[Function]"});
            } else {
                output.push({value: "Unknown " + value + ")"});
            }
        }
        return {
            output: output
        };
    }

    /**
     * Create a truncated label string for display
     */
    private static function createLabelString(labelString:String):String {
        labelString = labelString.split("\r\n").join("\n").split("\r").join("\n");

        var newlineIndex:Number = labelString.indexOf("\n");

        if (newlineIndex != -1) {
            labelString = labelString.substring(0, newlineIndex);
        }

        if (labelString.length > 32) {
            labelString = labelString.substring(0, 32);
        }

        return labelString;
    }

    // ========================================================================
    // Achievement Checking (ported from Main.as)
    // ========================================================================

    /**
     * Check all achievements against current game state
     * Called every frame once the game is loaded
     */
    private static function checkAchievements():Void {
        // Skip if no app data is set up
        if (AppData.data == null || AppData.data.assets == null) {
            return;
        }

        // Skip if processing is paused
        if (!processingActive) {
            return;
        }

        var frameStartTime:Number = getTimer();

        // Frame-local cache for formula results (cleared each frame)
        var frameCache:Object = {};

        for (var i:Number = 0; i < AppData.data.assets.length; ++i) {
            var achievement:Object = AppData.data.assets[i];

            // Only process ACTIVE assets
            if (achievement.state != "ACTIVE") {
                continue;
            }

            // Handle Rich Presence assets - evaluate formula once per second
            if (achievement.type == "RICH_PRESENCE") {
                var rpNow:Number = getTimer();
                // Only evaluate once per second
                if (rpNow - lastRichPresenceTime >= RICH_PRESENCE_INTERVAL) {
                    lastRichPresenceTime = rpNow;
                    if (achievement.compiledFormula != null && achievement.compiledFormula.length > 1) {
                        var rpFormulaResult:Array = evaluate(
                            achievement.compiledFormula, 1, achievement.compiledFormula.length,
                            [gameContainer.gameLoader._root], ["stage"]
                        );
                        // Store first result as the Rich Presence string
                        var rpString:String;
                        if (rpFormulaResult != null && rpFormulaResult.length > 0) {
                            rpString = String(rpFormulaResult[0]);
                        } else {
                            rpString = "";
                        }
                        achievement._richPresenceResult = rpString;
                        // Send to Deno for window title update
                        sendMessage("richPresenceUpdate", { result: rpString });
                    }
                }
                continue; // Skip achievement-specific processing
            }

            // Start timing for this achievement
            var startTime:Number = getTimer();

            // Track if all requirements pass for this asset
            var assetTriggered:Boolean = true;
            var hasRequirements:Boolean = false;

            // TRIGGER flag tracking - for primed state detection
            var allNonTriggerMet:Boolean = true;
            var allTriggerMet:Boolean = true;
            var hasTriggerCondition:Boolean = false;

            // === PHASE 0: Pause If detection (per group) ===
            // Evaluates Pause If requirements first to determine which groups are paused.
            // Also handles AndNext/OrNext chains ending in Pause If.
            // Delta values are always evaluated. Hits tracking for Pause If happens here.
            var groupPauseStates:Array = [];   // Boolean per group
            var groupPauseIfResults:Array = []; // {req, passed, valid, basePath, reqIndex}[] per group
            var groupChainInfo:Array = [];      // Object per group: reqIndex -> {isChainMember, terminalIndex}
            var groupRnifHandled:Array = [];    // Object per group: reqIndex -> true for ResetNextIf handled in Phase 0

            for (var j:Number = 0; j < achievement.groups.length; ++j) {
                var group:Object = achievement.groups[j];
                var isPaused:Boolean = false;
                var pauseIfResults:Array = [];
                var chainInfo:Object = {};  // Track chain membership for this group
                var rnifHandledInPhase0:Object = {};  // ResetNextIf indices handled here (skip in Phase 2)

                // First pass: identify AndNext/OrNext chains ending in Pause If
                for (var k:Number = 0; k < group.requirements.length; ++k) {
                    var requirement:Object = group.requirements[k];

                    if (requirement.flag == "AND_NEXT" || requirement.flag == "OR_NEXT") {
                        // Evaluate the chain to find terminal
                        var chainResult:Object = evaluateChain(group, k, frameCache, {});

                        // Check if terminal is Pause If
                        if (chainResult.terminalIndex < group.requirements.length) {
                            var terminalReq:Object = group.requirements[chainResult.terminalIndex];
                            if (terminalReq.flag == "PAUSE_IF") {
                                // Mark all chain members (from k to terminalIndex-1)
                                for (var cm:Number = k; cm < chainResult.terminalIndex; ++cm) {
                                    chainInfo[cm] = {isChainMember: true, terminalIndex: chainResult.terminalIndex};
                                }
                                // Mark terminal with chain result
                                chainInfo[chainResult.terminalIndex] = {
                                    isTerminal: true,
                                    chainResult: chainResult.chainResult,
                                    chainValid: chainResult.valid
                                };
                            }
                        }
                        // Skip ahead (chain will be processed when we hit the terminal)
                        k = chainResult.terminalIndex;
                    }
                }

                // Second pass: process Pause If requirements (with chain results)
                for (var k:Number = 0; k < group.requirements.length; ++k) {
                    var requirement:Object = group.requirements[k];

                    // Skip chain members (non-terminals) - they don't produce pauseIfResults
                    var info:Object = chainInfo[k];
                    if (info && info.isChainMember && !info.isTerminal) {
                        continue;
                    }

                    if (requirement.flag != "PAUSE_IF") continue;

                    hasRequirements = true;
                    var basePath:String = "assets/" + i + "/groups/" + j + "/requirements/" + k;

                    var passed:Boolean = false;
                    var valid:Boolean = true;

                    // Check if this is a chain terminal
                    if (info && info.isTerminal) {
                        // Use the chain result (already evaluated)
                        passed = info.chainResult;
                        valid = info.chainValid;
                        // Still need to evaluate this terminal's condition and combine
                        if (valid) {
                            var termEval:Object = evaluateRequirementCondition(requirement, frameCache, 0);
                            valid = termEval.valid;
                            // Chain result is already combined with terminal in evaluateChain
                        }
                    } else {
                        // Standalone Pause If - evaluate normally
                        var evalResult:Object = evaluateRequirementCondition(requirement, frameCache, 0);
                        passed = evalResult.passed;
                        valid = evalResult.valid;
                    }

                    if (!valid) {
                        pauseIfResults.push({req: requirement, passed: false, valid: false, basePath: basePath, reqIndex: k});
                        continue;
                    }

                    // If already paused by earlier Pause If, skip condition/hits
                    if (isPaused) {
                        pauseIfResults.push({req: requirement, passed: false, valid: true, basePath: basePath, reqIndex: k});
                        continue;
                    }

                    pauseIfResults.push({req: requirement, passed: passed, valid: true, basePath: basePath, reqIndex: k});

                    // Check for ResetNextIf targeting this PauseIf
                    // Per RA docs: ResetNextIf followed by PauseIf is evaluated even while paused,
                    // allowing it to unlock a PauseLock without needing an alt group.
                    var prevK:Number = k - 1;
                    while (prevK >= 0 && group.requirements[prevK].flag == "RESET_NEXT_IF") {
                        rnifHandledInPhase0[prevK] = true;
                        var rnifReq:Object = group.requirements[prevK];
                        var rnifResult:Object = evaluateRequirementCondition(rnifReq, frameCache, 0);
                        if (rnifResult.valid && rnifResult.passed) {
                            // Reset the PauseIf's hit count
                            if ((requirement.hits || 0) > 0) {
                                diffSet(requirement, "hits", 0, basePath + "/hits");
                            }
                        }
                        prevK--;
                    }

                    // Check if this triggers pause
                    var maxHits:Number = requirement.maxHits || 0;
                    var currentHits:Number = requirement.hits || 0;

                    if (maxHits == 0) {
                        // Transient pause: triggers every frame condition is true
                        if (passed) {
                            isPaused = true;
                        }
                    } else {
                        // Threshold pause: check for persistent pause
                        if (currentHits >= maxHits) {
                            // Already at max hits - persistent pause continues
                            isPaused = true;
                        } else if (passed) {
                            // Condition true, increment hits
                            var newHits:Number = currentHits + 1;
                            diffSet(requirement, "hits", newHits, basePath + "/hits");
                            if (newHits >= maxHits) {
                                isPaused = true;
                            }
                        }
                    }
                }

                groupPauseStates.push(isPaused);
                groupPauseIfResults.push(pauseIfResults);
                groupChainInfo.push(chainInfo);
                groupRnifHandled.push(rnifHandledInPhase0);
            }

            // === PHASE 1: Delta-only evaluation for non-Pause-If requirements in paused groups ===
            // For paused groups, we still need to update delta values to prepare for next frame
            for (var j:Number = 0; j < achievement.groups.length; ++j) {
                if (!groupPauseStates[j]) continue;  // Only process paused groups

                var group:Object = achievement.groups[j];
                for (var k:Number = 0; k < group.requirements.length; ++k) {
                    var requirement:Object = group.requirements[k];
                    if (requirement.flag == "PAUSE_IF") continue;  // Already handled in Phase 0

                    hasRequirements = true;

                    // Skip if not compiled
                    if (requirement.compiledA == null || requirement.compiledB == null) continue;

                    // Only evaluate delta types
                    if (requirement.typeA == "DELTA") {
                        var cacheKeyA:String = requirement.addressA;
                        var currentA:Array = frameCache[cacheKeyA];
                        if (currentA == null) {
                            currentA = evaluate(requirement.compiledA, 1, requirement.compiledA.length, [gameContainer.gameLoader._root], ["stage"]);
                            frameCache[cacheKeyA] = currentA;
                        }
                        if (currentA != null && currentA.length == 1) {
                            storeDeltaValue(requirement.id, "A", currentA[0]);
                        }
                    }
                    if (requirement.typeB == "DELTA") {
                        var cacheKeyB:String = requirement.addressB;
                        var currentB:Array = frameCache[cacheKeyB];
                        if (currentB == null) {
                            currentB = evaluate(requirement.compiledB, 1, requirement.compiledB.length, [gameContainer.gameLoader._root], ["stage"]);
                            frameCache[cacheKeyB] = currentB;
                        }
                        if (currentB != null && currentB.length == 1) {
                            storeDeltaValue(requirement.id, "B", currentB[0]);
                        }
                    }
                }
            }

            // === PHASE 2: Normal evaluation for non-paused groups, detect Reset If triggers ===
            var resetIfFired:Boolean = false;
            var groupResults:Array = [];  // {type, requirements[], allPassed, isPaused}
            var resetNextIfTargets:Array = [];  // [{groupIdx, reqIdx, basePath}] - targets to reset after Phase 5

            for (var j:Number = 0; j < achievement.groups.length; ++j) {
                var group:Object = achievement.groups[j];

                // Handle paused groups
                if (groupPauseStates[j]) {
                    // Paused group - cannot pass, only include Pause If results
                    groupResults.push({
                        type: group.type,
                        requirements: groupPauseIfResults[j],
                        allPassed: false,
                        isPaused: true
                    });
                    continue;
                }

                // Non-paused group - normal evaluation
                var groupReqs:Array = [];
                var groupAllPassed:Boolean = true;

                // First, add Pause If results from Phase 0 (Pause If is exempt from group pass check)
                for (var pi:Number = 0; pi < groupPauseIfResults[j].length; ++pi) {
                    groupReqs.push(groupPauseIfResults[j][pi]);
                }

                // Build set of requirement indices already handled in Phase 0 (skip in Phase 2)
                var pauseIfIndices:Object = {};
                for (var pi:Number = 0; pi < groupPauseIfResults[j].length; ++pi) {
                    pauseIfIndices[groupPauseIfResults[j][pi].reqIndex] = true;
                }
                // Also skip ResetNextIf requirements that target PauseIf (handled in Phase 0)
                var rnifHandled:Object = groupRnifHandled[j];
                for (var rnifIdx:String in rnifHandled) {
                    pauseIfIndices[rnifIdx] = true;
                }

                // Get chain info from Phase 0 and detect additional chains for non-Pause-If terminals
                var chainInfo:Object = groupChainInfo[j] || {};

                // Detect AndNext/OrNext chains ending in non-Pause-If terminals
                for (var k:Number = 0; k < group.requirements.length; ++k) {
                    // Skip if already part of a Pause If chain
                    if (chainInfo[k]) continue;
                    // Skip Pause If (handled in Phase 0)
                    if (pauseIfIndices[k]) continue;

                    var requirement:Object = group.requirements[k];
                    if (requirement.flag == "AND_NEXT" || requirement.flag == "OR_NEXT") {
                        // Evaluate the chain
                        var chainResult:Object = evaluateChain(group, k, frameCache, pauseIfIndices);

                        // Mark chain members
                        for (var cm:Number = k; cm < chainResult.terminalIndex; ++cm) {
                            if (!pauseIfIndices[cm]) {
                                chainInfo[cm] = {isChainMember: true, terminalIndex: chainResult.terminalIndex};
                            }
                        }
                        // Mark terminal with chain result
                        if (chainResult.terminalIndex < group.requirements.length && !pauseIfIndices[chainResult.terminalIndex]) {
                            chainInfo[chainResult.terminalIndex] = {
                                isTerminal: true,
                                chainResult: chainResult.chainResult,
                                chainValid: chainResult.valid
                            };
                        }
                        k = chainResult.terminalIndex;
                    }
                }

                // Detect AddHits/SubHits chains (separate from AndNext/OrNext)
                // These chains contribute hits to a terminal requirement
                var addHitsSubHitsInfo:Object = {};

                for (var k:Number = 0; k < group.requirements.length; ++k) {
                    // Skip if already processed or is a Pause If
                    if (pauseIfIndices[k] || addHitsSubHitsInfo[k]) continue;

                    var requirement:Object = group.requirements[k];
                    if (requirement.flag == "ADD_HITS" || requirement.flag == "SUB_HITS") {
                        var contributors:Array = [k];
                        var termIdx:Number = k + 1;

                        // Walk forward to find terminal (first non-AddHits/SubHits)
                        while (termIdx < group.requirements.length) {
                            if (pauseIfIndices[termIdx]) {
                                termIdx++;
                                continue;
                            }
                            var nextReq:Object = group.requirements[termIdx];
                            if (nextReq.flag == "ADD_HITS" || nextReq.flag == "SUB_HITS") {
                                contributors.push(termIdx);
                                termIdx++;
                            } else {
                                break;  // Found terminal
                            }
                        }

                        // Mark all contributors with terminal index
                        for (var ci:Number = 0; ci < contributors.length; ci++) {
                            var contribIdx:Number = contributors[ci];
                            addHitsSubHitsInfo[contribIdx] = {
                                isChainMember: true,
                                terminalIndex: termIdx,
                                flag: group.requirements[contribIdx].flag
                            };
                        }

                        // Mark terminal if valid
                        if (termIdx < group.requirements.length) {
                            addHitsSubHitsInfo[termIdx] = {isTerminal: true, contributors: contributors};
                        }

                        // Skip to terminal
                        k = termIdx - 1;
                    }
                }

                var sourceAccumulator:Number = 0;

                for (var k:Number = 0; k < group.requirements.length; ++k) {
                    var requirement:Object = group.requirements[k];

                    // Skip Pause If (already handled in Phase 0)
                    if (pauseIfIndices[k]) continue;

                    // Skip AndNext/OrNext chain members (non-terminals)
                    var info:Object = chainInfo[k];
                    if (info && info.isChainMember && !info.isTerminal) {
                        // Chain members don't count toward group satisfaction
                        continue;
                    }

                    // Handle AddSource/SubSource: accumulate left-side value, skip to next
                    if (requirement.flag == "ADD_SOURCE") {
                        var addVal:Number = evaluateRequirementValueA(requirement, frameCache);
                        if (!isNaN(addVal)) sourceAccumulator += addVal;
                        continue;
                    }
                    if (requirement.flag == "SUB_SOURCE") {
                        var subVal:Number = evaluateRequirementValueA(requirement, frameCache);
                        if (!isNaN(subVal)) sourceAccumulator -= subVal;
                        continue;
                    }

                    // Consume the accumulator for this requirement, then reset
                    var reqAccumulator:Number = sourceAccumulator;
                    sourceAccumulator = 0;

                    hasRequirements = true;

                    var basePath:String = "assets/" + i + "/groups/" + j + "/requirements/" + k;

                    // === Hit count completion check ===
                    // Per RA docs: "if a condition has a non-zero hit count, and reaches
                    // the number required, this condition is no longer tested. It remains true"
                    var completionMaxHits:Number = requirement.maxHits || 0;
                    var completionCurrentHits:Number = requirement.hits || 0;
                    if (completionMaxHits > 0 && completionCurrentHits >= completionMaxHits) {
                        // Requirement has reached its hit target - it's "locked true"
                        // Skip evaluation entirely, treat as satisfied
                        groupReqs.push({req: requirement, passed: true, valid: true, basePath: basePath, reqIndex: k});
                        // Note: flagged requirements don't count toward group pass, but this handles normal reqs
                        continue;
                    }

                    // Determine passed/valid - use chain result if this is a terminal
                    var passed:Boolean = false;
                    var valid:Boolean = true;

                    if (info && info.isTerminal) {
                        // This is a chain terminal - use combined chain result
                        passed = info.chainResult;
                        valid = info.chainValid;
                    } else {
                        // Standalone requirement - evaluate with accumulator
                        var evalResult:Object = evaluateRequirementCondition(requirement, frameCache, reqAccumulator);
                        passed = evalResult.passed;
                        valid = evalResult.valid;
                    }

                    if (!valid) {
                        groupReqs.push({req: requirement, passed: false, valid: false, basePath: basePath, reqIndex: k});
                        // Non-flagged requirements and MEASURED/MEASURED_IF affect group pass
                        var flagInvalid:String = requirement.flag;
                        if (flagInvalid == null || flagInvalid == "" || flagInvalid == "MEASURED" || flagInvalid == "MEASURED_IF") {
                            groupAllPassed = false;
                        }
                        continue;
                    }

                    // Store result
                    groupReqs.push({req: requirement, passed: passed, valid: true, basePath: basePath, reqIndex: k});

                    // Check if this requirement is satisfied (for group-level pass tracking)
                    // Non-flagged requirements, MEASURED/MEASURED_IF, and TRIGGER count toward group satisfaction
                    var flagSat:String = requirement.flag;
                    if (flagSat == null || flagSat == "" || flagSat == "MEASURED" || flagSat == "MEASURED_IF" || flagSat == "TRIGGER") {
                        // Track TRIGGER requirements separately for primed state
                        if (flagSat == "TRIGGER") {
                            hasTriggerCondition = true;
                        }

                        var maxHitsEval:Number = requirement.maxHits || 0;
                        var currentHitsEval:Number = requirement.hits || 0;
                        var reqSatisfied:Boolean = false;
                        if (maxHitsEval == 0) {
                            reqSatisfied = passed;
                        } else {
                            // Check if this is a terminal for AddHits/SubHits
                            var ahsInfo:Object = addHitsSubHitsInfo[k];
                            if (ahsInfo && ahsInfo.isTerminal && ahsInfo.contributors.length > 0) {
                                // Calculate effective hits (terminal + AddHits - SubHits)
                                var effectiveHits:Number = currentHitsEval;
                                var effectiveHitsLookahead:Number = 0;  // Additional hits this frame
                                for (var aci:Number = 0; aci < ahsInfo.contributors.length; aci++) {
                                    var contribIdx:Number = ahsInfo.contributors[aci];
                                    var contribReq:Object = group.requirements[contribIdx];
                                    var contribHits:Number = contribReq.hits || 0;
                                    // Check if this contributor passes this frame (for lookahead)
                                    var contribResult:Object = evaluateRequirementCondition(contribReq, frameCache, 0);
                                    var contribPasses:Boolean = contribResult.passed && contribResult.valid;
                                    if (contribReq.flag == "ADD_HITS") {
                                        effectiveHits += contribHits;
                                        if (contribPasses) effectiveHitsLookahead += 1;
                                    } else if (contribReq.flag == "SUB_HITS") {
                                        effectiveHits -= contribHits;
                                        if (contribPasses) effectiveHitsLookahead -= 1;
                                    }
                                }
                                // Terminal lookahead: +1 if terminal passes this frame
                                var terminalLookahead:Number = passed ? 1 : 0;
                                var totalLookahead:Number = effectiveHitsLookahead + terminalLookahead;
                                reqSatisfied = (effectiveHits >= maxHitsEval) ||
                                               (effectiveHits + totalLookahead >= maxHitsEval);
                            } else {
                                // Normal satisfaction check
                                reqSatisfied = (currentHitsEval >= maxHitsEval) ||
                                               (passed && currentHitsEval + 1 >= maxHitsEval);
                            }
                        }
                        if (!reqSatisfied) {
                            groupAllPassed = false;
                            // Track TRIGGER vs non-TRIGGER separately for primed state
                            if (flagSat == "TRIGGER") {
                                allTriggerMet = false;
                            } else {
                                allNonTriggerMet = false;
                            }
                        }
                    }

                    // Check for Reset If trigger (only in non-paused groups)
                    if (requirement.flag == "RESET_IF" && passed) {
                        var maxHitsCheck:Number = requirement.maxHits || 0;
                        var currentHitsCheck:Number = requirement.hits || 0;

                        if (maxHitsCheck == 0) {
                            resetIfFired = true;
                        } else if (currentHitsCheck == maxHitsCheck - 1) {
                            resetIfFired = true;
                        }
                    }

                    // Check for ResetNextIf trigger - resets only the NEXT requirement's hits
                    // Note: We record targets here and apply reset AFTER Phase 5 so the reset
                    // takes effect after any hits increment
                    if (requirement.flag == "RESET_NEXT_IF" && passed) {
                        var maxHitsRNI:Number = requirement.maxHits || 0;
                        var currentHitsRNI:Number = requirement.hits || 0;
                        var resetNextIfFired:Boolean = false;

                        if (maxHitsRNI == 0) {
                            // Always-active mode: fires every frame condition is true
                            resetNextIfFired = true;
                        } else if (currentHitsRNI == maxHitsRNI - 1) {
                            // Threshold mode: fires only when this increment would reach maxHits
                            resetNextIfFired = true;
                        }

                        if (resetNextIfFired) {
                            // Find the next requirement (skip Pause If which are handled in Phase 0)
                            var nextK:Number = k + 1;
                            while (nextK < group.requirements.length && pauseIfIndices[nextK]) {
                                nextK++;
                            }
                            if (nextK < group.requirements.length) {
                                var nextBasePath:String = "assets/" + i + "/groups/" + j + "/requirements/" + nextK;
                                resetNextIfTargets.push({groupIdx: j, reqIdx: nextK, basePath: nextBasePath});
                            }
                        }
                    }
                }

                groupResults.push({
                    type: group.type,
                    requirements: groupReqs,
                    allPassed: groupAllPassed,
                    isPaused: false
                });
            }

            // === PHASE 3: Handle Reset If (blocks ALL groups, resets ALL hits including paused) ===
            if (resetIfFired) {
                // Reset ALL hits in ALL groups (including paused ones)
                for (var gi:Number = 0; gi < groupResults.length; ++gi) {
                    var grReset:Object = groupResults[gi];
                    for (var ri:Number = 0; ri < grReset.requirements.length; ++ri) {
                        var rrReset:Object = grReset.requirements[ri];
                        if ((rrReset.req.hits || 0) > 0) {
                            diffSet(rrReset.req, "hits", 0, rrReset.basePath + "/hits");
                        }
                    }
                }
                // Also reset hits for non-Pause-If requirements in paused groups (not in groupResults)
                for (var j:Number = 0; j < achievement.groups.length; ++j) {
                    if (!groupPauseStates[j]) continue;
                    var group:Object = achievement.groups[j];
                    for (var k:Number = 0; k < group.requirements.length; ++k) {
                        var requirement:Object = group.requirements[k];
                        if (requirement.flag == "PAUSE_IF") continue;  // Already in groupResults
                        if ((requirement.hits || 0) > 0) {
                            diffSet(requirement, "hits", 0, "assets/" + i + "/groups/" + j + "/requirements/" + k + "/hits");
                        }
                    }
                }
                // Prevent achievement from triggering this frame
                assetTriggered = false;
            } else {
                // === PHASE 4: Check Core + Alt group logic ===
                var coreGroupPassed:Boolean = true;
                var hasAltGroups:Boolean = false;
                var anyAltGroupPassed:Boolean = false;

                for (var gi:Number = 0; gi < groupResults.length; ++gi) {
                    var grCheck:Object = groupResults[gi];
                    if (grCheck.type == "CORE") {
                        coreGroupPassed = grCheck.allPassed;
                    } else {
                        hasAltGroups = true;
                        if (grCheck.allPassed) {
                            anyAltGroupPassed = true;
                        }
                    }
                }

                // Achievement can trigger if Core passes AND (no Alts OR at least one Alt passes)
                assetTriggered = coreGroupPassed && (!hasAltGroups || anyAltGroupPassed);

                // === PHASE 4.5: TRIGGER flag - primed state handling ===
                if (hasTriggerCondition) {
                    if (allNonTriggerMet && !allTriggerMet) {
                        // PRIMED state - all prerequisites met, waiting for trigger condition
                        if (!achievement._primed) {
                            // Just became primed - show badge
                            var primedImageUrl:String = "http://raflash.local/asset-image/" + achievement.id;
                            PrimedBadges.show(achievement.id, primedImageUrl);
                        }
                        achievement._primed = true;
                        assetTriggered = false;  // Don't trigger until TRIGGER conditions met
                    } else {
                        // Not primed (prerequisites not met, or all conditions met)
                        if (achievement._primed) {
                            // Was primed, now isn't - hide badge
                            PrimedBadges.hide(achievement.id);
                        }
                        achievement._primed = false;
                    }
                }

                // === PHASE 5: Normal hits processing (only for non-paused groups) ===
                for (var gi:Number = 0; gi < groupResults.length; ++gi) {
                    var gr:Object = groupResults[gi];
                    if (gr.isPaused) continue;  // Skip paused groups

                    for (var ri:Number = 0; ri < gr.requirements.length; ++ri) {
                        var rr:Object = gr.requirements[ri];
                        var req:Object = rr.req;
                        var reqPassed:Boolean = rr.passed;
                        var reqValid:Boolean = rr.valid;
                        var reqBasePath:String = rr.basePath;

                        // Skip invalid requirements
                        if (!reqValid) continue;

                        // Skip Pause If (hits already handled in Phase 0)
                        if (req.flag == "PAUSE_IF") continue;

                        var maxHits:Number = req.maxHits || 0;
                        var currentHits:Number = req.hits || 0;

                        // AddHits/SubHits always track hits (even with maxHits=0) to contribute to terminal
                        var isAddSubHits:Boolean = (req.flag == "ADD_HITS" || req.flag == "SUB_HITS");

                        if (maxHits == 0 && !isAddSubHits) {
                            // No hits tracking - nothing to update
                        } else if (isAddSubHits) {
                            // AddHits/SubHits: always increment when condition passes
                            // (no max limit - they contribute all accumulated hits to terminal)
                            if (reqPassed) {
                                var newHits:Number = currentHits + 1;
                                diffSet(req, "hits", newHits, reqBasePath + "/hits");
                            }
                        } else {
                            // Has a hits target
                            if (currentHits >= maxHits) {
                                // Already complete - nothing to update
                            } else if (reqPassed) {
                                // Condition true this frame - increment hits
                                var newHits:Number = currentHits + 1;
                                diffSet(req, "hits", newHits, reqBasePath + "/hits");
                            }
                        }
                    }
                }

                // === PHASE 5.5: Apply ResetNextIf resets (after normal hits processing) ===
                for (var rni:Number = 0; rni < resetNextIfTargets.length; ++rni) {
                    var target:Object = resetNextIfTargets[rni];
                    var targetReq:Object = achievement.groups[target.groupIdx].requirements[target.reqIdx];
                    // Reset hits to 0 (even if just incremented)
                    if ((targetReq.hits || 0) > 0) {
                        diffSet(targetReq, "hits", 0, target.basePath + "/hits");
                    }
                }
            }

            // === PHASE 6: Calculate Measured value ===
            // Process per-group: check MeasuredIf gates, handle paused group freezing
            var measuredError:Boolean = false;
            var measuredCurrent:Number = NaN;
            var measuredTarget:Number = NaN;
            var hasAnyMeasured:Boolean = false;

            for (var mg:Number = 0; mg < achievement.groups.length; ++mg) {
                var mGroup:Object = achievement.groups[mg];
                var mGroupPaused:Boolean = groupPauseStates[mg];

                // Collect MEASURED and MEASURED_IF in this group
                var groupHasMeasured:Boolean = false;
                var groupHasMeasuredIf:Boolean = false;
                var measuredIfAllPassed:Boolean = true;

                for (var mr:Number = 0; mr < mGroup.requirements.length; ++mr) {
                    if (mGroup.requirements[mr].flag == "MEASURED") groupHasMeasured = true;
                    if (mGroup.requirements[mr].flag == "MEASURED_IF") groupHasMeasuredIf = true;
                }

                if (!groupHasMeasured && !groupHasMeasuredIf) continue;

                // If group is paused, use frozen measured value
                if (mGroupPaused) {
                    if (mGroup._pausedMeasuredCurrent != undefined) {
                        var pmCurrent:Number = mGroup._pausedMeasuredCurrent;
                        var pmTarget:Number = mGroup._pausedMeasuredTarget;
                        if (!hasAnyMeasured) {
                            measuredTarget = pmTarget;
                            measuredCurrent = pmCurrent;
                            hasAnyMeasured = true;
                        } else {
                            if (pmTarget != measuredTarget) {
                                measuredError = true;
                            } else if (pmCurrent > measuredCurrent) {
                                measuredCurrent = pmCurrent;
                            }
                        }
                    }
                    continue;
                }

                // Clear frozen value when unpaused
                delete mGroup._pausedMeasuredCurrent;
                delete mGroup._pausedMeasuredTarget;

                // Check all MeasuredIf conditions in this group
                // Per RA docs: if any MeasuredIf is false, the group's Measured value is 0
                if (groupHasMeasuredIf) {
                    for (var mif:Number = 0; mif < mGroup.requirements.length; ++mif) {
                        if (mGroup.requirements[mif].flag != "MEASURED_IF") continue;
                        var mCondResult:Object = evaluateRequirementCondition(mGroup.requirements[mif], frameCache, 0);
                        if (!mCondResult.valid || !mCondResult.passed) {
                            measuredIfAllPassed = false;
                            break;
                        }
                    }
                }

                // Process MEASURED requirements in this group
                var groupMeasuredCurrent:Number = NaN;
                var groupMeasuredTarget:Number = NaN;

                for (var mr:Number = 0; mr < mGroup.requirements.length; ++mr) {
                    var mReq:Object = mGroup.requirements[mr];
                    if (mReq.flag != "MEASURED") continue;

                    var mCurrent:Number;
                    var mTarget:Number;

                    if (!measuredIfAllPassed) {
                        // MeasuredIf gate failed — report 0 progress
                        // Still need the target for consistency checks
                        if ((mReq.maxHits || 0) > 0) {
                            mTarget = mReq.maxHits;
                        } else if (mReq.compiledB != null) {
                            var mCacheKeyB:String = mReq.addressB;
                            var mResultB:Array = frameCache[mCacheKeyB];
                            if (mResultB == null) {
                                mResultB = evaluate(mReq.compiledB, 1, mReq.compiledB.length, [gameContainer.gameLoader._root], ["stage"]);
                                frameCache[mCacheKeyB] = mResultB;
                            }
                            mTarget = (mResultB != null && mResultB.length == 1) ? Number(mResultB[0]) : 0;
                        } else {
                            mTarget = 0;
                        }
                        mCurrent = 0;
                    } else if ((mReq.maxHits || 0) > 0) {
                        // Hit Count Mode
                        mTarget = mReq.maxHits;

                        // Check if this is an AddHits/SubHits terminal
                        var mAddHitsInfo:Object = {};
                        for (var mk:Number = 0; mk < mGroup.requirements.length; ++mk) {
                            var mCheckReq:Object = mGroup.requirements[mk];
                            if (mCheckReq.flag == "ADD_HITS" || mCheckReq.flag == "SUB_HITS") {
                                var mContributors:Array = [mk];
                                var mTermIdx:Number = mk + 1;
                                while (mTermIdx < mGroup.requirements.length) {
                                    var mNextReq:Object = mGroup.requirements[mTermIdx];
                                    if (mNextReq.flag == "ADD_HITS" || mNextReq.flag == "SUB_HITS") {
                                        mContributors.push(mTermIdx);
                                        mTermIdx++;
                                    } else {
                                        break;
                                    }
                                }
                                for (var mci:Number = 0; mci < mContributors.length; mci++) {
                                    mAddHitsInfo[mContributors[mci]] = {isChainMember: true, terminalIndex: mTermIdx};
                                }
                                if (mTermIdx < mGroup.requirements.length) {
                                    mAddHitsInfo[mTermIdx] = {isTerminal: true, contributors: mContributors};
                                }
                                mk = mTermIdx - 1;
                            }
                        }

                        // Calculate effective hits
                        mCurrent = mReq.hits || 0;
                        var mAhsInfo:Object = mAddHitsInfo[mr];
                        if (mAhsInfo && mAhsInfo.isTerminal && mAhsInfo.contributors) {
                            for (var maci:Number = 0; maci < mAhsInfo.contributors.length; maci++) {
                                var mContribReq:Object = mGroup.requirements[mAhsInfo.contributors[maci]];
                                if (mContribReq.flag == "ADD_HITS") {
                                    mCurrent += (mContribReq.hits || 0);
                                } else if (mContribReq.flag == "SUB_HITS") {
                                    mCurrent -= (mContribReq.hits || 0);
                                }
                            }
                        }
                    } else {
                        // Value Mode - evaluate both sides
                        if (mReq.compiledA == null || mReq.compiledB == null) {
                            continue;  // Can't evaluate
                        }

                        var mCacheKeyA:String = mReq.addressA;
                        var mCacheKeyB2:String = mReq.addressB;

                        var mResultA:Array = frameCache[mCacheKeyA];
                        if (mResultA == null) {
                            mResultA = evaluate(mReq.compiledA, 1, mReq.compiledA.length, [gameContainer.gameLoader._root], ["stage"]);
                            frameCache[mCacheKeyA] = mResultA;
                        }

                        var mResultB2:Array = frameCache[mCacheKeyB2];
                        if (mResultB2 == null) {
                            mResultB2 = evaluate(mReq.compiledB, 1, mReq.compiledB.length, [gameContainer.gameLoader._root], ["stage"]);
                            frameCache[mCacheKeyB2] = mResultB2;
                        }

                        if (mResultA == null || mResultB2 == null || mResultA.length != 1 || mResultB2.length != 1) {
                            continue;  // Invalid multi-value result
                        }

                        mCurrent = Number(mResultA[0]);
                        mTarget = Number(mResultB2[0]);
                    }

                    // Track per-group max
                    if (isNaN(groupMeasuredTarget)) {
                        groupMeasuredTarget = mTarget;
                        groupMeasuredCurrent = mCurrent;
                    } else {
                        if (mTarget != groupMeasuredTarget) {
                            measuredError = true;
                        } else if (mCurrent > groupMeasuredCurrent) {
                            groupMeasuredCurrent = mCurrent;
                        }
                    }
                }

                // Skip if no valid MEASURED in this group
                if (isNaN(groupMeasuredTarget)) continue;

                // Freeze value if group is about to be paused (captured at pause time)
                // Note: groupPauseStates was already checked above; this stores for NEXT frame
                // We store on every non-paused frame so the value is current when pause begins
                mGroup._pausedMeasuredCurrent = groupMeasuredCurrent;
                mGroup._pausedMeasuredTarget = groupMeasuredTarget;

                // Combine across groups
                if (!hasAnyMeasured) {
                    measuredTarget = groupMeasuredTarget;
                    measuredCurrent = groupMeasuredCurrent;
                    hasAnyMeasured = true;
                } else {
                    if (groupMeasuredTarget != measuredTarget) {
                        measuredError = true;
                    } else if (groupMeasuredCurrent > measuredCurrent) {
                        measuredCurrent = groupMeasuredCurrent;
                    }
                }
            }

            // Trigger Measure UI if value changed
            if (hasAnyMeasured) {
                var prevMeasuredValue:Number = achievement._measuredValue;
                var prevMeasuredError:Boolean = achievement._measuredError;
                var measuredImageUrl:String = "http://raflash.local/asset-image/" + achievement.id;

                if (measuredError) {
                    // Error state - different targets
                    if (!prevMeasuredError && !assetTriggered) {
                        Measure.showOrReset(achievement.name, achievement.description || "", "ERROR", measuredImageUrl, achievement.id);
                    }
                    achievement._measuredError = true;
                } else {
                    achievement._measuredError = false;

                    var valueChanged:Boolean = (prevMeasuredValue != null) &&
                                               (measuredCurrent != prevMeasuredValue || measuredTarget != achievement._measuredTarget);

                    if (valueChanged && !assetTriggered) {
                        var measuredText:String = String(Math.floor(measuredCurrent)) + "/" + String(Math.floor(measuredTarget));
                        Measure.showOrReset(achievement.name, achievement.description || "", measuredText, measuredImageUrl, achievement.id);
                    }

                    achievement._measuredValue = measuredCurrent;
                    achievement._measuredTarget = measuredTarget;
                }
            }

            // Achievement triggered - show toast and handle state
            if (assetTriggered && hasRequirements) {
                var imageUrl:String = "http://raflash.local/asset-image/" + achievement.id;
                Toast.show("Achievement Unlocked", achievement.name, achievement.description || "", "left", imageUrl);

                // Reset all hits to 0 on all requirements
                for (var gj:Number = 0; gj < achievement.groups.length; ++gj) {
                    var grp:Object = achievement.groups[gj];
                    for (var rk:Number = 0; rk < grp.requirements.length; ++rk) {
                        var req:Object = grp.requirements[rk];
                        if (req.hits != null && req.hits > 0) {
                            diffSet(req, "hits", 0, "assets/" + i + "/groups/" + gj + "/requirements/" + rk + "/hits");
                        }
                    }
                }

                // Clear delta values for this asset (so reactivation starts fresh)
                clearAssetDeltaValues(achievement);

                diffSet(achievement, "state", "TRIGGERED", "assets/" + i + "/state");
            }

            // Record timing for this achievement
            var elapsed:Number = getTimer() - startTime;
            var achievementId:String = String(achievement.id);
            if (profilingData[achievementId] == null) {
                profilingData[achievementId] = {name: achievement.name, totalMs: 0, evalCount: 0};
            }
            profilingData[achievementId].totalMs += elapsed;
            profilingData[achievementId].evalCount += 1;
        }

        // Send any pending changes (lightweight - no full diff scan)
        var diffStartTime:Number = getTimer();
        if (diffHasPending()) {
            sendEditData(diffFlush());
        }
        diffOpsTimeMs += getTimer() - diffStartTime;

        // Track frame timing
        totalFrameTimeMs += getTimer() - frameStartTime;
        frameCount++;

        // Send profiling data every PROFILING_INTERVAL ms
        // DISABLED: Uncomment to re-enable profiling reports
        /*
        var now:Number = getTimer();
        if (now - lastProfilingReport >= PROFILING_INTERVAL) {
            // Count stage properties for diagnostics
            var stageCountStart:Number = getTimer();
            var stageStats:Object = countStageProperties(gameContainer.gameLoader._root, 3);
            stageCountTimeMs += getTimer() - stageCountStart;
            sendMessage("profiling", {
                achievements: profilingData,
                stage: stageStats,
                optimization: {
                    objAccessOptimized: objAccessOptimized,
                    objAccessGeneric: objAccessGeneric,
                    arrAccessOptimized: arrAccessOptimized,
                    arrAccessGeneric: arrAccessGeneric
                },
                timing: {
                    totalFrameTimeMs: totalFrameTimeMs,
                    diffOpsTimeMs: diffOpsTimeMs,
                    stageCountTimeMs: stageCountTimeMs,
                    frameCount: frameCount
                }
            });
            // Reset all profiling counters
            profilingData = {};
            objAccessOptimized = 0;
            objAccessGeneric = 0;
            arrAccessOptimized = 0;
            arrAccessGeneric = 0;
            totalFrameTimeMs = 0;
            diffOpsTimeMs = 0;
            stageCountTimeMs = 0;
            frameCount = 0;
            lastProfilingReport = now;
        }
        */
    }

    /**
     * Count properties on stage hierarchy for diagnostics
     */
    private static function countStageProperties(obj:Object, maxDepth:Number):Object {
        var directProps:Number = 0;
        var movieClips:Number = 0;
        var totalProps:Number = 0;

        for (var prop:String in obj) {
            directProps++;
            totalProps++;
            if (maxDepth > 0 && typeof(obj[prop]) == "movieclip") {
                movieClips++;
                var childStats:Object = countStageProperties(obj[prop], maxDepth - 1);
                totalProps += childStats.totalProps;
            }
        }

        return {
            directProps: directProps,
            movieClips: movieClips,
            totalProps: totalProps
        };
    }

    // ========================================================================
    // Memory Watch
    // ========================================================================

    /**
     * Process all active memory watchers
     * Called every frame - evaluates formulas and buffers results
     * Supports two modes:
     *   - Value mode: for primitives (numbers, strings, booleans)
     *   - Structure mode: for objects, arrays, movieclips (enumerates keys)
     */
    private static function processWatchers():Void {
        var now:Number = getTimer();
        memoryWatchFrameCount++;

        for (var watcherId:String in memoryWatchers) {
            var watcher:Object = memoryWatchers[watcherId];

            // Evaluate formula
            var value:Object;
            try {
                var result:Array = evaluate(watcher.bytecode, 1, watcher.bytecode.length,
                                            [gameContainer.gameLoader._root], ["stage"]);
                value = (result != null && result.length > 0) ? result[0] : null;
            } catch (e:Error) {
                value = "ERROR";
            }

            // Detect if result is a structure (iterable) or a value
            var isStructure:Boolean = false;
            if (value != null && value != "ERROR") {
                if (typeof(value) == "movieclip" || typeof(value) == "object") {
                    isStructure = true;
                } else if (value instanceof Array) {
                    isStructure = true;
                }
            }

            if (isStructure) {
                // Structure mode: enumerate keys and send (throttled to 1/second)
                if (now - watcher.lastFlush >= 1000) {
                    var keys:Array = [];
                    if (value instanceof Array) {
                        // Array: use numeric indices
                        for (var j:Number = 0; j < value.length; j++) {
                            keys.push(String(j));
                        }
                    } else {
                        // Object/MovieClip: enumerate properties
                        for (var key:String in value) {
                            keys.push(key);
                        }
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
                watcher.buffer.push({
                    frame: memoryWatchFrameCount,
                    value: value
                });

                if (now - watcher.lastFlush >= 1000) {
                    sendMessage("watchResults", {
                        watcherId: watcherId,
                        type: "value",
                        results: watcher.buffer
                    });
                    watcher.buffer = [];
                    watcher.lastFlush = now;
                }
            }
        }
    }

    // ========================================================================
    // Test Helpers (used by TestFlags.as)
    // ========================================================================

    /**
     * Run one frame of achievement checking.
     * Used by unit tests to simulate frames.
     */
    public static function testRunFrame():Void {
        // Temporarily enable processing
        var wasActive:Boolean = processingActive;
        processingActive = true;

        // Run achievement checking (uses AppData.data set up by test)
        checkAchievements();

        processingActive = wasActive;
    }

    /**
     * Clear all delta values.
     * Used by tests to reset state between tests.
     */
    public static function testClearDeltaValues():Void {
        deltaValues = {};
    }

    /**
     * Clear pending diff buffer.
     * Used by tests to reset state between tests.
     */
    public static function testClearDiffBuffer():Void {
        diffEdits = [];
    }

    /**
     * Get a delta value for testing.
     */
    public static function testGetDeltaValue(reqId:Number, side:String):Object {
        var data:Object = deltaValues[reqId];
        if (data == null) return undefined;
        return side == "A" ? data.prevA : data.prevB;
    }
}
