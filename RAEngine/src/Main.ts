/**
 * RAFlash Main Entry Point
 *
 * Unified Deno server that handles both AS2 (AVM1) and AS3 (AVM2) games.
 * Auto-detects the SWF version after file selection and launches the
 * appropriate firmware.
 *
 * Features:
 * - File picker for selecting game SWF
 * - Auto-detection of AS2 vs AS3 games (SWF version byte)
 * - F12 opens devtools menu
 * - Full devtools support (memory inspector, asset list, asset editor)
 * - Commands forwarded to firmware via XMLSocket (AVM1) or Socket (AVM2)
 *
 * Usage: deno run --allow-net --allow-run --allow-read --allow-write --allow-env Main.ts
 */

import { HTMLWindow } from "./HTMLWindow.ts";
import { JSONDiff, type Diff } from "./JSONDiff.ts";
import { Formula } from "./formula/Formula.ts";
import { AppData } from "./AppData.ts";
import { UserProfile } from "./UserProfile.ts";
import { WindowManager } from "./WindowManager.ts";
import type { Requirement } from "./types.ts";
import { join, SEPARATOR } from "https://deno.land/std/path/mod.ts";
import { Buffer } from "node:buffer";
import { PNG } from "npm:pngjs";
import jpeg from "npm:jpeg-js";
// @deno-types="npm:@types/pako"
import * as pako from "npm:pako";
import { startSitelockProxy, stopSitelockProxy } from "./SitelockProxy.ts";

// Helper to compile a requirement field based on its type
function compileRequirementField(req: Requirement, field: 'A' | 'B'): unknown[] {
    const address = (field === 'A' ? req.addressA : req.addressB) || '';

    // Always compile address as formula - this handles:
    // - Numeric literals like "50" → compiles to VALUE bytecode
    // - String literals like '"hello"' → compiles to STRING bytecode
    // - Formula expressions like "stage.player.health" → compiles to formula bytecode
    // Use '0' for empty to avoid unbalanced formula
    return Formula.compile(address || '0');
}

// Register watchers to compile formulas when addressA/addressB or typeA/typeB change
JSONDiff.watch(
    'assets/*/groups/*/requirements/*/addressA',
    (segments) => {
        const req = segments[segments.length - 2] as Requirement;
        req.compiledA = compileRequirementField(req, 'A');
    }
);

JSONDiff.watch(
    'assets/*/groups/*/requirements/*/addressB',
    (segments) => {
        const req = segments[segments.length - 2] as Requirement;
        req.compiledB = compileRequirementField(req, 'B');
    }
);

JSONDiff.watch(
    'assets/*/groups/*/requirements/*/typeA',
    (segments) => {
        const req = segments[segments.length - 2] as Requirement;
        req.compiledA = compileRequirementField(req, 'A');
    }
);

JSONDiff.watch(
    'assets/*/groups/*/requirements/*/typeB',
    (segments) => {
        const req = segments[segments.length - 2] as Requirement;
        req.compiledB = compileRequirementField(req, 'B');
    }
);

// Compile Rich Presence formula when it changes
JSONDiff.watch(
    'assets/*/formula',
    (segments) => {
        const asset = segments[segments.length - 2];
        if (asset && typeof asset === 'object' && !Array.isArray(asset)) {
            const rec = asset as Record<string, unknown>;
            if (rec.type === 'RICH_PRESENCE') {
                rec.compiledFormula = Formula.compile(String(rec.formula ?? '""'));
            }
        }
    }
);

const HTTP_PORT = 18080;
const FLASH_PORT = 18081;
const PROXY_PORT = 18082;
const RAFLASH_DOMAIN = "raflash.local"; // Fake domain for proxy routing (127.0.0.1 bypasses WinInet proxy)

// Sitelock bypass: set to a full URL to spoof the game's origin domain
// e.g. "http://www.coolmathgames.com/games/0-game.swf"
// Set to null for no domain spoofing (game loads from raflash.local)
const SITELOCK_URL: string | null = null;

// AVM mode configuration - set after game SWF is selected and version detected
interface AVMConfig {
    mode: "AVM1" | "AVM2";
    firmwareSwf: string;
    innerFirmwareSwf?: string; // AVM1 firmware loaded by AVM2 wrapper
    messageTerminator: string;
    patchFirmware: boolean;
    convertPngToJpeg: boolean;
}
let avmConfig: AVMConfig;

/**
 * Patch a firmware SWF's header with target frameRate and background color.
 * This allows games to run at their intended speed with correct colors.
 *
 * @param firmwareBytes - The firmware SWF bytes
 * @param targetFrameRate - The desired frame rate (e.g., 30)
 * @param targetBgColor - The background color as hex string (e.g., "#FFFFFF") or null to skip
 * @returns Patched SWF bytes (uncompressed)
 */
