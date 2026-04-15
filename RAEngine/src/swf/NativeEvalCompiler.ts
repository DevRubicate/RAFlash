/**
 * Compiles achievements and Rich Presence to native AVM1 bytecode.
 *
 * Achievements: each becomes a self-contained function that handles formula
 * evaluation, comparison, hit tracking, delta, and trigger determination.
 *
 * Rich Presence: each becomes a function that evaluates the formula and
 * returns the string result directly.
 *
 * Generated SWF structure:
 *   _global.__nativeAch = [achFn0, achFn1, ...]  — function(gameRoot, storage) → 0|1
 *   _global.__nativeRP  = [rpFn0, rpFn1, ...]    — function(gameRoot, storage) → string
 */

import { AVM1Builder, aString, aDouble, aInt, aNull, aUndefined, aRegister, aBool } from "./AVM1Builder.ts";
import { buildSWF } from "./SWFWriter.ts";
import { Formula } from "../formula/Formula.ts";

// ============================================================================
// Register allocation for per-achievement functions
// ============================================================================

const R_GAMEROOT = 1;   // function parameter
const R_STORAGE = 2;    // function parameter
const R_ALL_MET = 3;    // boolean accumulator: are all requirements met?
const R_VAL_A = 4;      // formula A result
const R_VAL_B = 5;      // formula B result
const R_SCRATCH1 = 6;   // scratch: hits value, delta previous, etc.
const R_SCRATCH2 = 7;   // scratch: comparison result, delta init flag, etc.

// Achievement-level flags
const R_RESET_FIRED = 8;    // boolean: did any RESET_IF fire this frame?
const R_CHAIN_ACC = 9;      // AND_NEXT/OR_NEXT chain accumulator

// Formula compiler internals (shifted to avoid conflicts with achievement regs)
const R_FORMULA_TEMP = 10;   // AND/OR/MOD scratch
const R_FORMULA_ARR = 11;    // ARRAY_ACCESS loop: array
const R_FORMULA_MATCH = 12;  // ARRAY_ACCESS loop: match result

const ACH_REGISTER_COUNT = 13; // R0-R12

// ============================================================================
// Formula compilation (DSL bytecode → AVM1 bytecode)
// ============================================================================

/** Register assignments for the formula compiler. */
interface FormulaRegs {
    gameRoot: number;
    temp: number;
    arr: number;
    match: number;
    storage: number;
}

const ACH_FORMULA_REGS: FormulaRegs = {
    gameRoot: R_GAMEROOT,
    temp: R_FORMULA_TEMP,
    arr: R_FORMULA_ARR,
    match: R_FORMULA_MATCH,
    storage: R_STORAGE,
};

/** All known achievement requirement flags. */
const KNOWN_FLAGS = new Set([
    "", "RESET_IF", "AND_NEXT", "OR_NEXT", "PAUSE_IF", "RESET_NEXT_IF",
    "ADD_HITS", "SUB_HITS", "ADD_SOURCE", "SUB_SOURCE",
    "MEASURED", "MEASURED_IF", "TRIGGER",
]);

/** Mutable context shared across recursive compilation calls. */
interface CompileContext {
    nextRememberKey: number;
}

/**
 * Compile a DSL formula (full bytecode array starting with VERSION_1) to AVM1.
 * Result is left on the stack.
 */
function compileDSLFormula(
    dslBytecode: string[], asm: AVM1Builder, ctx: CompileContext, regs: FormulaRegs,
): boolean {
    return compileDSLRange(dslBytecode, 1, dslBytecode.length, asm, ctx, regs);
}

/**
 * Compile a range of DSL bytecode tokens [start, end) to AVM1 bytecode.
 */
function compileDSLRange(
    dslBytecode: string[], start: number, end: number,
    asm: AVM1Builder, ctx: CompileContext, regs: FormulaRegs,
): boolean {
    let i = start;

    while (i < end) {
        const op = dslBytecode[i];

        switch (op) {
            case "IDENTIFIER":
                i++; // name follows; consumed by READ_GLOBAL
                break;

            case "READ_GLOBAL": {
                const name = dslBytecode[i - 1];
                if (name === "stage" || name === "this") {
                    asm.push(aRegister(regs.gameRoot));
                } else if (name === "stage_frame") {
                    asm.push(aRegister(regs.gameRoot), aString("_currentframe"));
                    asm.getMember();
                } else {
                    return false;
                }
                break;
            }

            case "VALUE": {
                const num = Number(dslBytecode[++i]);
                if (Number.isInteger(num) && num >= -2147483648 && num <= 2147483647) {
                    asm.push(aInt(num));
                } else {
                    asm.push(aDouble(num));
                }
                break;
            }

            case "STRING":
                asm.push(aString(dslBytecode[++i]));
                break;

            case "NULL":
                asm.push(aNull());
                break;

            case "OBJECT_ACCESS": {
                const len = Number(dslBytecode[++i]);
                if (len === 6
                    && dslBytecode[i + 1] === "IDENTIFIER" && dslBytecode[i + 2] === "key"
                    && dslBytecode[i + 3] === "READ_GLOBAL"
                    && dslBytecode[i + 4] === "IDENTIFIER"
                    && dslBytecode[i + 6] === "EQUAL") {
                    asm.push(aString(dslBytecode[i + 5]));
                    asm.getMember();
                    i += len;
                } else {
                    return false;
                }
                break;
            }

            case "ARRAY_ACCESS": {
                const len = Number(dslBytecode[++i]);
                if (len === 2 && dslBytecode[i + 1] === "VALUE") {
                    const idx = Number(dslBytecode[i + 2]);
                    asm.push(aDouble(idx));
                    asm.getMember();
                    i += len;
                } else if (len === 6
                    && dslBytecode[i + 1] === "IDENTIFIER" && dslBytecode[i + 2] === "this"
                    && dslBytecode[i + 3] === "READ_GLOBAL"
                    && dslBytecode[i + 4] === "STRING"
                    && dslBytecode[i + 6] === "EQUAL") {
                    const matchValue = dslBytecode[i + 5];
                    asm.storeRegister(regs.arr);
                    asm.pop();
                    asm.push(aUndefined());
                    asm.storeRegister(regs.match);
                    asm.pop();
                    asm.push(aRegister(regs.arr));
                    asm.enumerate2();
                    const loopStart = asm.position;
                    asm.storeRegister(regs.temp);
                    asm.push(aNull());
                    asm.equals2();
                    const exitPatch = asm.jumpIfForward();
                    asm.push(aRegister(regs.arr), aRegister(regs.temp));
                    asm.getMember();
                    asm.push(aString(matchValue));
                    asm.equals2();
                    asm.not();
                    asm.jumpIfTo(loopStart);
                    asm.push(aRegister(regs.arr), aRegister(regs.temp));
                    asm.getMember();
                    asm.storeRegister(regs.match);
                    asm.pop();
                    asm.jumpTo(loopStart);
                    asm.patchJumpHere(exitPatch);
                    asm.push(aRegister(regs.match));
                    i += len;
                } else {
                    return false;
                }
                break;
            }

            case "ADD": asm.add2(); break;
            case "SUB": asm.subtract(); break;
            case "MUL": asm.multiply(); break;
            case "DIV": asm.divide(); break;

            case "EQUAL": asm.equals2(); break;
            case "NOT_EQUAL": asm.equals2(); asm.not(); break;
            case "GREATER": asm.greater(); break;
            case "LESSER": asm.less2(); break;
            case "GREATER_EQUAL": asm.less2(); asm.not(); break;
            case "LESSER_EQUAL": asm.greater(); asm.not(); break;

            case "NOT": asm.not(); break;

            case "LEN":
                // Match interpreter: arrays → .length, non-arrays → 1
                asm.storeRegister(regs.temp);
                asm.push(aString("Array"));
                asm.getVariable();
                asm.instanceOf();
                const lenElsePatch = asm.jumpIfForward();
                // Not an array: pop value, push 1
                asm.pop();
                asm.push(aInt(1));
                const lenEndPatch = asm.jumpForward();
                // Is an array: read .length
                asm.patchJumpHere(lenElsePatch);
                asm.push(aRegister(regs.temp), aString("length"));
                asm.getMember();
                asm.patchJumpHere(lenEndPatch);
                break;

            case "AND":
                asm.storeRegister(regs.temp);
                asm.pop();
                asm.not(); asm.not();
                asm.push(aRegister(regs.temp));
                asm.not(); asm.not();
                asm.multiply();
                break;

            case "OR":
                asm.storeRegister(regs.temp);
                asm.pop();
                asm.not();
                asm.push(aRegister(regs.temp));
                asm.not();
                asm.multiply();
                asm.not();
                break;

            case "XOR":
                asm.bitXor();
                break;

            case "MOD":
                asm.storeRegister(regs.temp);
                asm.pop();
                asm.storeRegister(regs.arr);
                asm.push(aRegister(regs.arr), aRegister(regs.temp));
                asm.divide();
                asm.toInteger();
                asm.push(aRegister(regs.temp));
                asm.multiply();
                asm.subtract();
                break;

            case "POW":
                asm.push(aInt(2), aString("Math"));
                asm.getVariable();
                asm.push(aString("pow"));
                asm.callMethod();
                break;

            case "TERNARY": {
                const thenLen = Number(dslBytecode[++i]);
                const thenStart = i + 1;
                const thenEnd = thenStart + thenLen;
                const elseLen = Number(dslBytecode[thenEnd]);
                const elseStart = thenEnd + 1;
                const elseEnd = elseStart + elseLen;
                asm.not();
                const elsePatch = asm.jumpIfForward();
                if (!compileDSLRange(dslBytecode, thenStart, thenEnd, asm, ctx, regs)) return false;
                const endPatch = asm.jumpForward();
                asm.patchJumpHere(elsePatch);
                if (!compileDSLRange(dslBytecode, elseStart, elseEnd, asm, ctx, regs)) return false;
                asm.patchJumpHere(endPatch);
                i = elseEnd - 1;
                break;
            }

            case "REMEMBER": {
                const remLen = Number(dslBytecode[++i]);
                const remStart = i + 1;
                const remEnd = remStart + remLen;
                const remKey = ctx.nextRememberKey++;
                if (!compileDSLRange(dslBytecode, remStart, remEnd, asm, ctx, regs)) return false;
                asm.storeRegister(regs.temp);
                asm.push(aUndefined());
                asm.equals2();
                const useCachedPatch = asm.jumpIfForward();
                asm.push(aRegister(regs.storage), aInt(remKey), aRegister(regs.temp));
                asm.setMember();
                asm.push(aRegister(regs.temp));
                const remEndPatch = asm.jumpForward();
                asm.patchJumpHere(useCachedPatch);
                asm.push(aRegister(regs.storage), aInt(remKey));
                asm.getMember();
                asm.patchJumpHere(remEndPatch);
                i = remEnd - 1;
                break;
            }

            default:
                return false;
        }

        i++;
    }

    return true;
}

