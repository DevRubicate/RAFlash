/**
 * Patches a PE32 executable to load FlashpointProxy.exe via import table injection,
 * and strips dangerous keyboard shortcuts from the accelerator table.
 *
 * Matches the Flashpoint Archive approach (CFF Explorer):
 *   1. Strip Authenticode certificate
 *   2. Write new import data into .reloc section padding
 *   3. Make .rdata writable (for existing IATs)
 *   4. Make .reloc writable + non-discardable (for new IAT)
 *   5. Update import directory RVA/size
 *   6. Neutralize cheat-enabling keyboard accelerators (Ctrl+Enter, Ctrl+R, etc.)
 */

function readAsciiZ(data: Uint8Array, offset: number, maxLen = 128): string {
    let s = '';
    for (let i = 0; i < maxLen; i++) {
        if (data[offset + i] === 0) break;
        s += String.fromCharCode(data[offset + i]);
    }
    return s;
}

// Command IDs to keep (clipboard operations only)
const SAFE_COMMANDS = new Set([
    57642, // Ctrl+A (Select All)
    57634, // Ctrl+C (Copy)
    57637, // Ctrl+V (Paste)
    57635, // Ctrl+X (Cut)
]);

/**
 * Finds and neutralizes dangerous accelerator table entries in the PE resource directory.
 *
 * Flash Player's accelerator table (resource type 9) contains shortcuts like Ctrl+Enter
 * (play), Ctrl+R (rewind), Ctrl+F (step forward), etc. that let users manipulate game
 * timelines to cheat. We zero out all entries except safe clipboard/help shortcuts.
 *
 * PE resource directory structure: root → type (RT_ACCELERATOR=9) → ID → language → data entry
 * Each accelerator entry is 8 bytes: [fVirt:u16, key:u16, cmd:u16, pad:u16]
 */
function stripAcceleratorShortcuts(
    output: Uint8Array, outView: DataView,
    ddOff: number, sectHeadersOff: number, numSections: number,
) {
    const RT_ACCELERATOR = 9;

    function rvaToFileLocal(rva: number): number {
        for (let i = 0; i < numSections; i++) {
            const s = sectHeadersOff + i * 40;
            const vaddr = outView.getUint32(s + 12, true);
            const vsize = outView.getUint32(s + 8, true);
            const rawPtr = outView.getUint32(s + 20, true);
            if (rva >= vaddr && rva < vaddr + vsize) {
                return rawPtr + (rva - vaddr);
            }
        }
        throw new Error(`Cannot resolve RVA 0x${rva.toString(16)}`);
    }

    // Resource directory is data directory entry index 2
    const resRVA = outView.getUint32(ddOff + 2 * 8, true);
    if (resRVA === 0) throw new Error('No resource directory found');
    const resBase = rvaToFileLocal(resRVA);

    // Parse resource directory to find RT_ACCELERATOR entries
    function readDirEntries(dirFileOff: number): Array<{id: number, isDir: boolean, offset: number}> {
        const numNamed = outView.getUint16(dirFileOff + 12, true);
        const numId = outView.getUint16(dirFileOff + 14, true);
        const entries: Array<{id: number, isDir: boolean, offset: number}> = [];
        for (let i = 0; i < numNamed + numId; i++) {
            const entryOff = dirFileOff + 16 + i * 8;
            const nameOrId = outView.getUint32(entryOff, true);
            const dataOrDir = outView.getUint32(entryOff + 4, true);
            const isDir = (dataOrDir & 0x80000000) !== 0;
            const offset = dataOrDir & 0x7FFFFFFF;
            entries.push({ id: nameOrId, isDir, offset });
        }
        return entries;
    }

    // Level 1: find RT_ACCELERATOR type
    const rootEntries = readDirEntries(resBase);
    const accelType = rootEntries.find(e => e.id === RT_ACCELERATOR);
    if (!accelType || !accelType.isDir) {
        throw new Error('No accelerator table resource found');
    }

    // Level 2: iterate all accelerator table IDs
    const idEntries = readDirEntries(resBase + accelType.offset);
    let strippedCount = 0;

    for (const idEntry of idEntries) {
        if (!idEntry.isDir) continue;

        // Level 3: iterate language variants
        const langEntries = readDirEntries(resBase + idEntry.offset);
        for (const langEntry of langEntries) {
            if (langEntry.isDir) continue;

            // Data entry: RVA (4 bytes), Size (4 bytes), CodePage (4 bytes), Reserved (4 bytes)
            const dataEntryOff = resBase + langEntry.offset;
            const dataRVA = outView.getUint32(dataEntryOff, true);
            const dataSize = outView.getUint32(dataEntryOff + 4, true);
            const dataFileOff = rvaToFileLocal(dataRVA);
            const numEntries = Math.floor(dataSize / 8);

            for (let i = 0; i < numEntries; i++) {
                const entryOff = dataFileOff + i * 8;
                const fVirt = outView.getUint16(entryOff, true);
                const cmd = outView.getUint16(entryOff + 4, true);

                if (!SAFE_COMMANDS.has(cmd)) {
                    // Zero the key and command but preserve the last-entry marker (0x80)
                    outView.setUint16(entryOff, fVirt & 0x0080, true); // keep only last-entry bit
                    outView.setUint16(entryOff + 2, 0, true);          // key = 0
                    outView.setUint16(entryOff + 4, 0, true);          // cmd = 0
                    strippedCount++;
                }
            }
        }
    }

    if (strippedCount === 0) {
        throw new Error('No accelerator entries were stripped — table may have already been patched');
    }
}

