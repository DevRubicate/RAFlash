/**
 * Network Behavior Tests
 *
 * Tests for reconcileNetworkFiles (zip file management),
 * contentTypeForUrl, and networkRuleZipPath.
 */

import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import {
    reconcileNetworkFiles,
    contentTypeForUrl,
    networkRuleZipPath,
} from "../src/SitelockProxy.ts";

// Helper: encode string to base64 (simulating browser FileReader output)
function toBase64(str: string): string {
    return btoa(str);
}

// =============================================================================
// networkRuleZipPath
// =============================================================================

Deno.test("zipPath - http URL", () => {
    assertEquals(
        networkRuleZipPath("http://kongregate.com/category/games/tracker.swf"),
        "network/kongregate.com/category/games/tracker.swf",
    );
});

Deno.test("zipPath - https URL", () => {
    assertEquals(
        networkRuleZipPath("https://example.com/api/data.json"),
        "network/example.com/api/data.json",
    );
});

Deno.test("zipPath - preserves query string", () => {
    assertEquals(
        networkRuleZipPath("http://host.com/path?key=val"),
        "network/host.com/path?key=val",
    );
});

Deno.test("zipPath - root path", () => {
    assertEquals(
        networkRuleZipPath("http://example.com/"),
        "network/example.com/",
    );
});

Deno.test("zipPath - deep nesting", () => {
    assertEquals(
        networkRuleZipPath("http://cdn.example.com/a/b/c/d/e/file.swf"),
        "network/cdn.example.com/a/b/c/d/e/file.swf",
    );
});

Deno.test("zipPath - with port number", () => {
    assertEquals(
        networkRuleZipPath("http://localhost:8080/api"),
        "network/localhost:8080/api",
    );
});

// =============================================================================
// contentTypeForUrl
// =============================================================================

Deno.test("contentType - .swf", () => {
    assertEquals(contentTypeForUrl("http://example.com/game.swf"), "application/x-shockwave-flash");
});

Deno.test("contentType - .json", () => {
    assertEquals(contentTypeForUrl("http://example.com/data.json"), "application/json");
});

Deno.test("contentType - .xml", () => {
    assertEquals(contentTypeForUrl("http://example.com/config.xml"), "application/xml");
});

Deno.test("contentType - .png", () => {
    assertEquals(contentTypeForUrl("http://example.com/image.png"), "image/png");
});

Deno.test("contentType - .jpg", () => {
    assertEquals(contentTypeForUrl("http://example.com/photo.jpg"), "image/jpeg");
});

Deno.test("contentType - .jpeg", () => {
    assertEquals(contentTypeForUrl("http://example.com/photo.jpeg"), "image/jpeg");
});

Deno.test("contentType - .gif", () => {
    assertEquals(contentTypeForUrl("http://example.com/anim.gif"), "image/gif");
});

Deno.test("contentType - .html", () => {
    assertEquals(contentTypeForUrl("http://example.com/page.html"), "text/html");
});

Deno.test("contentType - .htm", () => {
    assertEquals(contentTypeForUrl("http://example.com/page.htm"), "text/html");
});

Deno.test("contentType - .css", () => {
    assertEquals(contentTypeForUrl("http://example.com/style.css"), "text/css");
});

Deno.test("contentType - .js", () => {
    assertEquals(contentTypeForUrl("http://example.com/script.js"), "application/javascript");
});

Deno.test("contentType - .mp3", () => {
    assertEquals(contentTypeForUrl("http://example.com/audio.mp3"), "audio/mpeg");
});

Deno.test("contentType - .txt", () => {
    assertEquals(contentTypeForUrl("http://example.com/readme.txt"), "text/plain");
});

Deno.test("contentType - .flv", () => {
    assertEquals(contentTypeForUrl("http://example.com/video.flv"), "video/x-flv");
});

Deno.test("contentType - .csv", () => {
    assertEquals(contentTypeForUrl("http://example.com/data.csv"), "text/csv");
});

Deno.test("contentType - unknown extension falls back to octet-stream", () => {
    assertEquals(contentTypeForUrl("http://example.com/file.xyz"), "application/octet-stream");
});

Deno.test("contentType - no extension falls back to octet-stream", () => {
    assertEquals(contentTypeForUrl("http://example.com/noext"), "application/octet-stream");
});

Deno.test("contentType - case insensitive", () => {
    assertEquals(contentTypeForUrl("http://example.com/game.SWF"), "application/x-shockwave-flash");
    assertEquals(contentTypeForUrl("http://example.com/image.PNG"), "image/png");
});

Deno.test("contentType - strips query string before checking extension", () => {
    assertEquals(contentTypeForUrl("http://example.com/game.swf?v=123"), "application/x-shockwave-flash");
});

Deno.test("contentType - query string with dot doesn't confuse it", () => {
    assertEquals(contentTypeForUrl("http://example.com/game.swf?file=test.png"), "application/x-shockwave-flash");
});

// =============================================================================
// reconcileNetworkFiles — uploads
// =============================================================================

Deno.test("reconcile - new file upload writes to zip", () => {
    const files: Record<string, Uint8Array> = {};
    const oldRules: any[] = [];
    const newRules: any[] = [
        { action: "file", url: "http://example.com/game.swf", fileData: toBase64("SWF_CONTENT") },
    ];

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEquals(new TextDecoder().decode(files["network/example.com/game.swf"]), "SWF_CONTENT");
});

Deno.test("reconcile - fileData is stripped from rules after processing", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "http://example.com/a.swf", fileData: toBase64("data") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEquals(newRules[0].fileData, undefined);
});

