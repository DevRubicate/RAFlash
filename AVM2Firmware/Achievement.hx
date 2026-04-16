package;

import haxe.Timer;

/**
 * Achievement evaluation engine for AVM2 (AS3/Haxe).
 *
 * Port of the checkAchievements system from AVM1Firmware/Main.as (lines 1537-2422).
 * Runs every frame to evaluate achievement conditions, track hits/deltas,
 * handle resets, detect primed state, show progress, and trigger achievements.
 */
class Achievement {

    // State
    public static var processingActive:Bool = true;
    public static var benchmarkingActive:Bool = false;
    public static var deltaValues:Map<String, Dynamic> = new Map();
    private static var diffEdits:Array<Dynamic> = [];
    private static var lastRichPresenceTime:Float = 0;

    private static inline var RICH_PRESENCE_INTERVAL:Float = 1000;

    // Native compiled achievement state
    public static var nativeAchReady:Bool = false;
    public static var nativeAchFnMap:Map<Int, Int> = new Map();   // asset index → function array index
    public static var nativeAchStorage:Array<Dynamic> = [];       // per-asset storage objects
    public static var nativeAchFns:Dynamic = null;                // Array of native achievement functions
    public static var nativeRpFnMap:Map<Int, Int> = new Map();    // asset index → rp function array index
    public static var nativeRpFns:Dynamic = null;                 // Array of native RP functions
    private static var nativeRpStorage:Array<Dynamic> = [];       // per-RP-asset storage objects
    public static var nativeAchLoader:Dynamic = null;             // Keep Loader alive to prevent GC of compiled ABC

    /**
     * Safely convert a Dynamic value to Float.
     * Haxe's (x : Float) type annotation generates AS3's `x as Number` which
     * returns 0 for strings instead of parsing them. This uses Std.parseFloat
     * to properly coerce string values like "67" to 67.0.
     */
    private static function toFloat(v:Dynamic):Float {
        if (Std.isOfType(v, Float) || Std.isOfType(v, Int)) return v;
        return Std.parseFloat(Std.string(v));
    }

    // === Diff Tracking ===

    private static function diffSet(target:Dynamic, key:String, value:Dynamic, path:String):Void {
        untyped target[key] = value;
        diffEdits.push([path, value]);
    }

    private static function diffFlush():Dynamic {
        if (diffEdits.length == 0) return null;
        var diff:Dynamic = {edited: diffEdits.copy()};
        diffEdits = [];
        return diff;
    }

    private static function diffHasPending():Bool {
        return diffEdits.length > 0;
    }

    // === Delta Tracking ===

    private static function storeDeltaValue(reqId:String, side:String, value:Dynamic):Void {
        if (!deltaValues.exists(reqId)) {
            deltaValues.set(reqId, {});
        }
        var entry:Dynamic = deltaValues.get(reqId);
        if (side == "A") {
            untyped entry.prevA = value;
        } else {
            untyped entry.prevB = value;
        }
    }

    private static function clearAssetDeltaValues(asset:Dynamic):Void {
        var groups:Array<Dynamic> = untyped asset.groups;
        var gj:Int = 0;
        while (gj < groups.length) {
            var reqs:Array<Dynamic> = untyped groups[gj].requirements;
            var rk:Int = 0;
            while (rk < reqs.length) {
                deltaValues.remove(Std.string(untyped reqs[rk].id));
                rk++;
            }
            gj++;
        }
    }

    // === Requirement Condition Evaluation ===

