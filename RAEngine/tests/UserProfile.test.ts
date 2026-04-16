/**
 * UserProfile Tests
 *
 * Tests for in-memory state management: recordUnlock, getUnlockedIds, reset.
 * These tests manipulate UserProfile.data directly to avoid filesystem I/O.
 */

import { test, assertEqual } from "../../tests/framework.ts";
import { UserProfile } from "../src/UserProfile.ts";

// Helper: set up UserProfile with a clean in-memory state
function setupProfile(name = "TestUser") {
    UserProfile.currentName = name;
    UserProfile.data = {
        name,
        created: "2024-01-01T00:00:00.000Z",
        games: {},
    };
    UserProfile.dirty = false;
}

// Clean up after each test
function cleanup() {
    UserProfile.reset();
}

// =============================================================================
// reset
// =============================================================================

test("UserProfile.reset - clears all state", () => {
    setupProfile();
    UserProfile.dirty = true;

    UserProfile.reset();

    assertEqual(UserProfile.currentName, null);
    assertEqual(UserProfile.data, null);
    assertEqual(UserProfile.dirty, false);
});

// =============================================================================
// recordUnlock
// =============================================================================

test("UserProfile.recordUnlock - creates game entry if missing", () => {
    setupProfile();
    UserProfile.recordUnlock("abc123", 1);

    assertEqual(UserProfile.data!.games["abc123"].unlocked, [1]);
    assertEqual(UserProfile.dirty, true);
    cleanup();
});

test("UserProfile.recordUnlock - adds to existing game entry", () => {
    setupProfile();
    UserProfile.data!.games["abc123"] = { unlocked: [1] };

    UserProfile.recordUnlock("abc123", 2);

    assertEqual(UserProfile.data!.games["abc123"].unlocked, [1, 2]);
    assertEqual(UserProfile.dirty, true);
    cleanup();
});

test("UserProfile.recordUnlock - does not duplicate existing unlock", () => {
    setupProfile();
    UserProfile.data!.games["abc123"] = { unlocked: [1, 2] };
    UserProfile.dirty = false;

    UserProfile.recordUnlock("abc123", 2);

    assertEqual(UserProfile.data!.games["abc123"].unlocked, [1, 2]);
    assertEqual(UserProfile.dirty, false); // no change, so not dirty
    cleanup();
});

test("UserProfile.recordUnlock - sets lastPlayed timestamp", () => {
    setupProfile();
    UserProfile.recordUnlock("abc123", 1);

    const lastPlayed = UserProfile.data!.games["abc123"].lastPlayed;
    assertEqual(typeof lastPlayed, "string");
    // Should be a valid ISO date
    assertEqual(isNaN(new Date(lastPlayed!).getTime()), false);
    cleanup();
});

test("UserProfile.recordUnlock - no-op when data is null", () => {
    UserProfile.data = null;
    UserProfile.recordUnlock("abc123", 1);
    assertEqual(UserProfile.data, null);
    cleanup();
});

test("UserProfile.recordUnlock - handles multiple games independently", () => {
    setupProfile();
    UserProfile.recordUnlock("game1", 1);
    UserProfile.recordUnlock("game2", 5);
    UserProfile.recordUnlock("game1", 2);

    assertEqual(UserProfile.data!.games["game1"].unlocked, [1, 2]);
    assertEqual(UserProfile.data!.games["game2"].unlocked, [5]);
    cleanup();
});

test("UserProfile.recordUnlock - handles negative IDs", () => {
    setupProfile();
    UserProfile.recordUnlock("abc123", -1);
    assertEqual(UserProfile.data!.games["abc123"].unlocked, [-1]);
    cleanup();
});

// =============================================================================
// getUnlockedIds
// =============================================================================

test("UserProfile.getUnlockedIds - returns unlocked IDs for known game", () => {
    setupProfile();
    UserProfile.data!.games["abc123"] = { unlocked: [1, 2, 3] };

    assertEqual(UserProfile.getUnlockedIds("abc123"), [1, 2, 3]);
    cleanup();
});

test("UserProfile.getUnlockedIds - returns empty array for unknown game", () => {
    setupProfile();
    assertEqual(UserProfile.getUnlockedIds("unknown"), []);
    cleanup();
});

test("UserProfile.getUnlockedIds - returns empty array when data is null", () => {
    UserProfile.data = null;
    assertEqual(UserProfile.getUnlockedIds("abc123"), []);
    cleanup();
});

