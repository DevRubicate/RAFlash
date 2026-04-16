/**
 * SitelockProxy Edge Case Tests (v0.0.19 release coverage)
 *
 * Additional integration tests for:
 *   - Multiple rules with different actions
 *   - File rules with various content types
 *   - Rule priority (first match wins)
 *   - Blocked requests (external request blocking)
 */

import { test, assertEqual } from "../../tests/framework.ts";
import { startSitelockProxy, stopSitelockProxy } from "../src/SitelockProxy.ts";

const TEST_PORT = 19877;

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
// Multiple rules: first matching active rule wins
// =============================================================================

test("proxy - first matching active rule wins", async () => {
    const rules = [
        { active: true, url: "http://api.example.com/data", status: 200, action: "text", body: "first" },
        { active: true, url: "http://api.example.com/data", status: 200, action: "text", body: "second" },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://api.example.com/data");
        const res = parseResponse(raw);
        assertEqual(res.status, 200);
        assertEqual(res.body, "first");
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// Mixed text and file rules for different URLs
// =============================================================================

test("proxy - mixed text and file rules on different URLs", async () => {
    const swfBytes = new Uint8Array([0x46, 0x57, 0x53]);
    const rules = [
        { active: true, url: "http://api.example.com/config", status: 200, action: "text", body: '{"key":"val"}' },
        { active: true, url: "http://cdn.example.com/asset.swf", status: 200, action: "file", body: "", fileBytes: swfBytes },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        // Text rule
        const raw1 = await proxyRequest("GET", "http://api.example.com/config");
        const res1 = parseResponse(raw1);
        assertEqual(res1.status, 200);
        assertEqual(res1.body, '{"key":"val"}');

        // File rule
        const raw2 = await proxyRequest("GET", "http://cdn.example.com/asset.swf");
        const res2 = parseResponse(raw2);
        assertEqual(res2.status, 200);
        assertEqual(res2.headers["content-type"], "application/x-shockwave-flash");
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// Custom status codes
// =============================================================================

test("proxy - 403 forbidden response", async () => {
    const rules = [
        { active: true, url: "http://tracking.example.com/pixel", status: 403, action: "text", body: "blocked" },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://tracking.example.com/pixel");
        const res = parseResponse(raw);
        assertEqual(res.status, 403);
        assertEqual(res.body, "blocked");
    } finally {
        stopSitelockProxy();
    }
});

test("proxy - 301 redirect status", async () => {
    const rules = [
        { active: true, url: "http://old.example.com/page", status: 301, action: "text", body: "moved" },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://old.example.com/page");
        const res = parseResponse(raw);
        assertEqual(res.status, 301);
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// All external requests are blocked (404)
// =============================================================================

test("proxy - different unknown hosts all return 404", async () => {
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => [],
    });

    try {
        const hosts = [
            "http://google.com/",
            "http://facebook.com/tracker",
            "http://cdn.random.net/script.js",
        ];
        for (const url of hosts) {
            const raw = await proxyRequest("GET", url);
            const res = parseResponse(raw);
            assertEqual(res.status, 404, `Expected 404 for ${url}`);
        }
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// Empty body rules
// =============================================================================

test("proxy - text rule with empty body", async () => {
    const rules = [
        { active: true, url: "http://api.example.com/empty", status: 204, action: "text", body: "" },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://api.example.com/empty");
        const res = parseResponse(raw);
        assertEqual(res.status, 204);
        assertEqual(res.body, "");
    } finally {
        stopSitelockProxy();
    }
});

// =============================================================================
// File rule content types
// =============================================================================

test("proxy - JSON file served with correct content type", async () => {
    const jsonBytes = new TextEncoder().encode('{"level":5}');
    const rules = [
        { active: true, url: "http://cdn.example.com/save.json", status: 200, action: "file", body: "", fileBytes: jsonBytes },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://cdn.example.com/save.json");
        const res = parseResponse(raw);
        assertEqual(res.headers["content-type"], "application/json");
    } finally {
        stopSitelockProxy();
    }
});

test("proxy - XML file served with correct content type", async () => {
    const xmlBytes = new TextEncoder().encode('<config/>');
    const rules = [
        { active: true, url: "http://cdn.example.com/config.xml", status: 200, action: "file", body: "", fileBytes: xmlBytes },
    ];
    startSitelockProxy({
        port: TEST_PORT,
        flashPort: 0,
        gameDomain: null,
        getNetworkRules: () => rules,
    });

    try {
        const raw = await proxyRequest("GET", "http://cdn.example.com/config.xml");
        const res = parseResponse(raw);
        assertEqual(res.headers["content-type"], "application/xml");
    } finally {
        stopSitelockProxy();
    }
});