// ============================================================================
// Achievement compilation
// ============================================================================

/** Compile a DSL address string to AVM1 bytes. Throws on failure. */
function compileFormulaToBytes(
    address: string, ctx: CompileContext, regs: FormulaRegs,
): Uint8Array {
    const dslBytecode = Formula.compile(address || "0") as string[];
    const asm = new AVM1Builder();
    if (!compileDSLFormula(dslBytecode, asm, ctx, regs)) {
        throw new Error(`Failed to compile formula to AVM1 bytecode: ${address}`);
    }
    return asm.toBytes();
}

/** Emit: read storage[key] into register, treating undefined as 0. */
function emitReadHitsToReg(asm: AVM1Builder, key: string, destReg: number): void {
    asm.push(aRegister(R_STORAGE), aString(key));
    asm.getMember();
    asm.storeRegister(destReg);
    // Check undefined → 0
    asm.push(aUndefined());
    asm.equals2();
    asm.not();
    const hasVal = asm.jumpIfForward(); // → has value, skip init
    asm.push(aInt(0));
    asm.storeRegister(destReg);
    asm.pop();
    asm.patchJumpHere(hasVal);
}

/** Emit comparison of R_VAL_A vs R_VAL_B, result in R_SCRATCH2. */
function emitComparison(asm: AVM1Builder, cmp: string): void {
    asm.push(aRegister(R_VAL_A), aRegister(R_VAL_B));
    switch (cmp) {
        case "==": asm.equals2(); break;
        case "!=": asm.equals2(); asm.not(); break;
        case ">": asm.greater(); break;
        case ">=": asm.less2(); asm.not(); break;
        case "<": asm.less2(); break;
        case "<=": asm.greater(); asm.not(); break;
        default: asm.equals2(); break;
    }
    asm.storeRegister(R_SCRATCH2);
    asm.pop();
}

/**
 * Emit delta core: read previous, store current for next frame, check init.
 * Returns a forward-jump patch for the "not initialized" case.
 * On the initialized path, valReg is set to the previous value.
 * Caller must handle the not-init path (patch + what to do).
 */
function emitDeltaCore(
    asm: AVM1Builder,
    prevKey: string,
    initKey: string,
    valReg: number,
): number {
    // Read previous value
    asm.push(aRegister(R_STORAGE), aString(prevKey));
    asm.getMember();
    asm.storeRegister(R_SCRATCH1); // prev
    asm.pop();
    // Read initialized flag
    asm.push(aRegister(R_STORAGE), aString(initKey));
    asm.getMember();
    asm.storeRegister(R_SCRATCH2); // initialized
    asm.pop();
    // Store current for next frame
    asm.push(aRegister(R_STORAGE), aString(prevKey), aRegister(valReg));
    asm.setMember();
    asm.push(aRegister(R_STORAGE), aString(initKey), aBool(true));
    asm.setMember();
    // If not initialized: jump (caller handles)
    asm.push(aRegister(R_SCRATCH2));
    asm.not();
    const notInitPatch = asm.jumpIfForward();
    // Initialized: valReg = previous value
    asm.push(aRegister(R_SCRATCH1));
    asm.storeRegister(valReg);
    asm.pop();
    return notInitPatch;
}

/**
 * Emit delta handling for standalone requirements. On not-init, sets
 * R_ALL_MET = false and adds a forward jump to nextReqPatches.
 */
function emitDelta(
    asm: AVM1Builder,
    prevKey: string,
    initKey: string,
    valReg: number,
    nextReqPatches: number[],
): void {
    const notInitPatch = emitDeltaCore(asm, prevKey, initKey, valReg);
    const deltaDonePatch = asm.jumpForward();
    asm.patchJumpHere(notInitPatch);
    asm.push(aBool(false));
    asm.storeRegister(R_ALL_MET);
    asm.pop();
    nextReqPatches.push(asm.jumpForward()); // → NEXT_REQ
    asm.patchJumpHere(deltaDonePatch);
}

/**
 * Emit delta handling for chain members. On not-init, sets R_SCRATCH2 = false
 * and adds a forward jump to endEvalPatches (skips to COMBINE, not NEXT_REQ).
 */
function emitDeltaForChain(
    asm: AVM1Builder,
    prevKey: string,
    initKey: string,
    valReg: number,
    endEvalPatches: number[],
): void {
    const notInitPatch = emitDeltaCore(asm, prevKey, initKey, valReg);
    const deltaDonePatch = asm.jumpForward();
    asm.patchJumpHere(notInitPatch);
    asm.push(aBool(false));
    asm.storeRegister(R_SCRATCH2);
    asm.pop();
    endEvalPatches.push(asm.jumpForward()); // → POST_EVAL
    asm.patchJumpHere(deltaDonePatch);
}

/**
 * Emit the evaluation sequence for a standalone requirement: formula A (with
 * delta), formula B (with delta), and comparison. After this, R_SCRATCH2 holds
 * the comparison result (passed boolean).
 *
 * On delta-not-initialized, sets R_ALL_MET = false and jumps (via nextReqPatches).
 */
function emitRequirementEval(
    asm: AVM1Builder,
    req: Record<string, unknown>,
    k: number,
    bytesA: Uint8Array,
    bytesB: Uint8Array,
    nextReqPatches: number[],
    g = 0,
): void {
    const hasDeltaA = req.typeA === "DELTA";
    const hasDeltaB = req.typeB === "DELTA";

    asm.rawBytes(bytesA);
    asm.storeRegister(R_VAL_A);
    asm.pop();

    if (hasDeltaA) {
        emitDelta(asm, `dA${g}_${k}`, `dAi${g}_${k}`, R_VAL_A, nextReqPatches);
    }

    asm.rawBytes(bytesB);
    asm.storeRegister(R_VAL_B);
    asm.pop();

    if (hasDeltaB) {
        emitDelta(asm, `dB${g}_${k}`, `dBi${g}_${k}`, R_VAL_B, nextReqPatches);
    }

    emitComparison(asm, req.cmp as string);
}

/**
 * Emit evaluation for a chain member. All exit paths converge at POST_EVAL
 * with R_SCRATCH2 holding the "satisfied" boolean (locked-true → true,
 * delta-not-init → false, normal → comparison result).
 */