Deno.test("reconcile - multiple uploads at once", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "http://a.com/1.swf", fileData: toBase64("one") },
        { action: "file", url: "http://b.com/2.swf", fileData: toBase64("two") },
        { action: "file", url: "http://c.com/3.swf", fileData: toBase64("three") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEquals(new TextDecoder().decode(files["network/a.com/1.swf"]), "one");
    assertEquals(new TextDecoder().decode(files["network/b.com/2.swf"]), "two");
    assertEquals(new TextDecoder().decode(files["network/c.com/3.swf"]), "three");
});

Deno.test("reconcile - re-upload replaces existing file", () => {
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

    assertEquals(new TextDecoder().decode(files["network/example.com/game.swf"]), "NEW");
});

// =============================================================================
// reconcileNetworkFiles — URL changes (file moves)
// =============================================================================

Deno.test("reconcile - changing URL moves file to new path", () => {
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

    assertEquals(new TextDecoder().decode(files["network/new.com/game.swf"]), "CONTENT");
    assertEquals(files["network/old.com/game.swf"], undefined); // old path cleaned up
});

Deno.test("reconcile - changing URL with simultaneous upload uses upload", () => {
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

    assertEquals(new TextDecoder().decode(files["network/new.com/game.swf"]), "FRESH");
    assertEquals(files["network/old.com/game.swf"], undefined);
});

Deno.test("reconcile - file already at new path is kept when URL unchanged", () => {
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

    assertEquals(files["network/example.com/game.swf"], original); // same reference, untouched
});

// =============================================================================
// reconcileNetworkFiles — orphan cleanup
// =============================================================================

Deno.test("reconcile - deleting a rule removes its file", () => {
    const files: Record<string, Uint8Array> = {
        "network/example.com/game.swf": new TextEncoder().encode("DATA"),
    };
    const oldRules: any[] = [
        { action: "file", url: "http://example.com/game.swf" },
    ];
    const newRules: any[] = []; // rule deleted

    reconcileNetworkFiles(files, oldRules, newRules);

    assertEquals(files["network/example.com/game.swf"], undefined);
});

Deno.test("reconcile - changing action from file to text removes file", () => {
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

    assertEquals(files["network/example.com/data.json"], undefined);
});

Deno.test("reconcile - deleting one rule keeps other rule's file", () => {
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

    assertEquals(files["network/a.com/1.swf"], undefined);
    assertEquals(new TextDecoder().decode(files["network/b.com/2.swf"]), "TWO");
});

Deno.test("reconcile - non-network zip entries are never touched", () => {
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

    assertEquals(files["start.swf"], swfBytes);
    assertEquals(files["data.json"], dataBytes);
    assertEquals(files["network/example.com/game.swf"], undefined);
});

// =============================================================================
// reconcileNetworkFiles — text rules (no zip interaction)
// =============================================================================

Deno.test("reconcile - text rules don't create zip entries", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "text", url: "http://example.com/api", body: "hello" },
    ];

    reconcileNetworkFiles(files, [], newRules);

    const networkKeys = Object.keys(files).filter(k => k.startsWith("network/"));
    assertEquals(networkKeys.length, 0);
});

Deno.test("reconcile - mixed text and file rules", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "text", url: "http://api.com/status", body: "ok" },
        { action: "file", url: "http://cdn.com/asset.swf", fileData: toBase64("SWF") },
        { action: "text", url: "http://api.com/config", body: "{}" },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEquals(Object.keys(files).filter(k => k.startsWith("network/")).length, 1);
    assertEquals(new TextDecoder().decode(files["network/cdn.com/asset.swf"]), "SWF");
});

// =============================================================================
// reconcileNetworkFiles — edge cases
// =============================================================================

Deno.test("reconcile - empty URL file rules are ignored", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "", fileData: toBase64("data") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    const networkKeys = Object.keys(files).filter(k => k.startsWith("network/"));
    assertEquals(networkKeys.length, 0);
});

Deno.test("reconcile - no rules to no rules is a no-op", () => {
    const files: Record<string, Uint8Array> = { "start.swf": new Uint8Array(0) };

    reconcileNetworkFiles(files, [], []);

    assertEquals(Object.keys(files).length, 1);
});

Deno.test("reconcile - rule without fileData and no existing file results in no zip entry", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "http://example.com/missing.swf" },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEquals(files["network/example.com/missing.swf"], undefined);
});

Deno.test("reconcile - fileData on text rule is stripped but not written", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "text", url: "http://example.com/api", body: "ok", fileData: toBase64("junk") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEquals(newRules[0].fileData, undefined);
    assertEquals(Object.keys(files).filter(k => k.startsWith("network/")).length, 0);
});

Deno.test("reconcile - two file rules with same URL, last upload wins", () => {
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "http://example.com/same.swf", fileData: toBase64("first") },
        { action: "file", url: "http://example.com/same.swf", fileData: toBase64("second") },
    ];

    reconcileNetworkFiles(files, [], newRules);

    assertEquals(new TextDecoder().decode(files["network/example.com/same.swf"]), "second");
});

Deno.test("reconcile - binary data survives base64 round-trip", () => {
    const binaryData = new Uint8Array([0x00, 0x01, 0xFF, 0xFE, 0x80, 0x7F]);
    const base64 = btoa(String.fromCharCode(...binaryData));
    const files: Record<string, Uint8Array> = {};
    const newRules: any[] = [
        { action: "file", url: "http://example.com/binary.dat", fileData: base64 },
    ];

    reconcileNetworkFiles(files, [], newRules);

    const result = files["network/example.com/binary.dat"];
    assertEquals(result.length, binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
        assertEquals(result[i], binaryData[i]);
    }
});
