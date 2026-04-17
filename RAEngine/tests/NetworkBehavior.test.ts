/**
 * Network Behavior Tests
 *
 * Tests for reconcileNetworkFiles (zip file management),
 * contentTypeForUrl, and networkRuleZipPath.
 */

import { test, assertEqual } from "../../tests/framework.ts";
import {
    reconcileNetworkFiles,
    contentTypeForUrl,
    networkRuleZipPath,
    matchNetworkUrl,
} from "../src/SitelockProxy.ts";

// Helper: encode string to base64 (simulating browser FileReader output)
function toBase64(str: string): string {
    return btoa(str);
}

// =============================================================================
// networkRuleZipPath
// =============================================================================

test("zipPath - root path", () => {
    assertEqual(
        networkRuleZipPath("http://example.com/"),
        "network/example.com/",
    );
});

test("zipPath - deep nesting", () => {
    assertEqual(
        networkRuleZipPath("http://cdn.example.com/a/b/c/d/e/file.swf"),
        "network/cdn.example.com/a/b/c/d/e/file.swf",
    );
});

test("zipPath - with port number", () => {
    assertEqual(
        networkRuleZipPath("http://localhost:8080/api"),
        "network/localhost:8080/api",
    );
});

// =============================================================================
// contentTypeForUrl
// =============================================================================

test("contentType - .swf", () => {
    assertEqual(contentTypeForUrl("http://example.com/game.swf"), "application/x-shockwave-flash");
});

test("contentType - .json", () => {
    assertEqual(contentTypeForUrl("http://example.com/data.json"), "application/json");
});

test("contentType - .xml", () => {
    assertEqual(contentTypeForUrl("http://example.com/config.xml"), "application/xml");
});

test("contentType - .png", () => {
    assertEqual(contentTypeForUrl("http://example.com/image.png"), "image/png");
});

test("contentType - .jpg", () => {
    assertEqual(contentTypeForUrl("http://example.com/photo.jpg"), "image/jpeg");
});

test("contentType - .gif", () => {
    assertEqual(contentTypeForUrl("http://example.com/anim.gif"), "image/gif");
});

test("contentType - .html", () => {
    assertEqual(contentTypeForUrl("http://example.com/page.html"), "text/html");
});

test("contentType - .css", () => {
    assertEqual(contentTypeForUrl("http://example.com/style.css"), "text/css");
});

test("contentType - .js", () => {
    assertEqual(contentTypeForUrl("http://example.com/script.js"), "application/javascript");
});

test("contentType - .mp3", () => {
    assertEqual(contentTypeForUrl("http://example.com/audio.mp3"), "audio/mpeg");
});

test("contentType - unknown extension falls back to octet-stream", () => {
    assertEqual(contentTypeForUrl("http://example.com/file.xyz"), "application/octet-stream");
});

test("contentType - no extension falls back to octet-stream", () => {
    assertEqual(contentTypeForUrl("http://example.com/noext"), "application/octet-stream");
});

test("contentType - case insensitive", () => {
    assertEqual(contentTypeForUrl("http://example.com/game.SWF"), "application/x-shockwave-flash");
    assertEqual(contentTypeForUrl("http://example.com/image.PNG"), "image/png");
});

test("contentType - strips query string before checking extension", () => {
    assertEqual(contentTypeForUrl("http://example.com/game.swf?v=123"), "application/x-shockwave-flash");
});

test("contentType - query string with dot doesn't confuse it", () => {
    assertEqual(contentTypeForUrl("http://example.com/game.swf?file=test.png"), "application/x-shockwave-flash");
});

// =============================================================================
// reconcileNetworkFiles — uploads
// =============================================================================

test("reconcile - new file upload writes to zip", () => {
    const files: Record<string, Uint8Array> = {};
    const oldRules: any[] = [];
    const newRules: any[] = [
        { action: "file", url: "http://example.com/game.swf", fileData: toBase64("SWF_CONTENT") },
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(new TextDecoder().decode(files["network/example.com/game.swf"]), "SWF_CONTENT");
});

test("reconcile - fileData is stripped from rules after processing", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "http://example.com/a.swf", fileData: toBase64("data") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEqual(newRules[0].fileData, undefined);
});