function patchFirmwareSwf(
    firmwareBytes: Uint8Array,
    targetFrameRate: number,
    targetBgColor: string | null,
    targetWidth: number,
    targetHeight: number,
    gameHidesMenuBar: boolean
): Uint8Array {
    // 1. Check if compressed (CWS = zlib, ZWS = lzma)
    const signature = String.fromCharCode(firmwareBytes[0], firmwareBytes[1], firmwareBytes[2]);

    if (signature === "ZWS") {
        console.warn("LZMA-compressed SWFs (ZWS) are not supported for patching");
        return firmwareBytes;
    }

    // 2. Get uncompressed data
    let data: Uint8Array;
    const isCompressed = signature === "CWS";

    if (isCompressed) {
        // Decompress: first 8 bytes are header, everything after is zlib-compressed
        const compressed = firmwareBytes.slice(8);
        const decompressed = pako.inflate(compressed);

        // Build uncompressed SWF: change CWS to FWS and combine
        data = new Uint8Array(8 + decompressed.length);
        data.set(firmwareBytes.slice(0, 8)); // Copy original header
        data[0] = 0x46; // 'F' - change CWS to FWS
        data.set(decompressed, 8);
    } else {
        data = new Uint8Array(firmwareBytes);
    }

    // 3. Rewrite RECT structure with game dimensions
    // Compensate for Flash Player's menu bar (20px) which fscommand("showmenu","false") removes.
    // Games that already hide the menu bar themselves don't need compensation.
    const menuBarCompensation = gameHidesMenuBar ? 0 : 20;
    // RECT format: [Nbits:5][Xmin:N][Xmax:N][Ymin:N][Ymax:N] (bit-packed)
    const xMaxTwips = targetWidth * 20;
    const yMaxTwips = (targetHeight - menuBarCompensation) * 20;
    // Nbits must hold the largest value (unsigned) plus a sign bit
    const maxVal = Math.max(xMaxTwips, yMaxTwips);
    const newNbits = maxVal > 0 ? Math.ceil(Math.log2(maxVal + 1)) + 1 : 1;

    // Parse old RECT to find where it ends
    const oldNbits = (data[8] >> 3) & 0x1F;
    const oldRectTotalBits = 5 + oldNbits * 4;
    const oldRectBytes = Math.ceil(oldRectTotalBits / 8);

    // Build new RECT bytes
    const newRectTotalBits = 5 + newNbits * 4;
    const newRectBytes = Math.ceil(newRectTotalBits / 8);
    const newRect = new Uint8Array(newRectBytes);

    // Helper to write bits into newRect
    const writeBits = (startBit: number, numBits: number, value: number) => {
        for (let i = 0; i < numBits; i++) {
            const bit = (value >> (numBits - 1 - i)) & 1;
            if (bit) {
                const byteIdx = Math.floor((startBit + i) / 8);
                const bitIdx = 7 - ((startBit + i) % 8);
                newRect[byteIdx] |= (1 << bitIdx);
            }
        }
    };

    writeBits(0, 5, newNbits);        // Nbits
    writeBits(5, newNbits, 0);        // Xmin = 0
    writeBits(5 + newNbits, newNbits, xMaxTwips);    // Xmax
    writeBits(5 + newNbits * 2, newNbits, 0);        // Ymin = 0
    writeBits(5 + newNbits * 3, newNbits, yMaxTwips); // Ymax

    // Rebuild data if RECT size changed
    const afterOldRect = 8 + oldRectBytes;
    const newData = new Uint8Array(8 + newRectBytes + (data.length - afterOldRect));
    newData.set(data.slice(0, 8));          // SWF header (signature + version + length)
    newData.set(newRect, 8);                // New RECT
    newData.set(data.slice(afterOldRect), 8 + newRectBytes); // Rest of SWF (frameRate, tags, etc.)

    // Update file length in header (bytes 4-7, little-endian)
    const newLength = newData.length;
    newData[4] = newLength & 0xFF;
    newData[5] = (newLength >> 8) & 0xFF;
    newData[6] = (newLength >> 16) & 0xFF;
    newData[7] = (newLength >> 24) & 0xFF;

    data = newData;
    const frameRateOffset = 8 + newRectBytes;

    // 4. Patch frameRate (8.8 fixed-point, little-endian)
    // Low byte = fraction (usually 0), high byte = integer part
    data[frameRateOffset] = 0; // fraction
    data[frameRateOffset + 1] = targetFrameRate; // integer

    // 5. Find and patch SetBackgroundColor tag (type 9) if color provided
    if (targetBgColor) {
        // Parse hex color: "#RRGGBB" or "RRGGBB"
        const colorHex = targetBgColor.replace('#', '');
        const r = parseInt(colorHex.substring(0, 2), 16);
        const g = parseInt(colorHex.substring(2, 4), 16);
        const b = parseInt(colorHex.substring(4, 6), 16);

        // Tags start after header: frameRate (2 bytes) + frameCount (2 bytes)
        const tagsOffset = frameRateOffset + 4;

        // Search for SetBackgroundColor tag (type 9)
        let offset = tagsOffset;
        while (offset < data.length - 2) {
            const tagCodeAndLength = data[offset] | (data[offset + 1] << 8);
            const tagType = tagCodeAndLength >> 6;
            let tagLength = tagCodeAndLength & 0x3F;

            // Extended length?
            let headerSize = 2;
            if (tagLength === 0x3F) {
                // Extended: next 4 bytes are the length
                tagLength = data[offset + 2] | (data[offset + 3] << 8) |
                           (data[offset + 4] << 16) | (data[offset + 5] << 24);
                headerSize = 6;
            }

            if (tagType === 9) {
                // SetBackgroundColor tag found! RGB follows the header
                data[offset + headerSize] = r;
                data[offset + headerSize + 1] = g;
                data[offset + headerSize + 2] = b;
                break;
            }

            if (tagType === 0) {
                // End tag - stop searching
                break;
            }

            offset += headerSize + tagLength;
        }
    }

    return data;
}

/**
 * Check if a SWF contains fscommand("showmenu") by scanning for the string.
 * Games that hide the menu bar themselves don't need menu bar height compensation.
 */
function swfHidesMenuBar(swfBytes: Uint8Array): boolean {
    // Decompress if needed to search actual content
    let data: Uint8Array;
    const sig = String.fromCharCode(swfBytes[0], swfBytes[1], swfBytes[2]);
    if (sig === "CWS") {
        try {
            const decompressed = pako.inflate(swfBytes.slice(8));
            data = new Uint8Array(8 + decompressed.length);
            data.set(swfBytes.slice(0, 8));
            data.set(decompressed, 8);
        } catch {
            data = swfBytes;
        }
    } else {
        data = swfBytes;
    }

    // Search for "FSCommand:showMenu" — the compiled form of fscommand("showmenu").
    // Case-insensitive on the "showMenu" part since Flash accepts any casing.
    const prefix = new TextEncoder().encode("FSCommand:");
    const suffix = [115, 104, 111, 119, 109, 101, 110, 117]; // "showmenu" lowercase
    const needleLen = prefix.length + suffix.length;
    for (let i = 0; i <= data.length - needleLen; i++) {
        let match = true;
        for (let j = 0; j < prefix.length; j++) {
            if (data[i + j] !== prefix[j]) { match = false; break; }
        }
        if (!match) continue;
        match = true;
        for (let j = 0; j < suffix.length; j++) {
            if ((data[i + prefix.length + j] | 0x20) !== suffix[j]) { match = false; break; }
        }
        if (match) return true;
    }
    return false;
}

/**
 * Parse SWF header to extract frameRate, backgroundColor, width, and height.
 * Handles both compressed (CWS) and uncompressed (FWS) SWFs.
 */
function parseSwfMetadata(swfBytes: Uint8Array): { frameRate: number; backgroundColor: string; width: number; height: number } {
    // Default values
    let frameRate = 30;
    let backgroundColor = "#FFFFFF";
    let width = 800;
    let height = 600;

    try {
        // Check signature
        const signature = String.fromCharCode(swfBytes[0], swfBytes[1], swfBytes[2]);

        let data: Uint8Array;
        if (signature === "CWS") {
            // Decompress zlib data (everything after byte 8)
            const compressed = swfBytes.slice(8);
            const decompressed = pako.inflate(compressed);
            // Build full uncompressed data (header + decompressed)
            data = new Uint8Array(8 + decompressed.length);
            data.set(swfBytes.slice(0, 8));
            data.set(decompressed, 8);
        } else if (signature === "FWS") {
            data = swfBytes;
        } else {
            console.warn(`Unknown SWF signature: ${signature}`);
            return { frameRate, backgroundColor, width, height };
        }

        // Parse RECT structure (bit-packed)
        // RECT starts at byte 8, first 5 bits = Nbits
        const rectNBits = (data[8] >> 3) & 0x1F;

        // Helper to read bits from byte array
        const readBits = (startBit: number, numBits: number): number => {
            let value = 0;
            for (let i = 0; i < numBits; i++) {
                const bitPos = startBit + i;
                const byteIndex = 8 + Math.floor(bitPos / 8);
                const bitIndex = 7 - (bitPos % 8);
                if (data[byteIndex] & (1 << bitIndex)) {
                    value |= (1 << (numBits - 1 - i));
                }
            }
            // Handle signed values (twips can be negative)
            if (numBits > 0 && (value & (1 << (numBits - 1)))) {
                value -= (1 << numBits);
            }
            return value;
        };

        // Read RECT values: Xmin, Xmax, Ymin, Ymax (each rectNBits bits, starting after 5-bit Nbits field)
        const xMin = readBits(5, rectNBits);
        const xMax = readBits(5 + rectNBits, rectNBits);
        const yMin = readBits(5 + rectNBits * 2, rectNBits);
        const yMax = readBits(5 + rectNBits * 3, rectNBits);

        // Convert from twips to pixels (20 twips = 1 pixel)
        width = Math.round((xMax - xMin) / 20);
        height = Math.round((yMax - yMin) / 20);

        const rectTotalBits = 5 + rectNBits * 4;
        const rectBytes = Math.ceil(rectTotalBits / 8);
        const frameRateOffset = 8 + rectBytes;

        // FrameRate is 8.8 fixed-point (2 bytes, little-endian)
        // Low byte = fraction, high byte = integer
        frameRate = data[frameRateOffset + 1]; // Just use integer part

        // Search for SetBackgroundColor tag (type 9)
        const tagsOffset = frameRateOffset + 4; // +2 frameRate, +2 frameCount
        let offset = tagsOffset;

        while (offset < data.length - 2) {
            const tagCodeAndLength = data[offset] | (data[offset + 1] << 8);
            const tagType = tagCodeAndLength >> 6;
            let tagLength = tagCodeAndLength & 0x3F;

            let headerSize = 2;
            if (tagLength === 0x3F) {
                tagLength = data[offset + 2] | (data[offset + 3] << 8) |
                           (data[offset + 4] << 16) | (data[offset + 5] << 24);
                headerSize = 6;
            }

            if (tagType === 9 && tagLength >= 3) {
                // SetBackgroundColor: RGB
                const r = data[offset + headerSize];
                const g = data[offset + headerSize + 1];
                const b = data[offset + headerSize + 2];
                backgroundColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
                break;
            }

            if (tagType === 0) break; // End tag
            offset += headerSize + tagLength;
        }
    } catch (err) {
        console.error(`parseSwfMetadata error: ${err}`);
    }

    return { frameRate, backgroundColor, width, height };
}

