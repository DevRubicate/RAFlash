/**
 * Network Behavior Edge Case Tests (v0.0.19 release coverage)
 *
 * Additional tests for the network behavior system introduced since v0.0.18:
 *   - Multiple rule interactions
 *   - File rule overwrites
 *   - Action type changes (file → text → file)
 *   - Empty/malformed inputs
 */

import { test, assertEqual } from "../../tests/framework.ts";
import {
    reconcileNetworkFiles,
    contentTypeForUrl,
    networkRuleZipPath,
} from "../src/SitelockProxy.ts";

function toBase64(str: string): string {
    return btoa(str);
}

// =============================================================================
// reconcileNetworkFiles — action type changes
// =============================================================================

test("reconcile - changing action from text to file with upload", () => {
    const files: Record<string, Uint8Array> = {};
    const oldRules: any[] = [
        { action: "text", url: "http://example.com/data.json", body: "{}" },
    ];
    const newRules: any[] = [
        { action: "file", url: "http://example.com/data.json", fileData: toBase64("REAL_DATA") },
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(new TextDecoder().decode(files["network/example.com/data.json"]), "REAL_DATA");
});

test("reconcile - changing action from file to text cleans up zip", () => {
    const files: Record<string, Uint8Array> = {
        "network/example.com/game.swf": new TextEncoder().encode("SWF"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://example.com/game.swf" },
    ];
    const newRules: any[] = [
        { action: "text", url: "http://example.com/game.swf", body: "blocked" },
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(files["network/example.com/game.swf"], undefined);
});

// =============================================================================
// reconcileNetworkFiles — multiple rules changing at once
// =============================================================================

test("reconcile - simultaneous add, delete, and move", () => {
    const files: Record<string, Uint8Array> = {
        "network/a.com/old.swf": new TextEncoder().encode("OLD"),
        "network/b.com/delete-me.swf": new TextEncoder().encode("DELETE"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://a.com/old.swf" },
        { action: "file", url: "http://b.com/delete-me.swf" },
    ];
    const newRules: any[] = [
        { action: "file", url: "http://a.com/new.swf" },  // URL change (move)
        // second rule deleted
        { action: "file", url: "http://c.com/fresh.swf", fileData: toBase64("FRESH") }, // new upload
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    // Moved
    assertEqual(new TextDecoder().decode(files["network/a.com/new.swf"]), "OLD");
    assertEqual(files["network/a.com/old.swf"], undefined);
    // Deleted
    assertEqual(files["network/b.com/delete-me.swf"], undefined);
    // Added
    assertEqual(new TextDecoder().decode(files["network/c.com/fresh.swf"]), "FRESH");
});

// =============================================================================
// contentTypeForUrl — additional extensions
// =============================================================================

test("zipPath - URL with encoded characters", () => {
    const path = networkRuleZipPath("http://example.com/path%20with%20spaces/file.swf");
    assertEqual(path, "network/example.com/path%20with%20spaces/file.swf");
});

// =============================================================================
// reconcileNetworkFiles — empty states
// =============================================================================

test("reconcile - all rules deleted at once", () => {
    const files: Record<string, Uint8Array> = {
        "network/a.com/1.swf": new TextEncoder().encode("1"),
        "network/b.com/2.swf": new TextEncoder().encode("2"),
        "network/c.com/3.swf": new TextEncoder().encode("3"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://a.com/1.swf" },
        { action: "file", url: "http://b.com/2.swf" },
        { action: "file", url: "http://c.com/3.swf" },
    ];
    const newRules: any[] = [];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(files["network/a.com/1.swf"], undefined);
    assertEqual(files["network/b.com/2.swf"], undefined);
    assertEqual(files["network/c.com/3.swf"], undefined);
});

test("reconcile - file rule with same URL as text rule (different rules)", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "text", url: "http://example.com/api", body: "text response" },
        { action: "file", url: "http://example.com/api", fileData: toBase64("file data") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    // The file rule should create a zip entry
    assertEqual(new TextDecoder().decode(files["network/example.com/api"]), "file data");
});