export function patchFlashPlayer(inputPath: string, outputPath: string, proxyName = 'FlashpointProxy.exe') {
    const original = Deno.readFileSync(inputPath);
    const view = new DataView(original.buffer);

    // --- Parse PE headers ---
    const peOffset = view.getUint32(0x3C, true);
    if (original[peOffset] !== 0x50 || original[peOffset + 1] !== 0x45) {
        throw new Error('Not a valid PE file');
    }

    const fileHeaderOff = peOffset + 4;
    const numSections = view.getUint16(fileHeaderOff + 2, true);
    const optHeaderSize = view.getUint16(fileHeaderOff + 16, true);
    const optHeaderOff = fileHeaderOff + 20;
    const magic = view.getUint16(optHeaderOff, true);
    if (magic !== 0x10B) throw new Error('Only PE32 (32-bit) executables are supported');

    const ddOff = optHeaderOff + 96;
    const importRVA = view.getUint32(ddOff + 1 * 8, true);
    const importSize = view.getUint32(ddOff + 1 * 8 + 4, true);
    const certFileOffset = view.getUint32(ddOff + 4 * 8, true);
    const certSize = view.getUint32(ddOff + 4 * 8 + 4, true);

    const sectHeadersOff = optHeaderOff + optHeaderSize;

    // Helper: RVA to file offset
    function rvaToFile(rva: number): number {
        for (let i = 0; i < numSections; i++) {
            const s = sectHeadersOff + i * 40;
            const vaddr = view.getUint32(s + 12, true);
            const vsize = view.getUint32(s + 8, true);
            const rawPtr = view.getUint32(s + 20, true);
            if (rva >= vaddr && rva < vaddr + vsize) {
                return rawPtr + (rva - vaddr);
            }
        }
        throw new Error(`Cannot resolve RVA 0x${rva.toString(16)}`);
    }

    // --- Read existing import descriptors ---
    const importFileOff = rvaToFile(importRVA);
    const numImportDescs = Math.floor(importSize / 20);
    const existingDescs: Uint8Array[] = [];
    for (let i = 0; i < numImportDescs - 1; i++) {
        const off = importFileOff + i * 20;
        existingDescs.push(new Uint8Array(original.buffer.slice(off, off + 20)));
    }

    // Verify input is an unpatched EXE
    for (const desc of existingDescs) {
        const descView = new DataView(desc.buffer);
        const nameRVA = descView.getUint32(12, true);
        if (nameRVA) {
            const name = readAsciiZ(original, rvaToFile(nameRVA));
            if (name.toLowerCase().includes('flashpointproxy')) {
                throw new Error(`Input EXE is already patched (imports ${name}). Expected a fresh, unpatched Flash Player.`);
            }
        }
    }

    // --- Find .rdata and .reloc sections ---
    let rdataIdx = -1, relocIdx = -1;
    for (let i = 0; i < numSections; i++) {
        const s = sectHeadersOff + i * 40;
        const name = new TextDecoder().decode(original.subarray(s, s + 8)).replace(/\0/g, '');
        if (name === '.rdata') rdataIdx = i;
        if (name === '.reloc') relocIdx = i;
    }
    if (rdataIdx === -1) throw new Error('Cannot find .rdata section');
    if (relocIdx === -1) throw new Error('Cannot find .reloc section');

    const relocHeader = sectHeadersOff + relocIdx * 40;
    const relocVA = view.getUint32(relocHeader + 12, true);
    const relocVSize = view.getUint32(relocHeader + 8, true);
    const relocRawPtr = view.getUint32(relocHeader + 20, true);
    const relocRawSize = view.getUint32(relocHeader + 16, true);

    const rdataHeader = sectHeadersOff + rdataIdx * 40;

    // --- Calculate layout in .reloc padding ---
    const proxyNameBytes = new TextEncoder().encode(proxyName + '\0');
    const importByName = new TextEncoder().encode('DllMain\0');

    // Layout: IAT (8 bytes) | ILT (8 bytes) | descriptors (80 bytes) | name | import-by-name
    // Matching Flashpoint's layout: IAT first, then ILT, then descriptors
    const iatOff = 0;
    const iltOff = iatOff + 8;
    const descOff = iltOff + 8;
    const descTableSize = (existingDescs.length + 1 + 1) * 20;
    const nameOff = descOff + descTableSize;
    const ibnOff = nameOff + proxyNameBytes.length;
    const ibnSize = 2 + importByName.length;
    const totalNeeded = ibnOff + ibnSize;

    // Place data at the tail end of .reloc virtual content (overwriting relocation
    // entries, which are only used during initial image mapping before imports resolve).
    // This matches how CFF Explorer places rebuilt import data.
    if (relocVSize < totalNeeded) {
        throw new Error(`Not enough space in .reloc for import data (need ${totalNeeded}, have ${relocVSize})`);
    }
    const dataOffset = ((relocVSize - totalNeeded) & ~15); // align down to 16 bytes
    if (dataOffset < relocVSize / 2) {
        throw new Error(`Not enough space in .reloc for import data`);
    }
    const newDataFileOff = relocRawPtr + dataOffset;
    const newDataRVA = relocVA + dataOffset;

    // --- Build output ---
    const strippedSize = certSize > 0 ? certFileOffset : original.length;
    const output = new Uint8Array(strippedSize);
    output.set(new Uint8Array(original.buffer, 0, strippedSize));
    const outView = new DataView(output.buffer);

    // --- Write import data into .reloc padding ---

    // IAT: one thunk + null
    outView.setUint32(newDataFileOff + iatOff, newDataRVA + ibnOff, true);
    outView.setUint32(newDataFileOff + iatOff + 4, 0, true);

    // ILT: one thunk + null
    outView.setUint32(newDataFileOff + iltOff, newDataRVA + ibnOff, true);
    outView.setUint32(newDataFileOff + iltOff + 4, 0, true);

    // Import descriptors: existing + new + null terminator
    for (let i = 0; i < existingDescs.length; i++) {
        output.set(existingDescs[i], newDataFileOff + descOff + i * 20);
    }
    const newDescOff = newDataFileOff + descOff + existingDescs.length * 20;
    outView.setUint32(newDescOff + 0, newDataRVA + iltOff, true);        // OriginalFirstThunk
    outView.setUint32(newDescOff + 4, 0, true);                           // TimeDateStamp
    outView.setUint32(newDescOff + 8, 0, true);                           // ForwarderChain
    outView.setUint32(newDescOff + 12, newDataRVA + nameOff, true);       // Name
    outView.setUint32(newDescOff + 16, newDataRVA + iatOff, true);        // FirstThunk
    // Null terminator (20 zero bytes)
    for (let i = 0; i < 20; i++) output[newDescOff + 20 + i] = 0;

    // DLL name
    output.set(proxyNameBytes, newDataFileOff + nameOff);

    // IMAGE_IMPORT_BY_NAME
    outView.setUint16(newDataFileOff + ibnOff, 0, true);
    output.set(importByName, newDataFileOff + ibnOff + 2);

    // --- Update PE headers ---

    // 1. Import directory → new location in .reloc
    outView.setUint32(ddOff + 1 * 8, newDataRVA + descOff, true);
    outView.setUint32(ddOff + 1 * 8 + 4, descTableSize, true);

    // 2. Make .rdata writable (for existing IATs)
    const rdataChars = outView.getUint32(rdataHeader + 36, true);
    outView.setUint32(rdataHeader + 36, rdataChars | 0x80000000, true);

    // 3. Make .reloc writable + remove DISCARDABLE (now contains import data)
    outView.setUint32(relocHeader + 36, 0xC0000040, true);

    // 4. Zero out certificate
    outView.setUint32(ddOff + 4 * 8, 0, true);
    outView.setUint32(ddOff + 4 * 8 + 4, 0, true);

    // 5. Strip dangerous keyboard shortcuts from accelerator table
    stripAcceleratorShortcuts(output, outView, ddOff, sectHeadersOff, numSections);

    // 6. Calculate PE checksum (matches what CFF Explorer produces)
    outView.setUint32(optHeaderOff + 64, 0, true); // zero first
    const checksumOffset = optHeaderOff + 64;
    let checksum = 0;
    for (let i = 0; i < output.length; i += 2) {
        if (i === checksumOffset || i === checksumOffset + 2) continue; // skip checksum field
        const word = (i + 1 < output.length) ? outView.getUint16(i, true) : output[i];
        checksum += word;
    }
    // Fold carry: add high 16 bits into low 16 bits until no carry remains
    while (checksum > 0xFFFF) {
        checksum = (checksum >> 16) + (checksum & 0xFFFF);
    }
    checksum = (checksum + output.length) & 0xFFFFFFFF;
    outView.setUint32(optHeaderOff + 64, checksum, true);

    Deno.writeFileSync(outputPath, output);
}

if (import.meta.main) {
    const [input, output] = Deno.args;
    if (!input || !output) {
        console.error('Usage: deno run --allow-read --allow-write patchFlashPlayer.ts <input.exe> <output.exe>');
        Deno.exit(1);
    }
    patchFlashPlayer(input, output);
}