// Application state
enum AppState {
    FILE_PICKER,
    GAME_RUNNING,
}

let appState = AppState.FILE_PICKER;
let selectedGamePath: string | null = null;
let gameWindowWidth = 800;  // Will be updated from game SWF metadata
let gameWindowHeight = 600; // Will be updated from game SWF metadata
let fileSelectedResolver: ((result: { gamePath: string; user: string }) => void) | null = null;
let selectedUserName: string | null = null;
let httpServer: Deno.HttpServer | null = null;

// Flash socket connection and communication
let firmwareWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
let firmwareConnected = false;
const pendingRequests = new Map<string, (response: Record<string, unknown>) => void>();
let requestIdCounter = 0;

// Connected devtools WebSocket clients
const devtoolsClients: Set<WebSocket> = new Set();

// Map watcherId to the socket that started it (for routing watchResults)
const watcherSockets = new Map<string, WebSocket>();


// Window-specific params (for popup windows like asset-editor)
const windowParams = new Map<number, Record<string, unknown>>();

// Flash Player window management
let flashPlayerPid: number | null = null;
let flashProcess: Deno.ChildProcess | null = null;

// Rich Presence title updates
let lastRichPresenceTime = 0;
let richPresenceCheckInterval: number | null = null;

/**
 * Reset all game-specific state between sessions.
 * Called after a game closes before showing the file picker again.
 */
function resetGameState(): void {
    firmwareWriter = null;
    firmwareConnected = false;
    pendingRequests.clear();
    requestIdCounter = 0;
    watcherSockets.clear();
    windowParams.clear();
    flashPlayerPid = null;
    flashProcess = null;
    lastRichPresenceTime = 0;
    selectedGamePath = null;
    selectedUserName = null;
    appState = AppState.FILE_PICKER;
    AppData.data = { assets: [], codeNotes: [], gameConfig: { title: '', originUrl: '', badgeImage: '' } };
    AppData.gamePath = null;
    AppData.stateFilePath = null;
    AppData.gameHash = null;
    UserProfile.reset();
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
    return `req_${++requestIdCounter}_${Date.now()}`;
}

/**
 * Send a command to the firmware and wait for response
 */
async function sendToFirmware(command: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!firmwareWriter || !firmwareConnected) {
        return { success: false, error: "Firmware not connected" };
    }

    const id = generateRequestId();
    const message = JSON.stringify(["REQUEST", id, { command, params }]) + avmConfig.messageTerminator;

    return new Promise((resolve) => {
        // Set up timeout
        const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            resolve({ success: false, error: "Request timed out" });
        }, 30000);

        // Store resolver
        pendingRequests.set(id, (response) => {
            clearTimeout(timeout);
            pendingRequests.delete(id);
            resolve(response);
        });

        // Send request
        const encoder = new TextEncoder();
        firmwareWriter!.write(encoder.encode(message)).catch(() => {
            clearTimeout(timeout);
            pendingRequests.delete(id);
            resolve({ success: false, error: "Failed to send to firmware" });
        });
    });
}

/**
 * Send a message to a specific devtools client
 */
function sendToDevtools(client: WebSocket, type: string, data: Record<string, unknown> | Diff): void {
    if (client.readyState === WebSocket.OPEN) {
        try {
            client.send(JSON.stringify(["EVENT", type, data]) + "\n");
        } catch (e) {
            console.error("Failed to send to devtools client:", e);
        }
    }
}

/**
 * Broadcast a message to all connected devtools clients, optionally excluding one
 */
function broadcastToDevtools(type: string, data: Record<string, unknown> | Diff, excludeClient?: WebSocket): void {
    const message = JSON.stringify(["EVENT", type, data]) + "\n";
    for (const client of devtoolsClients) {
        if (client === excludeClient) continue;
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch {
                // Client disconnected
            }
        }
    }
}

/**
 * Open the devtools menu window
 */
async function openDevtoolsMenu(): Promise<void> {
    const windowId = Math.floor(Math.random() * 0xFFFFFF);
    await HTMLWindow.create("menu.html", 300, 600, windowId, undefined, 0, 0);
}

/**
 * Update Flash Player window title with Rich Presence
 */
function updateFlashPlayerTitle(richPresence: string): void {
    if (!flashPlayerPid) return;
    const title = richPresence ? `RAFlash - ${richPresence}` : "RAFlash";
    WindowManager.setWindowTitle(flashPlayerPid, title);
}

/**
 * Start the HTTP server for file picker, devtools UI, and WebSocket
 */