function emitChainMemberEval(
    asm: AVM1Builder,
    req: Record<string, unknown>,
    k: number,
    bytesA: Uint8Array,
    bytesB: Uint8Array,
    maxHits: number,
    g = 0,
): void {
    const hasDeltaA = req.typeA === "DELTA";
    const hasDeltaB = req.typeB === "DELTA";
    const hitsKey = `h${g}_${k}`;

    // All paths converge at POST_EVAL with R_SCRATCH2 = satisfied
    const postEvalPatches: number[] = [];

    // --- Locked-true check (maxHits > 0) ---
    if (maxHits > 0) {
        emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
        asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
        asm.less2(); // hits < maxHits → not locked → skip locked block
        const notLockedPatch = asm.jumpIfForward();
        // LOCKED: satisfied = true
        asm.push(aBool(true));
        asm.storeRegister(R_SCRATCH2);
        asm.pop();
        postEvalPatches.push(asm.jumpForward());
        asm.patchJumpHere(notLockedPatch);
    }

    // --- Evaluate formulas + delta + compare ---
    asm.rawBytes(bytesA);
    asm.storeRegister(R_VAL_A);
    asm.pop();

    if (hasDeltaA) {
        emitDeltaForChain(asm, `dA${g}_${k}`, `dAi${g}_${k}`, R_VAL_A, postEvalPatches);
    }

    asm.rawBytes(bytesB);
    asm.storeRegister(R_VAL_B);
    asm.pop();

    if (hasDeltaB) {
        emitDeltaForChain(asm, `dB${g}_${k}`, `dBi${g}_${k}`, R_VAL_B, postEvalPatches);
    }

    emitComparison(asm, req.cmp as string);

    // --- POST_EVAL: all paths converge here, R_SCRATCH2 = satisfied ---
    for (const p of postEvalPatches) asm.patchJumpHere(p);
}

/**
 * Emit an AND_NEXT/OR_NEXT chain (members + terminal). The chain result ends
 * up in R_SCRATCH2 for the terminal's hit tracking + allMet logic.
 */
function emitChain(
    asm: AVM1Builder,
    reqs: Array<Record<string, unknown>>,
    memberIndices: number[],
    terminalIdx: number,
    compiledFormulas: Array<{ bytesA: Uint8Array; bytesB: Uint8Array }>,
    g = 0,
): void {
    const allIndices = [...memberIndices, terminalIdx];

    for (let m = 0; m < allIndices.length; m++) {
        const idx = allIndices[m];
        const req = reqs[idx];
        const maxHits = (req.maxHits as number) || 0;
        const hitsKey = `h${g}_${idx}`;
        const isTerminal = m === allIndices.length - 1;
        const { bytesA, bytesB } = compiledFormulas[idx];

        // Evaluate this member → R_SCRATCH2 = satisfied
        emitChainMemberEval(asm, req, idx, bytesA, bytesB, maxHits, g);

        // Combine with chain accumulator
        if (m === 0) {
            // First member: initialize accumulator
            asm.push(aRegister(R_SCRATCH2));
            asm.storeRegister(R_CHAIN_ACC);
            asm.pop();
        } else {
            // Subsequent: AND or OR with accumulator
            const prevFlag = (reqs[allIndices[m - 1]].flag as string);
            if (prevFlag === "AND_NEXT") {
                // R_CHAIN_ACC = !!R_CHAIN_ACC * !!R_SCRATCH2
                asm.push(aRegister(R_CHAIN_ACC));
                asm.not(); asm.not();
                asm.push(aRegister(R_SCRATCH2));
                asm.not(); asm.not();
                asm.multiply();
                asm.storeRegister(R_CHAIN_ACC);
                asm.pop();
            } else {
                // R_CHAIN_ACC = !(!R_CHAIN_ACC * !R_SCRATCH2)
                asm.push(aRegister(R_CHAIN_ACC));
                asm.not();
                asm.push(aRegister(R_SCRATCH2));
                asm.not();
                asm.multiply();
                asm.not();
                asm.storeRegister(R_CHAIN_ACC);
                asm.pop();
            }
        }

        // Chain member hit tracking (non-terminal only)
        if (!isTerminal && maxHits > 0) {
            // Increment if partialChain (R_CHAIN_ACC) is true AND hits < maxHits
            emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
            asm.push(aRegister(R_CHAIN_ACC));
            asm.not();
            const skipHitPatch = asm.jumpIfForward(); // chain false → skip
            asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
            asm.less2();
            asm.not(); // hits >= maxHits?
            const skipHitPatch2 = asm.jumpIfForward(); // at max → skip
            // Increment
            asm.push(aRegister(R_SCRATCH1));
            asm.increment();
            asm.storeRegister(R_SCRATCH1);
            asm.pop();
            asm.push(aRegister(R_STORAGE), aString(hitsKey), aRegister(R_SCRATCH1));
            asm.setMember();
            asm.patchJumpHere(skipHitPatch);
            asm.patchJumpHere(skipHitPatch2);
        }
    }

    // Terminal: copy chain result to R_SCRATCH2 for caller's hit tracking + allMet
    asm.push(aRegister(R_CHAIN_ACC));
    asm.storeRegister(R_SCRATCH2);
    asm.pop();

    // Terminal hit tracking + allMet (handled by caller based on terminal's flag)
}

/**
 * Emit hit tracking + met determination for a normal (non-flag) requirement.
 * R_SCRATCH2 must hold the passed boolean. Updates R_ALL_MET.
 */
function emitNormalHitTracking(
    asm: AVM1Builder,
    hitsKey: string,
    maxHits: number,
): void {
    if (maxHits > 0) {
        // Re-read hits (R_SCRATCH1 may have been clobbered by delta)
        emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);

        // If passed (R_SCRATCH2) AND hits < maxHits → increment
        asm.push(aRegister(R_SCRATCH2));
        asm.not();
        const skipIncPatch = asm.jumpIfForward(); // not passed → skip
        asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
        asm.less2();
        asm.not(); // hits >= maxHits already?
        const skipIncPatch2 = asm.jumpIfForward(); // at max → skip
        // Increment
        asm.push(aRegister(R_SCRATCH1));
        asm.increment();
        asm.storeRegister(R_SCRATCH1);
        asm.pop();
        asm.push(aRegister(R_STORAGE), aString(hitsKey), aRegister(R_SCRATCH1));
        asm.setMember();
        asm.patchJumpHere(skipIncPatch);
        asm.patchJumpHere(skipIncPatch2);

        // Check if met: hits >= maxHits
        asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
        asm.less2();
        asm.not(); // hits >= maxHits?
        const metPatch = asm.jumpIfForward(); // met → skip not-met
        // Not met
        asm.push(aBool(false));
        asm.storeRegister(R_ALL_MET);
        asm.pop();
        asm.patchJumpHere(metPatch);
    } else {
        // No hits: met = passed (R_SCRATCH2)
        asm.push(aRegister(R_SCRATCH2));
        const notPassedPatch = asm.jumpIfForward(); // if passed → skip not-met block
        // Not passed
        asm.push(aBool(false));
        asm.storeRegister(R_ALL_MET);
        asm.pop();
        asm.patchJumpHere(notPassedPatch);
    }
}

/**
 * Emit RESET_IF hit tracking + fire detection. R_SCRATCH2 must hold the passed
 * boolean. If the reset fires, sets R_RESET_FIRED = true.
 * RESET_IF does NOT update R_ALL_MET (doesn't count toward group satisfaction).
 */
function emitResetIfTracking(
    asm: AVM1Builder,
    hitsKey: string,
    maxHits: number,
): void {
    if (maxHits === 0) {
        // Transient: fires every frame the condition passes
        asm.push(aRegister(R_SCRATCH2)); // passed
        asm.not();
        const skipFirePatch = asm.jumpIfForward();
        asm.push(aBool(true));
        asm.storeRegister(R_RESET_FIRED);
        asm.pop();
        asm.patchJumpHere(skipFirePatch);
    } else {
        // Threshold: track hits, fire when hits reach maxHits
        emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);

        // If passed AND hits < maxHits → increment
        asm.push(aRegister(R_SCRATCH2));
        asm.not();
        const skipIncPatch = asm.jumpIfForward();
        asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
        asm.less2();
        asm.not(); // hits >= maxHits?
        const skipIncPatch2 = asm.jumpIfForward();
        // Increment
        asm.push(aRegister(R_SCRATCH1));
        asm.increment();
        asm.storeRegister(R_SCRATCH1);
        asm.pop();
        asm.push(aRegister(R_STORAGE), aString(hitsKey), aRegister(R_SCRATCH1));
        asm.setMember();
        asm.patchJumpHere(skipIncPatch);
        asm.patchJumpHere(skipIncPatch2);

        // Check if fires: hits >= maxHits (skip fire when hits < maxHits)
        asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
        asm.less2();
        const skipFirePatch = asm.jumpIfForward(); // hits < maxHits → skip
        asm.push(aBool(true));
        asm.storeRegister(R_RESET_FIRED);
        asm.pop();
        asm.patchJumpHere(skipFirePatch);
    }
}

