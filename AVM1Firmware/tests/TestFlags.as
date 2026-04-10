/**
 * Unit tests for achievement flag logic (Reset If, Pause If, etc.)
 *
 * Tests the checkAchievements() function with mock achievement data
 * to verify correct behavior of requirement flags.
 */
class TestFlags {
    // Counter for generating unique requirement IDs
    private static var reqIdCounter:Number = -1000;

    /**
     * Run all flag tests
     */
    public static function run():Void {
        // Reset If tests
        testResetIfMaxHitsZero();
        testResetIfMaxHitsThreshold();
        testResetIfResetsAllGroups();

        // Pause If tests
        testPauseIfTransient();
        testPauseIfUnpausesWhenFalse();
        testPauseIfPersistent();
        testPauseIfPersistentStaysPaused();
        testResetIfEscapesPersistentPause();
        testMultiplePauseIfFirstWins();
        testPauseIfOnlyAffectsOwnGroup();

        // ResetNextIf tests
        testResetNextIfMaxHitsZero();
        testResetNextIfMaxHitsThreshold();
        testResetNextIfOnlyResetsNext();
        testResetNextIfDoesNotBlock();
        testResetNextIfSkipsPauseIf();

        // Group logic tests
        testFlaggedReqsExemptFromGroupPass();
        testPausedCoreBlocksAchievement();
        testPausedAltDoesNotAffectOtherAlts();

        // Hit count completion behavior tests
        testHitCountStaysSatisfiedWhenConditionFalse();
        testHitCountStaysSatisfiedOnEvalError();

        // AndNext/OrNext tests
        testAndNextBothMustBeTrue();
        testAndNextOneFailsTerminalFails();
        testOrNextEitherCanBeTrue();
        testOrNextBothFalseTerminalFails();
        testAndNextWithResetIf();
        testAndNextWithHitCount();
        testOrNextWithHitCount();
        testAndNextOrNextChain();
        testAndNextWithPauseIf();
        testOrNextWithPauseIf();

        // AddHits/SubHits tests
        testAddHitsAccumulation();
        testAddHitsNotRequired();
        testSubHitsSubtracts();
        testMultipleAddHits();
        testResetIfClearsAddSubHits();
        testAddHitsIrrelevantNoMaxHits();

        // Measured/MeasuredIf tests
        testMeasuredValueMode();
        testMeasuredHitCountMode();
        testMeasuredIfFiltering();
        testMeasuredMultipleSameTarget();
        testMeasuredMultipleDifferentTargets();
        testMeasuredFirstFrameNoChange();
        testMeasuredAffectsGroupPass();
    }

    // ========================================================================
    // Reset If Tests
    // ========================================================================