function startHttpServer() {
    httpServer = Deno.serve(
        {
            port: HTTP_PORT,
            onListen() {},
        },
        async (req: Request): Promise<Response> => {
            const url = new URL(req.url);

            // WebSocket upgrade
            if (url.pathname === "/ws") {
                const { socket, response } = Deno.upgradeWebSocket(req);

                socket.onopen = () => {
                    // Register as devtools client
                    devtoolsClients.add(socket);

                    // Send initial setup
                    const setupData: Record<string, unknown> = {
                        state: appState === AppState.GAME_RUNNING ? "game" : "picker",
                        appData: AppData.data,
                    };
                    socket.send(JSON.stringify(["SETUP", setupData]) + "\n");
                };

                socket.onclose = () => {
                    devtoolsClients.delete(socket);
                };

                socket.onmessage = async (event) => {
                    const segments = event.data.split("\n");
                    for (const segment of segments) {
                        if (!segment) continue;
                        try {
                            const data = JSON.parse(segment);
                            if (data[0] === "SETUP") {
                                continue;
                            }
                            if (data[0] === "REQUEST") {
                                const [, id, message] = data;
                                const response = await handleApiRequest(message, socket);
                                socket.send(JSON.stringify(["RESPONSE", id, response]) + "\n");
                            }
                        } catch (e) {
                            console.error("WebSocket message error:", e);
                        }
                    }
                };

                return response;
            }

            // Serve files
            try {
                // Special handling for firmware SWF - optionally patch with game settings
                if ((url.pathname === "/firmware.swf") && selectedGamePath && avmConfig) {
                    if (avmConfig.patchFirmware) {
                        const gameSwfBuffer = await Deno.readFile(selectedGamePath);
                        const gameMetadata = parseSwfMetadata(gameSwfBuffer);
                        const firmwareBytes = await Deno.readFile(avmConfig.firmwareSwf);
                        const patchedFirmware = patchFirmwareSwf(
                            firmwareBytes,
                            gameMetadata.frameRate,
                            gameMetadata.backgroundColor,
                            gameMetadata.width,
                            gameMetadata.height,
                            swfHidesMenuBar(gameSwfBuffer)
                        );
                        return new Response(new Uint8Array(patchedFirmware) as BodyInit, {
                            status: 200,
                            headers: { "Content-Type": "application/x-shockwave-flash" },
                        });
                    } else {
                        const firmwareBytes = await Deno.readFile(avmConfig.firmwareSwf);
                        return new Response(firmwareBytes, {
                            status: 200,
                            headers: { "Content-Type": "application/x-shockwave-flash" },
                        });
                    }
                }

                // Serve inner AVM1 firmware (loaded by AVM1Wrapper)
                if (url.pathname === "/avm1-firmware.swf" && avmConfig?.innerFirmwareSwf && selectedGamePath) {
                    const gameSwfBuffer = await Deno.readFile(selectedGamePath);
                    const gameMetadata = parseSwfMetadata(gameSwfBuffer);
                    const firmwareBytes = await Deno.readFile(avmConfig.innerFirmwareSwf);
                    const patchedFirmware = patchFirmwareSwf(
                        firmwareBytes,
                        gameMetadata.frameRate,
                        gameMetadata.backgroundColor,
                        gameMetadata.width,
                        gameMetadata.height,
                        swfHidesMenuBar(gameSwfBuffer)
                    );
                    return new Response(new Uint8Array(patchedFirmware) as BodyInit, {
                        status: 200,
                        headers: { "Content-Type": "application/x-shockwave-flash" },
                    });
                }

                // Serve favicon from assets directory
                if (url.pathname === "/favicon.png") {
                    const icon = await Deno.readFile("assets/icon.png");
                    return new Response(icon, {
                        status: 200,
                        headers: { "Content-Type": "image/png" },
                    });
                }

                let filePath = "";

                if (url.pathname === "/firmware.swf" && avmConfig) {
                    filePath = avmConfig.firmwareSwf;
                } else if (url.pathname === "/game.swf" && selectedGamePath) {
                    filePath = selectedGamePath;
                } else {
                    // Serve from assets directory for UI
                    filePath = join("internals", "assets", url.pathname.substring(1));
                }

                const file = await Deno.readFile(filePath);
                const extension = filePath.split(".").pop() || "";
                const mimeTypes: Record<string, string> = {
                    html: "text/html",
                    css: "text/css",
                    js: "application/javascript",
                    swf: "application/x-shockwave-flash",
                    json: "application/json",
                    png: "image/png",
                    jpg: "image/jpeg",
                };
                const contentType = mimeTypes[extension] || "application/octet-stream";

                return new Response(file, {
                    status: 200,
                    headers: { "Content-Type": contentType },
                });
            } catch (error) {
                if (error instanceof Deno.errors.NotFound) {
                    return new Response("File not found", { status: 404 });
                }
                console.error("HTTP error:", error);
                return new Response("Internal Server Error", { status: 500 });
            }
        }
    );
}

/**
 * Handle API requests from file picker and devtools
 */
