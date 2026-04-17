/**
 * Test helper: fetch a URL through WinInet to populate its disk cache.
 * This reproduces the bug where Flash Player serves a cached SWF from
 * the real internet, bypassing FlashpointProxy and our firmware injection.
 *
 * Usage: deno run --unstable-ffi --allow-ffi tests/poison-cache.ts <url>
 */

const url = Deno.args[0];
if (!url) {
    console.error("Usage: deno run --unstable-ffi --allow-ffi tests/poison-cache.ts <url>");
    Deno.exit(1);
}

const wininet = Deno.dlopen("wininet.dll", {
    InternetOpenW: { parameters: ["buffer", "u32", "pointer", "pointer", "u32"], result: "pointer" },
    InternetOpenUrlW: { parameters: ["pointer", "buffer", "pointer", "u32", "u32", "pointer"], result: "pointer" },
    InternetReadFile: { parameters: ["pointer", "buffer", "u32", "buffer"], result: "i32" },
    InternetCloseHandle: { parameters: ["pointer"], result: "i32" },
});

function toWide(s: string): Uint8Array<ArrayBuffer> {
    const buf = new Uint8Array(new ArrayBuffer((s.length + 1) * 2));
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        buf[i * 2] = c & 0xFF;
        buf[i * 2 + 1] = (c >> 8) & 0xFF;
    }
    return buf;
}

const INTERNET_OPEN_TYPE_PRECONFIG = 0;
const hInternet = wininet.symbols.InternetOpenW(toWide("RAFlash"), INTERNET_OPEN_TYPE_PRECONFIG, null, null, 0);
if (!hInternet) {
    console.error("InternetOpenW failed");
    Deno.exit(1);
}

const hUrl = wininet.symbols.InternetOpenUrlW(hInternet, toWide(url), null, 0, 0, null);
if (hUrl) {
    // Read the full response — WinInet only caches data that's actually read
    const readBuf = new Uint8Array(new ArrayBuffer(8192));
    const bytesRead = new Uint8Array(new ArrayBuffer(4));
    let totalBytes = 0;
    while (true) {
        const ok = wininet.symbols.InternetReadFile(hUrl, readBuf, readBuf.length, bytesRead);
        if (!ok) break;
        const n = new DataView(bytesRead.buffer).getUint32(0, true);
        if (n === 0) break;
        totalBytes += n;
    }
    wininet.symbols.InternetCloseHandle(hUrl);
    console.log(`Cached: ${url} (${totalBytes} bytes)`);
} else {
    console.error(`Failed to fetch: ${url}`);
}
wininet.symbols.InternetCloseHandle(hInternet);