    private static function evaluateRequirementCondition(requirement:Dynamic, frameCache:Map<String, Array<Dynamic>>, gameRoot:Dynamic, accumulator:Float = 0):Dynamic {
        var compiledA:Array<Dynamic> = untyped requirement.compiledA;
        var compiledB:Array<Dynamic> = untyped requirement.compiledB;
        if (compiledA == null || compiledB == null) {
            return {passed: false, valid: false};
        }

        var cacheKeyA:String = Std.string(untyped requirement.addressA);
        var cacheKeyB:String = Std.string(untyped requirement.addressB);

        // Evaluate with caching
        var currentA:Array<Dynamic> = frameCache.exists(cacheKeyA) ? frameCache.get(cacheKeyA) : null;
        if (currentA == null) {
            currentA = Evaluate.evaluate(compiledA, 1, compiledA.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
            if (currentA != null) frameCache.set(cacheKeyA, currentA);
        }

        var currentB:Array<Dynamic> = frameCache.exists(cacheKeyB) ? frameCache.get(cacheKeyB) : null;
        if (currentB == null) {
            currentB = Evaluate.evaluate(compiledB, 1, compiledB.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
            if (currentB != null) frameCache.set(cacheKeyB, currentB);
        }

        if (currentA == null || currentB == null || currentA.length != 1 || currentB.length != 1) {
            return {passed: false, valid: false};
        }

        // Handle Delta type for A side
        var reqId:String = Std.string(untyped requirement.id);
        var resultA:Array<Dynamic>;
        if (untyped requirement.typeA == "DELTA") {
            var deltaData:Dynamic = deltaValues.exists(reqId) ? deltaValues.get(reqId) : null;
            if (deltaData == null || untyped __typeof__(deltaData.prevA) == "undefined") {
                storeDeltaValue(reqId, "A", currentA[0]);
                return {passed: false, valid: false};
            }
            // Capture previous value BEFORE storing current to avoid corruption
            // when this requirement is evaluated multiple times per frame (e.g. AddHits chains)
            var capturedPrevA:Dynamic = untyped deltaData.prevA;
            storeDeltaValue(reqId, "A", currentA[0]);
            resultA = [capturedPrevA];
        } else {
            resultA = currentA;
        }

        // Handle Delta type for B side
        var resultB:Array<Dynamic>;
        if (untyped requirement.typeB == "DELTA") {
            var deltaBData:Dynamic = deltaValues.exists(reqId) ? deltaValues.get(reqId) : null;
            if (deltaBData == null || untyped __typeof__(deltaBData.prevB) == "undefined") {
                storeDeltaValue(reqId, "B", currentB[0]);
                return {passed: false, valid: false};
            }
            // Capture previous value BEFORE storing current
            var capturedPrevB:Dynamic = untyped deltaBData.prevB;
            storeDeltaValue(reqId, "B", currentB[0]);
            resultB = [capturedPrevB];
        } else {
            resultB = currentB;
        }

        // Add accumulator from AddSource/SubSource chain to left side
        // Compare using numeric coercion. This matches AS2 behavior where
        // "67" >= 30 auto-coerces the string to a number. toFloat handles
        // string→number conversion that Haxe's (x : Float) annotation doesn't.
        // For string equality (e.g. heroName == "Bob"), toFloat returns NaN for
        // both sides of non-numeric strings, so we fall back to raw comparison.
        var passed:Bool = false;
        var cmp:String = Std.string(untyped requirement.cmp);
        var a:Float = toFloat(resultA[0]) + accumulator;
        var b:Float = toFloat(resultB[0]);
        var numericValid:Bool = !Math.isNaN(a) && !Math.isNaN(b);

        if (cmp == "==" || cmp == "!=") {
            // Try numeric first, fall back to raw Dynamic comparison for strings
            if (numericValid) {
                passed = cmp == "==" ? a == b : a != b;
            } else {
                var rawA:Dynamic = accumulator != 0 ? a : resultA[0];
                var rawB:Dynamic = resultB[0];
                passed = cmp == "==" ? rawA == rawB : rawA != rawB;
            }
        } else if (numericValid) {
            if (cmp == ">") passed = a > b;
            else if (cmp == ">=") passed = a >= b;
            else if (cmp == "<") passed = a < b;
            else if (cmp == "<=") passed = a <= b;
        }

        return {passed: passed, valid: true, valueA: a};
    }

    // === Requirement Value-A Evaluation (for AddSource/SubSource) ===

    private static function evaluateRequirementValueA(requirement:Dynamic, frameCache:Map<String, Array<Dynamic>>, gameRoot:Dynamic):Float {
        if (untyped requirement.compiledA == null) return Math.NaN;

        var cacheKeyA:String = Std.string(untyped requirement.addressA);
        var currentA:Array<Dynamic> = frameCache.exists(cacheKeyA) ? frameCache.get(cacheKeyA) : null;
        if (currentA == null) {
            var cA:Array<Dynamic> = untyped requirement.compiledA;
            currentA = Evaluate.evaluate(cA, 1, cA.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
            if (currentA != null) frameCache.set(cacheKeyA, currentA);
        }

        if (currentA == null || currentA.length != 1) return Math.NaN;

        // Handle Delta type
        var reqId:String = Std.string(untyped requirement.id);
        if (untyped requirement.typeA == "DELTA") {
            var deltaData:Dynamic = deltaValues.exists(reqId) ? deltaValues.get(reqId) : null;
            if (deltaData == null || untyped __typeof__(deltaData.prevA) == "undefined") {
                storeDeltaValue(reqId, "A", currentA[0]);
                return Math.NaN;
            }
            // Capture previous value BEFORE storing current to avoid corruption
            // when this requirement is evaluated multiple times per frame
            var capturedPrevA:Dynamic = untyped deltaData.prevA;
            storeDeltaValue(reqId, "A", currentA[0]);
            return toFloat(capturedPrevA);
        }

        return toFloat(currentA[0]);
    }

    // === Chain Evaluation ===

    private static function evaluateChain(group:Dynamic, startIndex:Int, frameCache:Map<String, Array<Dynamic>>, skipIndices:Map<Int, Bool>, gameRoot:Dynamic):Dynamic {
        var reqs:Array<Dynamic> = untyped group.requirements;
        var k:Int = startIndex;
        var req:Dynamic = reqs[k];

        var evalResult:Dynamic = evaluateRequirementCondition(req, frameCache, gameRoot);
        if (!evalResult.valid) {
            while (k + 1 < reqs.length) {
                k++;
                while (k < reqs.length && skipIndices.exists(k)) k++;
                if (k >= reqs.length) break;
                var nextReq:Dynamic = reqs[k];
                if (untyped nextReq.flag != "AND_NEXT" && untyped nextReq.flag != "OR_NEXT") {
                    return {chainResult: false, terminalIndex: k, valid: false};
                }
            }
            return {chainResult: false, terminalIndex: k, valid: false};
        }

        var chainResult:Bool = evalResult.passed;
        var currentOp:String = Std.string(untyped req.flag);

        while (k + 1 < reqs.length) {
            k++;
            while (k < reqs.length && skipIndices.exists(k)) k++;
            if (k >= reqs.length) return {chainResult: chainResult, terminalIndex: k - 1, valid: true};

            var nextReq:Dynamic = reqs[k];
            var nextEval:Dynamic = evaluateRequirementCondition(nextReq, frameCache, gameRoot);

            if (currentOp == "AND_NEXT") {
                chainResult = chainResult && (nextEval.valid && nextEval.passed);
            } else {
                chainResult = chainResult || (nextEval.valid && nextEval.passed);
            }

            if (untyped nextReq.flag != "AND_NEXT" && untyped nextReq.flag != "OR_NEXT") {
                return {chainResult: chainResult, terminalIndex: k, valid: true};
            }
            currentOp = Std.string(untyped nextReq.flag);
        }

        // Chain extends to end of requirements array — treat last element as terminal
        return {chainResult: chainResult, terminalIndex: k, valid: true};
    }

    // === Main Achievement Loop ===

    public static function checkAchievements(gameRoot:Dynamic, sendMessage:String->Dynamic->Void, sendEditData:Dynamic->Void):Void {
        if (untyped AppData.data == null || untyped AppData.data.assets == null) return;
        if (!processingActive) return;

        // Use ROOT_SENTINEL as evaluation context so achievements see the same
        // properties as the Memory Explorer (display list + static class fields).
        Evaluate.ROOT_SENTINEL.__raflash_gameRoot = gameRoot;

        var frameCache:Map<String, Array<Dynamic>> = new Map();
        var assets:Array<Dynamic> = untyped AppData.data.assets;
        var assetCount:Int = assets.length;
        var ai:Int = 0;
        var frameStartTime:Float = benchmarkingActive ? Timer.stamp() * 1000 : 0;
        var rpTimeMs:Float = 0;

        while (ai < assetCount) {
            var achievement:Dynamic = assets[ai];

            if (untyped achievement.state != "ACTIVE") { ai++; continue; }

            // Rich Presence
            if (untyped achievement.type == "RICH_PRESENCE") {
                var rpNow:Float = Timer.stamp() * 1000;
                if (rpNow - lastRichPresenceTime >= RICH_PRESENCE_INTERVAL) {
                    lastRichPresenceTime = rpNow;
                    var rpStartTime:Float = benchmarkingActive ? Timer.stamp() * 1000 : 0;

                    // Native compiled RP path
                    if (nativeAchReady && nativeRpFns != null && nativeRpFnMap.exists(ai)) {
                        var rpFnIdx:Int = nativeRpFnMap.get(ai);
                        var rpFn:Dynamic = untyped nativeRpFns[rpFnIdx];
                        if (rpFn != null) {
                            // Ensure per-asset storage exists
                            while (nativeRpStorage.length <= ai) nativeRpStorage.push(null);
                            if (nativeRpStorage[ai] == null) nativeRpStorage[ai] = {};
                            try {
                                var rpNative:Dynamic = untyped rpFn(gameRoot, nativeRpStorage[ai]);
                                var rpStr:String = (rpNative != null) ? Std.string(rpNative) : "";
                                untyped achievement._richPresenceResult = rpStr;
                                sendMessage("richPresenceUpdate", {result: rpStr});
                            } catch (e:Dynamic) {}
                        }
                    } else {
                        // Interpreter path
                        var compiledFormula:Array<Dynamic> = untyped achievement.compiledFormula;
                        if (compiledFormula != null && compiledFormula.length > 1) {
                            var rpResult = Evaluate.evaluate(compiledFormula, 1, compiledFormula.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
                            var rpString:String = (rpResult != null && rpResult.length > 0) ? Std.string(rpResult[0]) : "";
                            untyped achievement._richPresenceResult = rpString;
                            sendMessage("richPresenceUpdate", {result: rpString});
                        }
                    }
                    if (benchmarkingActive) {
                        var rpElapsed:Float = Timer.stamp() * 1000 - rpStartTime;
                        rpTimeMs += rpElapsed;
                        sendMessage("benchmark", {kind: "Rich Presence", ms: rpElapsed});
                    }
                }
                ai++;
                continue;
            }

            // === Native compiled achievement path ===
            if (nativeAchReady && nativeAchFns != null && nativeAchFnMap.exists(ai)) {
                var achStartTime:Float = benchmarkingActive ? Timer.stamp() * 1000 : 0;
                var fnIdx:Int = nativeAchFnMap.get(ai);
                var achFn:Dynamic = untyped nativeAchFns[fnIdx];

                if (achFn != null) {
                    // Ensure per-asset storage exists
                    while (nativeAchStorage.length <= ai) nativeAchStorage.push(null);
                    if (nativeAchStorage[ai] == null) nativeAchStorage[ai] = {};
                    var naStore:Dynamic = nativeAchStorage[ai];

                    try {
                        var achResult:Int = untyped achFn(gameRoot, naStore);

                        // Primed badge state (set by native function in storage._primed)
                        var naPrimed:Dynamic = untyped naStore._primed;
                        if (naPrimed == true || naPrimed == 1) {
                            if (untyped achievement._primed != true) {
                                var primedImg:String = "http://raflash.local/asset-image/" + Std.string(untyped achievement.id);
                                PrimedBadges.show(untyped achievement.id, primedImg);
                            }
                            untyped achievement._primed = true;
                        } else {
                            if (untyped achievement._primed == true) {
                                PrimedBadges.hide(untyped achievement.id);
                            }
                            untyped achievement._primed = false;
                        }

                        // Measured progress (set by native function in storage._mCur/_mTgt)
                        var naMCur:Dynamic = untyped naStore._mCur;
                        var naMTgt:Dynamic = untyped naStore._mTgt;
                        if (naMCur != null && naMTgt != null) {
                            var prevMV:Dynamic = untyped achievement._measuredValue;
                            var mCurF:Float = toFloat(naMCur);
                            var mTgtF:Float = toFloat(naMTgt);
                            var mvChanged:Bool = (prevMV != null) &&
                                (mCurF != toFloat(prevMV) || mTgtF != toFloat(untyped achievement._measuredTarget));
                            if (mvChanged && achResult != 1) {
                                var mText:String = Std.string(Math.floor(mCurF)) + "/" + Std.string(Math.floor(mTgtF));
                                var mImg:String = "http://raflash.local/asset-image/" + Std.string(untyped achievement.id);
                                Measure.showOrReset(Std.string(untyped achievement.name), Std.string(untyped achievement.description), mText, mImg, untyped achievement.id);
                            }
                            untyped achievement._measuredValue = mCurF;
                            untyped achievement._measuredTarget = mTgtF;
                        }

                        // Achievement triggered
                        if (achResult == 1) {
                            var trigImg:String = "http://raflash.local/asset-image/" + Std.string(untyped achievement.id);
                            Toast.show("Achievement Unlocked", Std.string(untyped achievement.name), Std.string(untyped achievement.description), "left", trigImg);
                            clearAssetDeltaValues(achievement);
                            diffSet(achievement, "state", "TRIGGERED", "assets/" + ai + "/state");
                            // Reset native storage for this asset
                            nativeAchStorage[ai] = {};
                        }
                    } catch (e:Dynamic) {
                        // Native eval failed — will fall back to interpreter next frame
                        // if recompilation fixes the issue
                    }
                }

                if (benchmarkingActive) {
                    var achElapsed:Float = Timer.stamp() * 1000 - achStartTime;
                    sendMessage("benchmark", {kind: Std.string(untyped achievement.name), ms: achElapsed});
                }
                ai++;
                continue;
            }

            var assetTriggered:Bool = true;
            var hasRequirements:Bool = false;
            var hasTriggerCondition:Bool = false;
            // === PHASE 0: Pause If detection ===
            var groups:Array<Dynamic> = untyped achievement.groups;
            var groupCount:Int = groups.length;
            var groupNonTriggerMet:Array<Bool> = [for (_ in 0...groupCount) true];
            var groupTriggerMet:Array<Bool> = [for (_ in 0...groupCount) true];
            var groupHasTrigger:Array<Bool> = [for (_ in 0...groupCount) false];
            var groupPauseStates:Array<Bool> = [];
            var groupPauseIfResults:Array<Array<Dynamic>> = [];
            var groupChainInfos:Array<Map<Int, Dynamic>> = [];
            var groupRnifHandled:Array<Map<Int, Bool>> = [];

            var j:Int = 0;
            while (j < groupCount) {
                var group:Dynamic = groups[j];
                var reqs:Array<Dynamic> = untyped group.requirements;
                var reqCount:Int = reqs.length;
                var isPaused:Bool = false;
                var pauseIfResults:Array<Dynamic> = [];
                var chainInfo:Map<Int, Dynamic> = new Map();
                var rnifHandled:Map<Int, Bool> = new Map();

                // First pass: identify chains ending in Pause If.
                // Scan flags first to find PauseIf terminals, then only evaluate those chains
                // (avoids double-evaluating non-PauseIf chains and corrupting DELTA tracking).
                var k:Int = 0;
                while (k < reqCount) {
                    var requirement:Dynamic = reqs[k];
                    var flag:String = Std.string(untyped requirement.flag);
                    if (flag == "AND_NEXT" || flag == "OR_NEXT") {
                        // Scan forward without evaluating to find chain terminal
                        var scanK:Int = k;
                        while (scanK + 1 < reqCount) {
                            scanK++;
                            var scanFlag:String = Std.string(untyped reqs[scanK].flag);
                            if (scanFlag != "AND_NEXT" && scanFlag != "OR_NEXT") break;
                        }
                        // Only evaluate if the terminal is a PauseIf
                        if (scanK < reqCount && untyped reqs[scanK].flag == "PAUSE_IF") {
                            var emptySkip:Map<Int, Bool> = new Map();
                            var cr:Dynamic = evaluateChain(group, k, frameCache, emptySkip, gameRoot);
                            if (cr.terminalIndex < reqCount) {
                                var cm:Int = k;
                                while (cm < cr.terminalIndex) {
                                    chainInfo.set(cm, {isChainMember: true, terminalIndex: cr.terminalIndex});
                                    cm++;
                                }
                                chainInfo.set(cr.terminalIndex, {isTerminal: true, chainResult: cr.chainResult, chainValid: cr.valid});
                            }
                            k = cr.terminalIndex;
                        } else {
                            k = scanK;
                        }
                    }
                    k++;
                }

                // Second pass: process Pause If requirements
                k = 0;
                while (k < reqCount) {
                    var requirement:Dynamic = reqs[k];
                    var info:Dynamic = chainInfo.exists(k) ? chainInfo.get(k) : null;
                    if (info != null && untyped info.isChainMember == true && untyped info.isTerminal != true) { k++; continue; }
                    if (untyped requirement.flag != "PAUSE_IF") { k++; continue; }

                    hasRequirements = true;
                    var basePath:String = "assets/" + ai + "/groups/" + j + "/requirements/" + k;
                    var passed:Bool = false;
                    var valid:Bool = true;

                    if (info != null && untyped info.isTerminal == true) {
                        passed = info.chainResult;
                        valid = info.chainValid;
                        if (valid) {
                            var termEval:Dynamic = evaluateRequirementCondition(requirement, frameCache, gameRoot);
                            valid = termEval.valid;
                        }
                    } else {
                        var evalResult:Dynamic = evaluateRequirementCondition(requirement, frameCache, gameRoot);
                        passed = evalResult.passed;
                        valid = evalResult.valid;
                    }

                    if (!valid) {
                        pauseIfResults.push({req: requirement, passed: false, valid: false, basePath: basePath, reqIndex: k});
                        k++;
                        continue;
                    }

                    if (isPaused) {
                        pauseIfResults.push({req: requirement, passed: false, valid: true, basePath: basePath, reqIndex: k});
                        k++;
                        continue;
                    }

                    pauseIfResults.push({req: requirement, passed: passed, valid: true, basePath: basePath, reqIndex: k});

                    // Check for ResetNextIf targeting this PauseIf
                    // Per RA docs: ResetNextIf followed by PauseIf is evaluated even while paused,
                    // allowing it to unlock a PauseLock without needing an alt group.
                    var prevK:Int = k - 1;
                    while (prevK >= 0 && Std.string(untyped reqs[prevK].flag) == "RESET_NEXT_IF") {
                        rnifHandled.set(prevK, true);
                        var rnifReq:Dynamic = reqs[prevK];
                        var rnifResult:Dynamic = evaluateRequirementCondition(rnifReq, frameCache, gameRoot);
                        if (rnifResult.valid && rnifResult.passed) {
                            // Reset the PauseIf's hit count
                            var rnifHits:Int = untyped requirement.hits != null ? requirement.hits : 0;
                            if (rnifHits > 0) {
                                diffSet(requirement, "hits", 0, basePath + "/hits");
                            }
                        }
                        prevK--;
                    }

                    var maxHits:Int = untyped requirement.maxHits != null ? requirement.maxHits : 0;
                    var currentHits:Int = untyped requirement.hits != null ? requirement.hits : 0;

                    if (maxHits == 0) {
                        if (passed) isPaused = true;
                    } else {
                        if (currentHits >= maxHits) {
                            isPaused = true;
                        } else if (passed) {
                            var newHits:Int = currentHits + 1;
                            diffSet(requirement, "hits", newHits, basePath + "/hits");
                            if (newHits >= maxHits) isPaused = true;
                        }
                    }
                    k++;
                }

                groupPauseStates.push(isPaused);
                groupPauseIfResults.push(pauseIfResults);
                groupChainInfos.push(chainInfo);
                groupRnifHandled.push(rnifHandled);
                j++;
            }

            // === PHASE 1: Delta updates in paused groups ===
            j = 0;
            while (j < groupCount) {
                if (!groupPauseStates[j]) { j++; continue; }
                var group:Dynamic = groups[j];
                var reqs:Array<Dynamic> = untyped group.requirements;
                var k:Int = 0;
                while (k < reqs.length) {
                    var requirement:Dynamic = reqs[k];
                    if (untyped requirement.flag == "PAUSE_IF") { k++; continue; }
                    hasRequirements = true;
                    if (untyped requirement.compiledA == null || untyped requirement.compiledB == null) { k++; continue; }

                    if (untyped requirement.typeA == "DELTA") {
                        var ckA:String = Std.string(untyped requirement.addressA);
                        var curA:Array<Dynamic> = frameCache.exists(ckA) ? frameCache.get(ckA) : null;
                        if (curA == null) {
                            var cA:Array<Dynamic> = untyped requirement.compiledA;
                            curA = Evaluate.evaluate(cA, 1, cA.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
                            if (curA != null) frameCache.set(ckA, curA);
                        }
                        if (curA != null && curA.length == 1)
                            storeDeltaValue(Std.string(untyped requirement.id), "A", curA[0]);
                    }
                    if (untyped requirement.typeB == "DELTA") {
                        var ckB:String = Std.string(untyped requirement.addressB);
                        var curB:Array<Dynamic> = frameCache.exists(ckB) ? frameCache.get(ckB) : null;
                        if (curB == null) {
                            var cB:Array<Dynamic> = untyped requirement.compiledB;
                            curB = Evaluate.evaluate(cB, 1, cB.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
                            if (curB != null) frameCache.set(ckB, curB);
                        }
                        if (curB != null && curB.length == 1)
                            storeDeltaValue(Std.string(untyped requirement.id), "B", curB[0]);
                    }
                    k++;
                }
                j++;
            }

            // === PHASE 2: Normal evaluation & Reset If detection ===
            var resetIfFired:Bool = false;
            var groupResults:Array<Dynamic> = [];
            var resetNextIfTargets:Array<Dynamic> = [];

            j = 0;
            while (j < groupCount) {
                var group:Dynamic = groups[j];
                var reqs:Array<Dynamic> = untyped group.requirements;

                if (groupPauseStates[j]) {
                    groupResults.push({type: untyped group.type, requirements: groupPauseIfResults[j], allPassed: false, isPaused: true});
                    j++;
                    continue;
                }

                var groupReqs:Array<Dynamic> = [];
                var groupAllPassed:Bool = true;

                // Add Phase 0 Pause If results
                var piResults:Array<Dynamic> = groupPauseIfResults[j];
                var pi:Int = 0;
                while (pi < piResults.length) { groupReqs.push(piResults[pi]); pi++; }

                // Build pauseIfIndices
                var pauseIfIndices:Map<Int, Bool> = new Map();
                pi = 0;
                while (pi < piResults.length) {
                    pauseIfIndices.set(piResults[pi].reqIndex, true);
                    pi++;
                }
                // Also skip ResetNextIf requirements that target PauseIf (handled in Phase 0)
                var rnifHandledMap:Map<Int, Bool> = groupRnifHandled[j];
                for (rnifIdx in rnifHandledMap.keys()) {
                    pauseIfIndices.set(rnifIdx, true);
                }

                // Detect non-Pause-If chains
                var chainInfo:Map<Int, Dynamic> = groupChainInfos[j];
                var k:Int = 0;
                while (k < reqs.length) {
                    if (chainInfo.exists(k) || pauseIfIndices.exists(k)) { k++; continue; }
                    var requirement:Dynamic = reqs[k];
                    var flag:String = Std.string(untyped requirement.flag);
                    if (flag == "AND_NEXT" || flag == "OR_NEXT") {
                        var cr:Dynamic = evaluateChain(group, k, frameCache, pauseIfIndices, gameRoot);
                        var cm:Int = k;
                        while (cm < cr.terminalIndex) {
                            if (!pauseIfIndices.exists(cm)) chainInfo.set(cm, {isChainMember: true, terminalIndex: cr.terminalIndex});
                            cm++;
                        }
                        if (cr.terminalIndex < reqs.length && !pauseIfIndices.exists(cr.terminalIndex)) {
                            chainInfo.set(cr.terminalIndex, {isTerminal: true, chainResult: cr.chainResult, chainValid: cr.valid});
                        }
                        k = cr.terminalIndex;
                    }
                    k++;
                }

                // Detect AddHits/SubHits chains
                var addHitsInfo:Map<Int, Dynamic> = new Map();
                k = 0;
                while (k < reqs.length) {
                    if (pauseIfIndices.exists(k) || addHitsInfo.exists(k)) { k++; continue; }
                    var requirement:Dynamic = reqs[k];
                    var flag:String = Std.string(untyped requirement.flag);
                    if (flag == "ADD_HITS" || flag == "SUB_HITS") {
                        var contributors:Array<Int> = [k];
                        var termIdx:Int = k + 1;
                        while (termIdx < reqs.length) {
                            if (pauseIfIndices.exists(termIdx)) { termIdx++; continue; }
                            var nf:String = Std.string(untyped reqs[termIdx].flag);
                            if (nf == "ADD_HITS" || nf == "SUB_HITS") { contributors.push(termIdx); termIdx++; }
                            else break;
                        }
                        for (ci in contributors) addHitsInfo.set(ci, {isChainMember: true, terminalIndex: termIdx, flag: Std.string(untyped reqs[ci].flag)});
                        if (termIdx < reqs.length) addHitsInfo.set(termIdx, {isTerminal: true, contributors: contributors});
                        k = termIdx - 1;
                    }
                    k++;
                }

                // Process each requirement
                var sourceAccumulator:Float = 0;
                k = 0;
                while (k < reqs.length) {
                    var requirement:Dynamic = reqs[k];
                    if (pauseIfIndices.exists(k)) { k++; continue; }

                    var info:Dynamic = chainInfo.exists(k) ? chainInfo.get(k) : null;
                    if (info != null && untyped info.isChainMember == true && untyped info.isTerminal != true) { k++; continue; }

                    // Handle AddSource/SubSource: accumulate left-side value, skip to next
                    var reqFlag:String = Std.string(untyped requirement.flag);
                    if (reqFlag == "ADD_SOURCE") {
                        var addVal:Float = evaluateRequirementValueA(requirement, frameCache, gameRoot);
                        if (!Math.isNaN(addVal)) sourceAccumulator += addVal;
                        k++;
                        continue;
                    }
                    if (reqFlag == "SUB_SOURCE") {
                        var subVal:Float = evaluateRequirementValueA(requirement, frameCache, gameRoot);
                        if (!Math.isNaN(subVal)) sourceAccumulator -= subVal;
                        k++;
                        continue;
                    }

                    // Consume the accumulator for this requirement, then reset
                    var reqAccumulator:Float = sourceAccumulator;
                    sourceAccumulator = 0;

                    hasRequirements = true;
                    var basePath:String = "assets/" + ai + "/groups/" + j + "/requirements/" + k;

                    // Hit count completion lock
                    var completionMaxHits:Int = untyped requirement.maxHits != null ? requirement.maxHits : 0;
                    var completionCurrentHits:Int = untyped requirement.hits != null ? requirement.hits : 0;
                    if (completionMaxHits > 0 && completionCurrentHits >= completionMaxHits) {
                        groupReqs.push({req: requirement, passed: true, valid: true, basePath: basePath, reqIndex: k});
                        k++;
                        continue;
                    }

                    var passed:Bool = false;
                    var valid:Bool = true;

                    if (info != null && untyped info.isTerminal == true) {
                        passed = info.chainResult;
                        valid = info.chainValid;
                    } else {
                        var evalResult:Dynamic = evaluateRequirementCondition(requirement, frameCache, gameRoot, reqAccumulator);
                        passed = evalResult.passed;
                        valid = evalResult.valid;
                    }

                    if (!valid) {
                        groupReqs.push({req: requirement, passed: false, valid: false, basePath: basePath, reqIndex: k});
                        var flagInvalid:String = Std.string(untyped requirement.flag);
                        if (flagInvalid == "" || flagInvalid == "null" || flagInvalid == "MEASURED" || flagInvalid == "MEASURED_IF") {
                            groupAllPassed = false;
                        }
                        k++;
                        continue;
                    }

                    groupReqs.push({req: requirement, passed: passed, valid: true, basePath: basePath, reqIndex: k});

                    // Group satisfaction check
                    var flagSat:String = Std.string(untyped requirement.flag);
                    if (flagSat == "" || flagSat == "null" || flagSat == "MEASURED" || flagSat == "MEASURED_IF" || flagSat == "TRIGGER") {
                        if (flagSat == "TRIGGER") {
                            hasTriggerCondition = true;
                            groupHasTrigger[j] = true;
                        }

                        var maxHitsEval:Int = untyped requirement.maxHits != null ? requirement.maxHits : 0;
                        var currentHitsEval:Int = untyped requirement.hits != null ? requirement.hits : 0;
                        var reqSatisfied:Bool = false;

                        if (maxHitsEval == 0) {
                            reqSatisfied = passed;
                        } else {
                            var ahsI:Dynamic = addHitsInfo.exists(k) ? addHitsInfo.get(k) : null;
                            if (ahsI != null && untyped ahsI.isTerminal == true) {
                                var contribs:Array<Int> = ahsI.contributors;
                                var effectiveHits:Int = currentHitsEval;
                                var lookahead:Int = 0;
                                for (contribIdx in contribs) {
                                    var contribReq:Dynamic = reqs[contribIdx];
                                    var contribHits:Int = untyped contribReq.hits != null ? contribReq.hits : 0;
                                    var contribMax:Int = untyped contribReq.maxHits != null ? contribReq.maxHits : 0;
                                    var contribResult:Dynamic = evaluateRequirementCondition(contribReq, frameCache, gameRoot);
                                    var contribPasses:Bool = contribResult.passed && contribResult.valid;
                                    var contribCanIncrement:Bool = contribPasses && (contribMax == 0 || contribHits < contribMax);
                                    if (Std.string(untyped contribReq.flag) == "ADD_HITS") {
                                        effectiveHits += contribHits;
                                        if (contribCanIncrement) lookahead += 1;
                                    } else {
                                        effectiveHits -= contribHits;
                                        if (contribCanIncrement) lookahead -= 1;
                                    }
                                }
                                var terminalLookahead:Int = passed ? 1 : 0;
                                reqSatisfied = (effectiveHits >= maxHitsEval) || (effectiveHits + lookahead + terminalLookahead >= maxHitsEval);
                            } else {
                                reqSatisfied = (currentHitsEval >= maxHitsEval) || (passed && currentHitsEval + 1 >= maxHitsEval);
                            }
                        }

                        if (!reqSatisfied) {
                            groupAllPassed = false;
                            if (flagSat == "TRIGGER") groupTriggerMet[j] = false;
                            else groupNonTriggerMet[j] = false;
                        }
                    }

                    // Reset If detection
                    if (untyped requirement.flag == "RESET_IF") {
                        var mhCheck:Int = untyped requirement.maxHits != null ? requirement.maxHits : 0;
                        var chCheck:Int = untyped requirement.hits != null ? requirement.hits : 0;

                        if (mhCheck == 0) {
                            if (passed) resetIfFired = true;
                        } else {
                            // Compute effective hits including AddHits/SubHits chain
                            var rifEffective:Int = chCheck;
                            var rifLookahead:Int = 0;
                            var rifAhsI:Dynamic = addHitsInfo.exists(k) ? addHitsInfo.get(k) : null;
                            if (rifAhsI != null && untyped rifAhsI.isTerminal == true) {
                                var rifContribs:Array<Int> = rifAhsI.contributors;
                                for (rifCIdx in rifContribs) {
                                    var rifCReq:Dynamic = reqs[rifCIdx];
                                    var rifCHits:Int = untyped rifCReq.hits != null ? rifCReq.hits : 0;
                                    var rifCMax:Int = untyped rifCReq.maxHits != null ? rifCReq.maxHits : 0;
                                    var rifCRes:Dynamic = evaluateRequirementCondition(rifCReq, frameCache, gameRoot);
                                    var rifCPasses:Bool = rifCRes.passed && rifCRes.valid;
                                    var rifCCanInc:Bool = rifCPasses && (rifCMax == 0 || rifCHits < rifCMax);
                                    if (Std.string(untyped rifCReq.flag) == "ADD_HITS") {
                                        rifEffective += rifCHits;
                                        if (rifCCanInc) rifLookahead += 1;
                                    } else {
                                        rifEffective -= rifCHits;
                                        if (rifCCanInc) rifLookahead -= 1;
                                    }
                                }
                            }
                            // Own-hit lookahead: passing this frame would increment own hits
                            var rifOwnLook:Int = (passed && chCheck < mhCheck) ? 1 : 0;
                            if (rifEffective + rifLookahead + rifOwnLook >= mhCheck) {
                                resetIfFired = true;
                            }
                        }
                    }

                    // Reset Next If detection
                    if (untyped requirement.flag == "RESET_NEXT_IF") {
                        var mhRNI:Int = untyped requirement.maxHits != null ? requirement.maxHits : 0;
                        var chRNI:Int = untyped requirement.hits != null ? requirement.hits : 0;
                        var resetNextIfFired:Bool = false;

                        if (mhRNI == 0) {
                            if (passed) resetNextIfFired = true;
                        } else {
                            // Compute effective hits including AddHits/SubHits chain
                            var rniEffective:Int = chRNI;
                            var rniLookahead:Int = 0;
                            var rniAhsI:Dynamic = addHitsInfo.exists(k) ? addHitsInfo.get(k) : null;
                            if (rniAhsI != null && untyped rniAhsI.isTerminal == true) {
                                var rniContribs:Array<Int> = rniAhsI.contributors;
                                for (rniCIdx in rniContribs) {
                                    var rniCReq:Dynamic = reqs[rniCIdx];
                                    var rniCHits:Int = untyped rniCReq.hits != null ? rniCReq.hits : 0;
                                    var rniCMax:Int = untyped rniCReq.maxHits != null ? rniCReq.maxHits : 0;
                                    var rniCRes:Dynamic = evaluateRequirementCondition(rniCReq, frameCache, gameRoot);
                                    var rniCPasses:Bool = rniCRes.passed && rniCRes.valid;
                                    var rniCCanInc:Bool = rniCPasses && (rniCMax == 0 || rniCHits < rniCMax);
                                    if (Std.string(untyped rniCReq.flag) == "ADD_HITS") {
                                        rniEffective += rniCHits;
                                        if (rniCCanInc) rniLookahead += 1;
                                    } else {
                                        rniEffective -= rniCHits;
                                        if (rniCCanInc) rniLookahead -= 1;
                                    }
                                }
                            }
                            var rniOwnLook:Int = (passed && chRNI < mhRNI) ? 1 : 0;
                            if (rniEffective + rniLookahead + rniOwnLook >= mhRNI) {
                                resetNextIfFired = true;
                            }
                        }

                        if (resetNextIfFired) {
                            var nextK:Int = k + 1;
                            while (nextK < reqs.length && pauseIfIndices.exists(nextK)) nextK++;
                            if (nextK < reqs.length) {
                                resetNextIfTargets.push({groupIdx: j, reqIdx: nextK, basePath: "assets/" + ai + "/groups/" + j + "/requirements/" + nextK});
                            }
                        }
                    }

                    k++;
                }

                groupResults.push({type: untyped group.type, requirements: groupReqs, allPassed: groupAllPassed, isPaused: false});
                j++;
            }

            // === PHASE 3: Handle Reset If ===
            if (resetIfFired) {
                var gi:Int = 0;
                while (gi < groupResults.length) {
                    var grReset:Dynamic = groupResults[gi];
                    var resetReqs:Array<Dynamic> = grReset.requirements;
                    var ri:Int = 0;
                    while (ri < resetReqs.length) {
                        var rrReset:Dynamic = resetReqs[ri];
                        var reqHits:Int = untyped rrReset.req.hits != null ? rrReset.req.hits : 0;
                        if (reqHits > 0) diffSet(rrReset.req, "hits", 0, Std.string(rrReset.basePath) + "/hits");
                        ri++;
                    }
                    gi++;
                }
                // Reset hits in paused groups too
                j = 0;
                while (j < groupCount) {
                    if (!groupPauseStates[j]) { j++; continue; }
                    var reqs:Array<Dynamic> = untyped groups[j].requirements;
                    var k:Int = 0;
                    while (k < reqs.length) {
                        if (untyped reqs[k].flag == "PAUSE_IF") { k++; continue; }
                        var reqHits:Int = untyped reqs[k].hits != null ? reqs[k].hits : 0;
                        if (reqHits > 0) diffSet(reqs[k], "hits", 0, "assets/" + ai + "/groups/" + j + "/requirements/" + k + "/hits");
                        k++;
                    }
                    j++;
                }
                assetTriggered = false;
            } else {
                // === PHASE 4: Core + Alt group logic ===
                var coreGroupPassed:Bool = true;
                var hasAltGroups:Bool = false;
                var anyAltGroupPassed:Bool = false;

                var gi:Int = 0;
                while (gi < groupResults.length) {
                    var grCheck:Dynamic = groupResults[gi];
                    if (Std.string(untyped grCheck.type) == "CORE") {
                        coreGroupPassed = grCheck.allPassed;
                    } else {
                        hasAltGroups = true;
                        if (grCheck.allPassed) anyAltGroupPassed = true;
                    }
                    gi++;
                }

                assetTriggered = coreGroupPassed && (!hasAltGroups || anyAltGroupPassed);

                // === PHASE 4.5: TRIGGER flag - primed state ===
                // Compute from per-group tracking: core always contributes, alt groups only if they passed
                if (hasTriggerCondition) {
                    var allNonTriggerMet:Bool = true;
                    var allTriggerMet:Bool = true;
                    var pri:Int = 0;
                    while (pri < groupResults.length) {
                        var prGr:Dynamic = groupResults[pri];
                        if (!prGr.isPaused && (Std.string(untyped prGr.type) == "CORE" || Std.string(untyped prGr.type) == "null" || prGr.allPassed)) {
                            if (pri < groupNonTriggerMet.length && !groupNonTriggerMet[pri]) allNonTriggerMet = false;
                            if (pri < groupTriggerMet.length && !groupTriggerMet[pri]) allTriggerMet = false;
                        }
                        pri++;
                    }
                    if (hasAltGroups && !anyAltGroupPassed) allNonTriggerMet = false;
                    if (allNonTriggerMet && !allTriggerMet) {
                        if (untyped achievement._primed != true) {
                            var primedImageUrl:String = "http://raflash.local/asset-image/" + Std.string(untyped achievement.id);
                            PrimedBadges.show(untyped achievement.id, primedImageUrl);
                        }
                        untyped achievement._primed = true;
                        assetTriggered = false;
                    } else {
                        if (untyped achievement._primed == true) {
                            PrimedBadges.hide(untyped achievement.id);
                        }
                        untyped achievement._primed = false;
                    }
                }

                // === PHASE 5: Normal hits processing ===
                var gi:Int = 0;
                while (gi < groupResults.length) {
                    var gr:Dynamic = groupResults[gi];
                    if (gr.isPaused) { gi++; continue; }

                    var grReqs:Array<Dynamic> = gr.requirements;
                    var ri:Int = 0;
                    while (ri < grReqs.length) {
                        var rr:Dynamic = grReqs[ri];
                        if (!rr.valid) { ri++; continue; }
                        if (untyped rr.req.flag == "PAUSE_IF") { ri++; continue; }

                        if (rr.passed && untyped rr.req._triggered != true) {
                            untyped rr.req._triggered = true;
                        }

                        var maxHits:Int = untyped rr.req.maxHits != null ? rr.req.maxHits : 0;
                        var currentHits:Int = untyped rr.req.hits != null ? rr.req.hits : 0;
                        var isAddSubHits:Bool = (untyped rr.req.flag == "ADD_HITS" || untyped rr.req.flag == "SUB_HITS");

                        if (maxHits == 0 && !isAddSubHits) {
                            // No hits tracking
                        } else if (isAddSubHits) {
                            if (rr.passed) diffSet(rr.req, "hits", currentHits + 1, Std.string(rr.basePath) + "/hits");
                        } else {
                            if (currentHits < maxHits && rr.passed) {
                                diffSet(rr.req, "hits", currentHits + 1, Std.string(rr.basePath) + "/hits");
                            }
                        }
                        ri++;
                    }
                    gi++;
                }

                // === PHASE 5.5: Reset Next If ===
                var rni:Int = 0;
                while (rni < resetNextIfTargets.length) {
                    var target:Dynamic = resetNextIfTargets[rni];
                    var targetReq:Dynamic = untyped groups[target.groupIdx].requirements[target.reqIdx];
                    var tHits:Int = untyped targetReq.hits != null ? targetReq.hits : 0;
                    if (tHits > 0) diffSet(targetReq, "hits", 0, Std.string(target.basePath) + "/hits");
                    rni++;
                }
            }

            // === PHASE 6: Calculate Measured value ===
            // Process per-group: check MeasuredIf gates, handle paused group freezing
            var measuredError:Bool = false;
            var measuredCurrent:Float = Math.NaN;
            var measuredTarget:Float = Math.NaN;
            var hasAnyMeasured:Bool = false;

            var mg:Int = 0;
            while (mg < groupCount) {
                var mGroup:Dynamic = groups[mg];
                var mGroupPaused:Bool = groupPauseStates[mg];
                var mGroupReqs:Array<Dynamic> = untyped mGroup.requirements;

                // Collect MEASURED and MEASURED_IF in this group
                var groupHasMeasured:Bool = false;
                var groupHasMeasuredIf:Bool = false;

                var mr:Int = 0;
                while (mr < mGroupReqs.length) {
                    var mf:String = Std.string(untyped mGroupReqs[mr].flag);
                    if (mf == "MEASURED") groupHasMeasured = true;
                    if (mf == "MEASURED_IF") groupHasMeasuredIf = true;
                    mr++;
                }

                if (!groupHasMeasured && !groupHasMeasuredIf) { mg++; continue; }

                // If group is paused, use frozen measured value
                if (mGroupPaused) {
                    if (untyped __typeof__(untyped mGroup._pausedMeasuredCurrent) != "undefined") {
                        var pmCurrent:Float = toFloat(untyped mGroup._pausedMeasuredCurrent);
                        var pmTarget:Float = toFloat(untyped mGroup._pausedMeasuredTarget);
                        if (!hasAnyMeasured) {
                            measuredTarget = pmTarget;
                            measuredCurrent = pmCurrent;
                            hasAnyMeasured = true;
                        } else {
                            if (pmTarget != measuredTarget) measuredError = true;
                            else if (pmCurrent > measuredCurrent) measuredCurrent = pmCurrent;
                        }
                    }
                    mg++;
                    continue;
                }

                // Clear frozen value when unpaused
                untyped __delete__(mGroup, "_pausedMeasuredCurrent");
                untyped __delete__(mGroup, "_pausedMeasuredTarget");

                // Check all MeasuredIf conditions in this group
                // Per RA docs: if any MeasuredIf is false, the group's Measured value is 0
                var measuredIfAllPassed:Bool = true;
                if (groupHasMeasuredIf) {
                    var mif:Int = 0;
                    while (mif < mGroupReqs.length) {
                        if (Std.string(untyped mGroupReqs[mif].flag) == "MEASURED_IF") {
                            var mCondResult:Dynamic = evaluateRequirementCondition(mGroupReqs[mif], frameCache, gameRoot);
                            if (!mCondResult.valid || !mCondResult.passed) {
                                measuredIfAllPassed = false;
                                break;
                            }
                        }
                        mif++;
                    }
                }

                // Process MEASURED requirements in this group
                var groupMeasuredCurrent:Float = Math.NaN;
                var groupMeasuredTarget:Float = Math.NaN;

                mr = 0;
                while (mr < mGroupReqs.length) {
                    var mReq:Dynamic = mGroupReqs[mr];
                    if (Std.string(untyped mReq.flag) != "MEASURED") { mr++; continue; }

                    var mCurrent:Float;
                    var mTargetVal:Float;

                    if (!measuredIfAllPassed) {
                        // MeasuredIf gate failed — report 0 progress
                        // Still need the target for consistency checks
                        var mMaxHitsZero:Int = untyped mReq.maxHits != null ? mReq.maxHits : 0;
                        if (mMaxHitsZero > 0) {
                            mTargetVal = mMaxHitsZero;
                        } else if (untyped mReq.compiledB != null) {
                            var mCacheKeyBZ:String = Std.string(untyped mReq.addressB);
                            var mResultBZ:Array<Dynamic> = frameCache.exists(mCacheKeyBZ) ? frameCache.get(mCacheKeyBZ) : null;
                            if (mResultBZ == null) {
                                var cBZ:Array<Dynamic> = untyped mReq.compiledB;
                                mResultBZ = Evaluate.evaluate(cBZ, 1, cBZ.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
                                if (mResultBZ != null) frameCache.set(mCacheKeyBZ, mResultBZ);
                            }
                            mTargetVal = (mResultBZ != null && mResultBZ.length == 1) ? toFloat(mResultBZ[0]) : 0;
                        } else {
                            mTargetVal = 0;
                        }
                        mCurrent = 0;
                    } else {
                        var mMaxHits:Int = untyped mReq.maxHits != null ? mReq.maxHits : 0;
                        if (mMaxHits > 0) {
                            // Hit Count Mode
                            mTargetVal = mMaxHits;
                            mCurrent = untyped mReq.hits != null ? mReq.hits : 0;

                            // Check for AddHits/SubHits terminal
                            var mAhsInfo:Dynamic = null;
                            var mk:Int = 0;
                            while (mk < mGroupReqs.length) {
                                var mCheckFlag:String = Std.string(untyped mGroupReqs[mk].flag);
                                if (mCheckFlag == "ADD_HITS" || mCheckFlag == "SUB_HITS") {
                                    var mContribs:Array<Int> = [mk];
                                    var mTermIdx:Int = mk + 1;
                                    while (mTermIdx < mGroupReqs.length) {
                                        var mnf:String = Std.string(untyped mGroupReqs[mTermIdx].flag);
                                        if (mnf == "ADD_HITS" || mnf == "SUB_HITS") { mContribs.push(mTermIdx); mTermIdx++; }
                                        else break;
                                    }
                                    if (mTermIdx == mr) {
                                        mAhsInfo = {contributors: mContribs};
                                    }
                                    mk = mTermIdx;
                                }
                                mk++;
                            }

                            if (mAhsInfo != null) {
                                var contribs:Array<Int> = mAhsInfo.contributors;
                                for (contribIdx in contribs) {
                                    var contribReq:Dynamic = mGroupReqs[contribIdx];
                                    var contribHits:Int = untyped contribReq.hits != null ? contribReq.hits : 0;
                                    if (Std.string(untyped contribReq.flag) == "ADD_HITS") mCurrent += contribHits;
                                    else mCurrent -= contribHits;
                                }
                            }
                        } else {
                            // Value Mode
                            if (untyped mReq.compiledA == null || untyped mReq.compiledB == null) { mr++; continue; }

                            var mCacheKeyA:String = Std.string(untyped mReq.addressA);
                            var mCacheKeyB:String = Std.string(untyped mReq.addressB);

                            var mResultA:Array<Dynamic> = frameCache.exists(mCacheKeyA) ? frameCache.get(mCacheKeyA) : null;
                            if (mResultA == null) {
                                var cA:Array<Dynamic> = untyped mReq.compiledA;
                                mResultA = Evaluate.evaluate(cA, 1, cA.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
                                if (mResultA != null) frameCache.set(mCacheKeyA, mResultA);
                            }
                            var mResultB:Array<Dynamic> = frameCache.exists(mCacheKeyB) ? frameCache.get(mCacheKeyB) : null;
                            if (mResultB == null) {
                                var cB:Array<Dynamic> = untyped mReq.compiledB;
                                mResultB = Evaluate.evaluate(cB, 1, cB.length, [Evaluate.ROOT_SENTINEL], cast ["root"], gameRoot);
                                if (mResultB != null) frameCache.set(mCacheKeyB, mResultB);
                            }

                            if (mResultA == null || mResultB == null || mResultA.length != 1 || mResultB.length != 1) { mr++; continue; }
                            mCurrent = toFloat(mResultA[0]);
                            mTargetVal = toFloat(mResultB[0]);
                        }
                    }

                    // Track per-group max
                    if (Math.isNaN(groupMeasuredTarget)) {
                        groupMeasuredTarget = mTargetVal;
                        groupMeasuredCurrent = mCurrent;
                    } else {
                        if (mTargetVal != groupMeasuredTarget) measuredError = true;
                        else if (mCurrent > groupMeasuredCurrent) groupMeasuredCurrent = mCurrent;
                    }
                    mr++;
                }

                // Skip if no valid MEASURED in this group
                if (Math.isNaN(groupMeasuredTarget)) { mg++; continue; }

                // Store measured value for freezing when group becomes paused
                untyped mGroup._pausedMeasuredCurrent = groupMeasuredCurrent;
                untyped mGroup._pausedMeasuredTarget = groupMeasuredTarget;

                // Combine across groups
                if (!hasAnyMeasured) {
                    measuredTarget = groupMeasuredTarget;
                    measuredCurrent = groupMeasuredCurrent;
                    hasAnyMeasured = true;
                } else {
                    if (groupMeasuredTarget != measuredTarget) measuredError = true;
                    else if (groupMeasuredCurrent > measuredCurrent) measuredCurrent = groupMeasuredCurrent;
                }
                mg++;
            }

            // Trigger Measure UI if value changed
            if (hasAnyMeasured) {
                var prevMeasuredValue:Dynamic = untyped achievement._measuredValue;
                var prevMeasuredError:Dynamic = untyped achievement._measuredError;
                var measuredImageUrl:String = "http://raflash.local/asset-image/" + Std.string(untyped achievement.id);

                if (measuredError) {
                    if (prevMeasuredError != true && !assetTriggered) {
                        Measure.showOrReset(Std.string(untyped achievement.name), Std.string(untyped achievement.description), "ERROR", measuredImageUrl, untyped achievement.id);
                    }
                    untyped achievement._measuredError = true;
                } else {
                    untyped achievement._measuredError = false;
                    var valueChanged:Bool = (prevMeasuredValue != null) &&
                        (measuredCurrent != toFloat(prevMeasuredValue) || measuredTarget != toFloat(untyped achievement._measuredTarget));
                    if (valueChanged && !assetTriggered) {
                        var measuredText:String = Std.string(Math.floor(measuredCurrent)) + "/" + Std.string(Math.floor(measuredTarget));
                        Measure.showOrReset(Std.string(untyped achievement.name), Std.string(untyped achievement.description), measuredText, measuredImageUrl, untyped achievement.id);
                    }
                    untyped achievement._measuredValue = measuredCurrent;
                    untyped achievement._measuredTarget = measuredTarget;
                }
            }

            // Achievement triggered
            if (assetTriggered && hasRequirements) {
                var imageUrl:String = "http://raflash.local/asset-image/" + Std.string(untyped achievement.id);
                Toast.show("Achievement Unlocked", Std.string(untyped achievement.name), Std.string(untyped achievement.description), "left", imageUrl);

                // Reset all hits
                var gj:Int = 0;
                while (gj < groupCount) {
                    var grpReqs:Array<Dynamic> = untyped groups[gj].requirements;
                    var rk:Int = 0;
                    while (rk < grpReqs.length) {
                        var reqHits:Int = untyped grpReqs[rk].hits != null ? grpReqs[rk].hits : 0;
                        if (reqHits > 0) diffSet(grpReqs[rk], "hits", 0, "assets/" + ai + "/groups/" + gj + "/requirements/" + rk + "/hits");
                        rk++;
                    }
                    gj++;
                }

                clearAssetDeltaValues(achievement);
                diffSet(achievement, "state", "TRIGGERED", "assets/" + ai + "/state");
            }

            ai++;
        }

        // Send pending changes
        var diffStartTime:Float = benchmarkingActive ? Timer.stamp() * 1000 : 0;
        if (diffHasPending()) {
            sendEditData(diffFlush());
        }

        if (benchmarkingActive) {
            var diffMs:Float = Timer.stamp() * 1000 - diffStartTime;
            var frameTotalMs:Float = Timer.stamp() * 1000 - frameStartTime;
            sendMessage("benchmark", {kind: "Achievements", ms: frameTotalMs - diffMs - rpTimeMs});
            sendMessage("benchmark", {kind: "Diff Ops", ms: diffMs});
        }
    }
}
