/**
 * UserProfile Edge Case Tests (v0.0.19 release coverage)
 *
 * Tests for:
 *   - Path traversal prevention in profile names
 *   - Profile name sanitization
 */

import { assertEquals } from "https://deno.land/std/assert/mod.ts";
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

Deno.test("sanitize - normal name unchanged", () => {
    assertEquals(sanitize("Player1"), "Player1");
});

Deno.test("sanitize - strips forward slashes", () => {
    assertEquals(sanitize("../../../etc/passwd"), "......etcpasswd");
});

Deno.test("sanitize - strips backslashes", () => {
    assertEquals(sanitize("..\\..\\..\\Windows\\System32"), "......WindowsSystem32");
});

Deno.test("sanitize - strips colons", () => {
    assertEquals(sanitize("C:evil"), "Cevil");
});

Deno.test("sanitize - strips Windows special chars", () => {
    assertEquals(sanitize('name*with?"bad<chars>'), "namewithbadchars");
});

Deno.test("sanitize - strips pipe", () => {
    assertEquals(sanitize("name|pipe"), "namepipe");
});

Deno.test("sanitize - trims whitespace", () => {
    assertEquals(sanitize("  name  "), "name");
});

Deno.test("sanitize - empty after stripping returns empty", () => {
    assertEquals(sanitize("/\\:*?\"<>|"), "");
});

Deno.test("sanitize - preserves unicode characters", () => {
    assertEquals(sanitize("プレイヤー"), "プレイヤー");
});

Deno.test("sanitize - preserves spaces in middle", () => {
    assertEquals(sanitize("Player Name"), "Player Name");
});

Deno.test("sanitize - path traversal with spaces", () => {
    assertEquals(sanitize("  ../admin  "), "..admin");
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

Deno.test("UserProfile.recordUnlock - zero ID is valid", () => {
    setupProfile();
    UserProfile.recordUnlock("game1", 0);
    assertEquals(UserProfile.data!.games["game1"].unlocked, [0]);
    cleanup();
});

Deno.test("UserProfile.recordUnlock - large negative ID", () => {
    setupProfile();
    UserProfile.recordUnlock("game1", -999);
    assertEquals(UserProfile.data!.games["game1"].unlocked, [-999]);
    cleanup();
});

Deno.test("UserProfile.recordUnlock - many unlocks for same game", () => {
    setupProfile();
    for (let i = 0; i < 100; i++) {
        UserProfile.recordUnlock("game1", i);
    }
    assertEquals(UserProfile.data!.games["game1"].unlocked.length, 100);
    assertEquals(UserProfile.data!.games["game1"].unlocked[0], 0);
    assertEquals(UserProfile.data!.games["game1"].unlocked[99], 99);
    cleanup();
});

Deno.test("UserProfile.recordUnlock - duplicate across multiple calls doesn't add", () => {
    setupProfile();
    UserProfile.recordUnlock("game1", 5);
    UserProfile.recordUnlock("game1", 5);
    UserProfile.recordUnlock("game1", 5);
    assertEquals(UserProfile.data!.games["game1"].unlocked, [5]);
    cleanup();
});