async function handleApiRequest(
    input: { command: string; params: Record<string, unknown> },
    senderSocket: WebSocket
): Promise<Record<string, unknown>> {
    switch (input.command) {
        // File picker commands
        case "getDirectoryInfo": {
            return {
                success: true,
                params: { currentDirectory: Deno.cwd().split(SEPARATOR) },
            };
        }
        case "readDirectory": {
            const path = String(input.params.path || ".");
            try {
                const entries = Array.from(Deno.readDirSync(path)).map((entry: Deno.DirEntry) => ({
                    name: entry.name,
                    type: entry.isDirectory ? "directory" : "file",
                }));
                return { success: true, params: entries };
            } catch (e) {
                console.error("readDirectory error:", e);
                return { success: false, error: "Failed to read directory" };
            }
        }
        case "selectFile": {
            const path = String(input.params.path);
            const user = String(input.params.user || "");
            selectedGamePath = path;
            if (fileSelectedResolver) {
                fileSelectedResolver({ gamePath: path, user });
            }
            return { success: true };
        }
        case "listUsers": {
            const users = await UserProfile.listUsers();
            return { success: true, params: { users } };
        }
        case "createUser": {
            const name = String(input.params.name || "");
            await UserProfile.createUser(name);
            return { success: true };
        }

        // Devtools commands - forward to firmware
        case "evaluate": {
            // Compile the input string to bytecode
            const compiled = Formula.compile(String(input.params.input || ""));
            const response = await sendToFirmware("evaluate", { formula: compiled });
            // Wrap firmware response in params to match frontend expectations
            return { success: response.success, params: response };
        }
        case "evaluateMultiple": {
            // Compile all input strings to bytecode
            const inputs = (input.params.inputs || []) as string[];
            const compiled = inputs.map(inp => Formula.compile(inp || ""));
            const response = await sendToFirmware("evaluateMultiple", { formulas: compiled });
            return { success: response.success, params: response };
        }
        case "getRichPresenceResult": {
            const response = await sendToFirmware("getRichPresenceResult", {
                assetId: input.params.assetId
            });
            return { success: response.success, params: response };
        }
        case "searchTargetForValue": {
            const pathString = String(input.params.path || "");
            const compiledPath = pathString ? Formula.compile(pathString) : null;
            const response = await sendToFirmware("searchTargetForValue", {
                value: input.params.value,
                pathFormula: compiledPath,
                pathString: pathString,
                searchMode: input.params.searchMode || "value"
            });
            // Wrap firmware response in params to match frontend expectations
            return { success: response.success, params: response };
        }
        case "editData": {
            // Apply changes and trigger watchers (e.g., formula compilation)
            if (input.params) {
                const incomingDiff = input.params as Diff;
                const { fullDiff, derivedDiff } = JSONDiff.processIncomingDiff(AppData.data, incomingDiff);

                // Update _modified flags for affected saved assets and track changes
                const assets = AppData.data.assets;
                const modifiedFlagChanges: Array<[string, unknown]> = [];
                for (let i = 0; i < assets.length; i++) {
                    const asset = assets[i];
                    if (asset._saved) {
                        const oldModified = asset._modified;
                        AppData.updateModifiedFlag(asset);
                        if (asset._modified !== oldModified) {
                            modifiedFlagChanges.push([`assets/${i}/_modified`, asset._modified]);
                        }
                    }
                }

                // Broadcast fullDiff to OTHER devtools clients (not the sender) - do this FIRST for instant UI updates
                broadcastToDevtools("editData", fullDiff, senderSocket);

                // Forward the full diff (including watcher-generated changes) to firmware (don't await - let it process async)
                sendToFirmware("editData", { changes: fullDiff });

                // Broadcast _modified flag changes to ALL clients (including sender)
                if (modifiedFlagChanges.length > 0) {
                    broadcastToDevtools("editData", { edited: modifiedFlagChanges });
                }

                // Send derivedDiff (watcher changes only) back to the sender
                if (derivedDiff.edited && derivedDiff.edited.length > 0) {
                    sendToDevtools(senderSocket, "editData", derivedDiff);
                }

                // Auto-save for Code Notes and Game Config
                const hasCodeNotesChanges = incomingDiff.edited?.some(
                    ([path]) => path.startsWith('codeNotes')
                );
                const hasGameConfigChanges = incomingDiff.edited?.some(
                    ([path]) => path.startsWith('gameConfig')
                );
                if (hasCodeNotesChanges || hasGameConfigChanges) {
                    await AppData.saveData();
                }

                // NOTE: Asset changes are NOT auto-saved. Use saveAssets command for explicit saves.

                return { success: true };
            }

            return { success: true };
        }
        case "setup": {
            // Devtools requesting current app data
            const currentData = AppData.data;
            const windowId = input.params.windowId as number;
            const storedParams = windowParams.get(windowId) || {};

            return {
                success: true,
                params: {
                    data: currentData,
                    params: storedParams,
                },
            };
        }
        case "initializeData": {
            // Send current app data to firmware
            const response = await sendToFirmware("setup", { data: AppData.data, gameUrl: SITELOCK_URL });
            return response;
        }
        case "getData": {
            const response = await sendToFirmware("getData", {});
            return response;
        }
        case "ping": {
            const response = await sendToFirmware("ping", {});
            return response;
        }
        case "showToast": {
            const response = await sendToFirmware("showToast", {
                title: input.params.title,
                description: input.params.description,
                label: input.params.label,
                align: input.params.align,
            });
            return response;
        }
        case "showMeasure": {
            const response = await sendToFirmware("showMeasure", {
                title: input.params.title || "",
                description: input.params.description || "",
                progress: input.params.progress || "1/5",
                imageUrl: input.params.imageUrl || "",
            });
            return response;
        }

        // Window management
        case "openWindow": {
            const windowName = String(input.params.name);
            const width = Number(input.params.width) || 800;
            const height = Number(input.params.height) || 600;
            const windowId = Math.floor(Math.random() * 0xFFFFFF);
            const parentWindowId = input.params.parentWindowId as number | undefined;
            await HTMLWindow.create(`${windowName}.html`, width, height, windowId, parentWindowId);
            return { success: true };
        }
        case "showPopup": {
            const url = String(input.params.url);
            const width = Number(input.params.width) || 800;
            const height = Number(input.params.height) || 600;
            const windowId = Math.floor(Math.random() * 0xFFFFFF);
            const parentWindowId = input.params.parentWindowId as number | undefined;

            // Store params for this window (e.g., selectedAssetId for asset-editor)
            if (input.params.params) {
                const params = input.params.params;
                windowParams.set(windowId, (typeof params === 'object' && params !== null) ? params as Record<string, unknown> : {});
            }

            // Extract just the HTML filename from the URL path
            const htmlFile = url.split("/").pop() || url;
            await HTMLWindow.create(htmlFile, width, height, windowId, parentWindowId);
            return { success: true };
        }

        // Asset persistence commands
        case "saveAssets": {
            const ids = input.params?.ids as number[] | undefined;
            const savedIds = await AppData.saveAssets(ids);

            // Broadcast updated _saved/_modified flags to all clients
            const assets = AppData.data.assets;
            const flagUpdates: Array<[string, unknown]> = [];
            for (let i = 0; i < assets.length; i++) {
                const asset = assets[i];
                if (savedIds.includes(asset.id)) {
                    flagUpdates.push([`assets/${i}[]/_saved`, asset._saved]);
                    flagUpdates.push([`assets/${i}[]/_modified`, asset._modified]);
                }
            }

            if (flagUpdates.length > 0) {
                const diff = { edited: flagUpdates };
                await sendToFirmware("editData", { changes: diff });
                broadcastToDevtools("editData", diff);
            }

            return { success: true, params: { savedIds } };
        }

        case "resetAssets": {
            const ids = input.params?.ids as number[];
            if (!ids || ids.length === 0) {
                return { success: false, error: "No asset IDs provided" };
            }

            const { resetIds, restoredAssets } = await AppData.resetAssets(ids);

            if (resetIds.length > 0) {
                // Build diff to broadcast the restored assets
                const assets = AppData.data.assets;
                const resetDiff: Array<[string, unknown]> = [];

                for (const restoredAsset of restoredAssets) {
                    const idx = assets.findIndex(a => a.id === restoredAsset.id);
                    if (idx !== -1) {
                        resetDiff.push([`assets/${idx}[]`, restoredAsset]);
                    }
                }

                if (resetDiff.length > 0) {
                    const diff = { edited: resetDiff };
                    await sendToFirmware("editData", { changes: diff });
                    broadcastToDevtools("editData", diff);
                }
            }

            return { success: true, params: { resetIds } };
        }

        case "deleteAssets": {
            const ids = input.params?.ids as number[];
            if (!ids || ids.length === 0) {
                return { success: false, error: "No asset IDs provided" };
            }

            const { deletedIds } = await AppData.deleteAssets(ids);

            if (deletedIds.length > 0) {
                // Broadcast the deletion - send the new assets array
                const diff: Diff = { edited: [["assets", AppData.data.assets]] };
                await sendToFirmware("editData", { changes: diff });
                broadcastToDevtools("editData", diff);
            }

            return { success: true, params: { deletedIds } };
        }

        case "setRuntimeSetting": {
            // Forward runtime settings to firmware (keepActive, processingActive)
            await sendToFirmware("setRuntimeSetting", input.params);
            return { success: true };
        }

        // Memory Watch commands
        case "startWatch": {
            const watcherId = String(input.params.watcherId);
            const formula = String(input.params.formula || "");
            const compiled = Formula.compile(formula);

            // Track which socket started this watcher
            watcherSockets.set(watcherId, senderSocket);

            // Forward to firmware
            await sendToFirmware("startWatch", { watcherId, bytecode: compiled });
            return { success: true };
        }

        case "stopWatch": {
            const watcherId = String(input.params.watcherId);

            // Remove socket tracking
            watcherSockets.delete(watcherId);

            // Forward to firmware
            await sendToFirmware("stopWatch", { watcherId });
            return { success: true };
        }

        default:
            return { success: false, error: `Unknown command: ${input.command}` };
    }
}

/**
 * Show file picker and wait for selection.
 * Returns null if the user closes the window without selecting a file.
 */
async function showFilePicker(): Promise<{ gamePath: string; user: string } | null> {
    const windowId = Math.floor(Math.random() * 0xFFFFFF);
    await HTMLWindow.create("file-picker.html", 800, 500, windowId);

    return Promise.race([
        new Promise<{ gamePath: string; user: string }>((resolve) => { fileSelectedResolver = resolve; }),
        HTMLWindow.waitForAnyClose().then(() => null)
    ]);
}

/**
 * Start the Flash socket server (XMLSocket for AVM1, Socket for AVM2)
 */
