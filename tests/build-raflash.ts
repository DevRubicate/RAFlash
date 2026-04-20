/**
 * Build a .raflash archive from a .swf and optional metadata.
 *
 *     deno run --allow-read --allow-write tests/build-raflash.ts \
 *         --swf=<in.swf> --out=<out.raflash> \
 *         [--hashOverride=<md5>] [--title=<name>]
 *
 * Used by the Makefile to generate a deterministic .raflash fixture for
 * the Recorded Test suite so the .raflash resolution path has permanent
 * regression coverage.
 */

import { zipSync } from "npm:fflate";

const args: Record<string, string> = {};
for (const arg of Deno.args) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
}

const swfPath = args["swf"];
const outPath = args["out"];
if (!swfPath || !outPath) {
    console.error("usage: build-raflash.ts --swf=<in.swf> --out=<out.raflash> [--hashOverride=<md5>] [--title=<name>]");
    Deno.exit(2);
}

const swfBytes = await Deno.readFile(swfPath);
const dataJson: Record<string, unknown> = {
    scaleMode: "showAll",
    align: "TL",
};
if (args["title"]) dataJson.title = args["title"];
if (args["hashOverride"]) dataJson.hashOverride = args["hashOverride"];

const zipped = zipSync({
    "start.swf": swfBytes,
    "data.json": new TextEncoder().encode(JSON.stringify(dataJson, null, 2)),
});

await Deno.writeFile(outPath, zipped);
console.log(`wrote ${outPath} (${zipped.length} bytes)`);