test("reconcile - multiple uploads at once", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "http://a.com/1.swf", fileData: toBase64("one") },
        { action: "file", url: "http://b.com/2.swf", fileData: toBase64("two") },
        { action: "file", url: "http://c.com/3.swf", fileData: toBase64("three") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEqual(new TextDecoder().decode(files["network/a.com/1.swf"]), "one");
    assertEqual(new TextDecoder().decode(files["network/b.com/2.swf"]), "two");
    assertEqual(new TextDecoder().decode(files["network/c.com/3.swf"]), "three");
});

test("reconcile - re-upload replaces existing file", () => {
    const files: Record<string, Uint8Array> = {
        "network/example.com/game.swf": new TextEncoder().encode("OLD"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://example.com/game.swf" },
    ];
    const newRules: any[] = [
        { action: "file", url: "http://example.com/game.swf", fileData: toBase64("NEW") },
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(new TextDecoder().decode(files["network/example.com/game.swf"]), "NEW");
});

// =============================================================================
// reconcileNetworkFiles — URL changes (file moves)
// =============================================================================

test("reconcile - changing URL moves file to new path", () => {
    const files: Record<string, Uint8Array> = {
        "network/old.com/game.swf": new TextEncoder().encode("CONTENT"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://old.com/game.swf" },
    ];
    const newRules: any[] = [
        { action: "file", url: "http://new.com/game.swf" },
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(new TextDecoder().decode(files["network/new.com/game.swf"]), "CONTENT");
    assertEqual(files["network/old.com/game.swf"], undefined); // old path cleaned up
});

test("reconcile - changing URL with simultaneous upload uses upload", () => {
    const files: Record<string, Uint8Array> = {
        "network/old.com/game.swf": new TextEncoder().encode("OLD"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://old.com/game.swf" },
    ];
    const newRules: any[] = [
        { action: "file", url: "http://new.com/game.swf", fileData: toBase64("FRESH") },
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(new TextDecoder().decode(files["network/new.com/game.swf"]), "FRESH");
    assertEqual(files["network/old.com/game.swf"], undefined);
});

test("reconcile - file already at new path is kept when URL unchanged", () => {
    const original = new TextEncoder().encode("CONTENT");
    const files: Record<string, Uint8Array> = {
        "network/example.com/game.swf": original,
    };
    const oldRules: any[] = [
        { action: "file", url: "http://example.com/game.swf" },
    ];
    const newRules: any[] = [
        { action: "file", url: "http://example.com/game.swf" },
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(files["network/example.com/game.swf"], original); // same reference, untouched
});

// =============================================================================
// reconcileNetworkFiles — orphan cleanup
// =============================================================================

test("reconcile - deleting a rule removes its file", () => {
    const files: Record<string, Uint8Array> = {
        "network/example.com/game.swf": new TextEncoder().encode("DATA"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://example.com/game.swf" },
    ];
    const newRules: any[] = []; // rule deleted

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(files["network/example.com/game.swf"], undefined);
});

test("reconcile - changing action from file to text removes file", () => {
    const files: Record<string, Uint8Array> = {
        "network/example.com/data.json": new TextEncoder().encode("{}"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://example.com/data.json" },
    ];
    const newRules: any[] = [
        { action: "text", url: "http://example.com/data.json", body: "{}" },
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(files["network/example.com/data.json"], undefined);
});

test("reconcile - deleting one rule keeps other rule's file", () => {
    const files: Record<string, Uint8Array> = {
        "network/a.com/1.swf": new TextEncoder().encode("ONE"),
        "network/b.com/2.swf": new TextEncoder().encode("TWO"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://a.com/1.swf" },
        { action: "file", url: "http://b.com/2.swf" },
    ];
    const newRules: any[] = [
        { action: "file", url: "http://b.com/2.swf" },
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(files["network/a.com/1.swf"], undefined);
    assertEqual(new TextDecoder().decode(files["network/b.com/2.swf"]), "TWO");
});

test("reconcile - non-network zip entries are never touched", () => {
    const swfBytes = new TextEncoder().encode("SWF");
    const dataBytes = new TextEncoder().encode("{}");
    const files: Record<string, Uint8Array> = {
        "start.swf": swfBytes,
        "data.json": dataBytes,
        "network/example.com/game.swf": new TextEncoder().encode("GAME"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://example.com/game.swf" },
    ];
    const newRules: any[] = []; // delete all rules

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEqual(files["start.swf"], swfBytes);
    assertEqual(files["data.json"], dataBytes);
    assertEqual(files["network/example.com/game.swf"], undefined);
});

// =============================================================================
// reconcileNetworkFiles — text rules (no zip interaction)
// =============================================================================

test("reconcile - text rules don't create zip entries", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "text", url: "http://example.com/api", body: "hello" },
    ];

    reconcileNetworkFiles(files, [], newRules);

    const networkKeys = Object.keys(files).filter(k => k.startsWith("network/"));
    assertEqual(networkKeys.length, 0);
});

test("reconcile - mixed text and file rules", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "text", url: "http://api.com/status", body: "ok" },
        { action: "file", url: "http://cdn.com/asset.swf", fileData: toBase64("SWF") },
        { action: "text", url: "http://api.com/config", body: "{}" },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEqual(Object.keys(files).filter(k => k.startsWith("network/")).length, 1);
    assertEqual(new TextDecoder().decode(files["network/cdn.com/asset.swf"]), "SWF");
});

// =============================================================================
// reconcileNetworkFiles — edge cases
// =============================================================================

test("reconcile - empty URL file rules are ignored", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "", fileData: toBase64("data") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    const networkKeys = Object.keys(files).filter(k => k.startsWith("network/"));
    assertEqual(networkKeys.length, 0);
});

test("reconcile - no rules to no rules is a no-op", () => {
    const files: Record<string, Uint8Array> = { "start.swf": new Uint8Array(0) };

    reconcileNetworkFiles(files, [], []);

    assertEqual(Object.keys(files).length, 1);
});

test("reconcile - rule without fileData and no existing file results in no zip entry", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "http://example.com/missing.swf" },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEqual(files["network/example.com/missing.swf"], undefined);
});

test("reconcile - fileData on text rule is stripped but not written", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "text", url: "http://example.com/api", body: "ok", fileData: toBase64("junk") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEqual(newRules[0].fileData, undefined);
    assertEqual(Object.keys(files).filter(k => k.startsWith("network/")).length, 0);
});

test("reconcile - two file rules with same URL, last upload wins", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "http://example.com/same.swf", fileData: toBase64("first") },
        { action: "file", url: "http://example.com/same.swf", fileData: toBase64("second") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEqual(new TextDecoder().decode(files["network/example.com/same.swf"]), "second");
});

test("reconcile - binary data survives base64 round-trip", () => {
    const binaryData = new Uint8Array([0x00, 0x01, 0xFF, 0xFE, 0x80, 0x7F]);
    const base64 = btoa(String.fromCharCode(...binaryData));
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "http://example.com/binary.dat", fileData: base64 },
    ];

    reconcileNetworkFiles(files, [], newRules);

    const result = files["network/example.com/binary.dat"];
    assertEqual(result.length, binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
        assertEqual(result[i], binaryData[i]);
    }
});

// =============================================================================
// matchNetworkUrl — wildcard matching
// =============================================================================

test("matchUrl - exact match with no wildcards", () => {
    assertEqual(matchNetworkUrl("http://example.com/game.swf", "http://example.com/game.swf"), true);
});

test("matchUrl - exact mismatch with no wildcards", () => {
    assertEqual(matchNetworkUrl("http://example.com/game.swf", "http://example.com/other.swf"), false);
});

test("matchUrl - {*} matches any query string", () => {
    assertEqual(matchNetworkUrl(
        "http://www.ngads.com/gateway_v2.php?seed={*}",
        "http://www.ngads.com/gateway_v2.php?seed=0.56048827432096",
    ), true);
});

test("matchUrl - {*} requires at least one character", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{*}.swf",
        "http://example.com/.swf",
    ), false);
});