async function startFlashServer(): Promise<void> {
    const listener = Deno.listen({ port: FLASH_PORT });

    // Flash socket policy file
    const POLICY_FILE = '<?xml version="1.0"?><cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\0';

    // Serve policy on port 843 (Flash's default policy port) to avoid ~3s timeout
    try {
        const policyListener = Deno.listen({ port: 843 });
        const encoder = new TextEncoder();
        (async () => {
            for await (const conn of policyListener) {
                try {
                    const writer = conn.writable.getWriter();
                    await writer.write(encoder.encode(POLICY_FILE));
                    writer.releaseLock();
                    conn.close();
                } catch { /* connection closed before write */ }
            }
        })();
    } catch {
        // Port 843 unavailable (e.g. needs elevated privileges) — Flash falls back to target port
    }

    for await (const conn of listener) {
        handleFlashConnection(conn, POLICY_FILE);
    }
}

/**
 * Handle a Flash connection
 */
async function handleFlashConnection(conn: Deno.Conn, policyFile: string): Promise<void> {
    // Disable Nagle's algorithm for immediate message delivery
    if ("setNoDelay" in conn) {
        (conn as Deno.TcpConn).setNoDelay(true);
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let httpBuffer = "";
    let isXMLSocket = false;

    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();

    try {
        const { done, value } = await reader.read();
        if (done) return;

        httpBuffer = decoder.decode(value);
        // HTTP request for firmware SWF
        if (httpBuffer.startsWith("GET /firmware.swf")) {
            let swfData: Uint8Array;
            if (avmConfig.patchFirmware) {
                const gameSwfBuffer = await Deno.readFile(selectedGamePath!);
                const gameMetadata = parseSwfMetadata(gameSwfBuffer);
                const firmwareBytes = await Deno.readFile(avmConfig.firmwareSwf);
                swfData = patchFirmwareSwf(firmwareBytes, gameMetadata.frameRate, gameMetadata.backgroundColor, gameMetadata.width, gameMetadata.height, swfHidesMenuBar(gameSwfBuffer));
            } else {
                swfData = await Deno.readFile(avmConfig.firmwareSwf);
            }

            const response = [
                "HTTP/1.1 200 OK",
                "Content-Type: application/x-shockwave-flash",
                `Content-Length: ${swfData.length}`,
                "Connection: close",
                "",
                "",
            ].join("\r\n");
            await writer.write(encoder.encode(response));
            await writer.write(swfData);
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return;
        }

        // HTTP request for inner AVM1 firmware (loaded by AVM1Wrapper)
        if (httpBuffer.startsWith("GET /avm1-firmware.swf") && avmConfig.innerFirmwareSwf) {
            const gameSwfBuffer = await Deno.readFile(selectedGamePath!);
            const gameMetadata = parseSwfMetadata(gameSwfBuffer);
            const firmwareBytes = await Deno.readFile(avmConfig.innerFirmwareSwf);
            const swfData = patchFirmwareSwf(firmwareBytes, gameMetadata.frameRate, gameMetadata.backgroundColor, gameMetadata.width, gameMetadata.height, swfHidesMenuBar(gameSwfBuffer));

            const response = [
                "HTTP/1.1 200 OK",
                "Content-Type: application/x-shockwave-flash",
                `Content-Length: ${swfData.length}`,
                "Connection: close",
                "",
                "",
            ].join("\r\n");
            await writer.write(encoder.encode(response));
            await writer.write(swfData);
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return;
        }

        // HTTP request for game SWF
        if (httpBuffer.startsWith("GET /game.swf")) {
            const swfData = await Deno.readFile(selectedGamePath!);
            const response = [
                "HTTP/1.1 200 OK",
                "Content-Type: application/x-shockwave-flash",
                `Content-Length: ${swfData.length}`,
                "Connection: close",
                "",
                "",
            ].join("\r\n");
            await writer.write(encoder.encode(response));
            await writer.write(swfData);
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return;
        }

        // HTTP request for asset badge image
        if (httpBuffer.startsWith("GET /asset-image/")) {
            const match = httpBuffer.match(/GET \/asset-image\/(-?\d+)/);
            if (match) {
                const assetId = parseInt(match[1], 10);
                const assets = AppData.data.assets as Array<Record<string, unknown>>;
                const asset = assets.find(a => a.id === assetId);

                if (asset?.badgeImage) {
                    // badgeImage is "data:image/png;base64,..." or "data:image/jpeg;base64,..."
                    const dataUri = asset.badgeImage as string;
                    const mimeMatch = dataUri.match(/^data:([^;]+);base64,/);
                    let mimeType = mimeMatch ? mimeMatch[1] : "image/png";
                    const base64Data = dataUri.split(',')[1];

                    // Decode base64 using Deno's standard decoding
                    const binaryString = atob(base64Data);
                    let imageBytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        imageBytes[i] = binaryString.charCodeAt(i);
                    }

                    // Convert PNG to JPEG for AVM1 Flash compatibility
                    // Flash AS2 MovieClipLoader has issues with certain PNG formats
                    if (avmConfig.convertPngToJpeg && mimeType === "image/png") {
                        try {
                            const png = PNG.sync.read(Buffer.from(imageBytes));

                            // PNG may have alpha channel - composite onto white background
                            const rgbData = new Uint8Array(png.width * png.height * 4);
                            for (let i = 0; i < png.width * png.height; i++) {
                                const srcIdx = i * 4;
                                const alpha = png.data[srcIdx + 3] / 255;
                                // Composite onto white background
                                rgbData[srcIdx] = Math.round(png.data[srcIdx] * alpha + 255 * (1 - alpha));
                                rgbData[srcIdx + 1] = Math.round(png.data[srcIdx + 1] * alpha + 255 * (1 - alpha));
                                rgbData[srcIdx + 2] = Math.round(png.data[srcIdx + 2] * alpha + 255 * (1 - alpha));
                                rgbData[srcIdx + 3] = 255;
                            }

                            const jpegData = jpeg.encode({
                                data: rgbData,
                                width: png.width,
                                height: png.height
                            }, 90);

                            imageBytes = new Uint8Array(jpegData.data);
                            mimeType = "image/jpeg";
                        } catch (e) {
                            console.error("PNG to JPEG conversion failed:", e);
                            // Fall back to serving original PNG
                        }
                    }

                    const response = [
                        "HTTP/1.1 200 OK",
                        `Content-Type: ${mimeType}`,
                        `Content-Length: ${imageBytes.length}`,
                        "Connection: close",
                        "",
                        "",
                    ].join("\r\n");
                    await writer.write(encoder.encode(response));
                    await writer.write(imageBytes);
                } else {
                    await writer.write(encoder.encode("HTTP/1.1 404 Not Found\r\n\r\n"));
                }
                writer.releaseLock();
                reader.releaseLock();
                conn.close();
                return;
            }
        }

        // HTTP request for game badge image
        if (httpBuffer.startsWith("GET /game-image")) {
            const gameConfig = AppData.data.gameConfig;
            if (gameConfig?.badgeImage) {
                const dataUri = gameConfig.badgeImage as string;
                const mimeMatch = dataUri.match(/^data:([^;]+);base64,/);
                let mimeType = mimeMatch ? mimeMatch[1] : "image/png";
                const base64Data = dataUri.split(',')[1];

                const binaryString = atob(base64Data);
                let imageBytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    imageBytes[i] = binaryString.charCodeAt(i);
                }

                if (avmConfig.convertPngToJpeg && mimeType === "image/png") {
                    try {
                        const png = PNG.sync.read(Buffer.from(imageBytes));
                        const rgbData = new Uint8Array(png.width * png.height * 4);
                        for (let i = 0; i < png.width * png.height; i++) {
                            const srcIdx = i * 4;
                            const alpha = png.data[srcIdx + 3] / 255;
                            rgbData[srcIdx] = Math.round(png.data[srcIdx] * alpha + 255 * (1 - alpha));
                            rgbData[srcIdx + 1] = Math.round(png.data[srcIdx + 1] * alpha + 255 * (1 - alpha));
                            rgbData[srcIdx + 2] = Math.round(png.data[srcIdx + 2] * alpha + 255 * (1 - alpha));
                            rgbData[srcIdx + 3] = 255;
                        }
                        const jpegData = jpeg.encode({ data: rgbData, width: png.width, height: png.height }, 90);
                        imageBytes = new Uint8Array(jpegData.data);
                        mimeType = "image/jpeg";
                    } catch (e) {
                        console.error("PNG to JPEG conversion failed:", e);
                    }
                }

                const response = [
                    "HTTP/1.1 200 OK",
                    `Content-Type: ${mimeType}`,
                    `Content-Length: ${imageBytes.length}`,
                    "Connection: close",
                    "",
                    "",
                ].join("\r\n");
                await writer.write(encoder.encode(response));
                await writer.write(imageBytes);
            } else {
                await writer.write(encoder.encode("HTTP/1.1 404 Not Found\r\n\r\n"));
            }
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return;
        }

        // Policy file request
        if (httpBuffer.includes("<policy-file-request/>")) {
            await writer.write(encoder.encode(policyFile));
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
            return;
        }

        // Socket connection from firmware
        isXMLSocket = true;
        firmwareWriter = writer;
        firmwareConnected = true;
        // Send app data to firmware (don't await - would deadlock before read loop starts)
        sendToFirmware("setup", { data: AppData.data, gameUrl: SITELOCK_URL }).catch(() => {});

        // Process initial data
        if (httpBuffer.trim()) {
            handleFirmwareData(httpBuffer);
        }

        // Read messages
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const data = decoder.decode(value);
            handleFirmwareData(data);
        }
    } catch (e) {
        if (isXMLSocket) {
            console.error(`XMLSocket error: ${e}`);
        }
    } finally {
        if (isXMLSocket) {
            firmwareConnected = false;
            firmwareWriter = null;
        }
        try {
            writer.releaseLock();
            reader.releaseLock();
            conn.close();
        } catch {
            // Already closed
        }
    }
}