// ============================================================================
// Group-level code generation
// ============================================================================

/** Flag sets for classification. */
const AFFECTS_ALLMET = new Set(["", "MEASURED", "MEASURED_IF", "TRIGGER"]);
const CHAIN_FLAGS = new Set(["AND_NEXT", "OR_NEXT"]);

/**
 * Detect ADD_HITS/SUB_HITS chains in a requirement list. Returns a map from
 * terminal index → array of contributor indices.
 */
function detectAhsChains(
    reqs: Array<Record<string, unknown>>,
): Map<number, { contributors: number[]; flags: string[] }> {
    const chains = new Map<number, { contributors: number[]; flags: string[] }>();
    for (let k = 0; k < reqs.length; k++) {
        const f = (reqs[k].flag as string) || "";
        if (f !== "ADD_HITS" && f !== "SUB_HITS") continue;
        const contributors: number[] = [k];
        const flags: string[] = [f];
        let t = k + 1;
        while (t < reqs.length) {
            const tf = (reqs[t].flag as string) || "";
            if (tf === "ADD_HITS" || tf === "SUB_HITS") {
                contributors.push(t);
                flags.push(tf);
                t++;
            } else break;
        }
        if (t < reqs.length) {
            chains.set(t, { contributors, flags });
        }
        k = t - 1; // skip past chain
    }
    return chains;
}

/**
 * Emit delta-only updates for all non-PAUSE_IF requirements in a paused group.
 * Evaluates formulas only for delta side-effects, no comparison or hit tracking.
 */
function emitGroupDeltaOnly(
    asm: AVM1Builder,
    reqs: Array<Record<string, unknown>>,
    formulas: Array<{ bytesA: Uint8Array; bytesB: Uint8Array }>,
    g: number,
): void {
    for (let k = 0; k < reqs.length; k++) {
        const req = reqs[k];
        if ((req.flag as string) === "PAUSE_IF") continue;
        const hasDeltaA = req.typeA === "DELTA";
        const hasDeltaB = req.typeB === "DELTA";
        if (!hasDeltaA && !hasDeltaB) continue;
        const { bytesA, bytesB } = formulas[k];
        if (hasDeltaA) {
            asm.rawBytes(bytesA);
            asm.storeRegister(R_VAL_A);
            asm.pop();
            // Store current value, set init flag (don't need result)
            asm.push(aRegister(R_STORAGE), aString(`dA${g}_${k}`), aRegister(R_VAL_A));
            asm.setMember();
            asm.push(aRegister(R_STORAGE), aString(`dAi${g}_${k}`), aBool(true));
            asm.setMember();
        }
        if (hasDeltaB) {
            asm.rawBytes(bytesB);
            asm.storeRegister(R_VAL_B);
            asm.pop();
            asm.push(aRegister(R_STORAGE), aString(`dB${g}_${k}`), aRegister(R_VAL_B));
            asm.setMember();
            asm.push(aRegister(R_STORAGE), aString(`dBi${g}_${k}`), aBool(true));
            asm.setMember();
        }
    }
}

/**
 * Emit one group's requirements (non-PAUSE_IF). Sets R_ALL_MET for the group
 * and may set R_RESET_FIRED. Handles all flag types: chains, sources,
 * ADD_HITS/SUB_HITS, RESET_IF, RESET_NEXT_IF, TRIGGER, MEASURED/MEASURED_IF.
 */
function emitGroupRequirements(
    asm: AVM1Builder,
    reqs: Array<Record<string, unknown>>,
    formulas: Array<{ bytesA: Uint8Array; bytesB: Uint8Array }>,
    g: number,
    hasTrigger: boolean,
    rnifTargets: Array<{ g: number; k: number }>,
    pauseIfIndices: Set<number>,
): void {
    // R_ALL_MET = true
    asm.push(aBool(true));
    asm.storeRegister(R_ALL_MET);
    asm.pop();

    // Source accumulator — stored in storage._sa, reset to 0
    const hasSource = reqs.some(r => {
        const f = (r.flag as string) || "";
        return f === "ADD_SOURCE" || f === "SUB_SOURCE";
    });
    if (hasSource) {
        asm.push(aRegister(R_STORAGE), aString("_sa"), aInt(0));
        asm.setMember();
    }

    // Pre-detect ADD_HITS/SUB_HITS chains
    const ahsChains = detectAhsChains(reqs);
    const ahsContributorSet = new Set<number>();
    for (const [, info] of ahsChains) {
        for (const c of info.contributors) ahsContributorSet.add(c);
    }

    for (let k = 0; k < reqs.length; k++) {
        const req = reqs[k];
        const flag = (req.flag as string) || "";
        const maxHits = (req.maxHits as number) || 0;
        const hitsKey = `h${g}_${k}`;

        // Skip PAUSE_IF (handled in pause phase)
        if (pauseIfIndices.has(k)) continue;

        // --- ADD_SOURCE / SUB_SOURCE ---
        if (flag === "ADD_SOURCE" || flag === "SUB_SOURCE") {
            const { bytesA } = formulas[k];
            // Evaluate formula A
            asm.rawBytes(bytesA);
            asm.storeRegister(R_VAL_A);
            asm.pop();
            // Handle delta A for source requirements
            if (req.typeA === "DELTA") {
                const notInit = emitDeltaCore(asm, `dA${g}_${k}`, `dAi${g}_${k}`, R_VAL_A);
                const donePatch = asm.jumpForward();
                asm.patchJumpHere(notInit);
                // Not initialized: skip accumulation, use 0 contribution
                asm.push(aInt(0));
                asm.storeRegister(R_VAL_A);
                asm.pop();
                asm.patchJumpHere(donePatch);
            }
            // Accumulate: storage._sa += (or -=) R_VAL_A
            asm.push(aRegister(R_STORAGE), aString("_sa"));
            asm.getMember(); // current accumulator
            asm.push(aRegister(R_VAL_A));
            if (flag === "ADD_SOURCE") asm.add2(); else asm.subtract();
            asm.storeRegister(R_SCRATCH1);
            asm.pop();
            asm.push(aRegister(R_STORAGE), aString("_sa"), aRegister(R_SCRATCH1));
            asm.setMember();
            continue;
        }

        // --- ADD_HITS / SUB_HITS contributor (non-terminal, handled at terminal) ---
        if (ahsContributorSet.has(k)) {
            // Evaluate condition for hit tracking
            const { bytesA, bytesB } = formulas[k];
            const nextReqPatches: number[] = [];
            if (maxHits > 0) {
                emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
                asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
                asm.less2(); asm.not();
                nextReqPatches.push(asm.jumpIfForward());
            }
            emitRequirementEval(asm, req, k, bytesA, bytesB, nextReqPatches, g);
            // Track hits: increment if passed, capped by own maxHits
            if (maxHits > 0) {
                emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
                asm.push(aRegister(R_SCRATCH2));
                asm.not();
                const skip1 = asm.jumpIfForward();
                asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
                asm.less2(); asm.not();
                const skip2 = asm.jumpIfForward();
                asm.push(aRegister(R_SCRATCH1));
                asm.increment();
                asm.storeRegister(R_SCRATCH1);
                asm.pop();
                asm.push(aRegister(R_STORAGE), aString(hitsKey), aRegister(R_SCRATCH1));
                asm.setMember();
                asm.patchJumpHere(skip1);
                asm.patchJumpHere(skip2);
            } else {
                // No cap: always increment when passed
                asm.push(aRegister(R_SCRATCH2));
                asm.not();
                const skip = asm.jumpIfForward();
                emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
                asm.push(aRegister(R_SCRATCH1));
                asm.increment();
                asm.storeRegister(R_SCRATCH1);
                asm.pop();
                asm.push(aRegister(R_STORAGE), aString(hitsKey), aRegister(R_SCRATCH1));
                asm.setMember();
                asm.patchJumpHere(skip);
            }
            for (const p of nextReqPatches) asm.patchJumpHere(p);
            continue;
        }

        // --- AND_NEXT/OR_NEXT chain ---
        if (CHAIN_FLAGS.has(flag)) {
            const memberIndices: number[] = [k];
            let termIdx = k + 1;
            while (termIdx < reqs.length) {
                const tf = (reqs[termIdx].flag as string) || "";
                if (!CHAIN_FLAGS.has(tf)) break;
                memberIndices.push(termIdx);
                termIdx++;
            }
            if (termIdx >= reqs.length) return; // chain without terminal (shouldn't happen, validated)

            emitChain(asm, reqs, memberIndices, termIdx, formulas, g);

            const termReq = reqs[termIdx];
            const termFlag = (termReq.flag as string) || "";
            const termMaxHits = (termReq.maxHits as number) || 0;
            const termHitsKey = `h${g}_${termIdx}`;

            emitPostComparison(asm, termFlag, termHitsKey, termMaxHits, hasTrigger, rnifTargets, g, termIdx, reqs, ahsChains);

            k = termIdx;
            continue;
        }

        // --- Standalone requirement ---
        const { bytesA, bytesB } = formulas[k];
        const nextReqPatches: number[] = [];

        // Locked-true check (skip for AHS terminals — their satisfaction
        // depends on effective hits, not just own hits)
        const isAhsTerminal = ahsChains.has(k);
        if (maxHits > 0 && !isAhsTerminal) {
            emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
            asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
            asm.less2(); asm.not();
            nextReqPatches.push(asm.jumpIfForward());
        }

        // Consume source accumulator: add to R_VAL_A after formula eval
        emitRequirementEval(asm, req, k, bytesA, bytesB, nextReqPatches, g);
        if (hasSource) {
            asm.push(aRegister(R_STORAGE), aString("_sa"));
            asm.getMember();
            asm.storeRegister(R_SCRATCH1);
            asm.pop();
            // If accumulator != 0, add to R_VAL_A and re-compare
            asm.push(aRegister(R_SCRATCH1), aInt(0));
            asm.equals2();
            const skipAccPatch = asm.jumpIfForward();
            asm.push(aRegister(R_VAL_A), aRegister(R_SCRATCH1));
            asm.add2();
            asm.storeRegister(R_VAL_A);
            asm.pop();
            // Re-compare with updated R_VAL_A
            emitComparison(asm, req.cmp as string);
            asm.patchJumpHere(skipAccPatch);
            // Reset accumulator
            asm.push(aRegister(R_STORAGE), aString("_sa"), aInt(0));
            asm.setMember();
        }

        emitPostComparison(asm, flag, hitsKey, maxHits, hasTrigger, rnifTargets, g, k, reqs, ahsChains);

        for (const p of nextReqPatches) asm.patchJumpHere(p);
    }
}