test("matchUrl - {*} matches entire path", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{*}",
        "http://example.com/any/path/here?q=1",
    ), true);
});

test("matchUrl - {#} matches digits", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/level{#}.swf",
        "http://example.com/level42.swf",
    ), true);
});

test("matchUrl - {#} rejects non-digits", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/level{#}.swf",
        "http://example.com/levelABC.swf",
    ), false);
});

test("matchUrl - {#} requires at least one digit", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/level{#}.swf",
        "http://example.com/level.swf",
    ), false);
});

test("matchUrl - {#} matches decimal numbers", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/seed={#}",
        "http://example.com/seed=0.56048827432096",
    ), true);
});

test("matchUrl - {#} does not capture trailing dot without digit", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{#}.hello",
        "http://example.com/555.hello",
    ), true);
});

test("matchUrl - {#} matches integer when no decimal part", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/id={#}",
        "http://example.com/id=42",
    ), true);
});

test("matchUrl - {?} matches letters", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{?}.swf",
        "http://example.com/game.swf",
    ), true);
});

test("matchUrl - {?} rejects digits", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{?}.swf",
        "http://example.com/123.swf",
    ), false);
});

test("matchUrl - {?} rejects special characters", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{?}.swf",
        "http://example.com/a-b.swf",
    ), false);
});