/**
 * Handle incoming data from firmware
 */
function handleFirmwareData(data: string): void {
    const messages = data.split(avmConfig.messageTerminator);
    for (const msg of messages) {
        if (!msg.trim()) continue;
        try {
            const parsed = JSON.parse(msg);

            // Handle response to our requests
            if (Array.isArray(parsed) && parsed[0] === "RESPONSE") {
                const [, id, response] = parsed;
                const resolver = pendingRequests.get(id);
                if (resolver) {
                    resolver((typeof response === 'object' && response !== null) ? response as Record<string, unknown> : { raw: response });
                }
                continue;
            }

            // Handle unsolicited messages from firmware
            if (parsed.type === "log") {
                // Firmware log message
                console.log(`[FIRMWARE] ${parsed.data?.message || JSON.stringify(parsed.data)}`)
            } else if (parsed.type === "gameLoaded") {
                // Show welcome toast with game info
                const gameTitle = AppData.data.gameConfig?.title || "Game Loaded";
                const assetCount = AppData.data.assets.length;
                let description: string;
                if (UserProfile.currentName && AppData.gameHash) {
                    const unlocked = UserProfile.getUnlockedIds(AppData.gameHash).length;
                    description = assetCount === 0 ? "No achievements" : `${unlocked} of ${assetCount} achievements unlocked`;
                } else {
                    description = assetCount === 0 ? "No achievements" : `${assetCount} achievement${assetCount === 1 ? "" : "s"}`;
                }
                const imageUrl = AppData.data.gameConfig?.badgeImage ? "http://raflash.local/game-image" : "";
                sendToFirmware("showToast", {
                    title: gameTitle,
                    description,
                    label: "",
                    align: "right",
                    imageUrl,
                }).catch(() => {});
            } else if (parsed.type === "keypress") {
                // F12 key pressed - open devtools
                if (parsed.data?.keyCode === 123) {
                    openDevtoolsMenu();
                }
            } else if (parsed.type === "editData") {
                // Process firmware changes and propagate to all devtools
                const changes = parsed.data?.changes || parsed.data;
                if (changes) {
                    const { fullDiff, derivedDiff } = JSONDiff.processIncomingDiff(AppData.data, changes as Diff);

                    // Record achievement unlocks to user profile
                    if (UserProfile.currentName && AppData.gameHash && fullDiff.edited) {
                        for (const [path, value] of fullDiff.edited) {
                            const match = path.match(/^assets\/(\d+)\/state$/);
                            if (match && value === "TRIGGERED") {
                                const index = parseInt(match[1]);
                                const asset = AppData.data.assets[index];
                                if (asset) {
                                    UserProfile.recordUnlock(AppData.gameHash, asset.id);
                                }
                            }
                        }
                        UserProfile.saveUser();
                    }

                    // Broadcast fullDiff to all devtools clients
                    broadcastToDevtools("editData", fullDiff);

                    // Send derivedDiff (watcher changes only) back to firmware
                    if (derivedDiff.edited && derivedDiff.edited.length > 0) {
                        sendToFirmware("editData", { changes: derivedDiff }).catch(() => {});
                    }

                    // Persist changes to disk
                    AppData.saveData();
                }
            } else if (parsed.type === "syncState") {
                // Firmware reconnected - its state is authoritative
                const firmwareData = parsed.data?.appData;
                if (firmwareData) {
                    const diff = JSONDiff.getDataDiff(AppData.data, firmwareData);
                    if (!JSONDiff.isPointlessDiff(diff)) {
                        JSONDiff.applyDataDiff(AppData.data, diff);
                        broadcastToDevtools("editData", diff);
                        AppData.saveData();
                    }
                    console.log("[FIRMWARE] State synced after reconnect");
                }
            } else if (parsed.type === "watchResults") {
                // Forward watch results to the socket that started the watcher
                const watcherId = String(parsed.data?.watcherId);
                const socket = watcherSockets.get(watcherId);
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify(["EVENT", "watchResults", parsed.data]) + "\n");
                }
            } else if (parsed.type === "richPresenceUpdate") {
                // Update Flash Player window title with Rich Presence result
                const result = (parsed.data?.result as string) ?? "";
                lastRichPresenceTime = Date.now();
                updateFlashPlayerTitle(result);
            } else if (parsed.type === "profiling") {
                // Print profiling data from firmware
                const profData = parsed.data as {
                    achievements: Record<string, { name: string; totalMs: number; evalCount: number }>;
                    stage: { directProps: number; movieClips: number; totalProps: number };
                    optimization: { objAccessOptimized: number; objAccessGeneric: number; arrAccessOptimized: number; arrAccessGeneric: number };
                    timing: { totalFrameTimeMs: number; diffOpsTimeMs: number; stageCountTimeMs: number; frameCount: number };
                };

                console.log("\n=== Achievement Profiling (last 5s) ===");
                const t = profData.timing;
                console.log(`Frames: ${t.frameCount} | Total: ${t.totalFrameTimeMs}ms | Diff: ${t.diffOpsTimeMs}ms | StageCount: ${t.stageCountTimeMs}ms`);
                console.log(`Stage: ${profData.stage.directProps} direct props, ${profData.stage.movieClips} MovieClips, ${profData.stage.totalProps} total props (depth 3)`);
                const opt = profData.optimization;
                console.log(`ObjAccess: ${opt.objAccessOptimized} optimized, ${opt.objAccessGeneric} generic | ArrAccess: ${opt.arrAccessOptimized} optimized, ${opt.arrAccessGeneric} generic`);
                console.log("---");
                for (const [id, info] of Object.entries(profData.achievements)) {
                    const avgMs = info.totalMs / info.evalCount;
                    console.log(`  ${info.name}: ${info.totalMs.toFixed(1)}ms total, ${info.evalCount} evals, ${avgMs.toFixed(2)}ms avg`);
                }
                console.log("");
            }
            // Other message types ignored
        } catch {
            // Parse error, ignore malformed messages
        }
    }
}

