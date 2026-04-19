/**
 * Install an achievement fixture JSON into RAFlash's on-disk cache so the
 * Stagehand harness auto-loads it during `.ratest` runs.
 *
 *     deno run --allow-read --allow-write tests/install-achievements.ts \
 *         --swf=<path-to-swf>        -- game whose MD5 hash keys the JSON
 *         --json=<fixture.json>      -- achievement data to install
 *         --sentinel=<sentinel-path> -- touched when install succeeds
 *
 * The hash is recomputed from the SWF every run, so if the game's bytecode
 * changes the JSON automatically re-installs under the new hash path.
 * Writing the sentinel lets Make depend on a stable filename even though
 * the real install target includes a hash in its name.
 */

import { crypto as stdCrypto } from "jsr:@std/crypto";

const args: Record<string, string> = {};
for (const arg of Deno.args) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
}

const swfPath = args["swf"];
const jsonPath = args["json"];
const sentinelPath = args["sentinel"];
if (!swfPath || !jsonPath || !sentinelPath) {
    console.error("usage: install-achievements.ts --swf=<path> --json=<path> --sentinel=<path>");
    Deno.exit(2);
}

const swfBytes = await Deno.readFile(swfPath);
const buf = await stdCrypto.subtle.digest("MD5", swfBytes as Uint8Array<ArrayBuffer>);
const hash = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

await Deno.mkdir(".build/RACache/games", { recursive: true });
const installPath = `.build/RACache/games/${hash}.json`;
await Deno.copyFile(jsonPath, installPath);

await Deno.mkdir(".build/RACache", { recursive: true });
await Deno.writeTextFile(sentinelPath, `${hash}\n${installPath}\n${new Date().toISOString()}\n`);