test("matchUrl - {?} requires at least one letter", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{?}.swf",
        "http://example.com/.swf",
    ), false);
});

test("matchUrl - composed {#?#} matches digits-letters-digits", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{#?#}",
        "http://example.com/45test78",
    ), true);
});

test("matchUrl - composed {#?#} rejects wrong pattern", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{#?#}",
        "http://example.com/test78",
    ), false);
});

test("matchUrl - {prefix*} matches strings starting with prefix", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{game*}.swf",
        "http://example.com/gameplay.swf",
    ), true);
});

test("matchUrl - {prefix*} rejects strings not starting with prefix", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{game*}.swf",
        "http://example.com/menu.swf",
    ), false);
});

test("matchUrl - literal text in expression {v#} matches v followed by digits", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/api/{v#}/data",
        "http://example.com/api/v2/data",
    ), true);
});

test("matchUrl - multiple wildcards in one pattern", () => {
    assertEqual(matchNetworkUrl(
        "http://{*}.example.com/api/{#}/data",
        "http://cdn.example.com/api/99/data",
    ), true);
});

test("matchUrl - multiple wildcards, partial mismatch", () => {
    assertEqual(matchNetworkUrl(
        "http://{*}.example.com/api/{#}/data",
        "http://cdn.example.com/api/abc/data",
    ), false);
});

test("matchUrl - regex special chars in URL are escaped", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/file.php?a=1&b=2",
        "http://example.com/file.php?a=1&b=2",
    ), true);
});

test("matchUrl - unclosed brace is treated as literal", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{broken",
        "http://example.com/{broken",
    ), true);
});

test("matchUrl - escaped \\* matches literal asterisk", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{\\*}.swf",
        "http://example.com/*.swf",
    ), true);
});

test("matchUrl - escaped \\* does not act as wildcard", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{\\*}.swf",
        "http://example.com/game.swf",
    ), false);
});

test("matchUrl - escaped \\# matches literal hash", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{\\#}.swf",
        "http://example.com/#.swf",
    ), true);
});

test("matchUrl - escaped \\? matches literal question mark", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{\\?}",
        "http://example.com/?",
    ), true);
});

test("matchUrl - mix of escaped and wildcard tokens", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{\\*#}",
        "http://example.com/*42",
    ), true);
});

test("matchUrl - trailing backslash is literal", () => {
    assertEqual(matchNetworkUrl(
        "http://example.com/{\\}",
        "http://example.com/\\",
    ), true);
});