/**
 * Launch Flash Player with firmware
 */
function launchFlashPlayer(): Deno.ChildProcess {
    const fpPath = `${Deno.cwd()}/vendor/adobe/fp-32.0.0.380.exe`;
    // Note: cwd is .build/ during development (make run) and the exe's directory when distributed
    const firmwareUrl = `http://${RAFLASH_DOMAIN}/firmware.swf`;

    const command = new Deno.Command(fpPath, {
        args: [firmwareUrl],
        cwd: Deno.cwd(),
    });
    return command.spawn();
}

/**
 * Main entry point
 */
async function main(): Promise<void> {

    // Verify both firmwares exist (we don't know which we'll need until game is selected)
    for (const fw of ["firmware/AVM1.swf", "firmware/AVM2.swf"]) {
        try {
            await Deno.stat(fw);
        } catch {
            console.error(`ERROR: Firmware SWF not found: ${fw}`);
            console.error("Run 'make' first to build both firmwares");
            Deno.exit(1);
        }
    }

    // 1. Start HTTP server (persists across game sessions)
    startHttpServer();

    // 2. Start Flash socket server in background (persists across game sessions)
    startFlashServer();

    // 3. Handle Ctrl+C (registered once, references module-level state)
    Deno.addSignalListener("SIGINT", async () => {
        if (richPresenceCheckInterval) {
            clearInterval(richPresenceCheckInterval);
        }
        stopSitelockProxy();
        try {
            flashProcess?.kill();
        } catch {
            // Already exited
        }
        await HTMLWindow.shutdown();
        Deno.exit(0);
    });

    // 4. Game loop: file picker → game → cleanup → repeat
    while (true) {
        const pickerResult = await showFilePicker();

        // User closed file picker without selecting → exit
        if (!pickerResult) {
            await HTMLWindow.shutdown();
            Deno.exit(0);
        }

        const { gamePath, user } = pickerResult;

        // Close file picker window
        await HTMLWindow.shutdown();

        // Resolve the game path (handle relative paths)
        let resolvedGamePath = gamePath;
        if (gamePath.startsWith("./") || gamePath.startsWith(".\\")) {
            resolvedGamePath = join(Deno.cwd(), gamePath.substring(2));
        } else if (!gamePath.includes(":") && !gamePath.startsWith("/")) {
            resolvedGamePath = join(Deno.cwd(), gamePath);
        }

        // Verify game file exists
        try {
            await Deno.stat(resolvedGamePath);
        } catch {
            console.error(`ERROR: Game SWF not found: ${resolvedGamePath}`);
            continue; // Back to file picker
        }

        selectedGamePath = resolvedGamePath;

        // Parse game SWF to get window dimensions and detect AVM version
        const gameSwfBuffer = await Deno.readFile(resolvedGamePath);
        const gameMetadata = parseSwfMetadata(gameSwfBuffer);
        gameWindowWidth = gameMetadata.width;
        gameWindowHeight = gameMetadata.height;

        const swfVersion = gameSwfBuffer[3];
        avmConfig = swfVersion >= 9
            ? { mode: "AVM2", firmwareSwf: "firmware/AVM2.swf", messageTerminator: "\n", patchFirmware: true, convertPngToJpeg: false }
            : { mode: "AVM1", firmwareSwf: "firmware/AVM1Wrapper.swf", innerFirmwareSwf: "firmware/AVM1.swf", messageTerminator: "\0", patchFirmware: true, convertPngToJpeg: true };

        // Load game-specific state (identified by MD5 hash of SWF)
        await AppData.setGamePath(resolvedGamePath);
        await AppData.loadData();

        // Load user and apply previously unlocked achievements
        selectedUserName = user;
        await UserProfile.loadUser(user);
        const unlockedIds = UserProfile.getUnlockedIds(AppData.gameHash!);
        for (const asset of AppData.data.assets) {
            if (unlockedIds.includes(asset.id)) {
                asset.state = "TRIGGERED";
            }
        }

        // Start sitelock proxy
        await Deno.writeTextFile(join(Deno.cwd(), "proxy.txt"), "1");
        await Deno.writeTextFile(join(Deno.cwd(), "port.txt"), String(PROXY_PORT));
        const sitelockDomain = SITELOCK_URL ? new URL(SITELOCK_URL).hostname : null;
        startSitelockProxy({
            port: PROXY_PORT,
            flashPort: FLASH_PORT,
            gameDomain: sitelockDomain,
            gameFilePath: resolvedGamePath,
        });

        // Switch to game running state
        appState = AppState.GAME_RUNNING;

        // Launch Flash Player
        flashProcess = launchFlashPlayer();
        flashPlayerPid = flashProcess.pid;

        // Resize and center Flash Player to match game dimensions (Windows only)
        if (Deno.build.os === "windows") {
            const icoPath = join(Deno.cwd(), "assets", "icon.ico");
            WindowManager.removeWindowChrome(flashProcess.pid, gameWindowWidth, gameWindowHeight, "RAFlash", 50, 10);
            WindowManager.setProcessIcon(flashProcess.pid, icoPath);
        }

        // Start Rich Presence timeout checker
        richPresenceCheckInterval = setInterval(() => {
            if (lastRichPresenceTime > 0 && Date.now() - lastRichPresenceTime >= 4000) {
                updateFlashPlayerTitle("");
            }
        }, 1000);

        // Wait for Flash Player to close
        await flashProcess.status;

        // Cleanup between games
        if (richPresenceCheckInterval) {
            clearInterval(richPresenceCheckInterval);
            richPresenceCheckInterval = null;
        }
        stopSitelockProxy();

        // Flush user profile before cleanup
        await UserProfile.saveUser();

        // Close all devtools WebSocket connections and windows
        for (const ws of devtoolsClients) {
            try { ws.close(); } catch { /* already closed */ }
        }
        devtoolsClients.clear();
        await HTMLWindow.shutdown();

        // Reset state for next game
        resetGameState();
    }
}

main();