/**
 * Emit post-comparison logic for a requirement based on its flag.
 * R_SCRATCH2 must hold the passed/chain-result boolean.
 */
function emitPostComparison(
    asm: AVM1Builder,
    flag: string,
    hitsKey: string,
    maxHits: number,
    hasTrigger: boolean,
    rnifTargets: Array<{ g: number; k: number }>,
    g: number,
    k: number,
    reqs: Array<Record<string, unknown>>,
    ahsChains: Map<number, { contributors: number[]; flags: string[] }>,
): void {
    if (flag === "RESET_IF") {
        emitResetIfTracking(asm, hitsKey, maxHits);
    } else if (flag === "RESET_NEXT_IF") {
        // Track hits and determine if fires → R_SCRATCH2 = fired
        emitResetIfStyleTracking(asm, hitsKey, maxHits);
        // Determine target: next non-PAUSE_IF requirement
        let target = k + 1;
        while (target < reqs.length && (reqs[target].flag as string) === "PAUSE_IF") target++;
        if (target < reqs.length) {
            // Conditionally store fire flag for epilogue
            asm.push(aRegister(R_SCRATCH2));
            asm.not();
            const skipRnifStore = asm.jumpIfForward();
            asm.push(aRegister(R_STORAGE), aString(`_rnif_${g}_${target}`), aBool(true));
            asm.setMember();
            asm.patchJumpHere(skipRnifStore);
            rnifTargets.push({ g, k: target });
        }
    } else if (flag === "ADD_HITS" || flag === "SUB_HITS") {
        // Contributor - shouldn't reach here (handled above), but safe no-op
    } else {
        // Normal, MEASURED, MEASURED_IF, TRIGGER: hit tracking + allMet
        const ahsInfo = ahsChains.get(k);
        if (ahsInfo && maxHits > 0) {
            // ADD_HITS/SUB_HITS terminal: compute effective hits
            emitAhsTerminalTracking(asm, hitsKey, maxHits, g, ahsInfo);
        } else {
            emitNormalHitTracking(asm, hitsKey, maxHits);
        }

        // TRIGGER tracking
        if (hasTrigger && AFFECTS_ALLMET.has(flag)) {
            // If this requirement is not satisfied (allMet was just potentially set to false),
            // update the appropriate trigger tracker
            // We need to know if THIS req is satisfied. R_SCRATCH2 still has passed.
            // For hit-based satisfaction, we check differently. Simplify: if allMet was
            // set to false by this requirement, one of the trackers needs updating.
            // But we don't know if THIS req was the one that set it.
            // Simpler: track satisfaction per-requirement. Use a flag in R_SCRATCH1.
            // Actually, the simplest approach: after emitNormalHitTracking, the "met" state
            // was computed. If not met, we already set R_ALL_MET=false. We need to also
            // set the appropriate trigger tracker to false.
            // Re-derive satisfaction: read R_ALL_MET? No, that's cumulative.
            // Best: re-check satisfaction inline.
            if (flag === "TRIGGER") {
                // If not satisfied: storage._atm = false
                // Re-derive: for maxHits>0, satisfied = hits>=maxHits. For maxHits==0, satisfied = passed.
                if (maxHits > 0) {
                    emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
                    asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
                    asm.less2(); asm.not(); // hits >= maxHits?
                    const satPatch = asm.jumpIfForward();
                    asm.push(aRegister(R_STORAGE), aString("_atm"), aBool(false));
                    asm.setMember();
                    asm.patchJumpHere(satPatch);
                } else {
                    asm.push(aRegister(R_SCRATCH2));
                    const satPatch = asm.jumpIfForward();
                    asm.push(aRegister(R_STORAGE), aString("_atm"), aBool(false));
                    asm.setMember();
                    asm.patchJumpHere(satPatch);
                }
            } else {
                // Non-TRIGGER: if not satisfied, storage._antm = false
                if (maxHits > 0) {
                    emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
                    asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
                    asm.less2(); asm.not();
                    const satPatch = asm.jumpIfForward();
                    asm.push(aRegister(R_STORAGE), aString("_antm"), aBool(false));
                    asm.setMember();
                    asm.patchJumpHere(satPatch);
                } else {
                    asm.push(aRegister(R_SCRATCH2));
                    const satPatch = asm.jumpIfForward();
                    asm.push(aRegister(R_STORAGE), aString("_antm"), aBool(false));
                    asm.setMember();
                    asm.patchJumpHere(satPatch);
                }
            }
        }

        // MEASURED_IF gate tracking: if this MEASURED_IF requirement is not
        // satisfied, set _mifOk_{g} = false so the epilogue can zero _mCur.
        if (flag === "MEASURED_IF") {
            if (maxHits > 0) {
                emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
                asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
                asm.less2(); asm.not(); // hits >= maxHits?
                const mifPatch = asm.jumpIfForward();
                asm.push(aRegister(R_STORAGE), aString(`_mifOk_${g}`), aBool(false));
                asm.setMember();
                asm.patchJumpHere(mifPatch);
            } else {
                asm.push(aRegister(R_SCRATCH2));
                const mifPatch = asm.jumpIfForward();
                asm.push(aRegister(R_STORAGE), aString(`_mifOk_${g}`), aBool(false));
                asm.setMember();
                asm.patchJumpHere(mifPatch);
            }
        }
    }
}

/**
 * RESET_NEXT_IF hit tracking + fire detection. Same structure as RESET_IF
 * tracking but sets R_SCRATCH2 = fire flag (for the caller to record target).
 */
