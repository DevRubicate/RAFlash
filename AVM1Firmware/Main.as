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

    // Game container (parent mode only) and the game's root MovieClip,
    // resolved by either parent-mode loadGame or child-mode bootstrap.
    private static var gameContainer:MovieClip;
    private static var gameRoot:MovieClip;
    private static var gameLoaded:Boolean = false;
    // True when the firmware is loaded as a child clip of the game's _root
    // (the game is _level0 itself). False when the firmware is the host that
    // loads the game into a child clip.
    private static var childMode:Boolean = false;
    // Child mode only: the firmware's own clip (captured from MTASC's frame 1
    // 'this' arg) so onFrame can re-resolve gameRoot if it ever goes empty.
    private static var _self:MovieClip;

    // Child-mode rescan diagnostics: track how long the rescan has been
    // unable to find a valid game root, and emit a one-shot warning if it
    // crosses a threshold so the user knows why achievements aren't firing.
    private static var _rescanFailFrames:Number = 0;
    private static var _rescanWarned:Boolean = false;
    private static var RESCAN_WARN_THRESHOLD:Number = 60;

    // Configuration (default port, overridden by URL ?port= param in init())
    private static var PORT:Number = 18081;
    private static var fixTextFieldBindings:Boolean = true;
    private static var fixSoundAttach:Boolean = true;

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
    private static var badgeImageOrder:Array = [];  // insertion order for LRU eviction
    private static var MAX_BADGE_CACHE_SIZE:Number = 200;
    private static var preloadQueue:Array = [];
    private static var currentPreloadId:Number = 0;
    private static var preloadContainer:MovieClip;

    // Runtime settings (from UI checkboxes)
    private static var processingActive:Boolean = true;
    private static var benchmarkingActive:Boolean = false;
    private static var interpreterFastPath:Boolean = true;

    // Recording state — toggled by setRecording command.
    // When true, onMouseUp listener forwards click paths to the engine.
    private static var recording:Boolean = false;
    private static var recordingMouseListener:Object = null;
    private static var hitTestMouseListener:Object = null;
    // Tracks which kind of HitTest is armed: false = click mode (only
    // button-like hits are claimed), true = element mode (any visible
    // MovieClip/Button/TextField counts).
    private static var hitTestElementMode:Boolean = false;
    private static var hitProbe:MovieClip = null;
    // Button event capture: AS2 Button symbols expose no bbox/hit API, and
    // instance onPress is silently swallowed when the button has a
    // BUTTONCONDACTION on(press) action. We instrument every instance
    // event on every Button in the tree to see which ones survive. At
    // mouseUp we prefer hitTestClickedButton (set by onRelease — the
    // definitive click-completion signal) over hitTestHoveredButton
    // (set by onRollOver — vulnerable to hover-then-click-elsewhere).
    private static var hitTestClickedButton:Object = null;
    private static var hitTestHoveredButton:Object = null;
    private static var hitTestButtonCaptures:Array = null;
    private static var hitTestClickX:Number = 0;
    private static var hitTestClickY:Number = 0;


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

    // Cache miss sentinel for frame cache
    public static var CACHE_MISS:Object = {};

    // Reusable context arrays for evaluate() calls (avoids allocating per call)
    private static var _stageContext:Array = [null];
    private static var _stageKeys:Array = ["stage"];

    // Native achievement compilation
    public static var nativeAchReady:Boolean = false;
    private static var nativeAchFnMap:Object = null;     // asset index → function array index
    private static var nativeAchStorage:Array = [];       // per-asset storage objects

    // Native Rich Presence compilation
    private static var nativeRPReady:Boolean = false;
    private static var nativeRPFnMap:Object = null;      // asset index → function array index
    private static var nativeRPStorage:Array = [];        // per-asset storage objects (for REMEMBER)

    // Origin for asset image URLs (derived from firmware's own URL at startup)
    private static var imageBaseUrl:String = "http://raflash.local";

    // Socket receive buffer for fragmented messages
    private static var receiveBuffer:String = "";

    // F12 key listener reference (parent mode only), so we can remove it on reset
    private static var f12KeyListener:Object = null;

    // Reconnection
    private static var reconnectTimer:Number = -1;
    private static var reconnectAttempts:Number = 0;
    private static var MAX_RECONNECT_ATTEMPTS:Number = 15;
    private static var disconnectOverlay:MovieClip = null;
    private static var initialSetupDone:Boolean = false;

    /**
     * Walk a DisplayObject subtree and return a nested description for the
     * Stage Viewer. Children of MovieClips are sorted by _depth so z-order
     * matches what the user sees on screen; non-container types return as
     * leaves.
     */
    private static function buildDisplayTree(target:Object, path:String):Object {
        var typeStr:String = "Object";
        if (typeof(target) == "movieclip") typeStr = "MovieClip";
        else if (target instanceof Button) typeStr = "Button";
        else if (target instanceof TextField) typeStr = "TextField";

        var children:Array = [];
        if (typeof(target) == "movieclip") {
            var mc:MovieClip = MovieClip(target);
            var collected:Array = [];
            for (var k:String in mc) {
                if (k == "__raflash") continue;
                var child:Object = mc[k];
                var ct:String = typeof(child);
                if (ct == "movieclip" || child instanceof Button || child instanceof TextField) {
                    var depth:Number = 0;
                    if (ct == "movieclip" && MovieClip(child).getDepth != undefined) {
                        depth = MovieClip(child).getDepth();
                    }
                    collected.push({ key: k, child: child, depth: depth });
                }
            }
            collected.sortOn("depth", Array.NUMERIC);
            for (var ci:Number = 0; ci < collected.length; ci++) {
                var entry:Object = collected[ci];
                children.push(buildDisplayTree(entry.child, path + "." + entry.key));
            }
        }

        var lastDot:Number = path.lastIndexOf(".");
        var displayName:String = lastDot >= 0 ? path.substring(lastDot + 1) : path;

        return { name: displayName, type: typeStr, path: path, children: children };
    }

    /**
     * Count enumerable game children of a MovieClip, ignoring our own
     * injected __raflash clip (which is always present in child mode and
     * shouldn't count as game content for the purposes of picking the right
     * level).
     */
    private static function countGameChildren(mc:MovieClip):Number {
        if (mc == undefined || mc == null) return 0;
        var n:Number = 0;
        for (var k:String in mc) {
            if (k != "__raflash") n++;
        }
        return n;
    }

    /**
     * In child mode, walk several possible sources to find the game's root
     * MovieClip and pick the candidate with the most game children.
     *
     * Many AS2 games are tiny stubs that loadMovieNum themselves into a
     * different level after their own frame 1 runs, leaving us looking at the
     * wrong place if we trust the first source we find. Cross-domain wrappers
     * also surface as non-MovieClip security objects on _parent. By scoring
     * candidates we naturally pick the right one in both cases.
     */
    private static function resolveChildModeGameRoot(ourClip:MovieClip):MovieClip {
        var bestClip:MovieClip = null;
        var bestCount:Number = -1;

        var consider = function(mc):Void {
            if (mc == undefined || mc == null) return;
            if (typeof(mc) != "movieclip") return;
            var n:Number = Main.countGameChildren(MovieClip(mc));
            if (n > bestCount) {
                bestCount = n;
                bestClip = MovieClip(mc);
            }
        };

        if (ourClip != undefined) {
            consider(ourClip._parent);
        }
        consider(_level0);
        // The level scan is the expensive part (10× eval), so skip it entirely
        // when _parent or _level0 has already given us a non-empty winner. The
        // disambiguation case the scoring was originally added for — stub
        // games that loadMovieNum themselves into a higher level — still
        // works, because in that case _level0 is empty after the stub finishes
        // and bestCount stays 0, so we fall through into the level scan. Once
        // any level has children we stop there.
        if (bestCount < 1) {
            for (var lvl:Number = 1; lvl <= 10; lvl++) {
                consider(eval("_level" + lvl));
                if (bestCount >= 1) break;
            }
        }
        return bestClip;
    }

    /**
     * Initialize the firmware.
     * Called from AVM1Entry.main(self) for production, or can be called
     * directly in tests with self=undefined (defaults to parent-mode init).
     *
     * Mode is auto-detected via _level0._url: in parent mode _level0 is the
     * firmware (loaded by AVM1Wrapper) so its URL ends with /avm1-firmware.swf
     * or similar; in child mode RAEngine launches the game directly so
     * _level0._url contains "/game.swf". This auto-detection agrees with the
     * user's firmwareMode setting because RAEngine acts on the setting when
     * choosing the launch URL.
     */
    public static function init(self:MovieClip):Void {
        // Detect child mode: the injected loader bytecode creates a clip
        // named "__raflash" and loads the firmware into it, so self._name
        // is "__raflash" in child mode. In parent mode the firmware is
        // loaded by AVM1Wrapper and has a different clip name.
        childMode = (self != undefined && self._name == "__raflash");
        var level0Url:String = String(_level0._url);

        // Extract origin (scheme + host) from _level0's URL for asset image
        // requests. Works in both modes: parent mode _level0 is the wrapper
        // loaded from the origin domain; child mode _level0 is the game itself.
        var schemeEnd:Number = level0Url.indexOf("://");
        if (schemeEnd >= 0) {
            var pathStart:Number = level0Url.indexOf("/", schemeEnd + 3);
            if (pathStart >= 0) {
                imageBaseUrl = level0Url.substring(0, pathStart);
            }
        }

        // Extract port from the firmware SWF's own URL (?port=XXXX).
        // In child mode self is the child clip loaded from avm1-firmware.swf;
        // in parent mode self is the firmware's root (loaded by AVM1Wrapper).
        if (self != undefined) {
            var fwUrl:String = String(self._url);
            var portIdx:Number = fwUrl.indexOf("port=");
            if (portIdx >= 0) {
                var portStr:String = fwUrl.substring(portIdx + 5);
                var ampIdx:Number = portStr.indexOf("&");
                if (ampIdx >= 0) portStr = portStr.substring(0, ampIdx);
                var parsed:Number = parseInt(portStr);
                if (!isNaN(parsed) && parsed > 0) PORT = parsed;
            }
        }

        if (childMode) {
            // Child mode: firmware was loaded by injected bytecode into a
            // child clip (e.g. _level0.__raflash) of the game's _root. The
            // game IS _level0 and is already running.
            //
            // Hide menu bar and right-click items so the player presents
            // cleanly. Stage.scaleMode/align are NOT set here — they are
            // enforced per-frame by onFrame() once the setup command arrives
            // with the gameConfig. Setting them here would override a
            // "neutral" config that wants the game to decide its own scaling.
            fscommand("showmenu", "false");
            fscommand("allowscale", "false");
            // Apply the trimmed menu via the prototype chain so every existing
            // and future MovieClip / Button picks it up without us having to
            // walk the display list. Clips that haven't explicitly assigned
            // their own .menu inherit this one through normal AS2 prototype
            // lookup. Can't get below the 2-item Settings/About floor — that
            // floor is enforced by the player itself, not by AS2 — but this
            // is the cheapest way to make the floor universal.
            var cm:ContextMenu = new ContextMenu();
            cm.hideBuiltInItems();
            MovieClip.prototype.menu = cm;
            Button.prototype.menu = cm;

            var ourClip:MovieClip = (self != undefined) ? self : MovieClip(_level0.__raflash);
            _self = ourClip;
            gameRoot = resolveChildModeGameRoot(ourClip);
            gameLoaded = true;

            // Drive the per-frame loop from our own clip's onEnterFrame so we
            // don't clobber the game's _root onEnterFrame.
            if (ourClip != undefined) {
                ourClip.onEnterFrame = function():Void {
                    try { Main.onFrame(); } catch (e:Error) { Main.logError("onEnterFrame", e); }
                };
            }

            // F12 key listener (parent mode sets this up after the game loads;
            // in child mode the game is already loaded so we set it now).
            // Remove any prior listener surviving from a previous child-mode
            // reset — the Key global persists across _level0.loadMovie reloads,
            // so without this, listeners accumulate on every reset.
            if (_global.__raF12Listener != null) {
                Key.removeListener(_global.__raF12Listener);
            }
            var keyListener:Object = {};
            keyListener.onKeyDown = function():Void {
                try {
                    if (Key.getCode() == 123) { // F12
                        Main.sendMessage("keypress", { keyCode: 123 });
                    }
                } catch (e:Error) { Main.logError("onKeyDown", e); }
            };
            _global.__raF12Listener = keyListener;
            Key.addListener(keyListener);

            Toast.setHostClip(_self);
            Measure.setHostClip(_self);
            PrimedBadges.setHostClip(_self);
            connectToServer();
            return;
        }

        // Parent mode: hide menu bar and right-click items.
        // Stage.scaleMode/align are enforced per-frame by onFrame() once
        // the setup command delivers the gameConfig.
        fscommand("showmenu", "false");
        // See child-mode comment above for why this uses prototype assignment.
        var cm:ContextMenu = new ContextMenu();
        cm.hideBuiltInItems();
        MovieClip.prototype.menu = cm;
        Button.prototype.menu = cm;

        connectToServer();
    }

    /**
     * Centralized error logger for the bulletproof try/catch wrappers.
     * Catches its own errors so the firmware never dies from a logging failure.
     */
    public static function logError(context:String, e:Error):Void {
        try {
            sendMessage("log", { message: "[firmware error] " + context + ": " + e.message });
        } catch (e2:Error) {
            // Last resort — trace if even sendMessage fails
            trace("[firmware error] " + context + ": " + e.message);
        }
    }

    /**
     * Reset all runtime state to initial values. Called during game reset
     * in both child and parent mode so the next game run starts clean.
     *
     * In child mode this is critical because AS2 static variables survive
     * _level0.loadMovie() — without this, the fresh firmware instance would
     * inherit stale hit counts, delta values, watchers, etc. from the
     * previous run.
     */
    private static function resetRuntimeState():Void {
        gameLoaded = false;
        processingActive = true;
        interpreterFastPath = true;
        _soundFixState = 0;
        _soundFixDeadline = 0;
        deltaValues = {};
        rememberedValues = {};
        memoryWatchers = {};
        memoryWatchFrameCount = 0;
        _global.__raHookSeen = {};
        _global.__raHookPending = {};
        _global.__raHookNextId = 0;
        badgeImageCache = {};
        badgeImageOrder = [];
        preloadQueue = [];
        currentPreloadId = 0;
        if (preloadContainer != null) {
            preloadContainer.removeMovieClip();
            preloadContainer = null;
        }
        lastRichPresenceTime = 0;
        nativeAchReady = false;
        nativeAchFnMap = null;
        nativeAchStorage = [];
        nativeRPReady = false;
        nativeRPFnMap = null;
        nativeRPStorage = [];
        profilingData = {};
        lastProfilingReport = 0;
        objAccessOptimized = 0;
        objAccessGeneric = 0;
        arrAccessOptimized = 0;
        arrAccessGeneric = 0;
        totalFrameTimeMs = 0;
        diffOpsTimeMs = 0;
        stageCountTimeMs = 0;
        frameCount = 0;
        _rescanFailFrames = 0;
        _rescanWarned = false;
    }

    private static function connectToServer():Void {
        // Pause the reconnect timer while a connection attempt is in flight.
        // Without this, the timer fires every 1s and calls connectToServer()
        // again, closing the socket mid-handshake. onConnect re-schedules on
        // failure or clears the timer on success.
        if (reconnectTimer != -1) {
            clearInterval(reconnectTimer);
            reconnectTimer = -1;
        }
        // Close previous socket to prevent handle leaks across reconnects
        if (socket != null) {
            try { socket.close(); } catch (e:Error) { /* already closed */ }
        }
        socket = new XMLSocket();
        receiveBuffer = "";

        socket.onConnect = function(success:Boolean):Void {
            try {
                if (success) {
                    Main.connected = true;
                    Main.reconnectAttempts = 0;
                    if (Main.reconnectTimer != -1) {
                        clearInterval(Main.reconnectTimer);
                        Main.reconnectTimer = -1;
                    }
                    Main.hideDisconnectOverlay();

                    // First-connect vs reconnect: gated by initialSetupDone, not
                    // gameLoaded. In child mode the game is already loaded by the
                    // time the firmware boots, so gameLoaded is always true here
                    // and the gameLoaded check would skip the "ready" handshake
                    // on first connect, leaving RAEngine waiting forever.
                    if (!Main.initialSetupDone) {
                        Main.sendMessage("ready", {});
                    } else {
                        trace("[AS2] Reconnected to Deno server");
                    }
                } else {
                    if (Main.gameLoaded) {
                        Main.scheduleReconnect();
                    }
                }
            } catch (e:Error) { Main.logError("socket.onConnect", e); }
        };

        socket.onData = function(data:String):Void {
            try {
                Main.handleData(data);
            } catch (e:Error) { Main.logError("socket.onData", e); }
        };

        socket.onClose = function():Void {
            try {
                Main.connected = false;
                if (Main.gameLoaded) {
                    Main.showDisconnectOverlay(false);
                    Main.scheduleReconnect();
                }
                // Before game loads, let Flash handle connection lifecycle naturally
                // (policy file handshake causes a close/reconnect cycle)
            } catch (e:Error) { Main.logError("socket.onClose", e); }
        };

        socket.connect("127.0.0.1", PORT);
    }

    private static function scheduleReconnect():Void {
        if (reconnectTimer != -1) return;
        reconnectTimer = setInterval(function():Void {
            try {
                Main.reconnectAttempts++;
                if (Main.reconnectAttempts >= Main.MAX_RECONNECT_ATTEMPTS) {
                    clearInterval(Main.reconnectTimer);
                    Main.reconnectTimer = -1;
                    Main.showDisconnectOverlay(true);
                    return;
                }
                Main.connectToServer();
            } catch (e:Error) { Main.logError("reconnectTimer", e); }
        }, 1000);
    }

    private static function showDisconnectOverlay(permanent:Boolean):Void {
        // In child mode the firmware doesn't own _root (the game does); skip
        // the overlay rather than draw on top of the game's content.
        if (childMode) return;

        hideDisconnectOverlay();

        var stageW:Number = Stage.width;
        var barHeight:Number = permanent ? 50 : 30;
        var bgAlpha:Number = permanent ? 90 : 75;

        var overlayHost:MovieClip = (_self != null) ? _self : _root;
        var mc:MovieClip = overlayHost.createEmptyMovieClip("_disconnectOverlay", 999800);
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
        // Parent mode: the loader clip IS the game's _root (because of _lockroot,
        // gameLoader._root === gameLoader). All achievement evaluation, watcher,
        // and memory inspection code reads from Main.gameRoot.
        gameRoot = gameLoader;

        // Patch Sound.attachSound to record linkage IDs (only if fix enabled).
        // Native methods on built-in prototypes are write-protected; ASSetPropFlags
        // clears the protection so our override takes effect.
        if (fixSoundAttach) {
            _global.ASSetPropFlags(Sound.prototype, "attachSound", 0, 7);
            var _origAttach:Function = Sound.prototype.attachSound;
            Sound.prototype.attachSound = function(id:String):Void {
                this.__raflash_linkage = id;
                _origAttach.call(this, id);
            };
        }

        // Load game from server (or spoofed domain URL for sitelock bypass)
        var gameUrl:String = (url != undefined && url != null) ? url : "http://raflash.local/game.swf";
        gameLoader.loadMovie(gameUrl);

        // Monitor loading progress and check achievements
        _root.onEnterFrame = function():Void {
            try {
                Main.onFrame();
            } catch (e:Error) { Main.logError("onEnterFrame", e); }
        };
    }

    /**
     * Per-frame handler for loading progress and achievements
     */
    private static var _soundFixState:Number = 0; // 0=scanning, 1=done
    private static var _soundFixDeadline:Number = 0;
    private static function onFrame():Void {
        // Re-enforce stage settings if configured (skip when "neutral" — let the game decide).
        var cfgScaleMode:String = AppData.data.gameConfig.scaleMode;
        if (cfgScaleMode != "neutral" && cfgScaleMode != undefined && Stage.scaleMode != cfgScaleMode) {
            Stage.scaleMode = cfgScaleMode;
        }
        var cfgAlign:String = AppData.data.gameConfig.align;
        if (cfgAlign != "neutral" && cfgAlign != undefined && Stage.align != cfgAlign) {
            Stage.align = cfgAlign;
        }

        // Function-call hook snapshot. Move "pending" → "seen" so all
        // formula evaluations within this onFrame see a consistent view
        // of which hooked functions fired since the previous snapshot.
        // Calls landing after this swap show up in the NEXT frame.
        if (_global.__raHookPending != undefined) {
            _global.__raHookSeen = _global.__raHookPending;
            _global.__raHookPending = {};
        }
        if (!gameLoaded) {
            try { checkLoadProgress(); } catch (e:Error) { logError("checkLoadProgress", e); }
        } else {
            // Child mode: re-resolve gameRoot if it goes empty. Some stub games
            // loadMovieNum their content into a higher level after their own
            // init runs, so the level we picked at firmware boot may have
            // become irrelevant by the time the game settles.
            if (childMode) {
                try {
                    // Re-resolve if gameRoot is empty/null, OR periodically
                    // (every 60 frames) to catch orphaned levels where the
                    // game moved its content to a different _level.
                    var needsRescan:Boolean = (gameRoot == null || countGameChildren(gameRoot) == 0);
                    if (!needsRescan && frameCount % 60 == 0) {
                        var candidate:MovieClip = resolveChildModeGameRoot(_self);
                        needsRescan = (candidate != null && candidate != gameRoot);
                    }
                    if (needsRescan) {
                        var newRoot:MovieClip = resolveChildModeGameRoot(_self);
                        if (newRoot != null && newRoot != gameRoot) {
                            gameRoot = newRoot;
                        }
                    }
                    if (gameRoot == null) {
                        _rescanFailFrames++;
                        if (!_rescanWarned && _rescanFailFrames >= RESCAN_WARN_THRESHOLD) {
                            _rescanWarned = true;
                            sendMessage("log", { message: "[firmware] child-mode gameRoot rescan failing — achievements will not fire until a valid root is found" });
                        }
                    } else {
                        _rescanFailFrames = 0;
                        _rescanWarned = false;
                    }
                } catch (eRes:Error) { logError("rescanGameRoot", eRes); }
            }

            // Fix Sound objects whose attachSound failed due to wrong library scope.
            // When a game creates new Sound() without a target, attachSound looks in the
            // firmware's library instead of the game's. The patched attachSound records
            // the linkage ID on each Sound, so we can create correctly-targeted replacements.
            // Retries for 3 seconds after game load since game init may take a few frames.
            // Parent mode only: in child mode the game's sounds default to its
            // own library because the game IS _level0.
            try {
                if (!childMode && _soundFixState == 0 && fixSoundAttach) {
                    if (_soundFixDeadline == 0) _soundFixDeadline = getTimer() + 3000;
                    var gr:MovieClip = gameRoot;
                    var fixed:Number = 0;
                    for (var name:String in gr) {
                        if (gr[name] instanceof Sound) {
                            var sndObj:Object = gr[name];
                            var snd:Sound = Sound(sndObj);
                            var linkage:String = sndObj.__raflash_linkage;
                            if (!(snd.duration > 0) && linkage != undefined) {
                                var replacement:Sound = new Sound(gr);
                                replacement.attachSound(linkage);
                                if (replacement.duration > 0) {
                                    replacement.onSoundComplete = snd.onSoundComplete;
                                    Object(replacement).__raflash_linkage = linkage;
                                    gr[name] = replacement;
                                    fixed++;
                                }
                            }
                        }
                    }
                    if (fixed > 0) {
                        sendMessage("log", {message: "Fixed " + fixed + " Sound objects with wrong library scope"});
                        _soundFixState = 1;
                    } else if (getTimer() > _soundFixDeadline) {
                        _soundFixState = 1;
                    }
                }
            } catch (e:Error) { logError("soundFixScan", e); }

            // Parent mode only: in child mode TextField variable bindings
            // resolve _root correctly because the game IS _root, so no manual
            // sync is needed.
            try {
                if (!childMode && fixTextFieldBindings) {
                    if (benchmarkingActive) {
                        var tfStart:Number = getTimer();
                        syncTextFieldBindings(gameRoot);
                        sendMessage("benchmark", {kind: "TextField Sync", ms: getTimer() - tfStart});
                    } else {
                        syncTextFieldBindings(gameRoot);
                    }
                }
            } catch (e:Error) { logError("syncTextFieldBindings", e); }

            try { checkAchievements(); } catch (e:Error) { logError("checkAchievements", e); }

            try {
                if (benchmarkingActive) {
                    var wStart:Number = getTimer();
                    processWatchers();
                    sendMessage("benchmark", {kind: "Watchers", ms: getTimer() - wStart});
                } else {
                    processWatchers();
                }
            } catch (e:Error) { logError("processWatchers", e); }
        }
    }

    /**
     * COMPATIBILITY HACK: Fix TextField variable bindings broken by loadMovie().
     *
     * In AS2, TextFields can have a `variable` property (set at authoring time in the
     * Flash IDE) that creates a two-way binding between the TextField's visual text and
     * an AS2 variable. For example, a TextField with variable="playername" on the root
     * timeline will sync its displayed text with _root.playername.
     *
     * This binding works correctly when the SWF runs as the root movie (_level0).
     * However, when a SWF is loaded via loadMovie() into a MovieClip — as our firmware
     * does to host the game — the binding breaks. The TextField still DISPLAYS user input
     * correctly (typing works visually), but the bound variable is never updated. It stays
     * at its initial value (typically empty string "").
     *
     * This means any game code that reads the variable (e.g. `if (_root.playername != "")`)
     * will see the stale value and fail, even though the user has typed text into the field.
     * The _lockroot property does NOT fix this — it only affects _root resolution in
     * ActionScript code, not the internal TextField variable binding mechanism.
     *
     * This function works around the issue by recursively walking the game's display tree
     * each frame, finding TextFields with variable bindings, and manually copying their
     * .text property to the bound variable location.
     *
     * Can be disabled in Settings > Compatibility if it causes issues with specific games.
     */
    /**
     * Resolve a TextField variable path like "_root.cash", "_parent.score", or "name"
     * into {target, prop} where target[prop] is the bound variable.
     */
    private static function resolveTextFieldVariable(tf:TextField):Object {
        var varPath:String = tf.variable;
        var parts:Array = varPath.split(".");
        var prop:String = parts[parts.length - 1];
        var target:Object;

        if (parts[0] == "_root") {
            target = gameRoot;
        } else if (parts[0] == "_parent") {
            target = tf._parent._parent;
        } else if (parts.length == 1) {
            return {target: tf._parent, prop: parts[0]};
        } else {
            target = tf._parent;
        }

        // Walk intermediate path segments (skip first and last)
        var start:Number = (parts[0] == "_root" || parts[0] == "_parent") ? 1 : 0;
        for (var i:Number = start; i < parts.length - 1; i++) {
            target = target[parts[i]];
            if (target == undefined) return null;
        }

        return {target: target, prop: prop};
    }

    private static function syncTextFieldBindings(clip:MovieClip):Void {
        for (var name:String in clip) {
            try {
                var child = clip[name];
                if (child instanceof TextField) {
                    var tf:TextField = TextField(child);
                    if (tf.variable != undefined && tf.variable != "") {
                        var resolved:Object = resolveTextFieldVariable(tf);
                        if (resolved == null) continue;

                        var varValue = resolved.target[resolved.prop];
                        var textValue:String = tf.text;
                        var lastSync = tf.__raflash_sync;

                        if (lastSync == undefined) {
                            // First encounter: variable is source of truth (text may be design-time placeholder)
                            if (varValue != undefined) {
                                tf.text = String(varValue);
                                tf.__raflash_sync = String(varValue);
                            } else {
                                // Variable not set yet — just start tracking, don't overwrite
                                tf.__raflash_sync = textValue;
                            }
                        } else if (textValue != lastSync) {
                            // User typed → sync text to variable
                            resolved.target[resolved.prop] = textValue;
                            tf.__raflash_sync = textValue;
                        } else if (varValue != undefined && String(varValue) != lastSync) {
                            // Game code set variable → sync variable to text
                            tf.text = String(varValue);
                            tf.__raflash_sync = String(varValue);
                        }
                    }
                } else if (child instanceof MovieClip) {
                    syncTextFieldBindings(MovieClip(child));
                }
            } catch (e:Error) { /* skip this child, keep processing siblings */ }
        }
    }

    /**
     * Check if game has finished loading
     */
    private static function checkLoadProgress():Void {
        var loader:MovieClip = gameRoot;
        var bytesLoaded:Number = loader.getBytesLoaded();
        var bytesTotal:Number = loader.getBytesTotal();

        if (bytesTotal > 0 && bytesLoaded >= bytesTotal && !gameLoaded) {
            gameLoaded = true;
            sendMessage("gameLoaded", { bytes: bytesTotal });

            // Set up F12 key listener after game loads (remove any prior
            // listener first so resets don't accumulate duplicates).
            if (f12KeyListener != null) {
                Key.removeListener(f12KeyListener);
            }
            f12KeyListener = {};
            f12KeyListener.onKeyDown = function():Void {
                try {
                    if (Key.getCode() == 123) { // F12
                        Main.sendMessage("keypress", { keyCode: 123 });
                    }
                } catch (e:Error) { Main.logError("onKeyDown", e); }
            };
            Key.addListener(f12KeyListener);

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
            // Parse failed. XMLSocket delivers complete null-terminated messages,
            // so a failure means genuinely corrupt data, not a partial message.
            // Discard this buffer to avoid blocking all subsequent messages.
            if (receiveBuffer.length > 1000000) {
                log("Buffer overflow (" + receiveBuffer.length + " bytes), discarding. First 80 chars: " + receiveBuffer.substring(0, 80));
            } else {
                log("JSON parse error, discarding buffer (" + receiveBuffer.length + " bytes): " + e.message);
            }
            receiveBuffer = "";
        }
    }

    /**
     * Handle a request from the server
     */
    private static function handleRequest(id:String, payload:Object):Void {
        var command:String = String(payload.command);
        var params:Object = payload.params || {};

        try {
        switch (command) {
            case "ping":
                sendResponse(id, { success: true, result: "pong" });
                break;

            case "setup":
                if (initialSetupDone) {
                    // Reconnect: firmware's runtime state (assets with live hit
                    // counts etc.) is authoritative — push it back to Deno.
                    // But always accept gameConfig from Deno since it owns
                    // config fields like scaleMode/align/shrinkHeight that the
                    // firmware doesn't modify.
                    if (params.data != undefined && params.data.gameConfig != undefined) {
                        AppData.data.gameConfig = params.data.gameConfig;
                    }
                    sendResponse(id, { success: true });
                    sendMessage("syncState", { appData: AppData.data });
                } else {
                    // First connect: accept Deno's data and load game
                    AppData.data = params.data;
                    AppData.originalData = JSON.parse(JSON.stringify(params.data));
                    if (params.settings != undefined) {
                        fixTextFieldBindings = (params.settings.fixTextFieldBindings != false);
                        fixSoundAttach = (params.settings.fixSoundAttach != false);
                        benchmarkingActive = (params.settings.benchmarkingEnabled == true);
                        interpreterFastPath = (params.settings.interpreterFastPath != false);
                    }
                    initialSetupDone = true;
                    sendResponse(id, { success: true });
                    if (childMode) {
                        // Game is already loaded — RAEngine injected the
                        // firmware loader into it. Signal ready immediately,
                        // then start badge preload (which needs AppData).
                        sendMessage("gameLoaded", { bytes: 0 });
                        try { startBadgePreload(); } catch (e:Error) { logError("startBadgePreload", e); }
                    } else {
                        loadGame(params.gameUrl);
                    }
                }
                break;

            case "evaluate":
                _stageContext[0] = gameRoot;
                var formula:Array = params.formula;
                var result:Array = evaluate(formula, 1, formula.length, _stageContext, _stageKeys);
                var formatted:Object = formatOutput(result, 0);
                sendResponse(id, { success: true, result: formatted });
                break;

            case "evaluateMultiple":
                _stageContext[0] = gameRoot;
                var formulas:Array = params.formulas;
                var results:Array = [];
                for (var f:Number = 0; f < formulas.length; f++) {
                    var formulaItem:Array = formulas[f];
                    var resultItem:Array = evaluate(formulaItem, 1, formulaItem.length, _stageContext, _stageKeys);
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
                    var pathResult:Array = evaluate(params.pathFormula, 1, params.pathFormula.length, _stageContext, _stageKeys);
                    if (pathResult != null && pathResult.length > 0) {
                        startTarget = pathResult[0];
                        pathPrefix = String(params.pathString);
                    } else {
                        // Path evaluation failed
                        sendResponse(id, { success: false, error: "Invalid path" });
                        break;
                    }
                } else {
                    // Default: start from root
                    startTarget = gameRoot;
                    pathPrefix = "root";
                }

                _visitedStamp++;
                if (params.searchMode == "name") {
                    searchTargetForName(startTarget, find.toLowerCase(), pathPrefix, searchResult, _visitedStamp);
                } else {
                    searchTargetForValue(startTarget, find, pathPrefix, searchResult, _visitedStamp);
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
                // Disable native compiled path until recompilation arrives,
                // otherwise the old compiled SWF evaluates stale conditions.
                nativeAchReady = false;
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
                } else if (params.key == "benchmarkingEnabled") {
                    benchmarkingActive = (params.value == true);
                } else if (params.key == "interpreterFastPath") {
                    interpreterFastPath = (params.value == true);
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

            case "resetGame":
                // Restore Flash Player default Stage properties before reload.
                // loadMovie does NOT reset these, so without this the reloaded
                // game would inherit whatever scaleMode/align the previous run
                // left behind — causing different behavior after reset vs fresh
                // launch.
                Stage.scaleMode = "showAll";
                Stage.align = "";
                resetRuntimeState();
                if (childMode) {
                    // In child mode the firmware is a clip inside _level0 (the
                    // game), so we cannot unload the game from here without
                    // tearing down our own execution context. Instead, ack the
                    // request now and reload _level0 with the game URL — that
                    // destroys this firmware along with the game tree, and the
                    // injected bootstrap on frame 1 of the fresh game will load
                    // a new firmware that reconnects and re-handshakes.
                    //
                    // Clear initialSetupDone so the fresh firmware instance
                    // takes the first-connect path in onConnect/setup — accepting
                    // the engine's AppData (with cleared hit counts) as
                    // authoritative instead of pushing stale static data back.
                    initialSetupDone = false;
                    sendResponse(id, { success: true });
                    var resetUrl:String = String(_level0._url);
                    sendMessage("log", { message: "[reset] reloading _level0 from " + resetUrl });
                    // Mark disconnected and close socket before loadMovie so the
                    // engine processes the TCP close before the new firmware
                    // connects. Without this, loadMovie destroys the socket
                    // implicitly and the TCP FIN races against the new connection.
                    connected = false;
                    try { socket.close(); } catch (e:Error) { /* already closed */ }
                    _level0.loadMovie(resetUrl);
                } else {
                    // Parent mode: unload game and reload.
                    gameRoot.unloadMovie();
                    gameContainer.removeMovieClip();
                    sendResponse(id, { success: true });
                    loadGame(params.gameUrl);
                }
                break;

            case "setValue":
                _stageContext[0] = gameRoot;
                var svFormula:Array = params.pathFormula;
                var svResult:Array = evaluate(svFormula, 1, svFormula.length, _stageContext, _stageKeys);
                if (svResult != null && svResult.length > 0) {
                    var svTarget:Object = svResult[0];
                    var svProp:String = params.property;
                    var svRaw:String = params.value;
                    var svNum:Number = Number(svRaw);
                    if (!isNaN(svNum) && svRaw != "") {
                        svTarget[svProp] = svNum;
                    } else if (svRaw == "true") {
                        svTarget[svProp] = true;
                    } else if (svRaw == "false") {
                        svTarget[svProp] = false;
                    } else if (svRaw == "null") {
                        svTarget[svProp] = null;
                    } else {
                        svTarget[svProp] = svRaw;
                    }
                    sendResponse(id, { success: true });
                } else {
                    sendResponse(id, { success: false, error: "Path not found" });
                }
                break;

            case "invokeMethod":
                // Resolve a path formula to a target object and call a named
                // method on it with the supplied args. Used by the Recorded
                // Test harness to drive interaction (clicks, ticks, ...)
                // without having to inject input events into Flash Player.
                _stageContext[0] = gameRoot;
                var imFormula:Array = params.pathFormula;
                var imResult:Array = evaluate(imFormula, 1, imFormula.length, _stageContext, _stageKeys);
                if (imResult == null || imResult.length == 0) {
                    sendResponse(id, { success: false, error: "Path not found" });
                    break;
                }
                if (imResult.length > 1) {
                    sendResponse(id, { success: false, error: "Path matched " + imResult.length + " elements, expected 1" });
                    break;
                }
                var imTarget:Object = imResult[0];
                var imMethod:String = String(params.method);
                var imFn:Function = imTarget[imMethod];
                if (typeof(imFn) != "function") {
                    sendResponse(id, { success: false, error: "Not a function: " + imMethod });
                    break;
                }
                var imArgs:Array = (params.args instanceof Array) ? params.args : [];
                var imRet = imFn.apply(imTarget, imArgs);
                var imFormatted:Object = formatOutput([imRet], 0);
                sendResponse(id, { success: true, result: imFormatted });
                break;

            case "focusElement":
                _stageContext[0] = gameRoot;
                var feFormula:Array = params.pathFormula;
                var feResult:Array = evaluate(feFormula, 1, feFormula.length, _stageContext, _stageKeys);
                if (feResult == null || feResult.length == 0) {
                    sendResponse(id, { success: false, error: "Path not found" });
                    break;
                }
                if (feResult.length > 1) {
                    sendResponse(id, { success: false, error: "Path matched " + feResult.length + " elements, expected 1" });
                    break;
                }
                Selection.setFocus(feResult[0]);
                sendResponse(id, { success: true });
                break;

            case "checkElementReady":
                // Effective-visibility check used by waitForElement: a leaf
                // can have _visible=true while an ancestor (e.g. a wrapper
                // panel like gui_spell) has _visible=false, hiding it from
                // the human player. Walk _parent up to gameRoot and
                // require every level to be _visible.
                _stageContext[0] = gameRoot;
                var crFormula:Array = params.pathFormula;
                var crResult:Array = evaluate(crFormula, 1, crFormula.length, _stageContext, _stageKeys);
                if (crResult == null || crResult.length == 0) {
                    sendResponse(id, { success: true, ready: false, reason: "not found" });
                    break;
                }
                var crCurrent:Object = crResult[0];
                var crLevel:Number = 0;
                var crReady:Boolean = true;
                var crReason:String = null;
                while (crCurrent != null && crCurrent != undefined && crLevel < 32) {
                    if (crCurrent._visible === false) {
                        var crName:String = String(crCurrent._name);
                        crReady = false;
                        crReason = "ancestor hidden: " + (crName == "" ? "<root>" : crName) + " (level " + crLevel + ")";
                        break;
                    }
                    if (crCurrent == gameRoot) break;
                    crCurrent = crCurrent._parent;
                    crLevel++;
                }
                sendResponse(id, { success: true, ready: crReady, reason: crReason });
                break;

            case "dumpDisplayTree":
                _stageContext[0] = gameRoot;
                var dumpFormula:Array = params.pathFormula;
                var dumpPath:String = params.pathString != undefined ? String(params.pathString) : "stage";
                var dumpResult:Array = evaluate(dumpFormula, 1, dumpFormula.length, _stageContext, _stageKeys);
                if (dumpResult == null || dumpResult.length == 0) {
                    sendResponse(id, { success: false, error: "Path not found" });
                    break;
                }
                sendResponse(id, { success: true, tree: buildDisplayTree(dumpResult[0], dumpPath) });
                break;

            case "setRecording":
                recording = (params.recording == true);
                sendMessage("log", { message: "[recording] setRecording -> " + recording + " (gameRoot=" + (gameRoot == null ? "null" : "set") + ")" });
                if (recording) {
                    setupRecordingListener();
                } else {
                    teardownRecordingListener();
                }
                sendResponse(id, { success: true });
                break;

            case "setHitTest":
                if (params.active == true) {
                    setupHitTestListener(params.elementMode == true);
                } else {
                    teardownHitTestListener();
                }
                sendResponse(id, { success: true });
                break;

            case "loadCompiledAvm1":
                var naUrl:String = String(params.url);
                var naIndices:Array = params.compiledIndices;
                var rpIndices:Array = params.rpCompiledIndices;
                nativeAchReady = false;
                nativeAchFnMap = {};
                nativeAchStorage = [];
                for (var ci:Number = 0; ci < naIndices.length; ci++) {
                    nativeAchFnMap[naIndices[ci]] = ci;
                }
                nativeRPReady = false;
                nativeRPFnMap = {};
                nativeRPStorage = [];
                for (var ri:Number = 0; ri < rpIndices.length; ri++) {
                    nativeRPFnMap[rpIndices[ri]] = ri;
                }
                var naHost:MovieClip = (_self != null) ? _self : _root;
                naHost.__nativeAchClip.removeMovieClip();
                var naClip:MovieClip = naHost.createEmptyMovieClip("__nativeAchClip", 983742);
                naClip._visible = false;
                var naLoader:MovieClipLoader = new MovieClipLoader();
                var naListener:Object = {};
                var naId:String = id;
                naListener.onLoadInit = function(target:MovieClip):Void {
                    if (_global.__nativeAch != undefined) {
                        Main.nativeAchReady = true;
                        if (_global.__nativeRP != undefined) {
                            Main.nativeRPReady = true;
                        }
                        Main.sendResponse(naId, { success: true });
                    } else {
                        Main.sendResponse(naId, { success: false, error: "__nativeAch not defined after load" });
                    }
                };
                naListener.onLoadError = function(target:MovieClip, errorCode:String):Void {
                    Main.sendResponse(naId, { success: false, error: "Load failed: " + errorCode });
                };
                naLoader.addListener(naListener);
                naLoader.loadClip(naUrl, naClip);
                break;

            default:
                sendResponse(id, { success: false, error: "Unknown command: " + command });
        }
        } catch (e:Error) {
            logError("command:" + command, e);
            try { sendResponse(id, { success: false, error: e.message }); } catch (e2:Error) {}
        }
    }

    /**
     * Send a response to a request
     */
    private static function sendResponse(id:String, data:Object):Void {
        if (!connected || socket == null) return;
        var message:Array = ["RESPONSE", id, data];
        var json:String = JSON.stringify(message);
        socket.send(json + chr(0));
    }

    /**
     * Send an unsolicited message to the server
     */
    private static function sendMessage(type:String, data:Object):Void {
        if (!connected || socket == null) return;
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
    // Recording: capture user clicks and forward paths to the engine
    // ========================================================================

    private static function setupRecordingListener():Void {
        if (recordingMouseListener != null) return;
        recordingMouseListener = {};
        // Capture on mouseDown, not mouseUp: the clicked element's own
        // handler (onRelease / IDE-compiled button action) typically runs
        // before our Mouse.addListener.onMouseUp, and that handler often
        // removes the element (e.g., a PLAY button that advances from the
        // title screen). By the time mouseUp arrives, hitTest finds nothing.
        recordingMouseListener.onMouseDown = function():Void {
            try {
                if (!Main.recording) return;
                var x:Number = _level0._xmouse;
                var y:Number = _level0._ymouse;
                if (Main.gameRoot == null) return;
                var target:Object = Main.findClickedTargetRec(Main.gameRoot, x, y);
                if (target == null) {
                    Main.sendMessage("userInput", { kind: "click", path: null, x: x, y: y });
                    return;
                }
                var path:String = Main.buildStagePath(target);
                Main.sendMessage("userInput", { kind: "click", path: path, x: x, y: y });
            } catch (e:Error) { Main.logError("recording onMouseDown", e); }
        };
        Mouse.addListener(recordingMouseListener);
        sendMessage("log", { message: "[recording] mouse listener attached" });
    }

    private static function teardownRecordingListener():Void {
        if (recordingMouseListener == null) return;
        Mouse.removeListener(recordingMouseListener);
        recordingMouseListener = null;
    }

    /**
     * One-shot hit-test analog to a browser devtools element picker.
     * Captures the next mouseDown, resolves the clicked target the same way
     * recording does, forwards the result to the engine, and auto-detaches —
     * so the user can inspect a path without committing to a full recording.
     */
    private static function setupHitTestListener(elementMode:Boolean):Void {
        if (hitTestMouseListener != null) return;
        hitTestElementMode = elementMode;
        installButtonCaptures();
        hitTestMouseListener = {};
        hitTestMouseListener.onMouseDown = function():Void {
            try {
                if (Main.gameRoot == null) return;
                Main.hitTestClickX = _level0._xmouse;
                Main.hitTestClickY = _level0._ymouse;
            } catch (e:Error) { Main.logError("hitTest onMouseDown", e); }
        };
        // Teardown on mouseUp (not mouseDown) so onPress/onRelease/etc. have
        // a chance to fire through our instance-handler capture. At mouseUp,
        // prefer the definitive click-completion signal (onRelease captured
        // a button) over hover state (vulnerable to hover-then-click-away).
        hitTestMouseListener.onMouseUp = function():Void {
            try {
                if (Main.gameRoot == null) { Main.teardownHitTestListener(); return; }
                var x:Number = Main.hitTestClickX;
                var y:Number = Main.hitTestClickY;
                var target:Object = Main.hitTestClickedButton;
                if (target == null) target = Main.hitTestHoveredButton;
                if (target == null) {
                    target = Main.hitTestElementMode
                        ? Main.findElementTargetRec(Main.gameRoot, x, y)
                        : Main.findClickedTargetRec(Main.gameRoot, x, y);
                }
                var path:String = (target == null) ? null : Main.buildStagePath(target);
                var msg:Object = { kind: "hitTest", path: path, x: x, y: y };
                if (target != null) {
                    // namePath = the same chain but with raw `_name` everywhere,
                    // including auto `instance<N>` names. Only attached when it
                    // actually differs from `path`, so the UI knows when to
                    // surface the second (less-reliable) option. Tree highlight
                    // also prefers it because dumpDisplayTree is name-keyed.
                    var namePath:String = Main.buildStagePathByName(target);
                    if (namePath != path) msg.namePath = namePath;
                }
                Main.sendMessage("userInput", msg);
                Main.teardownHitTestListener();
            } catch (e:Error) { Main.logError("hitTest onMouseUp", e); }
        };
        Mouse.addListener(hitTestMouseListener);
    }

    public static function teardownHitTestListener():Void {
        if (hitTestMouseListener == null) return;
        Mouse.removeListener(hitTestMouseListener);
        hitTestMouseListener = null;
        uninstallButtonCaptures();
    }

    /**
     * Install hover-tracking handlers on every Button reachable from
     * gameRoot. While armed, onRollOver records which button the cursor
     * is currently over; onRollOut clears it on leave. At mouseDown, the
     * currently-hovered button is the clicked button. Prior instance
     * handlers (if any) are saved and chained so authored behavior still
     * runs. We deliberately do NOT hook onPress because BUTTONCONDACTION
     * swallows instance onPress on buttons that have a timeline on(press).
     */
    private static function installButtonCaptures():Void {
        hitTestClickedButton = null;
        hitTestHoveredButton = null;
        hitTestButtonCaptures = [];
        if (gameRoot == null) return;
        var buttons:Array = [];
        collectAllButtons(gameRoot, buttons, {}, 0);
        for (var i:Number = 0; i < buttons.length; i++) {
            installCaptureOnButton(buttons[i]);
        }
    }

    /**
     * Separate function to give each button's capture closures their own
     * `prior*` bindings — AS2 shares `var` across a single function scope,
     * so inlining inside a loop would make every capture reference the
     * last iteration's priors.
     *
     * We hook every mouse event AS2 exposes on Buttons because
     * BUTTONCONDACTION suppresses the instance handler ONLY for events it
     * has a timeline action for. A button with `on(release)` in
     * BUTTONCONDACTION leaves onPress/onRollOver/etc. firing normally, so
     * broad coverage maximizes the odds at least one event fires for any
     * given button regardless of how BUTTONCONDACTION was authored.
     *
     * Signal hierarchy:
     *   Layer 1 (definitive click): onPress/onRelease/onDragOver set
     *     hitTestClickedButton; onReleaseOutside clears it (cancelled).
     *   Layer 2 (hover state): onRollOver/onDragOver set hitTestHoveredButton;
     *     onRollOut/onDragOut clear it.
     */
    private static function installCaptureOnButton(btn:Object):Void {
        var priorPress:Object = btn.onPress;
        var priorRelease:Object = btn.onRelease;
        var priorReleaseOutside:Object = btn.onReleaseOutside;
        var priorRollOver:Object = btn.onRollOver;
        var priorRollOut:Object = btn.onRollOut;
        var priorDragOver:Object = btn.onDragOver;
        var priorDragOut:Object = btn.onDragOut;
        hitTestButtonCaptures.push({
            button: btn,
            priorPress: priorPress, priorRelease: priorRelease, priorReleaseOutside: priorReleaseOutside,
            priorRollOver: priorRollOver, priorRollOut: priorRollOut,
            priorDragOver: priorDragOver, priorDragOut: priorDragOut
        });
        btn.onPress = function():Void {
            Main.hitTestClickedButton = this;
            Main.hitTestHoveredButton = this;
            if (typeof priorPress == "function") priorPress.call(this);
        };
        btn.onRelease = function():Void {
            Main.hitTestClickedButton = this;
            if (typeof priorRelease == "function") priorRelease.call(this);
        };
        btn.onReleaseOutside = function():Void {
            if (Main.hitTestClickedButton == this) Main.hitTestClickedButton = null;
            if (typeof priorReleaseOutside == "function") priorReleaseOutside.call(this);
        };
        btn.onRollOver = function():Void {
            Main.hitTestHoveredButton = this;
            if (typeof priorRollOver == "function") priorRollOver.call(this);
        };
        btn.onRollOut = function():Void {
            if (Main.hitTestHoveredButton == this) Main.hitTestHoveredButton = null;
            if (typeof priorRollOut == "function") priorRollOut.call(this);
        };
        btn.onDragOver = function():Void {
            Main.hitTestClickedButton = this;
            Main.hitTestHoveredButton = this;
            if (typeof priorDragOver == "function") priorDragOver.call(this);
        };
        btn.onDragOut = function():Void {
            if (Main.hitTestHoveredButton == this) Main.hitTestHoveredButton = null;
            if (typeof priorDragOut == "function") priorDragOut.call(this);
        };
    }

    private static function uninstallButtonCaptures():Void {
        if (hitTestButtonCaptures == null) return;
        for (var i:Number = 0; i < hitTestButtonCaptures.length; i++) {
            var rec:Object = hitTestButtonCaptures[i];
            restoreHandler(rec.button, "onPress", rec.priorPress);
            restoreHandler(rec.button, "onRelease", rec.priorRelease);
            restoreHandler(rec.button, "onReleaseOutside", rec.priorReleaseOutside);
            restoreHandler(rec.button, "onRollOver", rec.priorRollOver);
            restoreHandler(rec.button, "onRollOut", rec.priorRollOut);
            restoreHandler(rec.button, "onDragOver", rec.priorDragOver);
            restoreHandler(rec.button, "onDragOut", rec.priorDragOut);
        }
        hitTestButtonCaptures = null;
        hitTestClickedButton = null;
        hitTestHoveredButton = null;
    }

    private static function restoreHandler(obj:Object, name:String, prior:Object):Void {
        if (prior == undefined) delete obj[name];
        else obj[name] = prior;
    }

    /**
     * Walk the display tree from `parent` collecting every Button reachable.
     * Uses the same enumeration approach as `collectHitChildren` (for...in
     * + depth sweep) but unfiltered by position — we need every Button,
     * since bbox is unreliable and the capture mechanism is what tells us
     * which one was actually clicked.
     */
    private static function collectAllButtons(parent:Object, out:Array, visited:Object, depth:Number):Void {
        if (parent == null || depth > 20) return;
        var key:String = String(parent._target);
        if (visited[key]) return;
        visited[key] = true;
        var seen:Object = {};
        for (var nm:String in parent) {
            var child:Object = parent[nm];
            if (seen[nm]) continue;
            seen[nm] = true;
            if (child instanceof Button) {
                out.push(child);
            } else if (child instanceof MovieClip) {
                collectAllButtons(child, out, visited, depth + 1);
            }
        }
        if (parent.getInstanceAtDepth != undefined) {
            for (var d:Number = -16384; d < 0; d++) {
                var c:Object = parent.getInstanceAtDepth(d);
                if (c == null) continue;
                if (String(c._target) == key) continue;
                var cname:String = String(c._name);
                if (seen[cname]) continue;
                seen[cname] = true;
                if (c instanceof Button) {
                    out.push(c);
                } else if (c instanceof MovieClip) {
                    collectAllButtons(c, out, visited, depth + 1);
                }
            }
        }
    }

    /**
     * Find the clickable target under stage coords (x, y) by walking the
     * display tree in z-order (topmost-first). Within a container, children
     * are scanned by _depth descending. For MovieClip children, descendants
     * are probed before the MC's own body, because Flash renders descendants
     * on top of their parent's shapes. First hit wins — matching Flash's own
     * click routing, so a fullscreen dialog dimmer correctly wins over the
     * small widgets behind it.
     */
    public static function findClickedTargetRec(clip:Object, x:Number, y:Number):Object {
        return findTopmostHit(clip, x, y, {}, 0, false);
    }

    /**
     * Element-mode counterpart of findClickedTargetRec — claims hits on
     * any visible MovieClip / Button / TextField under the cursor, not
     * just clickable ones. Used by the Element HitTest inspector so the
     * user can pick decorative wrappers and text labels.
     */
    public static function findElementTargetRec(clip:Object, x:Number, y:Number):Object {
        return findTopmostHit(clip, x, y, {}, 0, true);
    }

    private static function findTopmostHit(clip:Object, x:Number, y:Number, visited:Object, depth:Number, anyElement:Boolean):Object {
        if (clip == null || depth > 20) return null;
        var key:String = String(clip._target);
        if (visited[key]) return null;
        visited[key] = true;

        var children:Array = collectHitChildren(clip, anyElement);
        for (var i:Number = 0; i < children.length; i++) {
            var child:Object = children[i];
            // `_visible = false` elements don't render and don't receive
            // clicks. Pruning here also honors ancestor visibility.
            // `_alpha = 0` is NOT filtered — AS2 routes clicks to
            // fully-transparent elements (invisible-hitbox pattern).
            if (child._visible == false) continue;
            if (child instanceof MovieClip) {
                var sub:Object = findTopmostHit(child, x, y, visited, depth + 1, anyElement);
                if (sub != null) return sub;
                // Click mode: only claim the hit for MCs that actually
                // receive mouse events (onPress/onRelease/...). Plain
                // container MCs stay in the recursion as transparent
                // wrappers. Element mode: any MC counts, since the user
                // is inspecting structure, not click routing.
                if ((anyElement || isMcClickable(child)) && pointInChildStageBounds(child, x, y)) return child;
            } else if (child instanceof Button) {
                if (pointInChildStageBounds(child, x, y)) return child;
            } else if (anyElement && child instanceof TextField) {
                if (pointInChildStageBounds(child, x, y)) return child;
            }
        }
        return null;
    }

    /**
     * Children of `parent` that participate in hit-testing, merged from
     * `for...in` and a timeline depth sweep (the sweep catches DontEnum
     * DefineButton2 Buttons that for...in hides), sorted by getDepth()
     * descending. Always includes MovieClip and Button; TextField is
     * included only when `anyElement` is true (Element HitTest mode).
     * Note: AS2 has no readable `_depth` property — only `getDepth()`.
     */
    private static function collectHitChildren(parent:Object, anyElement:Boolean):Array {
        if (parent == null) return [];
        var seen:Object = {};
        var out:Array = [];
        for (var nm:String in parent) {
            var fc:Object = parent[nm];
            if (fc instanceof MovieClip || fc instanceof Button
                    || (anyElement && fc instanceof TextField)) {
                seen[nm] = true;
                out.push(fc);
            }
        }
        if (parent.getInstanceAtDepth != undefined) {
            for (var d:Number = -16384; d < 0; d++) {
                var child:Object = parent.getInstanceAtDepth(d);
                if (child == null) continue;
                var cname:String = String(child._name);
                if (seen[cname]) continue;
                if (child instanceof MovieClip || child instanceof Button
                        || (anyElement && child instanceof TextField)) {
                    seen[cname] = true;
                    out.push(child);
                }
            }
        }
        out.sort(function(a, b):Number { return Number(b.getDepth()) - Number(a.getDepth()); });
        return out;
    }

    /**
     * True iff stage coords (x, y) hit child.
     *
     * MovieClips: `MovieClip.hitTest(x, y, true)` is shape-accurate.
     *
     * Buttons: AS2 exposes no `getBounds` on Button and no way to read
     * the symbol's registration offset, so we can't compute a bbox in
     * code — any `_x + _width` math silently mis-sizes buttons whose
     * author chose a non-top-left registration. Instead we move a
     * persistent 1×1 probe MC to the click point and ask Flash via
     * `probe.hitTest(button)`, which delegates to its internal bbox
     * logic and respects whatever registration the symbol was authored
     * with. Note the direction: `button.hitTest(probe)` silently returns
     * false for MovieClip targets in AS2, so the reverse is the only
     * reliable form.
     */
    private static function pointInChildStageBounds(child:Object, x:Number, y:Number):Boolean {
        if (child == null) return false;
        if (child instanceof MovieClip) {
            return child.hitTest(x, y, true) == true;
        }
        // TextField has the same `getBounds`-via-AS2 problem as Button —
        // the symbol's registration offset isn't introspectable, so the
        // probe-vs-target dance is the most reliable bbox test.
        if (child instanceof Button || child instanceof TextField) {
            var probe:MovieClip = getHitProbe();
            if (probe == null) return false;
            probe._x = x;
            probe._y = y;
            return probe.hitTest(child) == true;
        }
        return false;
    }

    /**
     * True iff this MovieClip is button-like — i.e., Flash would route
     * clicks to it rather than letting them pass through. An MC becomes
     * interactive when any of these handlers is defined on the instance
     * or its prototype. `onMouseDown/Up/Move` are broadcast-style
     * listeners and don't make the MC intercept clicks, so they're
     * intentionally excluded.
     */
    private static function isMcClickable(mc:Object):Boolean {
        if (mc == null) return false;
        if (typeof mc.onPress == "function") return true;
        if (typeof mc.onRelease == "function") return true;
        if (typeof mc.onReleaseOutside == "function") return true;
        if (typeof mc.onRollOver == "function") return true;
        if (typeof mc.onRollOut == "function") return true;
        if (typeof mc.onDragOver == "function") return true;
        if (typeof mc.onDragOut == "function") return true;
        return false;
    }

    private static function getHitProbe():MovieClip {
        if (hitProbe == null || hitProbe._parent == null) {
            hitProbe = _level0.createEmptyMovieClip("__raHitProbe", 1048575);
            if (hitProbe == null) return null;
            // AS2 quirk: `mc.hitTest(target)` object-form silently returns
            // false when the source clip has `_visible = false`. The probe
            // must stay visible to participate in hitTest; we hide it by
            // zeroing _alpha and parking it off-stage when idle.
            hitProbe._alpha = 0;
            hitProbe._x = -30000;
            hitProbe._y = -30000;
            hitProbe.beginFill(0x000000);
            hitProbe.moveTo(0, 0);
            hitProbe.lineTo(1, 0);
            hitProbe.lineTo(1, 1);
            hitProbe.lineTo(0, 1);
            hitProbe.endFill();
        }
        return hitProbe;
    }

    /**
     * Walk _parent chain from a clip up to gameRoot, emitting "stage.a.b.c".
     * Segments come from _name, except when Flash auto-assigned a volatile
     * "instance<N>" name — those get replaced with a type+coord filter so
     * the path survives across runs where N isn't stable.
     */
    public static function buildStagePath(clip:Object):String {
        return buildStagePathInternal(clip, false);
    }

    /**
     * Pure-name variant: keeps the literal `_name` (including the
     * volatile `instance<N>` ones) at every level. Only useful for UI
     * affordances that need to match the dumpDisplayTree representation
     * (which is also dotted-name); never use this for replay paths.
     */
    public static function buildStagePathByName(clip:Object):String {
        return buildStagePathInternal(clip, true);
    }

    private static function buildStagePathInternal(clip:Object, nameOnly:Boolean):String {
        if (clip == null) return null;
        var segments:Array = [];
        var current:Object = clip;
        var guard:Number = 0;
        while (current != null && current != gameRoot && current != _level0) {
            if (guard++ > 50) break; // runaway parent chain
            var n:String = String(current._name);
            if (n == null || n == "" || n == "undefined") break;
            segments.unshift(nameOnly ? n : buildPathSegment(current, n));
            current = current._parent;
        }
        if (segments.length == 0) return "stage";
        var out:String = "stage";
        for (var i:Number = 0; i < segments.length; i++) {
            var seg:String = segments[i];
            out += (seg.charAt(0) == "[") ? seg : ("." + seg);
        }
        return out;
    }

    private static function buildPathSegment(clip:Object, name:String):String {
        if (!isAutoInstanceName(name)) return name;
        var tn:String = typeNameOf(clip);
        return "[type(this) == '" + tn + "' && ._x == " + Number(clip._x)
            + " && ._y == " + Number(clip._y) + "]";
    }

    private static function isAutoInstanceName(n:String):Boolean {
        if (n == null || n.length <= 8) return false;
        if (n.substr(0, 8) != "instance") return false;
        for (var i:Number = 8; i < n.length; i++) {
            var code:Number = n.charCodeAt(i);
            if (code < 48 || code > 57) return false;
        }
        return true;
    }

    // ========================================================================
    // Badge Image Preloading
    // ========================================================================

    /**
     * Start preloading badge images in background
     */
    private static function startBadgePreload():Void {
        // Create off-screen container for preloaded images
        var preloadHost:MovieClip = (_self != null) ? _self : _root;
        preloadContainer = preloadHost.createEmptyMovieClip("preloadContainer", -16383);
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
            try {
                // Evict oldest cached badge if cache is full
                if (Main.badgeImageOrder.length >= Main.MAX_BADGE_CACHE_SIZE) {
                    var evictId:Number = Number(Main.badgeImageOrder.shift());
                    var evicted:MovieClip = Main.badgeImageCache[evictId];
                    if (evicted != null) evicted.removeMovieClip();
                    delete Main.badgeImageCache[evictId];
                }
                Main.badgeImageCache[assetId] = target;
                Main.badgeImageOrder.push(assetId);
                Main.preloadNext();
            } catch (e:Error) { Main.logError("preloadNext.onLoadInit", e); }
        };

        listener.onLoadError = function(target:MovieClip, error:String):Void {
            try {
                // Skip failed images, continue preloading
                Main.preloadNext();
            } catch (e:Error) { Main.logError("preloadNext.onLoadError", e); }
        };

        loader.addListener(listener);
        loader.loadClip(imageBaseUrl + "/asset-image/" + assetId, holder);
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
    // Fast-Path Formula Evaluator
    // ========================================================================

    /**
     * Evaluate a formula using a pre-detected pattern, bypassing the bytecode interpreter.
     * Pattern IDs: 0=literal num, 1=literal str, 2=null, 3=prop1, 4=prop2, 5=prop3, 6=array filter eq
     */
    private static function evaluateFast(fast:Array):Array {
        switch (fast[0]) {
            case 0: // LITERAL_NUM
                return [fast[1]];
            case 1: // LITERAL_STR
                return [fast[1]];
            case 2: // LITERAL_NULL
                return [null];
            case 3: { // PROP1: gameRoot[prop]
                var v3 = gameRoot[fast[1]];
                return (v3 !== undefined) ? [v3] : [];
            }
            case 4: { // PROP2: gameRoot[a][b]
                var o4 = gameRoot[fast[1]];
                if (o4 === undefined) return [];
                var v4 = o4[fast[2]];
                return (v4 !== undefined) ? [v4] : [];
            }
            case 5: { // PROP3: gameRoot[a][b][c]
                var o5 = gameRoot[fast[1]];
                if (o5 === undefined) return [];
                var o5b = o5[fast[2]];
                if (o5b === undefined) return [];
                var v5 = o5b[fast[3]];
                return (v5 !== undefined) ? [v5] : [];
            }
            case 6: { // PROP + ARRAY_FILTER_EQ: gameRoot[prop].filter(==match)
                var arr6 = gameRoot[fast[1]];
                if (!(arr6 instanceof Array)) return [];
                var match6 = fast[2];
                var result6:Array = [];
                for (var i6:Number = 0; i6 < arr6.length; i6++) {
                    if (arr6[i6] == match6) result6.push(arr6[i6]);
                }
                return result6;
            }
        }
        return null;
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
        // Whole-requirement fast-path: property lookup + literal comparison in one shot.
        // No arrays, no frame cache, no delta handling — just a direct property access and compare.
        if (requirement.fastReq != null && accumulator == 0) {
            var fr:Array = requirement.fastReq;
            var rawA;
            switch (fr[1]) {
                case 3:
                    rawA = gameRoot[fr[2]];
                    break;
                case 4: {
                    var _o4 = gameRoot[fr[2]];
                    rawA = (_o4 !== undefined) ? _o4[fr[3]] : undefined;
                    break;
                }
                case 5: {
                    var _o5 = gameRoot[fr[2]];
                    if (_o5 !== undefined) _o5 = _o5[fr[3]];
                    rawA = (_o5 !== undefined) ? _o5[fr[4]] : undefined;
                    break;
                }
            }
            var rawB = fr[fr.length - 1];
            var passed:Boolean = false;
            switch (fr[0]) {
                case 0: passed = (rawA == rawB); break;
                case 1: passed = (rawA != rawB); break;
                case 2: passed = (rawA > rawB); break;
                case 3: passed = (rawA >= rawB); break;
                case 4: passed = (rawA < rawB); break;
                case 5: passed = (rawA <= rawB); break;
            }
            return {passed: passed, valid: true, valueA: (rawA !== undefined) ? rawA : 0};
        }

        // Check if compiled formulas exist
        if (requirement.compiledA == null || requirement.compiledB == null) {
            return {passed: false, valid: false, valueA: 0};
        }

        // Use addressA/addressB as cache keys
        var cacheKeyA:String = requirement.addressA;
        var cacheKeyB:String = requirement.addressB;

        // Evaluate current values (with caching, fast-path preferred)
        var currentA:Array;
        if (frameCache.hasOwnProperty(cacheKeyA)) {
            currentA = frameCache[cacheKeyA];
        } else {
            currentA = requirement.fastA != null
                ? evaluateFast(requirement.fastA)
                : evaluate(requirement.compiledA, 1, requirement.compiledA.length, _stageContext, _stageKeys);
            frameCache[cacheKeyA] = currentA;
        }

        var currentB:Array;
        if (frameCache.hasOwnProperty(cacheKeyB)) {
            currentB = frameCache[cacheKeyB];
        } else {
            currentB = requirement.fastB != null
                ? evaluateFast(requirement.fastB)
                : evaluate(requirement.compiledB, 1, requirement.compiledB.length, _stageContext, _stageKeys);
            frameCache[cacheKeyB] = currentB;
        }

        // Evaluate failed
        if (currentA == null || currentB == null) {
            return {passed: false, valid: false, valueA: 0};
        }

        // Only allow single-value results (empty array is valid for null comparison)
        if (currentA.length > 1 || currentB.length > 1) {
            return {passed: false, valid: false, valueA: 0};
        }

        // Handle Delta type: capture previous values BEFORE storing current ones
        var needDeltaA:Boolean = (requirement.typeA == "DELTA");
        var needDeltaB:Boolean = (requirement.typeB == "DELTA");
        var deltaData:Object = deltaValues[requirement.id];

        // Capture previous values before storeDeltaValue overwrites them
        var capturedPrevA = undefined;
        var capturedHasA:Boolean = false;
        var capturedPrevB = undefined;
        var capturedHasB:Boolean = false;
        if (deltaData != null) {
            if (needDeltaA) {
                capturedPrevA = deltaData.prevA;
                capturedHasA = deltaData.hasA == true;
            }
            if (needDeltaB) {
                capturedPrevB = deltaData.prevB;
                capturedHasB = deltaData.hasB == true;
            }
        }

        // Now store current values (this overwrites prevA/prevB in deltaData)
        if (needDeltaA) {
            storeDeltaValue(requirement.id, "A", currentA.length == 1 ? currentA[0] : undefined);
        }
        if (needDeltaB) {
            storeDeltaValue(requirement.id, "B", currentB.length == 1 ? currentB[0] : undefined);
        }

        // Use captured previous values for comparison
        var resultA:Array;
        if (needDeltaA) {
            if (deltaData == null || !capturedHasA) {
                return {passed: false, valid: false, valueA: 0};
            }
            resultA = (capturedPrevA === undefined) ? [] : [capturedPrevA];
        } else {
            resultA = currentA;
        }

        var resultB:Array;
        if (needDeltaB) {
            if (deltaData == null || !capturedHasB) {
                return {passed: false, valid: false, valueA: 0};
            }
            resultB = (capturedPrevB === undefined) ? [] : [capturedPrevB];
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
        var currentA:Array;
        if (frameCache.hasOwnProperty(cacheKeyA)) {
            currentA = frameCache[cacheKeyA];
        } else {
            currentA = requirement.fastA != null
                ? evaluateFast(requirement.fastA)
                : evaluate(requirement.compiledA, 1, requirement.compiledA.length, _stageContext, _stageKeys);
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
        // Per-member info: each entry is {index, currentTrue, valid, locked},
        // collected so per-member hit counts can be applied later without
        // re-evaluating (which would corrupt deltas and lose info).
        var members:Array = [];

        // Evaluate the first condition
        var evalResult:Object = evaluateRequirementCondition(req, frameCache, 0);

        var firstMaxH:Number = req.maxHits || 0;
        var firstHts:Number = req.hits || 0;
        var firstLocked:Boolean = (firstMaxH > 0 && firstHts >= firstMaxH);
        var firstCurrent:Boolean = evalResult.valid && evalResult.passed;
        var firstSatisfied:Boolean = firstLocked || firstCurrent;

        members.push({
            index: k,
            currentTrue: firstCurrent,
            valid: evalResult.valid,
            locked: firstLocked
        });

        if (!evalResult.valid && !firstLocked) {
            // If first condition is invalid (and not locked-true), find terminal and return false
            while (k + 1 < group.requirements.length) {
                k++;
                // Skip indices we should skip
                while (k < group.requirements.length && skipIndices[k]) k++;
                if (k >= group.requirements.length) break;
                var nextReq0:Object = group.requirements[k];
                if (nextReq0.flag != "AND_NEXT" && nextReq0.flag != "OR_NEXT") {
                    return {chainResult: false, terminalIndex: k, valid: false, members: members};
                }
            }
            // Walk backwards from k-1 to find last non-skipped index
            var lastValid0:Number = -1;
            for (var bk0:Number = k - 1; bk0 >= startIndex; bk0--) {
                if (!skipIndices[bk0]) { lastValid0 = bk0; break; }
            }
            return {chainResult: false, terminalIndex: lastValid0, valid: false, members: members};
        }

        var chainResult:Boolean = firstSatisfied;
        var currentOp:String = req.flag;  // "AND_NEXT" or "OR_NEXT"

        // Walk the chain
        while (k + 1 < group.requirements.length) {
            k++;
            // Skip indices we should skip
            while (k < group.requirements.length && skipIndices[k]) k++;
            if (k >= group.requirements.length) {
                // Chain ended without terminal - walk backwards to find last non-skipped index
                var lastValidK:Number = -1;
                for (var bk:Number = k - 1; bk >= startIndex; bk--) {
                    if (!skipIndices[bk]) { lastValidK = bk; break; }
                }
                return {chainResult: false, terminalIndex: lastValidK, valid: false, members: members};
            }

            var nextReq:Object = group.requirements[k];
            var nextEval:Object = evaluateRequirementCondition(nextReq, frameCache, 0);

            var nextMaxH:Number = nextReq.maxHits || 0;
            var nextHts:Number = nextReq.hits || 0;
            var nextLocked:Boolean = (nextMaxH > 0 && nextHts >= nextMaxH);
            var nextCurrent:Boolean = nextEval.valid && nextEval.passed;
            var nextSatisfied:Boolean = nextLocked || nextCurrent;

            // Apply the operator from the previous requirement.
            // Locked-true members contribute true regardless of current condition;
            // this matches canonical RA semantics for hit-counted chain members.
            if (currentOp == "AND_NEXT") {
                chainResult = chainResult && nextSatisfied;
            } else {  // OR_NEXT
                chainResult = chainResult || nextSatisfied;
            }

            members.push({
                index: k,
                currentTrue: nextCurrent,
                valid: nextEval.valid,
                locked: nextLocked
            });

            // Check if this is the terminal (not AndNext/OrNext)
            if (nextReq.flag != "AND_NEXT" && nextReq.flag != "OR_NEXT") {
                return {chainResult: chainResult, terminalIndex: k, valid: true, members: members};
            }

            // Continue chain - update operator for next iteration
            currentOp = nextReq.flag;
        }

        // Reached end of requirements without terminal - invalid
        return {chainResult: false, terminalIndex: k, valid: false, members: members};
    }

    /**
     * Increment hit counts for AndNext/OrNext chain members based on the
     * partial chain truth up to and including each member. The chain terminal
     * is excluded — terminal hits are tracked by the regular Phase 5 path.
     *
     * Each member with maxHits > 0 increments by 1 when the partial chain
     * through that member is currently true (locked-true members contribute
     * truth without incrementing themselves further).
     *
     * @param group       The group containing the requirements
     * @param members     Per-member info from evaluateChain
     * @param iAsset      Index of the achievement (for diff path)
     * @param iGroup      Index of the group (for diff path)
     */
    private static function incrementChainMemberHits(group:Object, members:Array, iAsset:Number, iGroup:Number):Void {
        if (members == null || members.length < 2) return;

        var partialChain:Boolean = false;

        for (var i:Number = 0; i < members.length; i++) {
            var m:Object = members[i];
            var req:Object = group.requirements[m.index];
            var maxH:Number = req.maxHits || 0;
            var curH:Number = req.hits || 0;
            var locked:Boolean = (maxH > 0 && curH >= maxH);
            var satisfied:Boolean = locked || (m.valid && m.currentTrue);

            if (i == 0) {
                partialChain = satisfied;
            } else {
                var prevReq:Object = group.requirements[members[i - 1].index];
                if (prevReq.flag == "AND_NEXT") {
                    partialChain = partialChain && satisfied;
                } else {  // OR_NEXT
                    partialChain = partialChain || satisfied;
                }
            }

            // Skip terminal (last member) — handled by the regular Phase 5 path
            if (i == members.length - 1) continue;

            // Increment if eligible: this member has a hit cap, isn't already
            // capped, and the partial chain through this member is true.
            if (maxH > 0 && curH < maxH && partialChain) {
                var basePath:String = "assets/" + iAsset + "/groups/" + iGroup + "/requirements/" + m.index + "/hits";
                diffSet(req, "hits", curH + 1, basePath);
            }
        }
    }

    // ========================================================================
    // Formula Evaluation Engine (ported from Main.as)
    // ========================================================================

    /**
     * Pre-process a compiled formula array in-place.
     * Converts numeric string operands to actual numbers so parseInt isn't called every frame.
     * Marks the formula as preprocessed by setting index 0 to the number 1 (was "VERSION_1").
     */
    private static function preprocessFormula(formula:Array):Void {
        if (formula == null || formula.length < 1) {
            throw new Error("preprocessFormula: formula is empty");
        }
        // Accept either the raw VERSION_1 header or an already-preprocessed formula
        // (index 0 set to the number 1). Anything else indicates corruption.
        if (formula[0] !== "VERSION_1" && formula[0] !== 1) {
            throw new Error("preprocessFormula: missing VERSION_1 header (got " + formula[0] + ")");
        }
        formula[0] = 1; // Mark as preprocessed
        preprocessRange(formula, 1, formula.length);
    }

    /** Recursively preprocess a range of tokens within a formula array. */
    private static function preprocessRange(formula:Array, start:Number, end:Number):Void {
        for (var i:Number = start; i < end; i++) {
            switch (formula[i]) {
                case "VALUE":
                    i++;
                    formula[i] = parseFloat(formula[i]);
                    break;
                case "OBJECT_ACCESS":
                case "ARRAY_ACCESS":
                    i++;
                    formula[i] = parseInt(formula[i], 10);
                    break;
                case "REMEMBER":
                    i++;
                    var remBlockLen:Number = parseInt(formula[i], 10);
                    formula[i] = remBlockLen;
                    var remEnd:Number = i + remBlockLen;
                    preprocessRange(formula, i + 1, remEnd + 1);
                    i = remEnd;
                    break;
                case "TERNARY":
                    i++;
                    var thenLen:Number = parseInt(formula[i], 10);
                    formula[i] = thenLen;
                    var thenStart:Number = i + 1;
                    var thenEnd:Number = thenStart + thenLen;
                    preprocessRange(formula, thenStart, thenEnd);
                    // Pre-parse elseLen which sits right after the then-block
                    if (thenEnd < end) {
                        var elseLen:Number = parseInt(formula[thenEnd], 10);
                        formula[thenEnd] = elseLen;
                        var elseStart:Number = thenEnd + 1;
                        var elseEnd:Number = elseStart + elseLen;
                        preprocessRange(formula, elseStart, elseEnd);
                        i = elseEnd - 1; // -1 because loop will ++i
                    }
                    break;
                case "STRING":
                case "IDENTIFIER":
                    i++; // skip operand value
                    break;
            }
        }
    }

    /**
     * Function-call hook. When the formula DSL accesses a property whose
     * value is a Function, we transparently swap it for a wrapper that
     * records the call. The function itself still appears as a function
     * to the DSL — but now exposes a synthetic `.triggered` property
     * that resolves to 1 on frames the wrapper fired and 0 otherwise.
     * So `stage.menu.gotoMySite.triggered` is the achievement-friendly
     * expression; `stage.menu.gotoMySite` alone just yields the function
     * reference.
     *
     * Storage lives on _global so wrapper closures can write to it
     * without needing a reference back into Main, and so it survives
     * across reloads of this firmware in child mode.
     *
     * Returns the wrapper for function values; returns the original
     * value unchanged for everything else.
     */
    private static function wrapHook(parent, key, value) {
        if (typeof(value) != "function") {
            return value;
        }
        if (_global.__raHookSeen == undefined) {
            _global.__raHookSeen = {};
            _global.__raHookPending = {};
            _global.__raHookNextId = 0;
        }
        if (value.__raHookId != undefined || value.__raHookSkip == true) {
            return value;  // already wrapped, or previously failed to wrap
        }
        // First sighting: install a wrapper. The wrapper records the
        // call into _global.__raHookPending[id]; the swap at the top
        // of onFrame moves "pending" → "seen" so eval reads a stable
        // snapshot for the whole frame.
        var id:Number = ++_global.__raHookNextId;
        var orig:Function = value;
        var wrapper:Function = function() {
            _global.__raHookPending[id] = true;
            return orig.apply(this, arguments);
        };
        wrapper.__raHookId = id;
        wrapper.__raHookOrig = orig;
        // Hide internal properties from for...in enumeration
        _global.ASSetPropFlags(wrapper, ["__raHookId", "__raHookOrig"], 1);
        parent[key] = wrapper;
        // If the assignment didn't take (read-only / native slot),
        // mark the original so we don't keep allocating fresh ids on
        // every evaluation. `.triggered` on it will be undefined and
        // the achievement will read as never-fired.
        if (parent[key] !== wrapper) {
            value.__raHookSkip = true;
            return value;
        }
        return wrapper;
    }

    /**
     * Evaluate a compiled formula expression
     * This is a stack-based bytecode interpreter supporting:
     * - Arithmetic: ADD, SUB, MUL, DIV, MOD, POW
     * - Comparison: EQUAL, NOT_EQUAL, GREATER, GREATER_EQUAL, LESSER, LESSER_EQUAL
     * - Boolean: AND, OR, XOR
     * - Access: READ_GLOBAL, OBJECT_ACCESS, ARRAY_ACCESS
     */
    private static function evaluate(formula:Array, start:Number, end:Number, context:Array, keys:Array):Array {
        // Lazy preprocessing: convert string operands to numbers once
        if (formula[0] == "VERSION_1") {
            preprocessFormula(formula);
        }
        var stack:Array = [];
        for (var i:Number = start; i < end; ++i) {
            var token:String = formula[i];
            // Stack underflow guard for binary operators — a malformed formula
            // with more operators than operands would pop undefined from an
            // empty stack and silently produce NaN/type-error results.
            if (token == "ADD" || token == "SUB" || token == "MUL" || token == "DIV" ||
                token == "MOD" || token == "POW" || token == "EQUAL" || token == "NOT_EQUAL" ||
                token == "GREATER" || token == "GREATER_EQUAL" || token == "LESSER" ||
                token == "LESSER_EQUAL" || token == "AND" || token == "OR" || token == "XOR") {
                if (stack.length < 2) {
                    log("Stack underflow for " + token + " (need 2, have " + stack.length + ")");
                    return null;
                }
            } else if (token == "NOT" || token == "READ_GLOBAL" || token == "LEN" || token == "TYPE") {
                if (stack.length < 1) {
                    log("Stack underflow for " + token + " (need 1, have 0)");
                    return null;
                }
            } else if (token == "OBJECT_ACCESS" || token == "ARRAY_ACCESS") {
                if (stack.length < 1) {
                    log("Stack underflow for " + token + " (need 1, have 0)");
                    return null;
                }
            } else if (token == "TERNARY") {
                if (stack.length < 1) {
                    log("Stack underflow for TERNARY (need 1, have 0)");
                    return null;
                }
            }
            switch (token) {
                case "VALUE": {
                    stack.push([formula[++i]]);
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

                    // Scalar fast-path (most common case)
                    if (a.length == 1 && b.length == 1) {
                        var av = a[0], bv = b[0];
                        if (typeof(av) == "string" || typeof(bv) == "string") {
                            stack.push([String(av) + String(bv)]);
                        } else if (typeof(av) == "number" && typeof(bv) == "number") {
                            stack.push([av + bv]);
                        } else {
                            stack.push([NaN]);
                        }
                        break;
                    }

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
                    if (a.length == 1 && b.length == 1) {
                        stack.push([a[0] - b[0]]);
                        break;
                    }
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
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "MUL": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([a[0] * b[0]]);
                        break;
                    }
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
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "DIV": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([b[0] == 0 ? "ERROR" : a[0] / b[0]]);
                        break;
                    }
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(b[j] == 0 ? "ERROR" : a[0] / b[j]);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        if (b[0] == 0) {
                            var result = [];
                            for (var j = 0; j < a.length; ++j) result.push("ERROR");
                            stack.push(result);
                        } else {
                            var result = [];
                            for (var j = 0; j < a.length; ++j) {
                                result.push(a[j] / b[0]);
                            }
                            stack.push(result);
                        }
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(b[j] == 0 ? "ERROR" : a[j] / b[j]);
                        }
                        stack.push(result);
                    } else {
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "MOD": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([b[0] == 0 ? NaN : a[0] % b[0]]);
                        break;
                    }
                    if (a.length == 1) {
                        var result = [];
                        for (var j = 0; j < b.length; ++j) {
                            result.push(b[j] == 0 ? NaN : a[0] % b[j]);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        if (b[0] == 0) {
                            var result = [];
                            for (var j = 0; j < a.length; ++j) {
                                result.push(NaN);
                            }
                            stack.push(result);
                        } else {
                            var result = [];
                            for (var j = 0; j < a.length; ++j) {
                                result.push(a[j] % b[0]);
                            }
                            stack.push(result);
                        }
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(b[j] == 0 ? NaN : a[j] % b[j]);
                        }
                        stack.push(result);
                    } else {
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "POW": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([Math.pow(a[0], b[0])]);
                        break;
                    }
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
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
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
                    if (a.length == 1 && b.length == 1) {
                        stack.push([String(a[0]) === String(b[0]) ? 1 : 0]);
                        break;
                    }
                    if (a.length == 1) {
                        var result = [];
                        var sa:String = String(a[0]);
                        for (var j = 0; j < b.length; ++j) {
                            result.push(sa === String(b[j]) ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        var sb:String = String(b[0]);
                        for (var j = 0; j < a.length; ++j) {
                            result.push(String(a[j]) === sb ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(String(a[j]) === String(b[j]) ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
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
                    if (a.length == 1 && b.length == 1) {
                        stack.push([String(a[0]) !== String(b[0]) ? 1 : 0]);
                        break;
                    }
                    if (a.length == 1) {
                        var result = [];
                        var sa:String = String(a[0]);
                        for (var j = 0; j < b.length; ++j) {
                            result.push(sa !== String(b[j]) ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        var sb:String = String(b[0]);
                        for (var j = 0; j < a.length; ++j) {
                            result.push(String(a[j]) !== sb ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(String(a[j]) !== String(b[j]) ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "GREATER": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([a[0] > b[0] ? 1 : 0]);
                        break;
                    }
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
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "GREATER_EQUAL": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([a[0] >= b[0] ? 1 : 0]);
                        break;
                    }
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
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "LESSER": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([a[0] < b[0] ? 1 : 0]);
                        break;
                    }
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
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "LESSER_EQUAL": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([a[0] <= b[0] ? 1 : 0]);
                        break;
                    }
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
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "AND": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([a[0] && b[0] ? 1 : 0]);
                        break;
                    }
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
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "OR": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([a[0] || b[0] ? 1 : 0]);
                        break;
                    }
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
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "XOR": {
                    var b = stack.pop();
                    var a = stack.pop();
                    if (a.length == 1 && b.length == 1) {
                        stack.push([((a[0] ? 1 : 0) ^ (b[0] ? 1 : 0)) ? 1 : 0]);
                        break;
                    }
                    if (a.length == 1) {
                        var result = [];
                        var av = a[0] ? 1 : 0;
                        for (var j = 0; j < b.length; ++j) {
                            result.push((av ^ (b[j] ? 1 : 0)) ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (b.length == 1) {
                        var result = [];
                        var bv = b[0] ? 1 : 0;
                        for (var j = 0; j < a.length; ++j) {
                            result.push(((a[j] ? 1 : 0) ^ bv) ? 1 : 0);
                        }
                        stack.push(result);
                    } else if (a.length == b.length) {
                        var result = [];
                        for (var j = 0; j < a.length; ++j) {
                            result.push(((a[j] ? 1 : 0) ^ (b[j] ? 1 : 0)) ? 1 : 0);
                        }
                        stack.push(result);
                    } else {
                        var length = Math.max(a.length, b.length);
                        var result = [];
                        for (var j = 0; j < length; ++j) {
                            result.push(NaN);
                        }
                        stack.push(result);
                    }
                    break;
                }
                case "NOT": {
                    var a = stack.pop();
                    // Empty is truthy (matches TERNARY at lines 3341/3366), so NOT(empty) = [0]
                    if (a.length == 0) {
                        stack.push([0]);
                        break;
                    }
                    var result = [];
                    for (var j = 0; j < a.length; ++j) {
                        result.push(a[j] ? 0 : 1);
                    }
                    stack.push(result);
                    break;
                }
                case "LEN": {
                    var a = stack.pop();
                    // Flatten array elements (same as OBJECT_ACCESS preamble)
                    // so len(.arr) where arr=[] returns 0, not 1
                    var flat = [];
                    for (var j = 0; j < a.length; ++j) {
                        if (a[j] instanceof Array) {
                            for (var k = 0; k < a[j].length; ++k) {
                                flat.push(a[j][k]);
                            }
                        } else {
                            flat.push(a[j]);
                        }
                    }
                    stack.push([flat.length]);
                    break;
                }
                case "TYPE": {
                    // type(x) — returns a human-readable class name for each
                    // element of x. Maps AS2 typeof quirks and instanceof
                    // checks to canonical names ("MovieClip", "Button",
                    // "TextField", "Number", etc.) usable in predicates.
                    var tArr = stack.pop();
                    var typeOut = [];
                    for (var j = 0; j < tArr.length; ++j) {
                        typeOut.push(typeNameOf(tArr[j]));
                    }
                    stack.push(typeOut);
                    break;
                }
                case "READ_GLOBAL": {
                    var identifiers = stack.pop();
                    if (identifiers.length == 1) {
                        switch (identifiers[0]) {
                            case "stage":
                            case "root": {
                                stack.push([gameRoot]);
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
                                stack.push([gameRoot._currentframe]);
                                break;
                            }
                            default: {
                                log("Invalid global identifier " + identifiers[0]);
                                return null;
                            }
                        }
                    } else {
                        log("Invalid global identifier " + identifiers);
                        return null;
                    }
                    break;
                }
                case "OBJECT_ACCESS": {
                    var targets = stack.pop();
                    var amount = formula[i + 1];

                    // Flatten Array targets so .prop maps over array elements
                    // e.g. stage.allTitles.charTitle → allTitles is an Array,
                    // so expand its elements as individual targets
                    // Optimization: only allocate flatTargets if arrays are present
                    var needsFlatten:Boolean = false;
                    for (var j = 0; j < targets.length; ++j) {
                        if (targets[j] instanceof Array) {
                            needsFlatten = true;
                            break;
                        }
                    }
                    if (needsFlatten) {
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
                    }

                    var result = [];

                    // OPTIMIZATION: Detect simple property access pattern
                    // Pattern: IDENTIFIER key, READ_GLOBAL, IDENTIFIER <name>, EQUAL (length 6)
                    // Bounds: amount=6 means accesses span i+2..i+7; check i+8 <= end guarantees i+7 is valid
                    if (amount == 6 && i + amount + 2 <= end &&
                        formula[i + 2] == "IDENTIFIER" &&
                        formula[i + 3] == "key" &&
                        formula[i + 4] == "READ_GLOBAL" &&
                        formula[i + 5] == "IDENTIFIER" &&
                        formula[i + 7] == "EQUAL") {

                        var propName:String = formula[i + 6];
                        for (var j = 0; j < targets.length; ++j) {
                            // Synthetic .triggered on hooked functions:
                            // resolves to 1 if the wrapper fired during
                            // the current snapshot window, 0 otherwise.
                            // Returns "ERROR" if the function couldn't be hooked (read-only slot).
                            if (propName == "triggered"
                                    && typeof(targets[j]) == "function"
                                    && targets[j].__raHookId != undefined) {
                                result.push(_global.__raHookSeen[targets[j].__raHookId] == true ? 1 : 0);
                                continue;
                            }
                            if (propName == "triggered"
                                    && typeof(targets[j]) == "function"
                                    && targets[j].__raHookSkip == true) {
                                result.push("ERROR");
                                continue;
                            }
                            // Synthetic .allChildren on MovieClips: returns
                            // a plain object keyed by child name, union of
                            // for...in and a timeline-range depth sweep,
                            // filtered to display-list children. Keying by
                            // name lets Memory Explorer's tree view show
                            // "instance58: [Button]" naturally, and lets
                            // further DSL access like
                            // `stage.a.allChildren.instance58` work as a
                            // regular key filter.
                            //
                            // Opt-in (~16k depth lookups per access) so the
                            // per-frame evaluator isn't slowed.
                            if (propName == "allChildren"
                                    && targets[j] instanceof MovieClip) {
                                var acMc:MovieClip = targets[j];
                                var acObj:Object = {};
                                for (var acName:String in acMc) {
                                    var acVal:Object = acMc[acName];
                                    if (acVal instanceof MovieClip
                                            || acVal instanceof Button
                                            || acVal instanceof TextField) {
                                        acObj[acName] = acVal;
                                    }
                                }
                                for (var acD:Number = -16384; acD < 0; acD++) {
                                    var acChild:Object = acMc.getInstanceAtDepth(acD);
                                    if (acChild == null) continue;
                                    if (!(acChild instanceof MovieClip)
                                            && !(acChild instanceof Button)
                                            && !(acChild instanceof TextField)) continue;
                                    var acCn:String = String(acChild._name);
                                    if (acObj[acCn] == undefined) {
                                        acObj[acCn] = acChild;
                                    }
                                }
                                result.push(acObj);
                                continue;
                            }
                            var value = targets[j][propName];
                            if (value !== undefined) {
                                result.push(wrapHook(targets[j], propName, value));
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

                        // NOTE: for...in misses Button children of
                        // MovieClips (they're marked DontEnum by Flash),
                        // so wildcard DSL queries like `stage.*` won't see
                        // Buttons. Deep-depth enumeration is tempting but
                        // too expensive for the per-frame hot path — can
                        // push 1M+ iterations/frame and hang Flash. The
                        // fast path above handles explicit name access
                        // (`stage.foo.myButton`) via bracket lookup, which
                        // DOES resolve Buttons, so practical cases work.
                        for (var propertyName:String in target) {
                            var propValue = target[propertyName];
                            if (isHiddenBuiltinProp(propertyName, propValue)) continue;
                            childThis.push(propValue);
                            childKeys.push(propertyName);
                        }
                        // Synthetic .triggered for hooked functions, so
                        // generic-path filters like `key == "triggered"`
                        // resolve to the snapshot value.
                        // Returns "ERROR" for functions that couldn't be hooked.
                        if (typeof(target) == "function" && target.__raHookId != undefined) {
                            childThis.push(_global.__raHookSeen[target.__raHookId] == true ? 1 : 0);
                            childKeys.push("triggered");
                        } else if (typeof(target) == "function" && target.__raHookSkip == true) {
                            childThis.push("ERROR");
                            childKeys.push("triggered");
                        }

                        var filteredResult = evaluate(formula, i + 2, i + amount + 2, childThis, childKeys);
                        if (filteredResult == null) filteredResult = [];

                        for (var k = 0; k < filteredResult.length; ++k) {
                            if (filteredResult[k] == true) {
                                // Synthetic .triggered isn't a real
                                // property of `target`, so reading it
                                // back via target[...] would be wrong.
                                // childThis already holds the correct
                                // value (the 1/0 we synthesized).
                                if (childKeys[k] == "triggered"
                                        && typeof(target) == "function"
                                        && target.__raHookId != undefined) {
                                    result.push(childThis[k]);
                                } else {
                                    result.push(wrapHook(target, childKeys[k], target[childKeys[k]]));
                                }
                            }
                        }
                    }

                    stack.push(result);
                    i += amount + 1;
                    break;
                }
                case "ARRAY_ACCESS": {
                    var targets = stack.pop();
                    var amount = formula[i + 1];

                    var result = [];

                    // OPTIMIZATION 1: numeric literal index — `[N]`.
                    if (amount == 2 && formula[i + 2] == "VALUE") {
                        var idx:Number = formula[i + 3];
                        for (var j = 0; j < targets.length; ++j) {
                            var value = targets[j][idx];
                            if (value !== undefined) {
                                result.push(wrapHook(targets[j], idx, value));
                            }
                        }
                        arrAccessOptimized++;
                        stack.push(result);
                        i += amount + 1;
                        break;
                    }

                    // OPTIMIZATION 2: `[key == name]` — equivalent to
                    // `.name`. Keys are unique per parent, so one property
                    // lookup suffices instead of iterating all children.
                    if (amount == 6 && i + amount + 2 <= end &&
                            formula[i + 2] == "IDENTIFIER" &&
                            formula[i + 3] == "key" &&
                            formula[i + 4] == "READ_GLOBAL" &&
                            formula[i + 5] == "IDENTIFIER" &&
                            formula[i + 7] == "EQUAL") {
                        var propName:String = formula[i + 6];
                        for (var j = 0; j < targets.length; ++j) {
                            var value2 = targets[j][propName];
                            if (value2 !== undefined) {
                                result.push(wrapHook(targets[j], propName, value2));
                            }
                        }
                        arrAccessOptimized++;
                        stack.push(result);
                        i += amount + 1;
                        break;
                    }

                    arrAccessGeneric++;

                    // Generic per-row evaluation: for each child of each
                    // target, evaluate the filter bytecode with
                    // `this = [childValue]`, `key = [childKey]`. Collect
                    // the child when the first-element filter result is
                    // true.
                    //
                    // Array-like targets (numeric `length`) iterate
                    // indices 0..length-1. Object-like targets enumerate
                    // own properties via for...in — so expressions like
                    // `stage[this._x == 167]` filter an MC's children by
                    // predicate. Filters that don't reference `this`/`key`
                    // (e.g. `[5 == 5]`) work naturally under this model.
                    for (var j = 0; j < targets.length; ++j) {
                        var target = targets[j];
                        var targetType:String = typeof(target);
                        if (typeof(target.length) == "number") {
                            var tLen:Number = target.length;
                            for (var k = 0; k < tLen; ++k) {
                                var rThis:Array = [target[k]];
                                var rKey:Array = [k];
                                var rowResult = evaluate(formula, i + 2, i + amount + 2, rThis, rKey);
                                if (rowResult != null && rowResult.length > 0 && rowResult[0] == true) {
                                    result.push(wrapHook(target, k, target[k]));
                                }
                            }
                        } else if (target != null &&
                                targetType != "number" &&
                                targetType != "string" &&
                                targetType != "boolean" &&
                                targetType != "function" &&
                                targetType != "undefined") {
                            // Canonical enumeration for object-like targets:
                            // for...in enumerables + MC/TextField built-ins
                            // (via getBuiltinProperties), with the same
                            // isHiddenBuiltinProp filter the UI's formatOutput
                            // applies. This makes `stage[true]` iterate the
                            // exact same collection that `stage` displays, so
                            // filter results stay predictable and match the
                            // object view.
                            //
                            // Denylist of primitive typeofs (rather than
                            // allowlisting "object"/"movieclip") accepts MCs
                            // and any future display type.
                            var allNames:Array = [];
                            var allValues:Array = [];
                            for (var nm:String in target) {
                                if (isHiddenBuiltinProp(nm, target[nm])) continue;
                                allNames.push(nm);
                                allValues.push(target[nm]);
                            }
                            var builtins:Array = getBuiltinProperties(target);
                            for (var b:Number = 0; b < builtins.length; b++) {
                                if (isHiddenBuiltinProp(builtins[b].name, builtins[b].value)) continue;
                                allNames.push(builtins[b].name);
                                allValues.push(builtins[b].value);
                            }
                            for (var p:Number = 0; p < allNames.length; p++) {
                                var rThis2:Array = [allValues[p]];
                                var rKey2:Array = [allNames[p]];
                                var rowResult2 = evaluate(formula, i + 2, i + amount + 2, rThis2, rKey2);
                                if (rowResult2 != null && rowResult2.length > 0 && rowResult2[0] == true) {
                                    result.push(wrapHook(target, allNames[p], allValues[p]));
                                }
                            }
                        }
                    }

                    stack.push(result);
                    i += amount + 1;
                    break;
                }
                case "REMEMBER": {
                    var remLen:Number = formula[++i];
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
                    // Parse embedded bytecode lengths (pre-parsed by preprocessFormula)
                    var thenLen:Number = formula[++i];
                    var thenStart:Number = i + 1;
                    var thenEnd:Number = thenStart + thenLen;

                    var elseLen:Number = formula[thenEnd];
                    var elseStart:Number = thenEnd + 1;
                    var elseEnd:Number = elseStart + elseLen;
                    i = elseEnd - 1; // -1 because loop will ++i

                    if (stack.length == 0) {
                        throw new Error("Stack underflow at TERNARY");
                    }
                    var condition:Array = Array(stack.pop());

                    // Empty condition array means nothing matched — push empty result
                    if (condition.length == 0) {
                        stack.push([]);
                        break;
                    }

                    // Check if condition is uniformly truthy or falsy
                    var allTruthy:Boolean = true;
                    var allFalsy:Boolean = true;
                    for (var cj:Number = 0; cj < condition.length; cj++) {
                        var cv = condition[cj];
                        var cvTruthy:Boolean = (cv != 0 && cv != false && cv != null && cv != "");
                        if (cvTruthy) allFalsy = false;
                        else allTruthy = false;
                    }

                    if (allTruthy) {
                        // Only evaluate then branch
                        var thenOnly:Array = evaluate(formula, thenStart, thenEnd, context, keys);
                        stack.push(thenOnly != null ? thenOnly : []);
                    } else if (allFalsy) {
                        // Only evaluate else branch
                        var elseOnly:Array = evaluate(formula, elseStart, elseEnd, context, keys);
                        stack.push(elseOnly != null ? elseOnly : []);
                    } else {
                        // Mixed condition - must evaluate both branches
                        var thenResult:Array = evaluate(formula, thenStart, thenEnd, context, keys);
                        var elseResult:Array = evaluate(formula, elseStart, elseEnd, context, keys);
                        if (thenResult == null) thenResult = [];
                        if (elseResult == null) elseResult = [];

                        // Element-wise selection based on condition
                        var result:Array = [];
                        var len:Number = condition.length;
                        for (var j:Number = 0; j < len; j++) {
                            var cond = condition[j];
                            var isTruthy:Boolean = (cond != 0 && cond != false && cond != null && cond != "");
                            var thenVal = (thenResult.length == 1) ? thenResult[0] : (j < thenResult.length ? thenResult[j] : null);
                            var elseVal = (elseResult.length == 1) ? elseResult[0] : (j < elseResult.length ? elseResult[j] : null);
                            result.push(isTruthy ? thenVal : elseVal);
                        }
                        stack.push(result);
                    }
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
    private static var _visitedStamp:Number = 0;

    private static function searchTargetForValue(target:Object, value:String, path:String, output:Array, stamp:Number):Void {
        try {
            // Circular reference protection: stamp objects with a unique marker
            // per search invocation for O(1) lookup instead of linear array scan
            if (typeof(target) == "movieclip" || typeof(target) == "object") {
                if (target.__raVisited === stamp) return;
                target.__raVisited = stamp;
            }

            if (typeof(target) == "movieclip") {
                for (var key:String in target) {
                    searchTargetForValue(target[key], value, path + "." + key, output, stamp);
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
                    searchTargetForValue(target[j], value, path + "[" + j + "]", output, stamp);
                }
            } else if (target == null) {
                if ("null" == value) {
                    output.push(path);
                }
            } else if (target == undefined) {
                if ("undefined" == value) {
                    output.push(path);
                }
            } else if (typeof(target) == "number" && isNaN(Number(target))) {
                if ("NaN" == value) {
                    output.push(path);
                }
            } else if (typeof(target) == "object") {
                for (var key2:String in target) {
                    searchTargetForValue(target[key2], value, path + "." + key2, output, stamp);
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
        } catch (e:Error) { /* skip this subtree */ }
    }

    /**
     * Recursively search for property names containing a substring
     * @param visited Array to track visited objects (prevents infinite loops from circular references)
     */
    private static function searchTargetForName(target:Object, nameLower:String, path:String, output:Array, stamp:Number):Void {
        try {
            // Circular reference protection: stamp objects with a unique marker
            // per search invocation for O(1) lookup instead of linear array scan
            if (typeof(target) == "movieclip" || typeof(target) == "object") {
                if (target.__raVisited === stamp) return;
                target.__raVisited = stamp;
            }

            if (typeof(target) == "movieclip" || typeof(target) == "object") {
                for (var key:String in target) {
                    var childPath:String = path + "." + key;
                    if (key.toLowerCase().indexOf(nameLower) >= 0) {
                        output.push(childPath);
                    }
                    searchTargetForName(target[key], nameLower, childPath, output, stamp);
                }
            } else if (target instanceof Array) {
                for (var j:Number = 0, len:Number = target.length; j < len; ++j) {
                    searchTargetForName(target[j], nameLower, path + "[" + j + "]", output, stamp);
                }
            }
        } catch (e:Error) { /* skip this subtree */ }
    }

    // ========================================================================
    // Output Formatting (ported from Main.as)
    // ========================================================================

    // Flash built-in property defaults. Properties whose value matches the
    // documented default are hidden during child enumeration to reduce
    // noise in Memory Explorer and wildcard DSL queries. Direct name
    // access (`stage.foo._quality`) still resolves normally.
    //
    // Modeled on AVM2Firmware/Evaluate.hx:150–241. AS2 has no describeType
    // so we can't distinguish Flash-declared vs game-declared at runtime;
    // instead we hardcode the built-in names we know about and grow the
    // list as noise shows up.
    private static var flashPropDefaults:Object = null;
    private static var flashPropSkip:Object = null;

    private static function initFlashDefaults():Void {
        if (flashPropDefaults != null) return;
        flashPropDefaults = {};
        flashPropDefaults["_quality"] = "HIGH";
        flashPropDefaults["_highquality"] = 1;
        flashPropDefaults["_focusrect"] = null;
        flashPropDefaults["_lockroot"] = false;
        flashPropDefaults["_droptarget"] = "";
        flashPropDefaults["_rotation"] = 0;
        flashPropDefaults["_xscale"] = 100;
        flashPropDefaults["_yscale"] = 100;
        flashPropDefaults["_alpha"] = 100;
        // _name is non-empty on children; hiding when it holds the root's
        // "" keeps only the root degenerate case hidden.
        flashPropDefaults["_name"] = "";
        flashPropSkip = {};
        // _url is the SWF URL, present on every MC with the same value —
        // never useful game state regardless of what it resolves to.
        flashPropSkip["_url"] = true;
        // _target is the slash-notation path — always structural, never
        // game state, regardless of value.
        flashPropSkip["_target"] = true;
        // __raflash is our firmware's own MC attached to the game root;
        // always hide it so Memory Explorer shows pure game state.
        flashPropSkip["__raflash"] = true;
        // menu is inherited from MovieClip.prototype — every MC's .menu
        // points to the same ContextMenu. Direct access still works.
        flashPropSkip["menu"] = true;
        // $version is the Flash Player version string, attached globally —
        // not game state.
        flashPropSkip["$version"] = true;
        // _parent points back up the display tree; showing it creates a
        // visual cycle in the object view (and clutters drill-downs).
        // Direct access via `.somechild._parent` still works.
        flashPropSkip["_parent"] = true;
    }

    /**
     * True if (name, val) should be hidden during child enumeration.
     * Hides when the name is always-skip OR when it's a known built-in
     * whose value matches its documented default.
     */
    /**
     * Canonical type name for a value, used by the DSL's `type()` function.
     * Maps AS2 typeof quirks (`"movieclip"`) and common instanceof checks
     * to title-cased class names. Unknown objects fall through to "Object"
     * rather than "[object Object]".
     */
    private static function typeNameOf(v):String {
        if (v === null) return "Null";
        if (v === undefined) return "Undefined";
        var t:String = typeof(v);
        if (t == "number") return "Number";
        if (t == "string") return "String";
        if (t == "boolean") return "Boolean";
        if (t == "function") return "Function";
        if (t == "movieclip") return "MovieClip";
        // t == "object" — disambiguate via instanceof.
        if (v instanceof Array) return "Array";
        if (v instanceof Button) return "Button";
        if (v instanceof TextField) return "TextField";
        if (v instanceof Date) return "Date";
        return "Object";
    }

    private static function isHiddenBuiltinProp(name:String, val):Boolean {
        initFlashDefaults();
        if (flashPropSkip[name] == true) return true;
        if (flashPropDefaults.hasOwnProperty(name) && val == flashPropDefaults[name]) return true;
        return false;
    }

    /**
     * Get built-in properties for a target object that don't appear in for...in iteration.
     * Returns an array of {name, value} pairs for properties that exist on the target.
     */
    private static function getBuiltinProperties(target):Array {
        var result:Array = [];
        var t:String = typeof(target);
        if (t == "movieclip") {
            // Per AS2 MovieClip reference
            var mcProps:Array = [
                "_x", "_y", "_width", "_height", "_xscale", "_yscale",
                "_alpha", "_visible", "_rotation",
                "_currentframe", "_totalframes", "_framesloaded",
                "_name", "_target", "_url", "_parent",
                "_xmouse", "_ymouse",
                "_droptarget", "_focusrect", "_quality", "_highquality", "_lockroot"
            ];
            for (var i:Number = 0; i < mcProps.length; i++) {
                var mcName:String = mcProps[i];
                var mcValue = target[mcName];
                if (mcValue !== undefined) {
                    result.push({name: mcName, value: mcValue});
                }
            }
            if (typeof(target.getDepth) == "function") {
                result.push({name: "_depth", value: target.getDepth()});
            }
        } else if (target instanceof Button) {
            // Per AS2 Button reference. Button-specific state + the
            // display-object properties any DisplayObject exposes.
            var btnProps:Array = [
                "enabled", "useHandCursor", "tabEnabled", "tabIndex",
                "trackAsMenu", "menu",
                "blendMode", "cacheAsBitmap", "filters", "scale9Grid",
                "_x", "_y", "_width", "_height", "_xscale", "_yscale",
                "_alpha", "_visible", "_rotation",
                "_name", "_target", "_url", "_parent",
                "_xmouse", "_ymouse",
                "_focusrect", "_highquality", "_quality"
            ];
            for (var bp:Number = 0; bp < btnProps.length; bp++) {
                var bpName:String = btnProps[bp];
                var bpValue = target[bpName];
                if (bpValue !== undefined) {
                    result.push({name: bpName, value: bpValue});
                }
            }
            if (typeof(target.getDepth) == "function") {
                result.push({name: "_depth", value: target.getDepth()});
            }
        } else if (target instanceof TextField) {
            // Per AS2 TextField reference
            var tfProps:Array = [
                // Text content
                "text", "htmlText", "length", "textHeight", "textWidth",
                // Text properties
                "type", "variable", "multiline", "wordWrap", "password",
                "selectable", "maxChars", "restrict", "html", "condenseWhite",
                "embedFonts", "autoSize",
                // Visual styling
                "border", "borderColor", "background", "backgroundColor",
                "textColor", "antiAliasType", "gridFitType", "sharpness", "thickness",
                "filters", "styleSheet",
                // Scrolling
                "scroll", "maxscroll", "hscroll", "maxhscroll", "bottomScroll",
                // Interactivity
                "tabEnabled", "tabIndex", "mouseWheelEnabled", "menu",
                // Display object
                "_x", "_y", "_width", "_height", "_xscale", "_yscale",
                "_alpha", "_visible", "_rotation",
                "_name", "_target", "_url", "_parent",
                "_xmouse", "_ymouse",
                "_quality", "_highquality", "_soundbuftime"
            ];
            for (var j:Number = 0; j < tfProps.length; j++) {
                var tfName:String = tfProps[j];
                var tfValue = target[tfName];
                if (tfValue !== undefined) {
                    result.push({name: tfName, value: tfValue});
                }
            }
            if (typeof(target.getDepth) == "function") {
                result.push({name: "_depth", value: target.getDepth()});
            }
        }
        return result;
    }

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
                        var mcChild = value[key];
                        if (isHiddenBuiltinProp(key, mcChild)) continue;
                        output.push({value: key + ": " + formatOutput([mcChild], level + 1).output[0].value});
                    }
                    var mcBuiltins:Array = getBuiltinProperties(value);
                    for (var mb:Number = 0; mb < mcBuiltins.length; mb++) {
                        if (isHiddenBuiltinProp(mcBuiltins[mb].name, mcBuiltins[mb].value)) continue;
                        output.push({value: mcBuiltins[mb].name + ": " + formatOutput([mcBuiltins[mb].value], level + 1).output[0].value});
                    }
                } else {
                    var count:Number = 0;
                    for (var key:String in value) {
                        if (isHiddenBuiltinProp(key, value[key])) continue;
                        count++;
                    }
                    output.push({value: "[MovieClip ..." + count + "]"});
                }
            } else if (value instanceof Button) {
                if (level == 0 && singular) {
                    var btnBuiltins:Array = getBuiltinProperties(value);
                    for (var bb:Number = 0; bb < btnBuiltins.length; bb++) {
                        if (isHiddenBuiltinProp(btnBuiltins[bb].name, btnBuiltins[bb].value)) continue;
                        output.push({value: btnBuiltins[bb].name + ": " + formatOutput([btnBuiltins[bb].value], level + 1).output[0].value});
                    }
                } else {
                    var btnCount:Number = 0;
                    var btnInlineBuiltins:Array = getBuiltinProperties(value);
                    for (var bb2:Number = 0; bb2 < btnInlineBuiltins.length; bb2++) {
                        if (isHiddenBuiltinProp(btnInlineBuiltins[bb2].name, btnInlineBuiltins[bb2].value)) continue;
                        btnCount++;
                    }
                    output.push({value: "[Button ..." + btnCount + "]"});
                }
            } else if (value instanceof TextField) {
                if (level == 0 && singular) {
                    var tfBuiltins:Array = getBuiltinProperties(value);
                    for (var tb:Number = 0; tb < tfBuiltins.length; tb++) {
                        output.push({value: tfBuiltins[tb].name + ": " + formatOutput([tfBuiltins[tb].value], level + 1).output[0].value});
                    }
                } else {
                    output.push({value: "[TextField \"" + createLabelString(value.text) + "\"]"});
                }
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
            } else if (typeof(value) == "number" && isNaN(Number(value))) {
                output.push({value: "NaN"});
            } else if (typeof(value) == "object") {
                if (level == 0 && singular) {
                    for (var key:String in value) {
                        var objChild = value[key];
                        if (isHiddenBuiltinProp(key, objChild)) continue;
                        output.push({value: key + ": " + formatOutput([objChild], level + 1).output[0].value});
                    }
                } else {
                    var count:Number = 0;
                    for (var key:String in value) {
                        if (isHiddenBuiltinProp(key, value[key])) continue;
                        count++;
                    }
                    output.push({value: "[Object ..." + count + "]"});
                }
            } else if (typeof(value) == "boolean") {
                output.push({value: value});
            } else if (typeof(value) == "function") {
                output.push({value: "[Function]"});
            } else {
                output.push({value: "Unknown (" + value + ")"});
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
        var rpTimeMs:Number = 0;

        // Update reusable stage context for this frame
        _stageContext[0] = gameRoot;

        // Frame-local cache for formula results (cleared each frame)
        // Uses CACHE_MISS sentinel so null results are properly cached
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
                    var rpStartTime:Number = benchmarkingActive ? getTimer() : 0;
                    var rpString:String;

                    if (nativeRPReady && nativeRPFnMap[i] != undefined) {
                        // Native compiled path
                        var rpFnIdx:Number = nativeRPFnMap[i];
                        var rpFn:Function = _global.__nativeRP[rpFnIdx];
                        if (nativeRPStorage[i] == null) nativeRPStorage[i] = {};
                        var rpResult:Object = rpFn(gameRoot, nativeRPStorage[i]);
                        rpString = (rpResult != null && rpResult != undefined) ? String(rpResult) : "";
                    } else if (achievement.compiledFormula != null && achievement.compiledFormula.length > 1) {
                        // Interpreter fallback
                        var rpFormulaResult:Array = evaluate(
                            achievement.compiledFormula, 1, achievement.compiledFormula.length,
                            _stageContext, _stageKeys
                        );
                        if (rpFormulaResult != null && rpFormulaResult.length > 0) {
                            rpString = String(rpFormulaResult[0]);
                        } else {
                            rpString = "";
                        }
                    } else {
                        rpString = "";
                    }

                    achievement._richPresenceResult = rpString;
                    // Send to Deno for window title update
                    sendMessage("richPresenceUpdate", { result: rpString });

                    if (benchmarkingActive) {
                        var rpElapsed:Number = getTimer() - rpStartTime;
                        rpTimeMs += rpElapsed;
                        sendMessage("benchmark", {kind: "Rich Presence", ms: rpElapsed});
                    }
                }
                continue; // Skip achievement-specific processing
            }

            // Start timing for this achievement (only when benchmarking is active)
            var startTime:Number = benchmarkingActive ? getTimer() : 0;

            // === NATIVE COMPILED PATH ===
            if (nativeAchReady) {
                var fnIdx:Number = nativeAchFnMap[i];
                var achFn:Function = _global.__nativeAch[fnIdx];

                if (achFn == null || achFn == undefined) {
                    sendMessage("log", { message: "[native-ach] Asset " + i + " not in compiled index, falling back to interpreter" });
                    // Fall through to interpreter path below
                } else {

                // Get or create per-achievement storage
                if (nativeAchStorage[i] == null) nativeAchStorage[i] = {};
                var naStore:Object = nativeAchStorage[i];

                // Call compiled function
                var achResult:Number = achFn(gameRoot, naStore);

                // Sync hits from storage back to requirement objects (ALL groups)
                for (var ng:Number = 0; ng < achievement.groups.length; ng++) {
                    var naGroup:Object = achievement.groups[ng];
                    for (var nk:Number = 0; nk < naGroup.requirements.length; nk++) {
                        var naReq:Object = naGroup.requirements[nk];
                        var naFlag:String = naReq.flag || "";
                        // Sync requirements that track hits
                        if ((naReq.maxHits || 0) > 0 || naFlag == "ADD_HITS" || naFlag == "SUB_HITS") {
                            var naHitsKey:String = "h" + ng + "_" + nk;
                            var naHits:Number = naStore[naHitsKey];
                            if (naHits == undefined) naHits = 0;
                            if (naHits != (naReq.hits || 0)) {
                                diffSet(naReq, "hits", naHits,
                                    "assets/" + i + "/groups/" + ng + "/requirements/" + nk + "/hits");
                            }
                        }
                    }
                }

                // Handle TRIGGER / primed state
                var naPrimed:Boolean = (naStore._primed == true);
                if (naPrimed) {
                    if (!achievement._primed) {
                        var primedImgUrl:String = imageBaseUrl + "/asset-image/" + achievement.id;
                        PrimedBadges.show(achievement.id, primedImgUrl);
                    }
                    achievement._primed = true;
                } else {
                    if (achievement._primed) {
                        PrimedBadges.hide(achievement.id);
                    }
                    achievement._primed = false;
                }

                // Handle MEASURED display
                if (naStore._mCur != undefined && naStore._mTgt != undefined) {
                    var naMCur:Number = Number(naStore._mCur);
                    var naMTgt:Number = Number(naStore._mTgt);
                    if (isNaN(naMCur)) naMCur = 0;
                    if (isNaN(naMTgt)) naMTgt = 0;
                    var naPrevMeasured:Number = achievement._measuredValue;
                    var naValueChanged:Boolean = (naPrevMeasured != null) &&
                        (naMCur != naPrevMeasured || naMTgt != achievement._measuredTarget);
                    if (naValueChanged && achResult != 1) {
                        var naMText:String = String(Math.floor(naMCur)) + "/" + String(Math.floor(naMTgt));
                        var naMImgUrl:String = imageBaseUrl + "/asset-image/" + achievement.id;
                        Measure.showOrReset(achievement.name, achievement.description || "",
                                            naMText, naMImgUrl, achievement.id);
                    }
                    achievement._measuredValue = naMCur;
                    achievement._measuredTarget = naMTgt;
                }

                // Handle trigger
                if (achResult == 1) {
                    var naImageUrl:String = imageBaseUrl + "/asset-image/" + achievement.id;
                    Toast.show("Achievement Unlocked", achievement.name,
                               achievement.description || "", "left", naImageUrl);
                    // Reset storage and hits across all groups
                    nativeAchStorage[i] = {};
                    for (var nrg:Number = 0; nrg < achievement.groups.length; nrg++) {
                        var nrGroup:Object = achievement.groups[nrg];
                        for (var nrk:Number = 0; nrk < nrGroup.requirements.length; nrk++) {
                            if ((nrGroup.requirements[nrk].hits || 0) > 0) {
                                diffSet(nrGroup.requirements[nrk], "hits", 0,
                                    "assets/" + i + "/groups/" + nrg + "/requirements/" + nrk + "/hits");
                            }
                        }
                    }
                    clearAssetDeltaValues(achievement);
                    diffSet(achievement, "state", "TRIGGERED", "assets/" + i + "/state");
                }

                // Record timing
                if (benchmarkingActive) {
                    var naElapsed:Number = getTimer() - startTime;
                    var naAchId:String = String(achievement.id);
                    if (profilingData[naAchId] == null) {
                        profilingData[naAchId] = {name: achievement.name, totalMs: 0, evalCount: 0};
                    }
                    profilingData[naAchId].totalMs += naElapsed;
                    profilingData[naAchId].evalCount += 1;
                }
                continue; // Skip interpreter pipeline
                } // end achFn valid else block
            }

            // === SIMPLE ACHIEVEMENT FAST-PATH ===
            // For achievements with 1 CORE group, all requirements having fastReq,
            // no special flags, and no hit tracking — skip the entire phase pipeline.
            var simpleEligible:Boolean = interpreterFastPath && (achievement.groups.length == 1 && achievement.groups[0].type == "CORE");
            if (simpleEligible) {
                var simpleGroup:Object = achievement.groups[0];
                var simpleReqs:Array = simpleGroup.requirements;
                var simpleAllPass:Boolean = true;
                var simpleValid:Boolean = true;

                for (var sk:Number = 0; sk < simpleReqs.length; ++sk) {
                    var sr:Object = simpleReqs[sk];
                    // Bail to full pipeline if any requirement is complex
                    if (sr.fastReq == null || sr.flag != null && sr.flag != "" || sr.maxHits > 0 ||
                        sr.typeA == "DELTA" || sr.typeB == "DELTA") {
                        simpleEligible = false;
                        break;
                    }
                    var sfr:Array = sr.fastReq;
                    var sRawA;
                    switch (sfr[1]) {
                        case 3: sRawA = gameRoot[sfr[2]]; break;
                        case 4: {
                            var so4 = gameRoot[sfr[2]];
                            sRawA = (so4 !== undefined) ? so4[sfr[3]] : undefined;
                            break;
                        }
                        case 5: {
                            var so5 = gameRoot[sfr[2]];
                            if (so5 !== undefined) so5 = so5[sfr[3]];
                            sRawA = (so5 !== undefined) ? so5[sfr[4]] : undefined;
                            break;
                        }
                    }
                    var sRawB = sfr[sfr.length - 1];
                    var sPassed:Boolean = false;
                    switch (sfr[0]) {
                        case 0: sPassed = (sRawA == sRawB); break;
                        case 1: sPassed = (sRawA != sRawB); break;
                        case 2: sPassed = (sRawA > sRawB); break;
                        case 3: sPassed = (sRawA >= sRawB); break;
                        case 4: sPassed = (sRawA < sRawB); break;
                        case 5: sPassed = (sRawA <= sRawB); break;
                    }
                    if (!sPassed) {
                        simpleAllPass = false;
                        break;
                    }
                }

                if (simpleEligible) {
                    // All requirements passed — trigger the achievement
                    if (simpleAllPass && simpleReqs.length > 0) {
                        var imageUrl:String = imageBaseUrl + "/asset-image/" + achievement.id;
                        Toast.show("Achievement Unlocked", achievement.name, achievement.description || "", "left", imageUrl);
                        clearAssetDeltaValues(achievement);
                        diffSet(achievement, "state", "TRIGGERED", "assets/" + i + "/state");
                    }

                    // Record timing
                    if (benchmarkingActive) {
                        var elapsed:Number = getTimer() - startTime;
                        var achievementId:String = String(achievement.id);
                        if (profilingData[achievementId] == null) {
                            profilingData[achievementId] = {name: achievement.name, totalMs: 0, evalCount: 0};
                        }
                        profilingData[achievementId].totalMs += elapsed;
                        profilingData[achievementId].evalCount += 1;
                    }
                    continue; // Skip full phase pipeline
                }
            }

            // Track if all requirements pass for this asset
            var assetTriggered:Boolean = true;
            var hasRequirements:Boolean = false;

            // TRIGGER flag tracking - per group for primed state detection
            var groupNonTriggerMet:Array = [];  // Boolean per group
            var groupTriggerMet:Array = [];     // Boolean per group
            var groupHasTrigger:Array = [];     // Boolean per group
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

                // Detect AddHits/SubHits chains so a PauseIf can act as a chain terminal
                // (mirrors the chain detection done in Phase 1 for non-paused requirements)
                var phase0AhsInfo:Object = {};
                for (var k0:Number = 0; k0 < group.requirements.length; ++k0) {
                    if (phase0AhsInfo[k0]) continue;
                    var req0:Object = group.requirements[k0];
                    if (req0.flag == "ADD_HITS" || req0.flag == "SUB_HITS") {
                        var contribs0:Array = [k0];
                        var term0:Number = k0 + 1;
                        while (term0 < group.requirements.length) {
                            var nextReq0:Object = group.requirements[term0];
                            if (nextReq0.flag == "ADD_HITS" || nextReq0.flag == "SUB_HITS") {
                                contribs0.push(term0);
                                term0++;
                            } else {
                                break;
                            }
                        }
                        for (var ci0:Number = 0; ci0 < contribs0.length; ci0++) {
                            phase0AhsInfo[contribs0[ci0]] = {
                                isChainMember: true,
                                terminalIndex: term0,
                                flag: group.requirements[contribs0[ci0]].flag
                            };
                        }
                        if (term0 < group.requirements.length) {
                            phase0AhsInfo[term0] = {isTerminal: true, contributors: contribs0};
                        }
                        k0 = term0 - 1;
                    }
                }

                // First pass: identify AndNext/OrNext chains ending in Pause If.
                // We must NOT call evaluateChain here unconditionally — DELTA
                // requirements have a side effect (they overwrite the stored
                // previous-frame value when evaluated), so a wasted exploratory
                // evaluation here would corrupt the delta and cause Phase 2 to
                // see a delta-vs-current comparison as "no change." Walk the
                // chain structurally first, only evaluate if the terminal is
                // actually a Pause If.
                for (var k:Number = 0; k < group.requirements.length; ++k) {
                    var requirement:Object = group.requirements[k];

                    if (requirement.flag == "AND_NEXT" || requirement.flag == "OR_NEXT") {
                        // Walk forward by flag only to find the terminal index.
                        var terminalIdx:Number = k + 1;
                        while (terminalIdx < group.requirements.length) {
                            var nextFlag:String = group.requirements[terminalIdx].flag;
                            if (nextFlag != "AND_NEXT" && nextFlag != "OR_NEXT") break;
                            terminalIdx++;
                        }

                        // Only evaluate the chain if the terminal is Pause If;
                        // otherwise leave evaluation to Phase 2.
                        if (terminalIdx < group.requirements.length
                                && group.requirements[terminalIdx].flag == "PAUSE_IF") {
                            var chainResult:Object = evaluateChain(group, k, frameCache, {});
                            for (var cm:Number = k; cm < chainResult.terminalIndex; ++cm) {
                                chainInfo[cm] = {isChainMember: true, terminalIndex: chainResult.terminalIndex};
                            }
                            chainInfo[chainResult.terminalIndex] = {
                                isTerminal: true,
                                chainResult: chainResult.chainResult,
                                chainValid: chainResult.valid
                            };
                        }

                        // Skip ahead past the chain (chain members are handled
                        // either via chainInfo above or in Phase 2).
                        k = terminalIdx;
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
                        // Use the chain result (already evaluated by evaluateChain)
                        passed = info.chainResult;
                        valid = info.chainValid;
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

                    // Check if this triggers pause (increment hits first)
                    var maxHits:Number = requirement.maxHits || 0;
                    var currentHits:Number = requirement.hits || 0;

                    if (maxHits == 0) {
                        // Transient pause: triggers every frame condition is true
                        if (passed) {
                            isPaused = true;
                        }
                    } else {
                        // Threshold pause: fires when effective hits (own + AddHits/SubHits
                        // chain plus this-frame lookahead) reaches maxHits. The cmp only
                        // contributes through the own-hits increment.
                        if (passed && currentHits < maxHits) {
                            var newHits:Number = currentHits + 1;
                            diffSet(requirement, "hits", newHits, basePath + "/hits");
                            currentHits = newHits;
                        }
                        // Compute effective hits including AddHits/SubHits chain
                        var pifEffective:Number = currentHits;
                        var pifAhsInfo:Object = phase0AhsInfo[k];
                        if (pifAhsInfo && pifAhsInfo.isTerminal && pifAhsInfo.contributors) {
                            for (var pifCi:Number = 0; pifCi < pifAhsInfo.contributors.length; pifCi++) {
                                var pifCIdx:Number = pifAhsInfo.contributors[pifCi];
                                var pifCReq:Object = group.requirements[pifCIdx];
                                var pifCHits:Number = pifCReq.hits || 0;
                                if (pifCReq.flag == "ADD_HITS") {
                                    pifEffective += pifCHits;
                                } else if (pifCReq.flag == "SUB_HITS") {
                                    pifEffective -= pifCHits;
                                }
                            }
                        }
                        if (pifEffective >= maxHits) {
                            isPaused = true;
                        }
                    }

                    // Check for ResetNextIf targeting this PauseIf (AFTER hits increment)
                    // Per RA docs: ResetNextIf followed by PauseIf is evaluated even while paused,
                    // allowing it to unlock a PauseLock without needing an alt group.
                    // Must happen after hits increment so the reset takes effect.
                    var prevK:Number = k - 1;
                    while (prevK >= 0 && group.requirements[prevK].flag == "RESET_NEXT_IF") {
                        rnifHandledInPhase0[prevK] = true;
                        var rnifReq:Object = group.requirements[prevK];
                        var rnifResult:Object = evaluateRequirementCondition(rnifReq, frameCache, 0);
                        if (rnifResult.valid && rnifResult.passed) {
                            // Reset the PauseIf's hit count
                            if ((requirement.hits || 0) > 0) {
                                diffSet(requirement, "hits", 0, basePath + "/hits");
                                // Undo pause if the reset brought hits below threshold
                                if (maxHits > 0) {
                                    isPaused = false;
                                }
                            }
                        }
                        prevK--;
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
                        var currentA:Array;
                        if (frameCache.hasOwnProperty(cacheKeyA)) {
                            currentA = frameCache[cacheKeyA];
                        } else {
                            currentA = requirement.fastA != null
                                ? evaluateFast(requirement.fastA)
                                : evaluate(requirement.compiledA, 1, requirement.compiledA.length, _stageContext, _stageKeys);
                            frameCache[cacheKeyA] = currentA;
                        }
                        if (currentA != null && currentA.length == 1) {
                            storeDeltaValue(requirement.id, "A", currentA[0]);
                        }
                    }
                    if (requirement.typeB == "DELTA") {
                        var cacheKeyB:String = requirement.addressB;
                        var currentB:Array;
                        if (frameCache.hasOwnProperty(cacheKeyB)) {
                            currentB = frameCache[cacheKeyB];
                        } else {
                            currentB = requirement.fastB != null
                                ? evaluateFast(requirement.fastB)
                                : evaluate(requirement.compiledB, 1, requirement.compiledB.length, _stageContext, _stageKeys);
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

                // Per-group trigger tracking
                groupNonTriggerMet[j] = true;
                groupTriggerMet[j] = true;
                groupHasTrigger[j] = false;

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

                        // Increment per-chain-member hit counts (canonical RA
                        // semantics: each chain member with maxHits > 0 has its
                        // own hit accumulator, ticked when the partial chain
                        // through it is true). The terminal is excluded here —
                        // it's handled by the regular Phase 5 path below.
                        incrementChainMemberHits(group, chainResult.members, i, j);

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
                        // Track TRIGGER requirements separately for primed state (per group)
                        if (flagSat == "TRIGGER") {
                            hasTriggerCondition = true;
                            groupHasTrigger[j] = true;
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
                                    var contribMax:Number = contribReq.maxHits || 0;
                                    // Check if this contributor passes this frame (for lookahead)
                                    var contribResult:Object = evaluateRequirementCondition(contribReq, frameCache, 0);
                                    var contribPasses:Boolean = contribResult.passed && contribResult.valid;
                                    // Lookahead only fires if Phase 5 will actually increment
                                    // (i.e. contributor isn't already at its cap)
                                    var contribCanIncrement:Boolean = contribPasses && (contribMax == 0 || contribHits < contribMax);
                                    if (contribReq.flag == "ADD_HITS") {
                                        effectiveHits += contribHits;
                                        if (contribCanIncrement) effectiveHitsLookahead += 1;
                                    } else if (contribReq.flag == "SUB_HITS") {
                                        effectiveHits -= contribHits;
                                        if (contribCanIncrement) effectiveHitsLookahead -= 1;
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
                            // Track TRIGGER vs non-TRIGGER separately for primed state (per group)
                            if (flagSat == "TRIGGER") {
                                groupTriggerMet[j] = false;
                            } else {
                                groupNonTriggerMet[j] = false;
                            }
                        }
                    }

                    // Check for Reset If trigger (only in non-paused groups)
                    // - maxHits == 0: fires when cmp passes
                    // - maxHits >  0: fires when effective hits (own + AddHits/SubHits
                    //   chain, plus this-frame lookahead) reaches maxHits. The cmp only
                    //   contributes through the own-hits increment.
                    if (requirement.flag == "RESET_IF") {
                        var maxHitsCheck:Number = requirement.maxHits || 0;
                        var currentHitsCheck:Number = requirement.hits || 0;

                        if (maxHitsCheck == 0) {
                            if (passed) resetIfFired = true;
                        } else {
                            // Compute effective hits including AddHits/SubHits chain
                            var rifEffective:Number = currentHitsCheck;
                            var rifLookahead:Number = 0;
                            var rifAhsInfo:Object = addHitsSubHitsInfo[k];
                            if (rifAhsInfo && rifAhsInfo.isTerminal && rifAhsInfo.contributors) {
                                for (var rifCi:Number = 0; rifCi < rifAhsInfo.contributors.length; rifCi++) {
                                    var rifCIdx:Number = rifAhsInfo.contributors[rifCi];
                                    var rifCReq:Object = group.requirements[rifCIdx];
                                    var rifCHits:Number = rifCReq.hits || 0;
                                    var rifCMax:Number = rifCReq.maxHits || 0;
                                    var rifCRes:Object = evaluateRequirementCondition(rifCReq, frameCache, 0);
                                    var rifCPasses:Boolean = rifCRes.passed && rifCRes.valid;
                                    var rifCCanInc:Boolean = rifCPasses && (rifCMax == 0 || rifCHits < rifCMax);
                                    if (rifCReq.flag == "ADD_HITS") {
                                        rifEffective += rifCHits;
                                        if (rifCCanInc) rifLookahead += 1;
                                    } else if (rifCReq.flag == "SUB_HITS") {
                                        rifEffective -= rifCHits;
                                        if (rifCCanInc) rifLookahead -= 1;
                                    }
                                }
                            }
                            // Own-hit lookahead: cmp passing this frame would increment own hits
                            var rifOwnLook:Number = (passed && currentHitsCheck < maxHitsCheck) ? 1 : 0;
                            if (rifEffective + rifLookahead + rifOwnLook >= maxHitsCheck) {
                                resetIfFired = true;
                            }
                        }
                    }

                    // Check for ResetNextIf trigger - resets only the NEXT requirement's hits
                    // Note: We record targets here and apply reset AFTER Phase 5 so the reset
                    // takes effect after any hits increment.
                    // - maxHits == 0: fires when cmp passes
                    // - maxHits >  0: fires when effective hits (own + AddHits/SubHits chain
                    //   plus this-frame lookahead) reaches maxHits
                    if (requirement.flag == "RESET_NEXT_IF") {
                        var maxHitsRNI:Number = requirement.maxHits || 0;
                        var currentHitsRNI:Number = requirement.hits || 0;
                        var resetNextIfFired:Boolean = false;

                        if (maxHitsRNI == 0) {
                            if (passed) resetNextIfFired = true;
                        } else {
                            // Compute effective hits including AddHits/SubHits chain
                            var rniEffective:Number = currentHitsRNI;
                            var rniLookahead:Number = 0;
                            var rniAhsInfo:Object = addHitsSubHitsInfo[k];
                            if (rniAhsInfo && rniAhsInfo.isTerminal && rniAhsInfo.contributors) {
                                for (var rniCi:Number = 0; rniCi < rniAhsInfo.contributors.length; rniCi++) {
                                    var rniCIdx:Number = rniAhsInfo.contributors[rniCi];
                                    var rniCReq:Object = group.requirements[rniCIdx];
                                    var rniCHits:Number = rniCReq.hits || 0;
                                    var rniCMax:Number = rniCReq.maxHits || 0;
                                    var rniCRes:Object = evaluateRequirementCondition(rniCReq, frameCache, 0);
                                    var rniCPasses:Boolean = rniCRes.passed && rniCRes.valid;
                                    var rniCCanInc:Boolean = rniCPasses && (rniCMax == 0 || rniCHits < rniCMax);
                                    if (rniCReq.flag == "ADD_HITS") {
                                        rniEffective += rniCHits;
                                        if (rniCCanInc) rniLookahead += 1;
                                    } else if (rniCReq.flag == "SUB_HITS") {
                                        rniEffective -= rniCHits;
                                        if (rniCCanInc) rniLookahead -= 1;
                                    }
                                }
                            }
                            var rniOwnLook:Number = (passed && currentHitsRNI < maxHitsRNI) ? 1 : 0;
                            if (rniEffective + rniLookahead + rniOwnLook >= maxHitsRNI) {
                                resetNextIfFired = true;
                            }
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
                    isPaused: false,
                    addHitsSubHitsInfo: addHitsSubHitsInfo,
                    groupRef: group
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
                // Compute primed state from the groups that would contribute to a trigger:
                // Core group is always included; for alt groups, use the best-passing one.
                if (hasTriggerCondition) {
                    var allNonTriggerMet:Boolean = true;
                    var allTriggerMet:Boolean = true;
                    for (var pri:Number = 0; pri < groupResults.length; ++pri) {
                        var prGr:Object = groupResults[pri];
                        if (prGr.isPaused) continue;
                        if (prGr.type == "CORE" || prGr.allPassed || prGr.type == undefined) {
                            // Core always contributes; alt groups contribute if they passed
                            if (groupNonTriggerMet[pri] === false) allNonTriggerMet = false;
                            if (groupTriggerMet[pri] === false) allTriggerMet = false;
                        }
                    }
                    // If no alt group passed, pick the one closest to passing for trigger state
                    if (hasAltGroups && !anyAltGroupPassed) {
                        allNonTriggerMet = false;
                    }
                    if (allNonTriggerMet && !allTriggerMet) {
                        // PRIMED state - all prerequisites met, waiting for trigger condition
                        if (!achievement._primed) {
                            // Just became primed - show badge
                            var primedImageUrl:String = imageBaseUrl + "/asset-image/" + achievement.id;
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
                            // AddHits/SubHits: increment when condition passes,
                            // capped by its own maxHits if set (maxHits=0 means uncapped).
                            // For ADD_HITS, also gated by the chain terminal's maxHits —
                            // once the terminal's effective hits reach its target, AddHits
                            // contributors stop accumulating (going over has no value).
                            // SUB_HITS is NOT gated by the terminal cap because incrementing
                            // a SubHits decreases the chain total, bringing it back under cap.
                            var ownCapOk:Boolean = (maxHits == 0 || currentHits < maxHits);
                            var terminalCapOk:Boolean = true;
                            if (req.flag == "ADD_HITS") {
                                var ahsInfoP5:Object = gr.addHitsSubHitsInfo[rr.reqIndex];
                                if (ahsInfoP5 && ahsInfoP5.isChainMember) {
                                    var termIdxP5:Number = ahsInfoP5.terminalIndex;
                                    if (termIdxP5 < gr.groupRef.requirements.length) {
                                        var termReqP5:Object = gr.groupRef.requirements[termIdxP5];
                                        var termMaxHitsP5:Number = termReqP5.maxHits || 0;
                                        if (termMaxHitsP5 > 0) {
                                            // Compute current effective hits for the terminal
                                            var termEffective:Number = termReqP5.hits || 0;
                                            var termInfoP5:Object = gr.addHitsSubHitsInfo[termIdxP5];
                                            if (termInfoP5 && termInfoP5.contributors) {
                                                for (var ciP5:Number = 0; ciP5 < termInfoP5.contributors.length; ciP5++) {
                                                    var cIdxP5:Number = termInfoP5.contributors[ciP5];
                                                    var cReqP5:Object = gr.groupRef.requirements[cIdxP5];
                                                    if (cReqP5.flag == "ADD_HITS") {
                                                        termEffective += (cReqP5.hits || 0);
                                                    } else if (cReqP5.flag == "SUB_HITS") {
                                                        termEffective -= (cReqP5.hits || 0);
                                                    }
                                                }
                                            }
                                            if (termEffective >= termMaxHitsP5) terminalCapOk = false;
                                        }
                                    }
                                }
                            }
                            if (reqPassed && ownCapOk && terminalCapOk) {
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
                                mResultB = evaluate(mReq.compiledB, 1, mReq.compiledB.length, _stageContext, _stageKeys);
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
                        if (mResultA === CACHE_MISS || !frameCache.hasOwnProperty(mCacheKeyA)) {
                            mResultA = evaluate(mReq.compiledA, 1, mReq.compiledA.length, _stageContext, _stageKeys);
                            frameCache[mCacheKeyA] = mResultA;
                        }

                        var mResultB2:Array = frameCache[mCacheKeyB2];
                        if (mResultB2 === CACHE_MISS || !frameCache.hasOwnProperty(mCacheKeyB2)) {
                            mResultB2 = evaluate(mReq.compiledB, 1, mReq.compiledB.length, _stageContext, _stageKeys);
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
                var measuredImageUrl:String = imageBaseUrl + "/asset-image/" + achievement.id;

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
                var imageUrl:String = imageBaseUrl + "/asset-image/" + achievement.id;
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

            // Record timing for this achievement (only when benchmarking is active)
            if (benchmarkingActive) {
                var elapsed:Number = getTimer() - startTime;
                var achievementId:String = String(achievement.id);
                if (profilingData[achievementId] == null) {
                    profilingData[achievementId] = {name: achievement.name, totalMs: 0, evalCount: 0};
                }
                profilingData[achievementId].totalMs += elapsed;
                profilingData[achievementId].evalCount += 1;
            }
        }


        // Send any pending changes (lightweight - no full diff scan)
        var diffStartTime:Number = getTimer();
        if (diffHasPending()) {
            sendEditData(diffFlush());
        }
        var diffMs:Number = getTimer() - diffStartTime;
        diffOpsTimeMs += diffMs;

        // Track frame timing
        var frameTotalMs:Number = getTimer() - frameStartTime;
        totalFrameTimeMs += frameTotalMs;
        frameCount++;

        // Emit per-frame benchmark data (use-it-or-lose-it: lost if no listener)
        if (benchmarkingActive) {
            sendMessage("benchmark", {kind: "Achievements", ms: frameTotalMs - diffMs - rpTimeMs});
            sendMessage("benchmark", {kind: "Diff Ops", ms: diffMs});
            sendMessage("benchmark", {kind: "Frame Total", ms: frameTotalMs});
        }

        // Send profiling data every PROFILING_INTERVAL ms
        // DISABLED: Uncomment to re-enable profiling reports
        /*
        var now:Number = getTimer();
        if (now - lastProfilingReport >= PROFILING_INTERVAL) {
            // Count stage properties for diagnostics
            var stageCountStart:Number = getTimer();
            var stageStats:Object = countStageProperties(gameRoot, 3);
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
                                            _stageContext, _stageKeys);
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
