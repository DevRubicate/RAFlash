/**
 * Prints the identity hash of each game file passed on the command line,
 * in the exact format expected by a .ratest file's `hash` directive.
 *
 *     deno run --allow-read tests/ratest-hash.ts .tests/StagehandGame.swf
 *     deno run --allow-read tests/ratest-hash.ts .tests/Game.raflash
 *     deno run --allow-read tests/ratest-hash.ts .tests/*.swf .tests/*.raflash
 *
 * For .swf: the MD5 of the file bytes.
 * For .raflash: data.json.hashOverride if present, otherwise the MD5 of
 *               the inner start.swf bytes — matching RAEngine's identity
 *               rule so achievements attach to the same game.
 */

import { crypto as stdCrypto } from "jsr:@std/crypto";
import { unzipSync } from "npm:fflate";

if (Deno.args.length === 0) {
    console.error("usage: ratest-hash.ts <swf-or-raflash> [more...]");
    Deno.exit(2);
}

async function md5(bytes: Uint8Array): Promise<string> {
    // See note in tests/ratest.ts md5Bytes — same typings workaround.
    const buf = await stdCrypto.subtle.digest("MD5", bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

for (const path of Deno.args) {
    try {
        const lower = path.toLowerCase();
        let hash: string;
        let note = "";

        if (lower.endsWith(".raflash")) {
            const files = unzipSync(await Deno.readFile(path));
            const swf = files["start.swf"];
            if (!swf) throw new Error("invalid .raflash: no start.swf");

            let override: string | undefined;
            if (files["data.json"]) {
                try {
                    const parsed = JSON.parse(new TextDecoder().decode(files["data.json"]));
                    if (typeof parsed?.hashOverride === "string" && parsed.hashOverride !== "") {
                        override = parsed.hashOverride.toLowerCase();
                    }
                } catch { /* fall through to inner-SWF hash */ }
            }

            if (override) {
                hash = override;
                note = "  (hashOverride)";
            } else {
                hash = await md5(swf);
                note = "  (MD5 of start.swf)";
            }
        } else {
            hash = await md5(await Deno.readFile(path));
        }

        console.log(`${hash}  ${path}${note}`);
    } catch (e) {
        console.error(`${path}: ${(e as Error).message}`);
    }
}