function emitResetIfStyleTracking(
    asm: AVM1Builder,
    hitsKey: string,
    maxHits: number,
): void {
    // Identical logic to emitResetIfTracking but uses R_SCRATCH2 as fire flag
    // instead of R_RESET_FIRED
    if (maxHits === 0) {
        // Fires when passed — R_SCRATCH2 already has passed, nothing more to do
    } else {
        emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
        asm.push(aRegister(R_SCRATCH2));
        asm.not();
        const skipInc = asm.jumpIfForward();
        asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
        asm.less2(); asm.not();
        const skipInc2 = asm.jumpIfForward();
        asm.push(aRegister(R_SCRATCH1));
        asm.increment();
        asm.storeRegister(R_SCRATCH1);
        asm.pop();
        asm.push(aRegister(R_STORAGE), aString(hitsKey), aRegister(R_SCRATCH1));
        asm.setMember();
        asm.patchJumpHere(skipInc);
        asm.patchJumpHere(skipInc2);
        // Fire check: R_SCRATCH2 = hits >= maxHits
        asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
        asm.less2(); asm.not();
        asm.storeRegister(R_SCRATCH2);
        asm.pop();
    }
}

/**
 * Emit ADD_HITS/SUB_HITS terminal tracking. Increments own hits, then
 * computes effective hits (own + contributors) for satisfaction check.
 * Does NOT call emitNormalHitTracking to avoid premature allMet=false.
 */
function emitAhsTerminalTracking(
    asm: AVM1Builder,
    hitsKey: string,
    maxHits: number,
    g: number,
    ahsInfo: { contributors: number[]; flags: string[] },
): void {
    // Step 1: Increment own hits if passed and below cap
    emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
    asm.push(aRegister(R_SCRATCH2)); // passed
    asm.not();
    const skipInc = asm.jumpIfForward();
    asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
    asm.less2(); asm.not();
    const skipInc2 = asm.jumpIfForward();
    asm.push(aRegister(R_SCRATCH1));
    asm.increment();
    asm.storeRegister(R_SCRATCH1);
    asm.pop();
    asm.push(aRegister(R_STORAGE), aString(hitsKey), aRegister(R_SCRATCH1));
    asm.setMember();
    asm.patchJumpHere(skipInc);
    asm.patchJumpHere(skipInc2);

    // Step 2: Compute effective hits = own + ADD_HITS - SUB_HITS
    emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
    for (let i = 0; i < ahsInfo.contributors.length; i++) {
        const cIdx = ahsInfo.contributors[i];
        const cKey = `h${g}_${cIdx}`;
        emitReadHitsToReg(asm, cKey, R_SCRATCH2);
        asm.push(aRegister(R_SCRATCH1), aRegister(R_SCRATCH2));
        if (ahsInfo.flags[i] === "ADD_HITS") asm.add2(); else asm.subtract();
        asm.storeRegister(R_SCRATCH1);
        asm.pop();
    }

    // Step 3: Satisfaction check with effective hits
    asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
    asm.less2(); asm.not(); // effectiveHits >= maxHits?
    const metPatch = asm.jumpIfForward();
    asm.push(aBool(false));
    asm.storeRegister(R_ALL_MET);
    asm.pop();
    asm.patchJumpHere(metPatch);
}

/**
 * Compile one achievement into a function body. Throws on failure.
 */
