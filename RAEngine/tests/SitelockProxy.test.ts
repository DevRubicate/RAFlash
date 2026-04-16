/**
 * SitelockProxy Integration Tests
 *
 * Starts the actual proxy on a test port, sends real HTTP requests through it,
 * and verifies responses. Tests network behavior rules, 404 blocking, etc.
 */

import { test, assertEqual } from "../../tests/framework.ts";
import { startSitelockProxy, stopSitelockProxy, networkRuleZipPath } from "../src/SitelockProxy.ts";

const TEST_PORT = 19876;

/** Send an HTTP request through the forward proxy and return the raw response text. */
async function proxyRequest(method: string, url: string): Promise<string> {
    const conn = await Deno.connect({ hostname: "127.0.0.1", port: TEST_PORT });
    const writer = conn.writable.getWriter();
    const request = `${method} ${url} HTTP/1.1\r\nHost: ${new URL(url).host}\r\nConnection: close\r\n\r\n`;
    await writer.write(new TextEncoder().encode(request));
    writer.releaseLock();

    const reader = conn.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    reader.releaseLock();

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return new TextDecoder().decode(result);
}

function parseResponse(raw: string): { status: number; headers: Record<string, string>; body: string } {
    const headerEnd = raw.indexOf('\r\n\r\n');
    const headerSection = raw.slice(0, headerEnd);
    const body = raw.slice(headerEnd + 4);
    const lines = headerSection.split('\r\n');
    const statusMatch = lines[0].match(/HTTP\/1\.1 (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 0;
    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
        const colon = lines[i].indexOf(':');
        if (colon > 0) {
            headers[lines[i].slice(0, colon).trim().toLowerCase()] = lines[i].slice(colon + 1).trim();
        }
    }
    return { status, headers, body };
}

// =============================================================================
// Unknown hosts are blocked with 404
// =============================================================================

test("proxy - unknown host returns 404", async () => {
    const rules: any[] = [];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://unknown.example.com/something");
        const res = parseResponse(raw);
        assertEqual(res.status, 404);
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// Network behavior rules - text response
// =============================================================================

test("proxy - active text rule returns configured response", async () => {
    const rules = [
        { active: true, url: "http://api.example.com/data.json", status: 200, action: "text", body: '{"hello":"world"}' },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://api.example.com/data.json");
        const res = parseResponse(raw);
        assertEqual(res.status, 200);
        assertEqual(res.headers["content-type"], "text/plain");
        assertEqual(res.body, '{"hello":"world"}');
    } finally {
        stopSitelockProxy();
    }
});

test("proxy - text rule with custom status code", async () => {
    const rules = [
        { active: true, url: "http://api.example.com/gone", status: 410, action: "text", body: "gone away" },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://api.example.com/gone");
        const res = parseResponse(raw);
        assertEqual(res.status, 410);
        assertEqual(res.body, "gone away");
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// Inactive rules are ignored
// =============================================================================

test("proxy - inactive rule is skipped, returns 404", async () => {
    const rules = [
        { active: false, url: "http://api.example.com/data.json", status: 200, action: "text", body: "nope" },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://api.example.com/data.json");
        const res = parseResponse(raw);
        assertEqual(res.status, 404);
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// Empty URL rules never match
// =============================================================================

test("proxy - empty URL rule never matches", async () => {
    const rules = [
        { active: true, url: "", status: 200, action: "text", body: "should not match" },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://anything.com/");
        const res = parseResponse(raw);
        assertEqual(res.status, 404);
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// Exact match only - similar URLs don't match
// =============================================================================

test("proxy - URL must match exactly", async () => {
    const rules = [
        { active: true, url: "http://api.example.com/data.json", status: 200, action: "text", body: "matched" },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        // Different path
        const raw1 = await proxyRequest("GET", "http://api.example.com/other.json");
        assertEqual(parseResponse(raw1).status, 404);

        // Different host
        const raw2 = await proxyRequest("GET", "http://other.example.com/data.json");
        assertEqual(parseResponse(raw2).status, 404);

        // Exact match works
        const raw3 = await proxyRequest("GET", "http://api.example.com/data.json");
        assertEqual(parseResponse(raw3).status, 200);
        assertEqual(parseResponse(raw3).body, "matched");
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// Rules update live without proxy restart
// =============================================================================

test("proxy - rules update live without restart", async () => {
    const rules: any[] = [];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        // No rules — 404
        const raw1 = await proxyRequest("GET", "http://api.example.com/live");
        assertEqual(parseResponse(raw1).status, 404);

        // Add a rule live
        rules.push({ active: true, url: "http://api.example.com/live", status: 200, action: "text", body: "live!" });

        const raw2 = await proxyRequest("GET", "http://api.example.com/live");
        const res2 = parseResponse(raw2);
        assertEqual(res2.status, 200);
        assertEqual(res2.body, "live!");

        // Deactivate it live
        rules[0].active = false;

        const raw3 = await proxyRequest("GET", "http://api.example.com/live");
        assertEqual(parseResponse(raw3).status, 404);
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// File response rules
// =============================================================================

test("proxy - file rule serves bytes with correct content-type", async () => {
    const swfBytes = new Uint8Array([0x46, 0x57, 0x53, 0x09]); // "FWS\t" — fake SWF header
    const rules = [
        { active: true, url: "http://cdn.example.com/game.swf", status: 200, action: "file", body: "", fileBytes: swfBytes },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://cdn.example.com/game.swf");
        const res = parseResponse(raw);
        assertEqual(res.status, 200);
        assertEqual(res.headers["content-type"], "application/x-shockwave-flash");
        assertEqual(res.headers["content-length"], "4");
    } finally {
        stopSitelockProxy();
    }
});

test("proxy - file rule without fileBytes falls back to empty text", async () => {
    const rules = [
        { active: true, url: "http://cdn.example.com/missing.swf", status: 200, action: "file", body: "" },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://cdn.example.com/missing.swf");
        const res = parseResponse(raw);
        assertEqual(res.status, 200);
        assertEqual(res.headers["content-type"], "text/plain");
        assertEqual(res.body, "");
    } finally {
        stopSitelockProxy();
    }
});

test("proxy - file rule content-type detected from extension", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG header
    const rules = [
        { active: true, url: "http://cdn.example.com/image.png", status: 200, action: "file", body: "", fileBytes: pngBytes },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://cdn.example.com/image.png");
        const res = parseResponse(raw);
        assertEqual(res.headers["content-type"], "image/png");
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// networkRuleZipPath
// =============================================================================

test("networkRuleZipPath - strips http and prepends network/", () => {
    assertEqual(networkRuleZipPath("http://kongregate.com/category/games/tracker.swf"), "network/kongregate.com/category/games/tracker.swf");
});

test("networkRuleZipPath - strips https", () => {
    assertEqual(networkRuleZipPath("https://example.com/api/data.json"), "network/example.com/api/data.json");
});

test("networkRuleZipPath - preserves query string", () => {
    assertEqual(networkRuleZipPath("http://host.com/path?key=val"), "network/host.com/path?key=val");
});