    /**
     * Reset If with maxHits=0 fires every frame condition is true
     */
    private static function testResetIfMaxHitsZero():Void {
        TestRunner.test("Reset If maxHits=0 - fires when true");
        setupTest();

        // Create achievement: Core with normal req (always true) + Reset If (always true)
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 2});
        var resetReq:Object = createReq({alwaysTrue: true, flag: "RESET_IF", maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [normalReq, resetReq])])]
        };

        // Frame 1: Reset If fires, normal req's potential hit is blocked
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 0, "normal req hits should be 0 (reset fired)");

        // Frame 2: Same thing
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 0, "normal req hits still 0");

        // Achievement should not have triggered
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "achievement should still be ACTIVE");

        TestRunner.endTest();
    }

    /**
     * Reset If with maxHits>0 only fires when hits reach threshold
     */
    private static function testResetIfMaxHitsThreshold():Void {
        TestRunner.test("Reset If maxHits=3 - accumulates then fires");
        setupTest();

        // Create achievement: Core with normal req + Reset If (maxHits=3)
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 5});
        var resetReq:Object = createReq({alwaysTrue: true, flag: "RESET_IF", maxHits: 3});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [normalReq, resetReq])])]
        };

        // Frame 1: Reset If gets hit 1
        Main.testRunFrame();
        TestRunner.assertEqual(resetReq.hits, 1, "Reset If hits should be 1");
        TestRunner.assertEqual(normalReq.hits, 1, "normal req hits should be 1");

        // Frame 2: Reset If gets hit 2
        Main.testRunFrame();
        TestRunner.assertEqual(resetReq.hits, 2, "Reset If hits should be 2");
        TestRunner.assertEqual(normalReq.hits, 2, "normal req hits should be 2");

        // Frame 3: Reset If reaches 3 and fires - all hits reset
        Main.testRunFrame();
        TestRunner.assertEqual(resetReq.hits, 0, "Reset If hits should be 0 (fired)");
        TestRunner.assertEqual(normalReq.hits, 0, "normal req hits should be 0 (reset)");

        TestRunner.endTest();
    }

    /**
     * Reset If resets hits in ALL groups
     */
    private static function testResetIfResetsAllGroups():Void {
        TestRunner.test("Reset If resets all groups");
        setupTest();

        // Create achievement: Core with Reset If, Alt1 with normal req, Alt2 with normal req
        var coreResetReq:Object = createReq({alwaysTrue: true, flag: "RESET_IF", maxHits: 2});
        var alt1Req:Object = createReq({alwaysTrue: true, maxHits: 5});
        var alt2Req:Object = createReq({alwaysTrue: true, maxHits: 5});

        AppData.data = {
            assets: [createAchievement([
                createGroup("CORE", [coreResetReq]),
                createGroup("ALT", [alt1Req]),
                createGroup("ALT", [alt2Req])
            ])]
        };

        // Frame 1: All reqs get hits
        Main.testRunFrame();
        TestRunner.assertEqual(coreResetReq.hits, 1, "Core Reset If hits=1");
        TestRunner.assertEqual(alt1Req.hits, 1, "Alt1 req hits=1");
        TestRunner.assertEqual(alt2Req.hits, 1, "Alt2 req hits=1");

        // Frame 2: Reset If fires (hits=2), all groups reset
        Main.testRunFrame();
        TestRunner.assertEqual(coreResetReq.hits, 0, "Core Reset If hits=0 (fired)");
        TestRunner.assertEqual(alt1Req.hits, 0, "Alt1 req hits=0 (reset)");
        TestRunner.assertEqual(alt2Req.hits, 0, "Alt2 req hits=0 (reset)");

        TestRunner.endTest();
    }

    // ========================================================================
    // Pause If Tests
    // ========================================================================

    /**
     * Pause If with maxHits=0 pauses when condition is true
     */
    private static function testPauseIfTransient():Void {
        TestRunner.test("Pause If maxHits=0 - pauses when true");
        setupTest();

        // Create: Core with Pause If (always true) + normal req
        var pauseReq:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 0});
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 5});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [pauseReq, normalReq])])]
        };

        // Frame 1: Pause If triggers, normal req should NOT accumulate hits
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 0, "normal req hits=0 (group paused)");

        // Frame 2: Still paused
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 0, "normal req hits still 0");

        TestRunner.endTest();
    }

    /**
     * Pause If with maxHits=0 unpauses when condition becomes false
     */
    private static function testPauseIfUnpausesWhenFalse():Void {
        TestRunner.test("Pause If maxHits=0 - unpauses when false");
        setupTest();

        // Create: Core with Pause If (starts true) + normal req
        var pauseReq:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 0});
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 5});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [pauseReq, normalReq])])]
        };

        // Frame 1: Paused
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 0, "normal req hits=0 (paused)");

        // Change Pause If to always false
        pauseReq.compiledB = ["VERSION_1", "VALUE", "0"];

        // Frame 2: Should unpause, normal req gets hit
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 1, "normal req hits=1 (unpaused)");

        TestRunner.endTest();
    }

    /**
     * Pause If with maxHits>0 becomes persistent when threshold reached
     */
    private static function testPauseIfPersistent():Void {
        TestRunner.test("Pause If maxHits=3 - becomes persistent");
        setupTest();

        // Create: Core with Pause If (maxHits=3) + normal req
        var pauseReq:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 3});
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 10});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [pauseReq, normalReq])])]
        };

        // Frames 1-2: Pause If accumulates hits, group not paused yet
        Main.testRunFrame();
        TestRunner.assertEqual(pauseReq.hits, 1, "Pause If hits=1");
        TestRunner.assertEqual(normalReq.hits, 1, "normal req hits=1");

        Main.testRunFrame();
        TestRunner.assertEqual(pauseReq.hits, 2, "Pause If hits=2");
        TestRunner.assertEqual(normalReq.hits, 2, "normal req hits=2");

        // Frame 3: Pause If reaches threshold, group becomes paused
        Main.testRunFrame();
        TestRunner.assertEqual(pauseReq.hits, 3, "Pause If hits=3");
        TestRunner.assertEqual(normalReq.hits, 2, "normal req hits still 2 (paused)");

        TestRunner.endTest();
    }

    /**
     * Persistent Pause If stays paused even if condition becomes false
     */
    private static function testPauseIfPersistentStaysPaused():Void {
        TestRunner.test("Persistent Pause If stays paused when false");
        setupTest();

        // Create: Core with Pause If (already at maxHits) + normal req
        var pauseReq:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 2});
        pauseReq.hits = 2;  // Pre-set to already at max
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 10});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [pauseReq, normalReq])])]
        };

        // Frame 1: Already at max, should be paused
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 0, "normal req hits=0 (paused)");

        // Change condition to false
        pauseReq.compiledB = ["VERSION_1", "VALUE", "0"];

        // Frame 2: Still paused because hits >= maxHits
        Main.testRunFrame();
        TestRunner.assertEqual(pauseReq.hits, 2, "Pause If hits still 2");
        TestRunner.assertEqual(normalReq.hits, 0, "normal req hits still 0 (persistent pause)");

        TestRunner.endTest();
    }

    /**
     * Reset If in another group can escape persistent Pause If
     * For the group to actually unpause, the Pause If condition must become false
     * after the reset (otherwise it re-pauses immediately).
     */
    private static function testResetIfEscapesPersistentPause():Void {
        TestRunner.test("Reset If escapes persistent Pause If");
        setupTest();

        // Create: Core (normal req), Alt1 (persistent Pause If), Alt2 (Reset If)
        var coreReq:Object = createReq({alwaysTrue: true, maxHits: 10});
        var alt1PauseReq:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 1});
        alt1PauseReq.hits = 1;  // Already persistent
        var alt1NormalReq:Object = createReq({alwaysTrue: true, maxHits: 10});
        var alt2ResetReq:Object = createReq({alwaysTrue: true, flag: "RESET_IF", maxHits: 2});

        AppData.data = {
            assets: [createAchievement([
                createGroup("CORE", [coreReq]),
                createGroup("ALT", [alt1PauseReq, alt1NormalReq]),
                createGroup("ALT", [alt2ResetReq])
            ])]
        };

        // Frame 1: Alt1 paused, Alt2 Reset If gets hit 1
        Main.testRunFrame();
        TestRunner.assertEqual(alt1NormalReq.hits, 0, "Alt1 normal req paused");
        TestRunner.assertEqual(alt2ResetReq.hits, 1, "Alt2 Reset If hits=1");
        TestRunner.assertEqual(coreReq.hits, 1, "Core req hits=1");

        // Frame 2: Reset If fires, resets all including Pause If hits
        Main.testRunFrame();
        TestRunner.assertEqual(alt1PauseReq.hits, 0, "Pause If hits reset to 0");
        TestRunner.assertEqual(alt2ResetReq.hits, 0, "Reset If hits reset to 0");
        TestRunner.assertEqual(coreReq.hits, 0, "Core req hits reset to 0");

        // Now change Pause If condition to false - simulating player leaving the pause zone
        alt1PauseReq.compiledB = ["VERSION_1", "VALUE", "0"];

        // Frame 3: Pause If condition is now false, so group should unpause
        Main.testRunFrame();
        TestRunner.assertEqual(alt1NormalReq.hits, 1, "Alt1 normal req now gets hits");
        TestRunner.assertEqual(alt1PauseReq.hits, 0, "Pause If not accumulating (condition false)");

        TestRunner.endTest();
    }

    /**
     * Multiple Pause If in same group - first one wins
     */
    private static function testMultiplePauseIfFirstWins():Void {
        TestRunner.test("Multiple Pause If - first one pauses");
        setupTest();

        // Create: Core with two Pause Ifs (both true) + normal req
        var pauseReq1:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 0});
        var pauseReq2:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 2});
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 10});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [pauseReq1, pauseReq2, normalReq])])]
        };

        // Frame 1: First Pause If pauses, second one should not accumulate hits
        Main.testRunFrame();
        TestRunner.assertEqual(pauseReq2.hits, 0, "second Pause If should not get hits (group already paused)");
        TestRunner.assertEqual(normalReq.hits, 0, "normal req paused");

        TestRunner.endTest();
    }

    /**
     * Pause If only affects its own group
     */
    private static function testPauseIfOnlyAffectsOwnGroup():Void {
        TestRunner.test("Pause If only pauses its group");
        setupTest();

        // Create: Core (normal req), Alt (Pause If + normal req)
        var coreReq:Object = createReq({alwaysTrue: true, maxHits: 10});
        var altPauseReq:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 0});
        var altNormalReq:Object = createReq({alwaysTrue: true, maxHits: 10});

        AppData.data = {
            assets: [createAchievement([
                createGroup("CORE", [coreReq]),
                createGroup("ALT", [altPauseReq, altNormalReq])
            ])]
        };

        // Frame 1: Alt paused, Core should still work
        Main.testRunFrame();
        TestRunner.assertEqual(coreReq.hits, 1, "Core req gets hits");
        TestRunner.assertEqual(altNormalReq.hits, 0, "Alt normal req paused");

        // Frame 2: Same
        Main.testRunFrame();
        TestRunner.assertEqual(coreReq.hits, 2, "Core req hits=2");
        TestRunner.assertEqual(altNormalReq.hits, 0, "Alt normal req still paused");

        TestRunner.endTest();
    }

    // ========================================================================
    // ResetNextIf Tests
    // ========================================================================

    /**
     * ResetNextIf with maxHits=0 fires every frame and resets next requirement's hits
     */
    private static function testResetNextIfMaxHitsZero():Void {
        TestRunner.test("ResetNextIf maxHits=0 - resets next req");
        setupTest();

        // Create: ResetNextIf (always true) + normal req (always true)
        var resetNextReq:Object = createReq({alwaysTrue: true, flag: "RESET_NEXT_IF", maxHits: 0});
        var targetReq:Object = createReq({alwaysTrue: true, maxHits: 5});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [resetNextReq, targetReq])])]
        };

        // Frame 1: ResetNextIf fires, target req's hit is reset
        Main.testRunFrame();
        TestRunner.assertEqual(targetReq.hits, 0, "target req hits=0 (reset by ResetNextIf)");

        // Frame 2: Same thing - ResetNextIf keeps resetting
        Main.testRunFrame();
        TestRunner.assertEqual(targetReq.hits, 0, "target req hits still 0");

        TestRunner.endTest();
    }

    /**
     * ResetNextIf with maxHits>0 only fires when threshold reached
     */
    private static function testResetNextIfMaxHitsThreshold():Void {
        TestRunner.test("ResetNextIf maxHits=3 - accumulates then fires");
        setupTest();

        // Create: ResetNextIf (maxHits=3) + normal req
        var resetNextReq:Object = createReq({alwaysTrue: true, flag: "RESET_NEXT_IF", maxHits: 3});
        var targetReq:Object = createReq({alwaysTrue: true, maxHits: 10});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [resetNextReq, targetReq])])]
        };

        // Frame 1: ResetNextIf hits=1, target gets hit
        Main.testRunFrame();
        TestRunner.assertEqual(resetNextReq.hits, 1, "ResetNextIf hits=1");
        TestRunner.assertEqual(targetReq.hits, 1, "target req hits=1");

        // Frame 2: ResetNextIf hits=2, target gets another hit
        Main.testRunFrame();
        TestRunner.assertEqual(resetNextReq.hits, 2, "ResetNextIf hits=2");
        TestRunner.assertEqual(targetReq.hits, 2, "target req hits=2");

        // Frame 3: ResetNextIf hits=3 and fires, resets target
        Main.testRunFrame();
        TestRunner.assertEqual(resetNextReq.hits, 3, "ResetNextIf hits=3");
        TestRunner.assertEqual(targetReq.hits, 0, "target req hits=0 (reset)");

        TestRunner.endTest();
    }

    /**
     * ResetNextIf only resets the immediately following requirement, not others
     */
    private static function testResetNextIfOnlyResetsNext():Void {
        TestRunner.test("ResetNextIf only resets next req");
        setupTest();

        // Create: ResetNextIf + target (gets reset) + third req (not reset)
        var resetNextReq:Object = createReq({alwaysTrue: true, flag: "RESET_NEXT_IF", maxHits: 0});
        var targetReq:Object = createReq({alwaysTrue: true, maxHits: 10});
        var thirdReq:Object = createReq({alwaysTrue: true, maxHits: 10});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [resetNextReq, targetReq, thirdReq])])]
        };

        // Frame 1: ResetNextIf fires, only target is reset
        Main.testRunFrame();
        TestRunner.assertEqual(targetReq.hits, 0, "target req hits=0 (reset)");
        TestRunner.assertEqual(thirdReq.hits, 1, "third req hits=1 (not affected)");

        // Frame 2: Same pattern
        Main.testRunFrame();
        TestRunner.assertEqual(targetReq.hits, 0, "target req still 0");
        TestRunner.assertEqual(thirdReq.hits, 2, "third req hits=2");

        TestRunner.endTest();
    }

    /**
     * ResetNextIf does NOT block achievement from triggering
     */
    private static function testResetNextIfDoesNotBlock():Void {
        TestRunner.test("ResetNextIf does not block achievement");
        setupTest();

        // Create: ResetNextIf (always firing) + passing normal req
        var resetNextReq:Object = createReq({alwaysTrue: true, flag: "RESET_NEXT_IF", maxHits: 0});
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 0});  // Passes immediately

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [resetNextReq, normalReq])])]
        };

        // Frame 1: ResetNextIf fires but doesn't block, achievement triggers
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED", "achievement should trigger");

        TestRunner.endTest();
    }

    /**
     * ResetNextIf skips over Pause If requirements when finding the next target
     */
    private static function testResetNextIfSkipsPauseIf():Void {
        TestRunner.test("ResetNextIf targets Pause If directly");
        setupTest();

        // Create: ResetNextIf + Pause If (targeted) + normal req (unaffected)
        // Per RA docs, ResetNextIf targets the immediately next condition.
        // Only combining modifiers (AddSource, SubSource, AddAddress) are skipped.
        // PauseIf is a regular flag, so it IS the target — not skipped over.
        var resetNextReq:Object = createReq({alwaysTrue: true, flag: "RESET_NEXT_IF", maxHits: 0});
        var pauseReq:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 5});
        var targetReq:Object = createReq({alwaysTrue: true, maxHits: 10});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [resetNextReq, pauseReq, targetReq])])]
        };

        // Frame 1: ResetNextIf fires and resets PauseIf's hits, not targetReq's
        Main.testRunFrame();
        TestRunner.assertEqual(pauseReq.hits, 0, "pause req hits=0 (reset by ResetNextIf)");
        TestRunner.assertEqual(targetReq.hits, 1, "target req hits=1 (unaffected, not the ResetNextIf target)");

        TestRunner.endTest();
    }

    // ========================================================================
    // Group Logic Tests
    // ========================================================================

    /**
     * Flagged requirements (Reset If, Pause If) don't count toward group pass
     */
    private static function testFlaggedReqsExemptFromGroupPass():Void {
        TestRunner.test("Flagged reqs exempt from group pass");
        setupTest();

        // Create: Core with Reset If (satisfied) + normal req (NOT satisfied)
        // The Reset If being satisfied should NOT make the group pass
        var resetReq:Object = createReq({alwaysTrue: true, flag: "RESET_IF", maxHits: 1});
        var normalReq:Object = createReq({alwaysTrue: false, maxHits: 0});  // Never passes

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [resetReq, normalReq])])]
        };

        // Run enough frames for Reset If to be "satisfied"
        Main.testRunFrame();  // Reset If hits=1 (satisfied)

        // Achievement should NOT trigger because normal req never passes
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "achievement should not trigger");

        TestRunner.endTest();
    }

    /**
     * Paused Core blocks achievement
     */
    private static function testPausedCoreBlocksAchievement():Void {
        TestRunner.test("Paused Core blocks achievement");
        setupTest();

        // Create: Core (paused) + Alt (passes)
        var corePauseReq:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 0});
        var altReq:Object = createReq({alwaysTrue: true, maxHits: 0});  // Passes immediately

        AppData.data = {
            assets: [createAchievement([
                createGroup("CORE", [corePauseReq]),
                createGroup("ALT", [altReq])
            ])]
        };

        // Frame 1: Core paused, even though Alt passes
        Main.testRunFrame();

        // Achievement should NOT trigger (Core must pass)
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "achievement blocked by paused Core");

        TestRunner.endTest();
    }

    /**
     * Paused Alt doesn't affect other Alts
     */
    private static function testPausedAltDoesNotAffectOtherAlts():Void {
        TestRunner.test("Paused Alt, passing Alt - achievement triggers");
        setupTest();

        // Create: Core (passes), Alt1 (paused), Alt2 (passes)
        var coreReq:Object = createReq({alwaysTrue: true, maxHits: 0});
        var alt1PauseReq:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 0});
        var alt2Req:Object = createReq({alwaysTrue: true, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([
                createGroup("CORE", [coreReq]),
                createGroup("ALT", [alt1PauseReq]),
                createGroup("ALT", [alt2Req])
            ])]
        };

        // Frame 1: Core passes, Alt1 paused (doesn't pass), Alt2 passes
        Main.testRunFrame();

        // Achievement SHOULD trigger (Core + Alt2 pass)
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED", "achievement should trigger via Alt2");

        TestRunner.endTest();
    }

    // ========================================================================
    // Hit Count Completion Behavior Tests
    // ========================================================================

    /**
     * A requirement with completed hits stays satisfied even if condition becomes false.
     * Per RA docs: "if a condition has a non-zero hit count, and reaches the number
     * required, this condition is no longer tested. It remains true"
     */
    private static function testHitCountStaysSatisfiedWhenConditionFalse():Void {
        TestRunner.test("Hit count reached - stays satisfied when condition false");
        setupTest();

        // Create: Core with hitReq (needs 3 hits) + gateReq (initially false, prevents early trigger)
        var hitReq:Object = createReq({alwaysTrue: true, maxHits: 3});
        var gateReq:Object = createReq({alwaysTrue: false, maxHits: 0});  // Initially false, blocks achievement

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [hitReq, gateReq])])]
        };

        // Frames 1-3: Build up hits to reach target (achievement blocked by gateReq)
        Main.testRunFrame();
        TestRunner.assertEqual(hitReq.hits, 1, "hits=1 after frame 1");
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "still active (gateReq blocking)");

        Main.testRunFrame();
        TestRunner.assertEqual(hitReq.hits, 2, "hits=2 after frame 2");

        Main.testRunFrame();
        TestRunner.assertEqual(hitReq.hits, 3, "hits=3 after frame 3 (reached target)");
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "still active (gateReq still blocking)");

        // Now change hitReq condition to FALSE - the requirement should remain "locked true"
        hitReq.compiledB = ["VERSION_1", "VALUE", "0"];

        // Also open the gate
        gateReq.compiledB = ["VERSION_1", "VALUE", "1"];

        // Frame 4: hitReq condition is false, but it's "locked true" because hits >= maxHits
        // gateReq now passes, so achievement should trigger
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED",
            "achievement should trigger - hitReq locked true despite condition false");

        TestRunner.endTest();
    }

    /**
     * A requirement with completed hits stays satisfied even if evaluation fails.
     * This tests the edge case where the formula evaluation returns an error after
     * hits have already reached the target.
     */
    private static function testHitCountStaysSatisfiedOnEvalError():Void {
        TestRunner.test("Hit count reached - stays satisfied on eval error");
        setupTest();

        // Create: Core with hitReq (needs 2 hits) + gateReq (initially false, prevents early trigger)
        var hitReq:Object = createReq({alwaysTrue: true, maxHits: 2});
        var gateReq:Object = createReq({alwaysTrue: false, maxHits: 0});  // Initially false, blocks achievement

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [hitReq, gateReq])])]
        };

        // Frames 1-2: Build up hits to reach target (achievement blocked by gateReq)
        Main.testRunFrame();
        TestRunner.assertEqual(hitReq.hits, 1, "hits=1 after frame 1");
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "still active (gateReq blocking)");

        Main.testRunFrame();
        TestRunner.assertEqual(hitReq.hits, 2, "hits=2 after frame 2 (reached target)");
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "still active (gateReq still blocking)");

        // Now break the formula - set compiledA to null to simulate evaluation error
        hitReq.compiledA = null;

        // Also open the gate
        gateReq.compiledB = ["VERSION_1", "VALUE", "1"];

        // Frame 3: hitReq formula would fail, but it's "locked true" because hits >= maxHits
        // gateReq now passes, so achievement should trigger
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED",
            "achievement should trigger - hitReq locked true despite broken formula");

        TestRunner.endTest();
    }

    // ========================================================================
    // AndNext/OrNext Tests
    // ========================================================================

    /**
     * AndNext: Both conditions must be true for terminal to pass
     */
    private static function testAndNextBothMustBeTrue():Void {
        TestRunner.test("AndNext - both conditions must be true");
        setupTest();

        // Create: AndNext(true) + terminal(true) = both true
        var andNextReq:Object = createReq({alwaysTrue: true, flag: "AND_NEXT"});
        var terminalReq:Object = createReq({alwaysTrue: true, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [andNextReq, terminalReq])])]
        };

        // Frame 1: Both true -> terminal passes -> achievement triggers
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED",
            "achievement should trigger when AndNext and terminal both true");

        TestRunner.endTest();
    }

    /**
     * AndNext: If first condition fails, terminal fails even if terminal condition is true
     */
    private static function testAndNextOneFailsTerminalFails():Void {
        TestRunner.test("AndNext - first fails, terminal fails");
        setupTest();

        // Create: AndNext(false) + terminal(true)
        var andNextReq:Object = createReq({alwaysTrue: false, flag: "AND_NEXT"});
        var terminalReq:Object = createReq({alwaysTrue: true, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [andNextReq, terminalReq])])]
        };

        // Frame 1: AndNext false -> terminal fails even though its condition is true
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE",
            "achievement should not trigger when AndNext is false");

        TestRunner.endTest();
    }

    /**
     * OrNext: Either condition can be true for terminal to pass
     */
    private static function testOrNextEitherCanBeTrue():Void {
        TestRunner.test("OrNext - either can be true");
        setupTest();

        // Create: OrNext(true) + terminal(false) = first true, terminal passes
        var orNextReq:Object = createReq({alwaysTrue: true, flag: "OR_NEXT"});
        var terminalReq:Object = createReq({alwaysTrue: false, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [orNextReq, terminalReq])])]
        };

        // Frame 1: OrNext true -> terminal passes (even though its own condition is false)
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED",
            "achievement should trigger when OrNext is true");

        TestRunner.endTest();
    }

    /**
     * OrNext: Both conditions false means terminal fails
     */
    private static function testOrNextBothFalseTerminalFails():Void {
        TestRunner.test("OrNext - both false, terminal fails");
        setupTest();

        // Create: OrNext(false) + terminal(false) = both false
        var orNextReq:Object = createReq({alwaysTrue: false, flag: "OR_NEXT"});
        var terminalReq:Object = createReq({alwaysTrue: false, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [orNextReq, terminalReq])])]
        };

        // Frame 1: Both false -> terminal fails
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE",
            "achievement should not trigger when both OrNext and terminal are false");

        TestRunner.endTest();
    }

    /**
     * AndNext with ResetIf: Reset only fires when both conditions are true
     */
    private static function testAndNextWithResetIf():Void {
        TestRunner.test("AndNext with ResetIf");
        setupTest();

        // Create: normal req (with hits) + AndNext(false initially) + ResetIf(true)
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 5});
        var andNextReq:Object = createReq({alwaysTrue: false, flag: "AND_NEXT"});
        var resetReq:Object = createReq({alwaysTrue: true, flag: "RESET_IF", maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [normalReq, andNextReq, resetReq])])]
        };

        // Frame 1: AndNext is false, so ResetIf doesn't fire -> normal req gets hit
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 1, "normal req should have 1 hit (ResetIf blocked by AndNext)");

        // Frame 2: Same
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 2, "normal req should have 2 hits");

        // Now make AndNext true
        andNextReq.compiledB = ["VERSION_1", "VALUE", "1"];

        // Frame 3: AndNext true + ResetIf true -> ResetIf fires -> hits reset
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 0, "normal req should have 0 hits (ResetIf fired)");

        TestRunner.endTest();
    }

    /**
     * AndNext affects hit count tracking: hits only increment when chain is true
     */
    private static function testAndNextWithHitCount():Void {
        TestRunner.test("AndNext affects hit count tracking");
        setupTest();

        // Create: AndNext(false initially) + terminal with maxHits=3
        var andNextReq:Object = createReq({alwaysTrue: false, flag: "AND_NEXT"});
        var terminalReq:Object = createReq({alwaysTrue: true, maxHits: 3});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [andNextReq, terminalReq])])]
        };

        // Frame 1: AndNext false -> terminal doesn't get hits
        Main.testRunFrame();
        TestRunner.assertEqual(terminalReq.hits, 0, "terminal should have 0 hits (AndNext false)");

        // Make AndNext true
        andNextReq.compiledB = ["VERSION_1", "VALUE", "1"];

        // Frame 2: AndNext true -> terminal gets hit
        Main.testRunFrame();
        TestRunner.assertEqual(terminalReq.hits, 1, "terminal should have 1 hit (AndNext true)");

        // Frame 3: AndNext true -> terminal gets hit 2
        Main.testRunFrame();
        TestRunner.assertEqual(terminalReq.hits, 2, "terminal should have 2 hits");

        // Frame 4: AndNext true -> terminal gets hit 3 -> triggers (hits reset to 0 on trigger)
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED", "achievement should trigger");
        // Note: hits are reset to 0 when achievement triggers, so we don't check hits after trigger

        TestRunner.endTest();
    }

    /**
     * OrNext with hit count: hits increment when either condition is true
     */
    private static function testOrNextWithHitCount():Void {
        TestRunner.test("OrNext with hit count");
        setupTest();

        // Create: OrNext(true) + terminal(false) with maxHits=2
        var orNextReq:Object = createReq({alwaysTrue: true, flag: "OR_NEXT"});
        var terminalReq:Object = createReq({alwaysTrue: false, maxHits: 2});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [orNextReq, terminalReq])])]
        };

        // Frame 1: OrNext true -> chain passes -> terminal gets hit
        Main.testRunFrame();
        TestRunner.assertEqual(terminalReq.hits, 1, "terminal should have 1 hit");

        // Frame 2: OrNext still true -> chain passes -> terminal gets hit 2 -> triggers (hits reset on trigger)
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED", "achievement should trigger");
        // Note: hits are reset to 0 when achievement triggers

        TestRunner.endTest();
    }

    /**
     * Multi-level chain: ((A AND B) OR C) precedence test
     */
    private static function testAndNextOrNextChain():Void {
        TestRunner.test("AndNext + OrNext chain precedence");
        setupTest();

        // Create: AndNext(true) + OrNext(false) + terminal(false)
        // Chain: (true AND false) OR false = false OR false = false
        var andNextReq:Object = createReq({alwaysTrue: true, flag: "AND_NEXT"});
        var orNextReq:Object = createReq({alwaysTrue: false, flag: "OR_NEXT"});
        var terminalReq:Object = createReq({alwaysTrue: false, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [andNextReq, orNextReq, terminalReq])])]
        };

        // Frame 1: (true AND false) OR false = false
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE",
            "achievement should not trigger: (true AND false) OR false = false");

        // Now change OrNext to true: (true AND true) OR false = true OR false = true
        orNextReq.compiledB = ["VERSION_1", "VALUE", "1"];

        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED",
            "achievement should trigger: (true AND true) OR false = true");

        TestRunner.endTest();
    }

    /**
     * AndNext with PauseIf: Only pauses when both conditions are true
     */
    private static function testAndNextWithPauseIf():Void {
        TestRunner.test("AndNext with PauseIf");
        setupTest();

        // Create: AndNext(false initially) + PauseIf(true) + normal req
        var andNextReq:Object = createReq({alwaysTrue: false, flag: "AND_NEXT"});
        var pauseReq:Object = createReq({alwaysTrue: true, flag: "PAUSE_IF", maxHits: 0});
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 5});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [andNextReq, pauseReq, normalReq])])]
        };

        // Frame 1: AndNext false -> PauseIf blocked -> normal req gets hit
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 1, "normal req should have 1 hit (PauseIf blocked by AndNext)");

        // Frame 2: Same
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 2, "normal req should have 2 hits");

        // Now make AndNext true
        andNextReq.compiledB = ["VERSION_1", "VALUE", "1"];

        // Frame 3: AndNext true + PauseIf true -> group paused -> no more hits
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 2, "normal req should still have 2 hits (paused)");

        TestRunner.endTest();
    }

    /**
     * OrNext with PauseIf: Pauses when either condition is true
     */
    private static function testOrNextWithPauseIf():Void {
        TestRunner.test("OrNext with PauseIf");
        setupTest();

        // Create: OrNext(false initially) + PauseIf(false) + normal req
        var orNextReq:Object = createReq({alwaysTrue: false, flag: "OR_NEXT"});
        var pauseReq:Object = createReq({alwaysTrue: false, flag: "PAUSE_IF", maxHits: 0});
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 5});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [orNextReq, pauseReq, normalReq])])]
        };

        // Frame 1: Both false -> not paused -> normal req gets hit
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 1, "normal req should have 1 hit (not paused)");

        // Make OrNext true (PauseIf condition still false)
        orNextReq.compiledB = ["VERSION_1", "VALUE", "1"];

        // Frame 2: OrNext true -> pause triggers -> no more hits
        Main.testRunFrame();
        TestRunner.assertEqual(normalReq.hits, 1, "normal req should still have 1 hit (paused via OrNext)");

        TestRunner.endTest();
    }

    // ========================================================================
    // AddHits/SubHits Tests
    // ========================================================================

    /**
     * AddHits accumulates and contributes to terminal's effective hits
     */
    private static function testAddHitsAccumulation():Void {
        TestRunner.test("AddHits - accumulates and contributes to terminal");
        setupTest();

        // AddHits(always true) + terminal(always true, needs 5 effective hits)
        var addHitsReq:Object = createReq({alwaysTrue: true, flag: "ADD_HITS", maxHits: 0});
        var terminalReq:Object = createReq({alwaysTrue: true, maxHits: 5});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [addHitsReq, terminalReq])])]
        };

        // Frame 1: addHits=1, terminal=1, effective=2
        Main.testRunFrame();
        TestRunner.assertEqual(addHitsReq.hits, 1, "addHits should have 1 hit");
        TestRunner.assertEqual(terminalReq.hits, 1, "terminal should have 1 hit");
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "not triggered yet (effective=2)");

        // Frame 2: addHits=2, terminal=2, effective=4
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "not triggered yet (effective=4)");

        // Frame 3: addHits=3, terminal=3, effective=6 >= 5 -> triggers
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED", "should trigger (effective=6 >= 5)");

        TestRunner.endTest();
    }

    /**
     * AddHits doesn't need to pass for achievement to trigger (terminal can do it alone)
     */
    private static function testAddHitsNotRequired():Void {
        TestRunner.test("AddHits - doesn't need to pass for achievement");
        setupTest();

        // AddHits(always false) + terminal(always true, needs 2 hits)
        var addHitsReq:Object = createReq({alwaysTrue: false, flag: "ADD_HITS", maxHits: 0});
        var terminalReq:Object = createReq({alwaysTrue: true, maxHits: 2});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [addHitsReq, terminalReq])])]
        };

        // Frame 1: addHits=0, terminal=1, effective=1
        Main.testRunFrame();
        TestRunner.assertEqual(addHitsReq.hits, 0, "addHits has 0 hits (condition false)");
        TestRunner.assertEqual(terminalReq.hits, 1, "terminal has 1 hit");
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "not triggered yet");

        // Frame 2: addHits=0, terminal=2, effective=2 >= 2 -> triggers
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED", "should trigger via terminal alone");

        TestRunner.endTest();
    }

    /**
     * SubHits subtracts from effective total
     */
    private static function testSubHitsSubtracts():Void {
        TestRunner.test("SubHits - subtracts from effective hits");
        setupTest();

        // AddHits(true) + SubHits(true) + terminal(true, needs 5)
        // Each frame: +1 addHits, -1 subHits, +1 terminal = net +1 effective
        var addHitsReq:Object = createReq({alwaysTrue: true, flag: "ADD_HITS", maxHits: 0});
        var subHitsReq:Object = createReq({alwaysTrue: true, flag: "SUB_HITS", maxHits: 0});
        var terminalReq:Object = createReq({alwaysTrue: true, maxHits: 5});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [addHitsReq, subHitsReq, terminalReq])])]
        };

        // Frame 1: effective = 1 (terminal) + 1 (addHits) - 1 (subHits) = 1
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "frame 1: effective=1");

        // Frames 2-4
        Main.testRunFrame();
        Main.testRunFrame();
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "frame 4: effective=4");

        // Frame 5: effective = 5 + 5 - 5 = 5 >= 5 -> triggers
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED", "frame 5: should trigger");

        TestRunner.endTest();
    }

    /**
     * Multiple AddHits all contribute to terminal
     */
    private static function testMultipleAddHits():Void {
        TestRunner.test("Multiple AddHits - all contribute to terminal");
        setupTest();

        // AddHits1 + AddHits2 + terminal(needs 5)
        // Each frame: +1 +1 +1 = 3 effective hits
        var addHits1:Object = createReq({alwaysTrue: true, flag: "ADD_HITS", maxHits: 0});
        var addHits2:Object = createReq({alwaysTrue: true, flag: "ADD_HITS", maxHits: 0});
        var terminalReq:Object = createReq({alwaysTrue: true, maxHits: 5});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [addHits1, addHits2, terminalReq])])]
        };

        // Frame 1: effective = 1 + 1 + 1 = 3
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "frame 1: effective=3");

        // Frame 2: effective = 2 + 2 + 2 = 6 >= 5 -> triggers
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED", "frame 2: should trigger");

        TestRunner.endTest();
    }

    /**
     * Reset If clears AddHits/SubHits hits
     */
    private static function testResetIfClearsAddSubHits():Void {
        TestRunner.test("Reset If clears AddHits/SubHits hits");
        setupTest();

        // AddHits + SubHits + terminal + ResetIf(maxHits=3)
        var addHitsReq:Object = createReq({alwaysTrue: true, flag: "ADD_HITS", maxHits: 0});
        var subHitsReq:Object = createReq({alwaysTrue: true, flag: "SUB_HITS", maxHits: 0});
        var terminalReq:Object = createReq({alwaysTrue: true, maxHits: 10});
        var resetReq:Object = createReq({alwaysTrue: true, flag: "RESET_IF", maxHits: 3});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [addHitsReq, subHitsReq, terminalReq, resetReq])])]
        };

        // Frames 1-2: accumulate hits
        Main.testRunFrame();
        Main.testRunFrame();
        TestRunner.assertEqual(addHitsReq.hits, 2, "addHits has 2 hits");
        TestRunner.assertEqual(subHitsReq.hits, 2, "subHits has 2 hits");

        // Frame 3: Reset If fires, all hits cleared
        Main.testRunFrame();
        TestRunner.assertEqual(addHitsReq.hits, 0, "addHits reset to 0");
        TestRunner.assertEqual(subHitsReq.hits, 0, "subHits reset to 0");
        TestRunner.assertEqual(terminalReq.hits, 0, "terminal reset to 0");

        TestRunner.endTest();
    }

    /**
     * AddHits irrelevant when terminal has maxHits=0
     */
    private static function testAddHitsIrrelevantNoMaxHits():Void {
        TestRunner.test("AddHits - irrelevant when terminal maxHits=0");
        setupTest();

        // AddHits(false) + terminal(true, maxHits=0)
        var addHitsReq:Object = createReq({alwaysTrue: false, flag: "ADD_HITS", maxHits: 0});
        var terminalReq:Object = createReq({alwaysTrue: true, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [addHitsReq, terminalReq])])]
        };

        // Frame 1: Terminal has maxHits=0, so it triggers immediately regardless of AddHits
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "TRIGGERED", "should trigger immediately");

        TestRunner.endTest();
    }

    // ========================================================================
    // Measured / MeasuredIf Tests
    // ========================================================================

    /**
     * Measured Value Mode - tracks current vs target from formula evaluation
     */
    private static function testMeasuredValueMode():Void {
        TestRunner.test("Measured - Value Mode tracks current/target");
        setupTest();

        // Measured req: current=5, target=10 (uses special value req)
        var measuredReq:Object = createMeasuredValueReq(5, 10, "MEASURED");
        // Normal req to prevent immediate trigger
        var normalReq:Object = createReq({alwaysTrue: false, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [measuredReq, normalReq])])]
        };

        // Frame 1: Measured value should be set (first frame = initialization)
        Main.testRunFrame();
        var achievement:Object = AppData.data.assets[0];
        TestRunner.assertEqual(achievement._measuredValue, 5, "measured value should be 5");
        TestRunner.assertEqual(achievement._measuredTarget, 10, "measured target should be 10");

        TestRunner.endTest();
    }

    /**
     * Measured Hit Count Mode - tracks hits vs maxHits
     */
    private static function testMeasuredHitCountMode():Void {
        TestRunner.test("Measured - Hit Count Mode tracks hits/maxHits");
        setupTest();

        // Measured req with hits tracking (alwaysTrue, maxHits=5)
        var measuredReq:Object = createReq({alwaysTrue: true, flag: "MEASURED", maxHits: 5});
        // Another req to prevent immediate trigger
        var blockerReq:Object = createReq({alwaysTrue: false, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [measuredReq, blockerReq])])]
        };

        // Frame 1: hits=1
        Main.testRunFrame();
        var achievement:Object = AppData.data.assets[0];
        TestRunner.assertEqual(achievement._measuredValue, 1, "measured value should be 1");
        TestRunner.assertEqual(achievement._measuredTarget, 5, "measured target should be 5");

        // Frame 2: hits=2
        Main.testRunFrame();
        TestRunner.assertEqual(achievement._measuredValue, 2, "measured value should be 2");

        TestRunner.endTest();
    }

    /**
     * MeasuredIf - only contributes when condition is true
     */
    private static function testMeasuredIfFiltering():Void {
        TestRunner.test("MeasuredIf - false zeros entire group measurement");
        setupTest();

        // MeasuredIf that is FALSE - gates the entire group's measured value
        // Per RA docs: "A MeasuredIf condition must be true for the Measured value
        // to be non-zero" — when any MeasuredIf in a group is false, the group's
        // measured value is automatically 0.
        var measuredIfFalse:Object = createMeasuredValueReq(99, 100, "MEASURED_IF");
        measuredIfFalse.compiledB = ["VERSION_1", "VALUE", "0"];  // Make condition false (99 != 0)

        // Normal Measured that would be 5/10, but gated by MeasuredIf
        var measuredTrue:Object = createMeasuredValueReq(5, 10, "MEASURED");

        // Blocker req
        var blockerReq:Object = createReq({alwaysTrue: false, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [measuredIfFalse, measuredTrue, blockerReq])])]
        };

        // Frame 1: MeasuredIf is false, so entire group's measured value is 0
        Main.testRunFrame();
        var achievement:Object = AppData.data.assets[0];
        TestRunner.assertEqual(achievement._measuredValue, 0, "measured value should be 0 (MeasuredIf is false)");

        TestRunner.endTest();
    }

    /**
     * Multiple Measured with same target - takes MAX of currents
     */
    private static function testMeasuredMultipleSameTarget():Void {
        TestRunner.test("Measured - Multiple same target takes MAX");
        setupTest();

        // Two Measured reqs, same target (10), different currents (3 and 7)
        var measured1:Object = createMeasuredValueReq(3, 10, "MEASURED");
        var measured2:Object = createMeasuredValueReq(7, 10, "MEASURED");

        // Blocker req
        var blockerReq:Object = createReq({alwaysTrue: false, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [measured1, measured2, blockerReq])])]
        };

        // Frame 1: Should take MAX(3, 7) = 7
        Main.testRunFrame();
        var achievement:Object = AppData.data.assets[0];
        TestRunner.assertEqual(achievement._measuredValue, 7, "measured value should be MAX (7)");
        TestRunner.assertEqual(achievement._measuredTarget, 10, "measured target should be 10");

        TestRunner.endTest();
    }

    /**
     * Multiple Measured with different targets - shows ERROR
     */
    private static function testMeasuredMultipleDifferentTargets():Void {
        TestRunner.test("Measured - Different targets sets error");
        setupTest();

        // Two Measured reqs with DIFFERENT targets (10 and 20)
        var measured1:Object = createMeasuredValueReq(3, 10, "MEASURED");
        var measured2:Object = createMeasuredValueReq(5, 20, "MEASURED");

        // Blocker req
        var blockerReq:Object = createReq({alwaysTrue: false, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [measured1, measured2, blockerReq])])]
        };

        // Frame 1: Different targets = error
        Main.testRunFrame();
        var achievement:Object = AppData.data.assets[0];
        TestRunner.assertEqual(achievement._measuredError, true, "should have measured error");

        TestRunner.endTest();
    }

    /**
     * First frame initialization doesn't count as "change"
     */
    private static function testMeasuredFirstFrameNoChange():Void {
        TestRunner.test("Measured - First frame is initialization not change");
        setupTest();

        var measuredReq:Object = createMeasuredValueReq(5, 10, "MEASURED");
        var blockerReq:Object = createReq({alwaysTrue: false, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [measuredReq, blockerReq])])]
        };

        var achievement:Object = AppData.data.assets[0];

        // Before first frame - no measured value
        TestRunner.assertEqual(achievement._measuredValue, undefined, "no measured value before first frame");

        // Frame 1: Sets value (initialization)
        Main.testRunFrame();
        TestRunner.assertEqual(achievement._measuredValue, 5, "measured value set after first frame");
        // Note: We can't easily test that UI wasn't shown, but the logic is correct

        TestRunner.endTest();
    }

    /**
     * Measured requirements count toward group pass (unlike other flags)
     */
    private static function testMeasuredAffectsGroupPass():Void {
        TestRunner.test("Measured - Affects group pass");
        setupTest();

        // Measured req that evaluates to false (current != target)
        var measuredReq:Object = createMeasuredValueReq(5, 10, "MEASURED");
        // This has cmp "==" and 5 != 10, so it's "false" and SHOULD block trigger

        // Normal req that's true
        var normalReq:Object = createReq({alwaysTrue: true, maxHits: 0});

        AppData.data = {
            assets: [createAchievement([createGroup("CORE", [measuredReq, normalReq])])]
        };

        // Frame 1: Should NOT trigger because Measured affects group pass
        Main.testRunFrame();
        TestRunner.assertEqual(AppData.data.assets[0].state, "ACTIVE", "should NOT trigger (Measured affects group pass)");

        TestRunner.endTest();
    }

    // ========================================================================
    // Test Helpers
    // ========================================================================

    /**
     * Reset test state before each test
     */
    private static function setupTest():Void {
        AppData.data = null;
        Main.testClearDeltaValues();
        Main.testClearDiffBuffer();
    }

    /**
     * Create a mock achievement
     */
    private static function createAchievement(groups:Array):Object {
        return {
            id: -999,
            name: "Test Achievement",
            state: "ACTIVE",
            groups: groups
        };
    }

    /**
     * Create a mock group
     */
    private static function createGroup(type:String, requirements:Array):Object {
        return {
            type: type,
            requirements: requirements
        };
    }

    /**
     * Create a mock requirement
     * @param opts Object with: alwaysTrue, flag, maxHits, typeA, typeB
     */
    private static function createReq(opts:Object):Object {
        var id:Number = reqIdCounter--;
        var passValue:String = opts.alwaysTrue ? "1" : "0";

        return {
            id: id,
            flag: opts.flag || null,
            maxHits: opts.maxHits || 0,
            hits: 0,
            cmp: "==",
            addressA: "testA_" + id,  // Unique cache key
            addressB: "testB_" + id,
            compiledA: ["VERSION_1", "VALUE", "1"],
            compiledB: ["VERSION_1", "VALUE", passValue],
            typeA: opts.typeA || "VALUE",
            typeB: opts.typeB || "VALUE"
        };
    }

    /**
     * Create a Measured requirement with specific current and target values
     * Used for testing Value Mode where current and target can differ
     * @param current The current value (left side of comparison)
     * @param target The target value (right side of comparison)
     * @param flag "MEASURED" or "MEASURED_IF"
     */
    private static function createMeasuredValueReq(current:Number, target:Number, flag:String):Object {
        var id:Number = reqIdCounter--;

        return {
            id: id,
            flag: flag,
            maxHits: 0,  // Value mode (no hit tracking)
            hits: 0,
            cmp: "==",
            addressA: "measuredA_" + id,  // Unique cache key
            addressB: "measuredB_" + id,
            compiledA: ["VERSION_1", "VALUE", String(current)],
            compiledB: ["VERSION_1", "VALUE", String(target)],
            typeA: "VALUE",
            typeB: "VALUE"
        };
    }
}