function compileAchievementBody(
    asset: Record<string, unknown>,
): Uint8Array {
    const groups = asset.groups as Array<Record<string, unknown>> | undefined;
    if (!groups || groups.length === 0) {
        throw new Error("Achievement has no groups");
    }

    // Validate all groups
    for (const group of groups) {
        const type = group.type as string;
        if (type !== "CORE" && type !== "ALT") {
            throw new Error(`Unknown group type: ${type}`);
        }
        const reqs = group.requirements as Array<Record<string, unknown>> | undefined;
        if (!reqs) {
            throw new Error("Group has no requirements array");
        }
        for (const req of reqs) {
            const flag = (req.flag as string) || "";
            if (!KNOWN_FLAGS.has(flag)) {
                throw new Error(`Unknown requirement flag: ${flag}`);
            }
        }
    }

    // Analysis across all groups
    let hasResetIf = false;
    let hasTrigger = false;
    let hasMeasured = false;
    for (const group of groups) {
        const reqs = group.requirements as Array<Record<string, unknown>>;
        for (const req of reqs) {
            const f = (req.flag as string) || "";
            if (f === "RESET_IF") hasResetIf = true;
            if (f === "TRIGGER") hasTrigger = true;
            if (f === "MEASURED" || f === "MEASURED_IF") hasMeasured = true;
        }
    }

    // Pre-compile all formulas across all groups
    const ctx: CompileContext = { nextRememberKey: 0 };
    const regs = ACH_FORMULA_REGS;
    const allGroupFormulas: Array<Array<{ bytesA: Uint8Array; bytesB: Uint8Array }>> = [];
    for (const group of groups) {
        const reqs = group.requirements as Array<Record<string, unknown>>;
        const gFormulas: Array<{ bytesA: Uint8Array; bytesB: Uint8Array }> = [];
        for (const req of reqs) {
            const bytesA = compileFormulaToBytes(req.addressA as string, ctx, regs);
            const bytesB = compileFormulaToBytes(req.addressB as string, ctx, regs);
            gFormulas.push({ bytesA, bytesB });
        }
        allGroupFormulas.push(gFormulas);
    }

    const asm = new AVM1Builder();

    // === Prologue ===
    if (hasResetIf) {
        asm.push(aBool(false));
        asm.storeRegister(R_RESET_FIRED);
        asm.pop();
    }
    if (hasTrigger) {
        asm.push(aRegister(R_STORAGE), aString("_antm"), aBool(true));
        asm.setMember();
        asm.push(aRegister(R_STORAGE), aString("_atm"), aBool(true));
        asm.setMember();
    }
    // Init MEASURED_IF gate flags per group
    for (let g = 0; g < groups.length; g++) {
        const reqs = (groups[g] as Record<string, unknown>).requirements as Array<Record<string, unknown>>;
        for (const r of reqs) {
            if ((r.flag as string) === "MEASURED_IF") {
                asm.push(aRegister(R_STORAGE), aString(`_mifOk_${g}`), aBool(true));
                asm.setMember();
                break;
            }
        }
    }

    // Collect RESET_NEXT_IF targets across all groups
    const rnifTargets: Array<{ g: number; k: number }> = [];

    // === Per-group evaluation ===
    for (let g = 0; g < groups.length; g++) {
        const group = groups[g] as Record<string, unknown>;
        const reqs = group.requirements as Array<Record<string, unknown>>;
        const formulas = allGroupFormulas[g];

        // Identify PAUSE_IF indices (including chains ending in PAUSE_IF)
        const pauseIfIndices = new Set<number>();
        for (let k = 0; k < reqs.length; k++) {
            if ((reqs[k].flag as string) === "PAUSE_IF") pauseIfIndices.add(k);
        }
        // Also identify AND_NEXT/OR_NEXT chains ending in PAUSE_IF
        for (let k = 0; k < reqs.length; k++) {
            const f = (reqs[k].flag as string) || "";
            if (!CHAIN_FLAGS.has(f)) continue;
            let t = k + 1;
            while (t < reqs.length && CHAIN_FLAGS.has((reqs[t].flag as string) || "")) t++;
            if (t < reqs.length && (reqs[t].flag as string) === "PAUSE_IF") {
                for (let m = k; m <= t; m++) pauseIfIndices.add(m);
            }
            k = t;
        }

        const groupHasPauseIf = pauseIfIndices.size > 0;
        let skipGroupPatch = -1;

        // --- PAUSE_IF phase ---
        if (groupHasPauseIf) {
            // Evaluate PAUSE_IF requirements → R_ALL_MET = isPaused
            asm.push(aBool(false));
            asm.storeRegister(R_ALL_MET); // isPaused = false
            asm.pop();

            for (let k = 0; k < reqs.length; k++) {
                if (!pauseIfIndices.has(k)) continue;
                const req = reqs[k];
                const flag = (req.flag as string) || "";

                if (CHAIN_FLAGS.has(flag)) {
                    // Chain ending in PAUSE_IF
                    const memberIndices: number[] = [k];
                    let t = k + 1;
                    while (t < reqs.length && CHAIN_FLAGS.has((reqs[t].flag as string) || "")) {
                        memberIndices.push(t);
                        t++;
                    }
                    emitChain(asm, reqs, memberIndices, t, formulas, g);
                    // R_SCRATCH2 = chain result (passed for PAUSE_IF)
                    const pReq = reqs[t];
                    const pMaxHits = (pReq.maxHits as number) || 0;
                    const pHitsKey = `h${g}_${t}`;
                    emitPauseIfFire(asm, pHitsKey, pMaxHits);
                    k = t;
                    continue;
                }

                if (flag !== "PAUSE_IF") continue;

                // Standalone PAUSE_IF
                const maxHits = (req.maxHits as number) || 0;
                const hitsKey = `h${g}_${k}`;
                const { bytesA, bytesB } = formulas[k];
                if (maxHits > 0) {
                    // If already at threshold, skip evaluation but still fire pause
                    emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
                    asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
                    asm.less2(); asm.not(); // hits >= maxHits?
                    const alreadyLockedPatch = asm.jumpIfForward();
                    // Not locked: evaluate formula + fire logic
                    const patchesPif: number[] = [];
                    emitRequirementEval(asm, req, k, bytesA, bytesB, patchesPif, g);
                    emitPauseIfFire(asm, hitsKey, maxHits);
                    for (const p of patchesPif) asm.patchJumpHere(p);
                    const skipLockedPatch = asm.jumpForward();
                    // Locked: hits already at threshold → pause fires unconditionally
                    asm.patchJumpHere(alreadyLockedPatch);
                    asm.push(aBool(true));
                    asm.storeRegister(R_ALL_MET);
                    asm.pop();
                    asm.patchJumpHere(skipLockedPatch);
                } else {
                    // Transient: no locked-true concept, always evaluate
                    const patchesPif: number[] = [];
                    emitRequirementEval(asm, req, k, bytesA, bytesB, patchesPif, g);
                    emitPauseIfFire(asm, hitsKey, maxHits);
                    for (const p of patchesPif) asm.patchJumpHere(p);
                }
            }

            // R_ALL_MET = isPaused. If paused: delta-only, group=false
            asm.push(aRegister(R_ALL_MET));
            asm.not();
            const notPausedPatch = asm.jumpIfForward();
            // PAUSED path
            emitGroupDeltaOnly(asm, reqs, formulas, g);
            if (groups.length > 1) {
                asm.push(aRegister(R_STORAGE), aString(`_g${g}`), aBool(false));
                asm.setMember();
            } else {
                asm.push(aBool(false));
                asm.storeRegister(R_ALL_MET);
                asm.pop();
            }
            skipGroupPatch = asm.jumpForward();
            asm.patchJumpHere(notPausedPatch);
        }

        // --- Normal evaluation ---
        emitGroupRequirements(asm, reqs, formulas, g, hasTrigger, rnifTargets, pauseIfIndices);

        if (groups.length > 1) {
            asm.push(aRegister(R_STORAGE), aString(`_g${g}`), aRegister(R_ALL_MET));
            asm.setMember();
        }

        if (groupHasPauseIf) {
            asm.patchJumpHere(skipGroupPatch);
        }
    }

    // === RESET_NEXT_IF epilogue: clear target hits ===
    for (const target of rnifTargets) {
        const targetKey = `_rnif_${target.g}_${target.k}`;
        const hitsKey = `h${target.g}_${target.k}`;
        // if storage[targetKey] is true: clear target's hits
        asm.push(aRegister(R_STORAGE), aString(targetKey));
        asm.getMember();
        asm.not();
        const skipRnif = asm.jumpIfForward();
        asm.push(aRegister(R_STORAGE), aString(hitsKey), aInt(0));
        asm.setMember();
        // Clear the flag
        asm.push(aRegister(R_STORAGE), aString(targetKey), aBool(false));
        asm.setMember();
        asm.patchJumpHere(skipRnif);
    }

    // === RESET_IF epilogue ===
    if (hasResetIf) {
        asm.push(aRegister(R_RESET_FIRED));
        asm.not();
        const noResetPatch = asm.jumpIfForward();
        // Clear ALL hit storage keys across ALL groups
        for (let g = 0; g < groups.length; g++) {
            const reqs = (groups[g] as Record<string, unknown>).requirements as Array<Record<string, unknown>>;
            for (let k = 0; k < reqs.length; k++) {
                const mh = (reqs[k].maxHits as number) || 0;
                const f = (reqs[k].flag as string) || "";
                // Clear if has maxHits OR is ADD_HITS/SUB_HITS (they track hits even with maxHits=0)
                if (mh > 0 || f === "ADD_HITS" || f === "SUB_HITS") {
                    asm.push(aRegister(R_STORAGE), aString(`h${g}_${k}`), aInt(0));
                    asm.setMember();
                }
            }
        }
        asm.push(aInt(0));
        asm.returnOp();
        asm.patchJumpHere(noResetPatch);
    }

    // === Group logic ===
    if (groups.length > 1) {
        // CORE result from group 0
        asm.push(aRegister(R_STORAGE), aString("_g0"));
        asm.getMember();
        asm.storeRegister(R_ALL_MET);
        asm.pop();

        // Check ALT groups
        const hasAlt = groups.some((gr, i) => i > 0 && (gr as Record<string, unknown>).type === "ALT");
        if (hasAlt) {
            asm.push(aBool(false));
            asm.storeRegister(R_SCRATCH1); // anyAltPassed
            asm.pop();
            for (let g = 1; g < groups.length; g++) {
                if ((groups[g] as Record<string, unknown>).type !== "ALT") continue;
                // anyAltPassed = anyAltPassed OR storage._g<g>
                asm.push(aRegister(R_SCRATCH1));
                asm.not();
                asm.push(aRegister(R_STORAGE), aString(`_g${g}`));
                asm.getMember();
                asm.not();
                asm.multiply();
                asm.not();
                asm.storeRegister(R_SCRATCH1);
                asm.pop();
            }
            // R_ALL_MET = R_ALL_MET AND anyAltPassed
            asm.push(aRegister(R_ALL_MET));
            asm.not(); asm.not();
            asm.push(aRegister(R_SCRATCH1));
            asm.not(); asm.not();
            asm.multiply();
            asm.storeRegister(R_ALL_MET);
            asm.pop();
        }
    }

    // === TRIGGER / primed epilogue ===
    if (hasTrigger) {
        // primed = allNonTriggerMet AND NOT allTriggerMet
        asm.push(aRegister(R_STORAGE), aString("_antm"));
        asm.getMember();
        asm.not(); asm.not(); // !!allNonTriggerMet
        asm.push(aRegister(R_STORAGE), aString("_atm"));
        asm.getMember();
        asm.not(); // NOT allTriggerMet
        asm.multiply(); // primed
        asm.storeRegister(R_SCRATCH1);
        asm.pop();
        // Store primed state for firmware
        asm.push(aRegister(R_STORAGE), aString("_primed"), aRegister(R_SCRATCH1));
        asm.setMember();
        // If primed: don't trigger
        asm.push(aRegister(R_SCRATCH1));
        asm.not();
        const notPrimedPatch = asm.jumpIfForward();
        asm.push(aBool(false));
        asm.storeRegister(R_ALL_MET);
        asm.pop();
        asm.patchJumpHere(notPrimedPatch);
    }

    // === MEASURED epilogue ===
    if (hasMeasured) {
        emitMeasuredEpilogue(asm, groups as Array<Record<string, unknown>>, allGroupFormulas);
    }

    // === Return ===
    asm.push(aRegister(R_ALL_MET));
    asm.not();
    const notTriggeredPatch = asm.jumpIfForward();
    asm.push(aInt(1));
    asm.returnOp();
    asm.patchJumpHere(notTriggeredPatch);
    asm.push(aInt(0));
    asm.returnOp();

    return asm.toBytes();
}

/**
 * Emit PAUSE_IF fire detection. R_SCRATCH2 has the passed boolean.
 * If the PAUSE_IF fires, sets R_ALL_MET = true (isPaused).
 */
function emitPauseIfFire(
    asm: AVM1Builder,
    hitsKey: string,
    maxHits: number,
): void {
    if (maxHits === 0) {
        // Transient pause: fires when condition passes
        asm.push(aRegister(R_SCRATCH2));
        asm.not();
        const skipPatch = asm.jumpIfForward();
        asm.push(aBool(true));
        asm.storeRegister(R_ALL_MET);
        asm.pop();
        asm.patchJumpHere(skipPatch);
    } else {
        // Threshold pause: track hits, fire when hits reach maxHits
        emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);
        asm.push(aRegister(R_SCRATCH2));
        asm.not();
        const skipInc = asm.jumpIfForward();
        asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
        asm.less2(); asm.not();
        const skipInc2 = asm.jumpIfForward();
        asm.push(aRegister(R_SCRATCH1));
        asm.increment();
        asm.storeRegister(R_SCRATCH1);
        asm.pop();
        asm.push(aRegister(R_STORAGE), aString(hitsKey), aRegister(R_SCRATCH1));
        asm.setMember();
        asm.patchJumpHere(skipInc);
        asm.patchJumpHere(skipInc2);
        // Fire check: skip fire when hits < maxHits
        asm.push(aRegister(R_SCRATCH1), aInt(maxHits));
        asm.less2();
        const skipFire = asm.jumpIfForward(); // hits < maxHits → skip
        asm.push(aBool(true));
        asm.storeRegister(R_ALL_MET);
        asm.pop();
        asm.patchJumpHere(skipFire);
    }
}

