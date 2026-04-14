/**
 * UserProfile Tests
 *
 * Tests for in-memory state management: recordUnlock, getUnlockedIds, reset.
 * These tests manipulate UserProfile.data directly to avoid filesystem I/O.
 */

import { assertEquals } from "https://deno.land/std/assert/mod.ts";
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

Deno.test("UserProfile.reset - clears all state", () => {
    setupProfile();
    UserProfile.dirty = true;

    UserProfile.reset();

    assertEquals(UserProfile.currentName, null);
    assertEquals(UserProfile.data, null);
    assertEquals(UserProfile.dirty, false);
});

// =============================================================================
// recordUnlock
// =============================================================================

Deno.test("UserProfile.recordUnlock - creates game entry if missing", () => {
    setupProfile();
    UserProfile.recordUnlock("abc123", 1);

    assertEquals(UserProfile.data!.games["abc123"].unlocked, [1]);
    assertEquals(UserProfile.dirty, true);
    cleanup();
});

Deno.test("UserProfile.recordUnlock - adds to existing game entry", () => {
    setupProfile();
    UserProfile.data!.games["abc123"] = { unlocked: [1] };

    UserProfile.recordUnlock("abc123", 2);

    assertEquals(UserProfile.data!.games["abc123"].unlocked, [1, 2]);
    assertEquals(UserProfile.dirty, true);
    cleanup();
});

Deno.test("UserProfile.recordUnlock - does not duplicate existing unlock", () => {
    setupProfile();
    UserProfile.data!.games["abc123"] = { unlocked: [1, 2] };
    UserProfile.dirty = false;

    UserProfile.recordUnlock("abc123", 2);

    assertEquals(UserProfile.data!.games["abc123"].unlocked, [1, 2]);
    assertEquals(UserProfile.dirty, false); // no change, so not dirty
    cleanup();
});

Deno.test("UserProfile.recordUnlock - sets lastPlayed timestamp", () => {
    setupProfile();
    UserProfile.recordUnlock("abc123", 1);

    const lastPlayed = UserProfile.data!.games["abc123"].lastPlayed;
    assertEquals(typeof lastPlayed, "string");
    // Should be a valid ISO date
    assertEquals(isNaN(new Date(lastPlayed!).getTime()), false);
    cleanup();
});

Deno.test("UserProfile.recordUnlock - no-op when data is null", () => {
    UserProfile.data = null;
    UserProfile.recordUnlock("abc123", 1);
    assertEquals(UserProfile.data, null);
    cleanup();
});

Deno.test("UserProfile.recordUnlock - handles multiple games independently", () => {
    setupProfile();
    UserProfile.recordUnlock("game1", 1);
    UserProfile.recordUnlock("game2", 5);
    UserProfile.recordUnlock("game1", 2);

    assertEquals(UserProfile.data!.games["game1"].unlocked, [1, 2]);
    assertEquals(UserProfile.data!.games["game2"].unlocked, [5]);
    cleanup();
});

Deno.test("UserProfile.recordUnlock - handles negative IDs", () => {
    setupProfile();
    UserProfile.recordUnlock("abc123", -1);
    assertEquals(UserProfile.data!.games["abc123"].unlocked, [-1]);
    cleanup();
});

// =============================================================================
// getUnlockedIds
// =============================================================================

Deno.test("UserProfile.getUnlockedIds - returns unlocked IDs for known game", () => {
    setupProfile();
    UserProfile.data!.games["abc123"] = { unlocked: [1, 2, 3] };

    assertEquals(UserProfile.getUnlockedIds("abc123"), [1, 2, 3]);
    cleanup();
});

Deno.test("UserProfile.getUnlockedIds - returns empty array for unknown game", () => {
    setupProfile();
    assertEquals(UserProfile.getUnlockedIds("unknown"), []);
    cleanup();
});

Deno.test("UserProfile.getUnlockedIds - returns empty array when data is null", () => {
    UserProfile.data = null;
    assertEquals(UserProfile.getUnlockedIds("abc123"), []);
    cleanup();
});

Deno.test("UserProfile.getUnlockedIds - returns empty array for game with no unlocks", () => {
    setupProfile();
    UserProfile.data!.games["abc123"] = { unlocked: [] };
    assertEquals(UserProfile.getUnlockedIds("abc123"), []);
    cleanup();
});

// =============================================================================
// recordUnlock + getUnlockedIds integration
// =============================================================================

Deno.test("recordUnlock then getUnlockedIds returns recorded IDs", () => {
    setupProfile();
    UserProfile.recordUnlock("hash1", 10);
    UserProfile.recordUnlock("hash1", 20);
    UserProfile.recordUnlock("hash1", 30);

    assertEquals(UserProfile.getUnlockedIds("hash1"), [10, 20, 30]);
    assertEquals(UserProfile.getUnlockedIds("hash2"), []);
    cleanup();
});

// =============================================================================
// dirty flag behavior
// =============================================================================

Deno.test("dirty flag is false after setup", () => {
    setupProfile();
    assertEquals(UserProfile.dirty, false);
    cleanup();
});

Deno.test("dirty flag set to true only on new unlock", () => {
    setupProfile();
    UserProfile.recordUnlock("game1", 1);
    assertEquals(UserProfile.dirty, true);

    // Reset dirty, record same unlock
    UserProfile.dirty = false;
    UserProfile.recordUnlock("game1", 1);
    assertEquals(UserProfile.dirty, false); // duplicate, no change
    cleanup();
});
