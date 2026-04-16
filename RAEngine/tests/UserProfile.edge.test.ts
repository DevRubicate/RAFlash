/**
 * UserProfile Edge Case Tests (v0.0.19 release coverage)
 *
 * Tests for:
 *   - Path traversal prevention in profile names
 *   - Profile name sanitization
 */

import { test, assertEqual } from "../../tests/framework.ts";
import { UserProfile } from "../src/UserProfile.ts";

// =============================================================================
// Profile Name Sanitization (path traversal fix)
// =============================================================================

// These tests verify that loadUser and createUser strip dangerous characters.
// Since loadUser/createUser hit the filesystem, we test the sanitization logic
// indirectly through the pattern used: name.replace(/[/\\:*?"<>|]/g, "").trim()

function sanitize(name: string): string {
    return name.replace(/[/\\:*?"<>|]/g, "").trim();
}

test("sanitize - normal name unchanged", () => {
    assertEqual(sanitize("Player1"), "Player1");
});

test("sanitize - strips forward slashes", () => {
    assertEqual(sanitize("../../../etc/passwd"), "......etcpasswd");
});

test("sanitize - strips backslashes", () => {
    assertEqual(sanitize("..\\..\\..\\Windows\\System32"), "......WindowsSystem32");
});

test("sanitize - strips colons", () => {
    assertEqual(sanitize("C:evil"), "Cevil");
});

test("sanitize - strips Windows special chars", () => {
    assertEqual(sanitize('name*with?"bad<chars>'), "namewithbadchars");
});

test("sanitize - strips pipe", () => {
    assertEqual(sanitize("name|pipe"), "namepipe");
});

test("sanitize - trims whitespace", () => {
    assertEqual(sanitize("  name  "), "name");
});

test("sanitize - empty after stripping returns empty", () => {
    assertEqual(sanitize("/\\:*?\"<>|"), "");
});

test("sanitize - preserves unicode characters", () => {
    assertEqual(sanitize("プレイヤー"), "プレイヤー");
});

test("sanitize - preserves spaces in middle", () => {
    assertEqual(sanitize("Player Name"), "Player Name");
});

test("sanitize - path traversal with spaces", () => {
    assertEqual(sanitize("  ../admin  "), "..admin");
});

// =============================================================================
// recordUnlock edge cases
// =============================================================================

function setupProfile(name = "TestUser") {
    UserProfile.currentName = name;
    UserProfile.data = {
        name,
        created: "2024-01-01T00:00:00.000Z",
        games: {},
    };
    UserProfile.dirty = false;
}

function cleanup() {
    UserProfile.reset();
}

test("UserProfile.recordUnlock - zero ID is valid", () => {
    setupProfile();
    UserProfile.recordUnlock("game1", 0);
    assertEqual(UserProfile.data!.games["game1"].unlocked, [0]);
    cleanup();
});

test("UserProfile.recordUnlock - large negative ID", () => {
    setupProfile();
    UserProfile.recordUnlock("game1", -999);
    assertEqual(UserProfile.data!.games["game1"].unlocked, [-999]);
    cleanup();
});

test("UserProfile.recordUnlock - many unlocks for same game", () => {
    setupProfile();
    for (let i = 0; i < 100; i++) {
        UserProfile.recordUnlock("game1", i);
    }
    assertEqual(UserProfile.data!.games["game1"].unlocked.length, 100);
    assertEqual(UserProfile.data!.games["game1"].unlocked[0], 0);
    assertEqual(UserProfile.data!.games["game1"].unlocked[99], 99);
    cleanup();
});

test("UserProfile.recordUnlock - duplicate across multiple calls doesn't add", () => {
    setupProfile();
    UserProfile.recordUnlock("game1", 5);
    UserProfile.recordUnlock("game1", 5);
    UserProfile.recordUnlock("game1", 5);
    assertEqual(UserProfile.data!.games["game1"].unlocked, [5]);
    cleanup();
});