/**
 * Emit MEASURED epilogue — computes current/target and stores in storage
 * for the firmware to display. Handles both hit-count and value modes.
 */
function emitMeasuredEpilogue(
    asm: AVM1Builder,
    groups: Array<Record<string, unknown>>,
    allGroupFormulas: Array<Array<{ bytesA: Uint8Array; bytesB: Uint8Array }>>,
): void {
    // Find MEASURED requirements and compute values
    for (let g = 0; g < groups.length; g++) {
        const reqs = groups[g].requirements as Array<Record<string, unknown>>;
        for (let k = 0; k < reqs.length; k++) {
            const req = reqs[k];
            if ((req.flag as string) !== "MEASURED") continue;
            const maxHits = (req.maxHits as number) || 0;

            if (maxHits > 0) {
                // Hit Count Mode: current = effective hits, target = maxHits
                const hitsKey = `h${g}_${k}`;
                emitReadHitsToReg(asm, hitsKey, R_SCRATCH1);

                // Check for ADD_HITS/SUB_HITS contributors
                const ahsChains = detectAhsChains(reqs);
                const ahsInfo = ahsChains.get(k);
                if (ahsInfo) {
                    for (let i = 0; i < ahsInfo.contributors.length; i++) {
                        const cKey = `h${g}_${ahsInfo.contributors[i]}`;
                        asm.push(aRegister(R_STORAGE), aString(cKey));
                        asm.getMember();
                        asm.storeRegister(R_SCRATCH2);
                        asm.push(aUndefined());
                        asm.equals2();
                        asm.not();
                        const hasV = asm.jumpIfForward();
                        asm.push(aInt(0));
                        asm.storeRegister(R_SCRATCH2);
                        asm.pop();
                        asm.patchJumpHere(hasV);
                        asm.push(aRegister(R_SCRATCH1), aRegister(R_SCRATCH2));
                        if (ahsInfo.flags[i] === "ADD_HITS") asm.add2(); else asm.subtract();
                        asm.storeRegister(R_SCRATCH1);
                        asm.pop();
                    }
                }

                // Store: storage._mCur = R_SCRATCH1, storage._mTgt = maxHits
                asm.push(aRegister(R_STORAGE), aString("_mCur"), aRegister(R_SCRATCH1));
                asm.setMember();
                asm.push(aRegister(R_STORAGE), aString("_mTgt"), aInt(maxHits));
                asm.setMember();
            } else {
                // Value Mode: current = evaluated A, target = evaluated B
                const { bytesA, bytesB } = allGroupFormulas[g][k];
                asm.rawBytes(bytesA);
                asm.storeRegister(R_SCRATCH1);
                asm.pop();
                asm.rawBytes(bytesB);
                asm.storeRegister(R_SCRATCH2);
                asm.pop();
                asm.push(aRegister(R_STORAGE), aString("_mCur"), aRegister(R_SCRATCH1));
                asm.setMember();
                asm.push(aRegister(R_STORAGE), aString("_mTgt"), aRegister(R_SCRATCH2));
                asm.setMember();
            }

            // Check MEASURED_IF gates in the same group
            let hasMeasuredIf = false;
            for (const r of reqs) {
                if ((r.flag as string) === "MEASURED_IF") { hasMeasuredIf = true; break; }
            }
            if (hasMeasuredIf) {
                // If any MEASURED_IF in this group failed, _mifOk_{g} was set
                // to false during evaluation. Zero _mCur when the gate fails.
                asm.push(aRegister(R_STORAGE), aString(`_mifOk_${g}`));
                asm.getMember();
                const skipZero = asm.jumpIfForward();
                asm.push(aRegister(R_STORAGE), aString("_mCur"), aInt(0));
                asm.setMember();
                asm.patchJumpHere(skipZero);
            }

            break; // Only first MEASURED per group
        }
    }
}

// ============================================================================
// Rich Presence compilation
// ============================================================================

// Register allocation for Rich Presence functions (simpler than achievements)
const RP_R_GAMEROOT = 1;
const RP_R_STORAGE = 2;
const RP_R_TEMP = 3;
const RP_R_ARR = 4;
const RP_R_MATCH = 5;
const RP_REGISTER_COUNT = 6;

const RP_FORMULA_REGS: FormulaRegs = {
    gameRoot: RP_R_GAMEROOT,
    temp: RP_R_TEMP,
    arr: RP_R_ARR,
    match: RP_R_MATCH,
    storage: RP_R_STORAGE,
};

/**
 * Compile a Rich Presence asset to a native AVM1 function body.
 * function(gameRoot, storage) → string result
 *
 * The formula is compiled as-is and the result is returned directly.
 * Storage is used for REMEMBER values.
 */
function compileRichPresenceBody(asset: Record<string, unknown>): Uint8Array {
    const formula = String(asset.formula ?? '""');
    const dslBytecode = Formula.compile(formula) as string[];

    const ctx: CompileContext = { nextRememberKey: 0 };
    const asm = new AVM1Builder();

    if (!compileDSLFormula(dslBytecode, asm, ctx, RP_FORMULA_REGS)) {
        throw new Error(`Failed to compile Rich Presence formula: ${formula}`);
    }

    // Stack has formula result; return it
    asm.returnOp();
    return asm.toBytes();
}

// ============================================================================
// SWF generation
// ============================================================================

export interface NativeAchResult {
    swf: Uint8Array;
    compiledIndices: number[];
    rpCompiledIndices: number[];
}

/**
 * Compile all achievements and Rich Presence to native AVM1 functions, packaged as one SWF.
 * Throws if any asset fails to compile.
 *
 * Generated SWF structure:
 *   _global.__nativeAch = [achFn0, achFn1, ...]
 *   _global.__nativeRP  = [rpFn0, rpFn1, ...]
 */
export function compileAchievementsSWF(assets: unknown[]): NativeAchResult {
    const compiledIndices: number[] = [];
    const functionBodies: Uint8Array[] = [];
    const rpCompiledIndices: number[] = [];
    const rpFunctionBodies: Uint8Array[] = [];

    for (let i = 0; i < (assets as Array<Record<string, unknown>>).length; i++) {
        const asset = (assets as Array<Record<string, unknown>>)[i];
        if (asset == null) continue;

        if (asset.type === "RICH_PRESENCE") {
            const body = compileRichPresenceBody(asset);
            rpCompiledIndices.push(i);
            rpFunctionBodies.push(body);
        } else {
            const body = compileAchievementBody(asset);
            compiledIndices.push(i);
            functionBodies.push(body);
        }
    }

    const mainAsm = new AVM1Builder();

    // Build _global.__nativeAch = [achFn0, achFn1, ...]
    mainAsm.push(aString("_global"));
    mainAsm.getVariable();
    mainAsm.push(aString("__nativeAch"));

    // Push in reverse: initArray pops LIFO, so last-pushed → index 0
    for (let i = functionBodies.length - 1; i >= 0; i--) {
        mainAsm.defineFunction2({
            name: "",
            params: [
                { register: R_GAMEROOT, name: "gameRoot" },
                { register: R_STORAGE, name: "storage" },
            ],
            registerCount: ACH_REGISTER_COUNT,
            flags: 0,
            body: functionBodies[i],
        });
    }

    mainAsm.push(aInt(functionBodies.length));
    mainAsm.initArray();
    mainAsm.setMember(); // _global.__nativeAch = array

    // Build _global.__nativeRP = [rpFn0, rpFn1, ...]
    mainAsm.push(aString("_global"));
    mainAsm.getVariable();
    mainAsm.push(aString("__nativeRP"));

    for (let i = rpFunctionBodies.length - 1; i >= 0; i--) {
        mainAsm.defineFunction2({
            name: "",
            params: [
                { register: RP_R_GAMEROOT, name: "gameRoot" },
                { register: RP_R_STORAGE, name: "storage" },
            ],
            registerCount: RP_REGISTER_COUNT,
            flags: 0,
            body: rpFunctionBodies[i],
        });
    }

    mainAsm.push(aInt(rpFunctionBodies.length));
    mainAsm.initArray();
    mainAsm.setMember(); // _global.__nativeRP = array

    mainAsm.end();

    const swf = buildSWF(mainAsm.toBytes());

    return { swf, compiledIndices, rpCompiledIndices };
}
