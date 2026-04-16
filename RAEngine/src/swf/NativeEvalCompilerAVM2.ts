/**
 * Compiles achievements and Rich Presence to native AVM2 bytecode.
 *
 * Mirrors NativeEvalCompiler.ts (AVM1) but targets AVM2 opcodes.
 * Each achievement becomes a function(gameRoot, storage) → 0|1.
 * Each RP becomes a function(gameRoot, storage) → string.
 *
 * The compiled SWF defines class __NativeEval with static arrays:
 *   __NativeEval.ach = [achFn0, achFn1, ...]
 *   __NativeEval.rp  = [rpFn0, rpFn1, ...]
 */

import { AVM2ConstantPool, AVM2Code, buildNativeEvalABC, buildAVM2SWF } from "./AVM2Builder.ts";
import { Formula } from "../formula/Formula.ts";

// ============================================================================
// Register allocation for per-achievement functions
// ============================================================================
// local_0 = this (unused, from newfunction closure)
// local_1 = gameRoot (parameter)
// local_2 = storage (parameter)

const R_GAMEROOT = 1;
const R_STORAGE = 2;
const R_ALL_MET = 3;
const R_VAL_A = 4;
const R_VAL_B = 5;
const R_SCRATCH1 = 6;
const R_SCRATCH2 = 7;
const R_RESET_FIRED = 8;
const R_CHAIN_ACC = 9;
const R_FORMULA_TEMP = 10;
const R_FORMULA_ARR = 11;
const R_FORMULA_MATCH = 12;
const R_FORMULA_IDX = 13;   // hasnext2 index for ARRAY_ACCESS enumeration

const ACH_LOCAL_COUNT = 14; // locals 0-13

// ============================================================================
// Formula compilation (DSL bytecode → AVM2 bytecode)
// ============================================================================

interface FormulaRegs {
    gameRoot: number;
    storage: number;
    temp: number;
    arr: number;
    match: number;
    idx: number;
}

const ACH_FORMULA_REGS: FormulaRegs = {
    gameRoot: R_GAMEROOT,
    storage: R_STORAGE,
    temp: R_FORMULA_TEMP,
    arr: R_FORMULA_ARR,
    match: R_FORMULA_MATCH,
    idx: R_FORMULA_IDX,
};

interface CompileContext {
    nextRememberKey: number;
}

const KNOWN_FLAGS = new Set([
    "", "RESET_IF", "AND_NEXT", "OR_NEXT", "PAUSE_IF", "RESET_NEXT_IF",
    "ADD_HITS", "SUB_HITS", "ADD_SOURCE", "SUB_SOURCE",
    "MEASURED", "MEASURED_IF", "TRIGGER",
]);

/**
 * Compile a DSL formula (starting with VERSION_1) to AVM2 bytecode.
 * Result is left on the operand stack.
 */
function compileDSLFormula(
    dslBytecode: string[], asm: AVM2Code, ctx: CompileContext, regs: FormulaRegs,
    pool: AVM2ConstantPool,
): boolean {
    return compileDSLRange(dslBytecode, 1, dslBytecode.length, asm, ctx, regs, pool);
}

function compileDSLRange(
    dslBytecode: string[], start: number, end: number,
    asm: AVM2Code, ctx: CompileContext, regs: FormulaRegs,
    pool: AVM2ConstantPool,
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
                    asm.getLocal(regs.gameRoot);
                } else if (name === "stage_frame") {
                    asm.getLocal(regs.gameRoot);
                    asm.getProperty(pool.publicMultiname("currentFrame"));
                } else {
                    return false;
                }
                break;
            }

            case "VALUE": {
                const num = Number(dslBytecode[++i]);
                asm.pushNumber(num);
                break;
            }

            case "STRING":
                asm.pushString(dslBytecode[++i]);
                break;

            case "NULL":
                asm.pushNull();
                break;

            case "OBJECT_ACCESS": {
                const len = Number(dslBytecode[++i]);
                // Optimized path: simple property access pattern (key == "propName")
                if (len === 6
                    && dslBytecode[i + 1] === "IDENTIFIER" && dslBytecode[i + 2] === "key"
                    && dslBytecode[i + 3] === "READ_GLOBAL"
                    && dslBytecode[i + 4] === "IDENTIFIER"
                    && dslBytecode[i + 6] === "EQUAL") {
                    const propName = dslBytecode[i + 5];
                    asm.getProperty(pool.publicMultiname(propName));
                    i += len;
                } else {
                    return false;
                }
                break;
            }

            case "ARRAY_ACCESS": {
                const len = Number(dslBytecode[++i]);
                if (len === 2 && dslBytecode[i + 1] === "VALUE") {
                    // Simple numeric index: arr[N]
                    const idx = Number(dslBytecode[i + 2]);
                    asm.pushNumber(idx);
                    // Use MultinameL for runtime name from stack
                    asm.getProperty(pool.latePub);
                    i += len;
                } else if (len === 6
                    && dslBytecode[i + 1] === "IDENTIFIER" && dslBytecode[i + 2] === "this"
                    && dslBytecode[i + 3] === "READ_GLOBAL"
                    && dslBytecode[i + 4] === "STRING"
                    && dslBytecode[i + 6] === "EQUAL") {
                    // Find element by value: arr[this == "matchValue"]
                    const matchValue = dslBytecode[i + 5];

                    // Save array, init match to undefined
                    asm.setLocal(regs.arr);
                    asm.pushUndefined();
                    asm.setLocal(regs.match);
                    asm.pushByte(0);
                    asm.setLocal(regs.idx);

                    // Enumeration loop using hasnext2
                    const loopStart = asm.position;
                    asm.hasNext2(regs.arr, regs.idx);
                    const exitPatch = asm.ifFalseForward();

                    // Get current value
                    asm.getLocal(regs.arr);
                    asm.getLocal(regs.idx);
                    asm.nextValue();

                    // Check if value equals matchValue
                    asm.dup();
                    asm.pushString(matchValue);
                    asm.equals();
                    const noMatchPatch = asm.ifFalseForward();

                    // Match found: save it
                    asm.setLocal(regs.match);
                    asm.jumpTo(loopStart);

                    // No match: discard value
                    asm.patchJumpHere(noMatchPatch);
                    asm.pop();
                    asm.jumpTo(loopStart);

                    // Exit loop: push match result
                    asm.patchJumpHere(exitPatch);
                    asm.getLocal(regs.match);
                    i += len;
                } else {
                    return false;
                }
                break;
            }

            case "ADD": asm.add(); break;
            case "SUB": asm.subtract(); break;
            case "MUL": asm.multiply(); break;
            case "DIV": asm.divide(); break;

            case "EQUAL": asm.equals(); break;
            case "NOT_EQUAL": asm.equals(); asm.not(); break;
            case "GREATER": asm.greaterThan(); break;
            case "LESSER": asm.lessThan(); break;
            case "GREATER_EQUAL": asm.greaterEquals(); break;
            case "LESSER_EQUAL": asm.lessEquals(); break;

            case "NOT": asm.not(); break;

            case "LEN": {
                // Match interpreter: arrays → .length, non-arrays → 1
                asm.dup();
                asm.setLocal(regs.temp);
                const mnArray = pool.publicQName("Array");
                asm.getLex(mnArray);
                asm.isTypeLate();
                const isArrayPatch = asm.ifTrueForward();
                // Not an array: push 1
                asm.pushByte(1);
                const lenEndPatch = asm.jumpForward();
                // Is an array: read .length
                asm.patchJumpHere(isArrayPatch);
                asm.getLocal(regs.temp);
                asm.getProperty(pool.publicMultiname("length"));
                asm.patchJumpHere(lenEndPatch);
                break;
            }

            case "AND":
                // !!a * !!b (De Morgan's AND via multiplication of booleans)
                asm.setLocal(regs.temp);       // temp = b
                asm.not(); asm.not();          // !!a
                asm.getLocal(regs.temp);
                asm.not(); asm.not();          // !!b
                asm.multiply();                // !!a * !!b
                break;

            case "OR":
                // !(!a * !b) (De Morgan's OR)
                asm.setLocal(regs.temp);       // temp = b
                asm.not();                     // !a
                asm.getLocal(regs.temp);
                asm.not();                     // !b
                asm.multiply();                // !a * !b
                asm.not();                     // !(...)
                break;

            case "XOR":
                asm.bitXor();
                break;

            case "MOD":
                // AVM2 has native modulo opcode
                asm.modulo();
                break;

            case "POW": {
                // Math.pow(a, b)
                // Stack has [..., a, b]. Need [..., Math, a, b] for callProperty.
                asm.setLocal(regs.temp);       // temp = b
                asm.setLocal(regs.arr);        // arr = a (reuse register)
                const mnMath = pool.publicQName("Math");
                const mnPow = pool.publicMultiname("pow");
                asm.getLex(mnMath);
                asm.getLocal(regs.arr);
                asm.getLocal(regs.temp);
                asm.callProperty(mnPow, 2);
                break;
            }

            case "TERNARY": {
                const thenLen = Number(dslBytecode[++i]);
                const thenStart = i + 1;
                const thenEnd = thenStart + thenLen;
                const elseLen = Number(dslBytecode[thenEnd]);
                const elseStart = thenEnd + 1;
                const elseEnd = elseStart + elseLen;
                // Condition is on stack; if false → else branch
                const elsePatch = asm.ifFalseForward();
                if (!compileDSLRange(dslBytecode, thenStart, thenEnd, asm, ctx, regs, pool)) return false;
                const endPatch = asm.jumpForward();
                asm.patchJumpHere(elsePatch);
                if (!compileDSLRange(dslBytecode, elseStart, elseEnd, asm, ctx, regs, pool)) return false;
                asm.patchJumpHere(endPatch);
                i = elseEnd - 1;
                break;
            }

            case "REMEMBER": {
                const remLen = Number(dslBytecode[++i]);
                const remStart = i + 1;
                const remEnd = remStart + remLen;
                const remKey = ctx.nextRememberKey++;
                const mnRemKey = pool.publicMultiname(String(remKey));

                // Evaluate inner formula (result on stack)
                if (!compileDSLRange(dslBytecode, remStart, remEnd, asm, ctx, regs, pool)) return false;

                // Check if result is undefined
                asm.dup();
                asm.setLocal(regs.temp);
                asm.pushUndefined();
                asm.strictEquals();
                const useCachedPatch = asm.ifTrueForward();

                // Result is valid: cache it and push
                asm.getLocal(regs.storage);
                asm.getLocal(regs.temp);
                asm.setProperty(mnRemKey);
                asm.getLocal(regs.temp);
                const remEndPatch = asm.jumpForward();

                // Result is undefined: use cached value
                asm.patchJumpHere(useCachedPatch);
                asm.getLocal(regs.storage);
                asm.getProperty(mnRemKey);

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

function compileFormulaToBytes(
    address: string, ctx: CompileContext, regs: FormulaRegs,
    pool: AVM2ConstantPool,
): Uint8Array {
    const dslBytecode = Formula.compile(address || "0") as string[];
    const asm = new AVM2Code(pool);
    if (!compileDSLFormula(dslBytecode, asm, ctx, regs, pool)) {
        throw new Error(`Failed to compile formula to AVM2 bytecode: ${address}`);
    }
    return asm.toBytes();
}

// ── Helper emitters ──

/** Read storage[key] into a local, defaulting to 0 if undefined. */
function emitReadHitsToReg(asm: AVM2Code, pool: AVM2ConstantPool, key: string, destReg: number): void {
    const mn = pool.publicMultiname(key);
    asm.getLocal(R_STORAGE);
    asm.getProperty(mn);
    asm.dup();
    asm.setLocal(destReg);
    asm.pushUndefined();
    const hasValPatch = asm.ifStrictNeForward();
    // Undefined: set to 0
    asm.pushByte(0);
    asm.setLocal(destReg);
    asm.patchJumpHere(hasValPatch);
}

/** Emit comparison of R_VAL_A vs R_VAL_B, result in R_SCRATCH2. */
function emitComparison(asm: AVM2Code, cmp: string): void {
    asm.getLocal(R_VAL_A);
    asm.getLocal(R_VAL_B);
    switch (cmp) {
        case "==": asm.equals(); break;
        case "!=": asm.equals(); asm.not(); break;
        case ">": asm.greaterThan(); break;
        case ">=": asm.greaterEquals(); break;
        case "<": asm.lessThan(); break;
        case "<=": asm.lessEquals(); break;
        default: asm.equals(); break;
    }
    asm.setLocal(R_SCRATCH2);
}

/** Emit delta core: read previous, store current, check init flag. */
function emitDeltaCore(
    asm: AVM2Code, pool: AVM2ConstantPool,
    prevKey: string, initKey: string, valReg: number,
): number {
    const mnPrev = pool.publicMultiname(prevKey);
    const mnInit = pool.publicMultiname(initKey);

    // Read previous value
    asm.getLocal(R_STORAGE);
    asm.getProperty(mnPrev);
    asm.setLocal(R_SCRATCH1); // prev

    // Read initialized flag
    asm.getLocal(R_STORAGE);
    asm.getProperty(mnInit);
    asm.setLocal(R_SCRATCH2); // initialized

    // Store current for next frame
    asm.getLocal(R_STORAGE);
    asm.getLocal(valReg);
    asm.setProperty(mnPrev);
    asm.getLocal(R_STORAGE);
    asm.pushTrue();
    asm.setProperty(mnInit);

    // If not initialized: jump (caller handles)
    asm.getLocal(R_SCRATCH2);
    asm.not();
    const notInitPatch = asm.ifTrueForward();

    // Initialized: valReg = previous value
    asm.getLocal(R_SCRATCH1);
    asm.setLocal(valReg);

    return notInitPatch;
}

function emitDelta(
    asm: AVM2Code, pool: AVM2ConstantPool,
    prevKey: string, initKey: string, valReg: number,
    nextReqPatches: number[],
): void {
    const notInitPatch = emitDeltaCore(asm, pool, prevKey, initKey, valReg);
    const deltaDonePatch = asm.jumpForward();
    asm.patchJumpHere(notInitPatch);
    asm.pushFalse();
    asm.setLocal(R_ALL_MET);
    nextReqPatches.push(asm.jumpForward()); // → NEXT_REQ
    asm.patchJumpHere(deltaDonePatch);
}

function emitDeltaForChain(
    asm: AVM2Code, pool: AVM2ConstantPool,
    prevKey: string, initKey: string, valReg: number,
    endEvalPatches: number[],
): void {
    const notInitPatch = emitDeltaCore(asm, pool, prevKey, initKey, valReg);
    const deltaDonePatch = asm.jumpForward();
    asm.patchJumpHere(notInitPatch);
    asm.pushFalse();
    asm.setLocal(R_SCRATCH2);
    endEvalPatches.push(asm.jumpForward()); // → POST_EVAL
    asm.patchJumpHere(deltaDonePatch);
}

function emitRequirementEval(
    asm: AVM2Code, pool: AVM2ConstantPool,
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
    asm.setLocal(R_VAL_A);

    if (hasDeltaA) {
        emitDelta(asm, pool, `dA${g}_${k}`, `dAi${g}_${k}`, R_VAL_A, nextReqPatches);
    }

    asm.rawBytes(bytesB);
    asm.setLocal(R_VAL_B);

    if (hasDeltaB) {
        emitDelta(asm, pool, `dB${g}_${k}`, `dBi${g}_${k}`, R_VAL_B, nextReqPatches);
    }

    emitComparison(asm, req.cmp as string);
}

function emitChainMemberEval(
    asm: AVM2Code, pool: AVM2ConstantPool,
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

    const postEvalPatches: number[] = [];

    // Locked-true check
    if (maxHits > 0) {
        emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
        asm.getLocal(R_SCRATCH1);
        asm.pushNumber(maxHits);
        asm.lessThan();
        const notLockedPatch = asm.ifTrueForward();
        // LOCKED: satisfied = true
        asm.pushTrue();
        asm.setLocal(R_SCRATCH2);
        postEvalPatches.push(asm.jumpForward());
        asm.patchJumpHere(notLockedPatch);
    }

    // Evaluate formulas
    asm.rawBytes(bytesA);
    asm.setLocal(R_VAL_A);
    if (hasDeltaA) emitDeltaForChain(asm, pool, `dA${g}_${k}`, `dAi${g}_${k}`, R_VAL_A, postEvalPatches);

    asm.rawBytes(bytesB);
    asm.setLocal(R_VAL_B);
    if (hasDeltaB) emitDeltaForChain(asm, pool, `dB${g}_${k}`, `dBi${g}_${k}`, R_VAL_B, postEvalPatches);

    emitComparison(asm, req.cmp as string);

    for (const p of postEvalPatches) asm.patchJumpHere(p);
}

function emitChain(
    asm: AVM2Code, pool: AVM2ConstantPool,
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

        emitChainMemberEval(asm, pool, req, idx, bytesA, bytesB, maxHits, g);

        // Combine with chain accumulator
        if (m === 0) {
            asm.getLocal(R_SCRATCH2);
            asm.setLocal(R_CHAIN_ACC);
        } else {
            const prevFlag = reqs[allIndices[m - 1]].flag as string;
            if (prevFlag === "AND_NEXT") {
                // chainAcc = !!chainAcc * !!result
                asm.getLocal(R_CHAIN_ACC);
                asm.not(); asm.not();
                asm.getLocal(R_SCRATCH2);
                asm.not(); asm.not();
                asm.multiply();
                asm.setLocal(R_CHAIN_ACC);
            } else {
                // chainAcc = !(!chainAcc * !result)
                asm.getLocal(R_CHAIN_ACC);
                asm.not();
                asm.getLocal(R_SCRATCH2);
                asm.not();
                asm.multiply();
                asm.not();
                asm.setLocal(R_CHAIN_ACC);
            }
        }

        // Chain member hit tracking (non-terminal only)
        if (!isTerminal && maxHits > 0) {
            emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
            asm.getLocal(R_CHAIN_ACC);
            asm.not();
            const skipHitPatch = asm.ifTrueForward();
            asm.getLocal(R_SCRATCH1);
            asm.pushNumber(maxHits);
            asm.greaterEquals();
            const skipHitPatch2 = asm.ifTrueForward();
            // Increment
            asm.getLocal(R_SCRATCH1);
            asm.increment();
            asm.setLocal(R_SCRATCH1);
            asm.getLocal(R_STORAGE);
            asm.getLocal(R_SCRATCH1);
            asm.setProperty(pool.publicMultiname(hitsKey));
            asm.patchJumpHere(skipHitPatch);
            asm.patchJumpHere(skipHitPatch2);
        }
    }

    // Terminal: copy chain result to R_SCRATCH2
    asm.getLocal(R_CHAIN_ACC);
    asm.setLocal(R_SCRATCH2);
}

function emitNormalHitTracking(
    asm: AVM2Code, pool: AVM2ConstantPool,
    hitsKey: string, maxHits: number,
): void {
    const mnHits = pool.publicMultiname(hitsKey);

    if (maxHits > 0) {
        emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);

        // If passed AND hits < maxHits → increment
        asm.getLocal(R_SCRATCH2);
        asm.not();
        const skipIncPatch = asm.ifTrueForward();
        asm.getLocal(R_SCRATCH1);
        asm.pushNumber(maxHits);
        asm.greaterEquals();
        const skipIncPatch2 = asm.ifTrueForward();
        // Increment
        asm.getLocal(R_SCRATCH1);
        asm.increment();
        asm.setLocal(R_SCRATCH1);
        asm.getLocal(R_STORAGE);
        asm.getLocal(R_SCRATCH1);
        asm.setProperty(mnHits);
        asm.patchJumpHere(skipIncPatch);
        asm.patchJumpHere(skipIncPatch2);

        // Check if met: hits >= maxHits
        asm.getLocal(R_SCRATCH1);
        asm.pushNumber(maxHits);
        asm.greaterEquals();
        const metPatch = asm.ifTrueForward();
        // Not met
        asm.pushFalse();
        asm.setLocal(R_ALL_MET);
        asm.patchJumpHere(metPatch);
    } else {
        // No hits: met = passed
        asm.getLocal(R_SCRATCH2);
        const notPassedPatch = asm.ifTrueForward();
        asm.pushFalse();
        asm.setLocal(R_ALL_MET);
        asm.patchJumpHere(notPassedPatch);
    }
}

function emitResetIfTracking(
    asm: AVM2Code, pool: AVM2ConstantPool,
    hitsKey: string, maxHits: number,
): void {
    if (maxHits === 0) {
        // Transient: fires every frame condition passes
        asm.getLocal(R_SCRATCH2);
        asm.not();
        const skipFirePatch = asm.ifTrueForward();
        asm.pushTrue();
        asm.setLocal(R_RESET_FIRED);
        asm.patchJumpHere(skipFirePatch);
    } else {
        const mnHits = pool.publicMultiname(hitsKey);
        emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);

        asm.getLocal(R_SCRATCH2);
        asm.not();
        const skipIncPatch = asm.ifTrueForward();
        asm.getLocal(R_SCRATCH1);
        asm.pushNumber(maxHits);
        asm.greaterEquals();
        const skipIncPatch2 = asm.ifTrueForward();
        asm.getLocal(R_SCRATCH1);
        asm.increment();
        asm.setLocal(R_SCRATCH1);
        asm.getLocal(R_STORAGE);
        asm.getLocal(R_SCRATCH1);
        asm.setProperty(mnHits);
        asm.patchJumpHere(skipIncPatch);
        asm.patchJumpHere(skipIncPatch2);

        // Fire check: hits >= maxHits
        asm.getLocal(R_SCRATCH1);
        asm.pushNumber(maxHits);
        asm.lessThan();
        const skipFirePatch = asm.ifTrueForward();
        asm.pushTrue();
        asm.setLocal(R_RESET_FIRED);
        asm.patchJumpHere(skipFirePatch);
    }
}

function emitResetIfStyleTracking(
    asm: AVM2Code, pool: AVM2ConstantPool,
    hitsKey: string, maxHits: number,
): void {
    if (maxHits === 0) {
        // R_SCRATCH2 already has passed = fire flag
    } else {
        const mnHits = pool.publicMultiname(hitsKey);
        emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);

        asm.getLocal(R_SCRATCH2);
        asm.not();
        const skipInc = asm.ifTrueForward();
        asm.getLocal(R_SCRATCH1);
        asm.pushNumber(maxHits);
        asm.greaterEquals();
        const skipInc2 = asm.ifTrueForward();
        asm.getLocal(R_SCRATCH1);
        asm.increment();
        asm.setLocal(R_SCRATCH1);
        asm.getLocal(R_STORAGE);
        asm.getLocal(R_SCRATCH1);
        asm.setProperty(mnHits);
        asm.patchJumpHere(skipInc);
        asm.patchJumpHere(skipInc2);

        // Fire check: R_SCRATCH2 = hits >= maxHits
        asm.getLocal(R_SCRATCH1);
        asm.pushNumber(maxHits);
        asm.greaterEquals();
        asm.setLocal(R_SCRATCH2);
    }
}

function emitPauseIfFire(
    asm: AVM2Code, pool: AVM2ConstantPool,
    hitsKey: string, maxHits: number,
): void {
    if (maxHits === 0) {
        asm.getLocal(R_SCRATCH2);
        asm.not();
        const skipPatch = asm.ifTrueForward();
        asm.pushTrue();
        asm.setLocal(R_ALL_MET);
        asm.patchJumpHere(skipPatch);
    } else {
        const mnHits = pool.publicMultiname(hitsKey);
        emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);

        asm.getLocal(R_SCRATCH2);
        asm.not();
        const skipInc = asm.ifTrueForward();
        asm.getLocal(R_SCRATCH1);
        asm.pushNumber(maxHits);
        asm.greaterEquals();
        const skipInc2 = asm.ifTrueForward();
        asm.getLocal(R_SCRATCH1);
        asm.increment();
        asm.setLocal(R_SCRATCH1);
        asm.getLocal(R_STORAGE);
        asm.getLocal(R_SCRATCH1);
        asm.setProperty(mnHits);
        asm.patchJumpHere(skipInc);
        asm.patchJumpHere(skipInc2);

        asm.getLocal(R_SCRATCH1);
        asm.pushNumber(maxHits);
        asm.lessThan();
        const skipFire = asm.ifTrueForward();
        asm.pushTrue();
        asm.setLocal(R_ALL_MET);
        asm.patchJumpHere(skipFire);
    }
}

function emitAhsTerminalTracking(
    asm: AVM2Code, pool: AVM2ConstantPool,
    hitsKey: string, maxHits: number,
    g: number,
    ahsInfo: { contributors: number[]; flags: string[] },
): void {
    const mnHits = pool.publicMultiname(hitsKey);

    // Step 1: Increment own hits if passed and below cap
    emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
    asm.getLocal(R_SCRATCH2);
    asm.not();
    const skipInc = asm.ifTrueForward();
    asm.getLocal(R_SCRATCH1);
    asm.pushNumber(maxHits);
    asm.greaterEquals();
    const skipInc2 = asm.ifTrueForward();
    asm.getLocal(R_SCRATCH1);
    asm.increment();
    asm.setLocal(R_SCRATCH1);
    asm.getLocal(R_STORAGE);
    asm.getLocal(R_SCRATCH1);
    asm.setProperty(mnHits);
    asm.patchJumpHere(skipInc);
    asm.patchJumpHere(skipInc2);

    // Step 2: Compute effective hits = own + ADD_HITS - SUB_HITS
    emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
    for (let i = 0; i < ahsInfo.contributors.length; i++) {
        const cKey = `h${g}_${ahsInfo.contributors[i]}`;
        emitReadHitsToReg(asm, pool, cKey, R_SCRATCH2);
        asm.getLocal(R_SCRATCH1);
        asm.getLocal(R_SCRATCH2);
        if (ahsInfo.flags[i] === "ADD_HITS") asm.add(); else asm.subtract();
        asm.setLocal(R_SCRATCH1);
    }

    // Step 3: Satisfaction check
    asm.getLocal(R_SCRATCH1);
    asm.pushNumber(maxHits);
    asm.greaterEquals();
    const metPatch = asm.ifTrueForward();
    asm.pushFalse();
    asm.setLocal(R_ALL_MET);
    asm.patchJumpHere(metPatch);
}

// ============================================================================
// Group-level code generation
// ============================================================================

const AFFECTS_ALLMET = new Set(["", "MEASURED", "MEASURED_IF", "TRIGGER"]);
const CHAIN_FLAGS = new Set(["AND_NEXT", "OR_NEXT"]);

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
        k = t - 1;
    }
    return chains;
}

function emitGroupDeltaOnly(
    asm: AVM2Code, pool: AVM2ConstantPool,
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
            asm.setLocal(R_VAL_A);
            asm.getLocal(R_STORAGE);
            asm.getLocal(R_VAL_A);
            asm.setProperty(pool.publicMultiname(`dA${g}_${k}`));
            asm.getLocal(R_STORAGE);
            asm.pushTrue();
            asm.setProperty(pool.publicMultiname(`dAi${g}_${k}`));
        }
        if (hasDeltaB) {
            asm.rawBytes(bytesB);
            asm.setLocal(R_VAL_B);
            asm.getLocal(R_STORAGE);
            asm.getLocal(R_VAL_B);
            asm.setProperty(pool.publicMultiname(`dB${g}_${k}`));
            asm.getLocal(R_STORAGE);
            asm.pushTrue();
            asm.setProperty(pool.publicMultiname(`dBi${g}_${k}`));
        }
    }
}

function emitPostComparison(
    asm: AVM2Code, pool: AVM2ConstantPool,
    flag: string, hitsKey: string, maxHits: number,
    hasTrigger: boolean,
    rnifTargets: Array<{ g: number; k: number }>,
    g: number, k: number,
    reqs: Array<Record<string, unknown>>,
    ahsChains: Map<number, { contributors: number[]; flags: string[] }>,
): void {
    if (flag === "RESET_IF") {
        emitResetIfTracking(asm, pool, hitsKey, maxHits);
    } else if (flag === "RESET_NEXT_IF") {
        emitResetIfStyleTracking(asm, pool, hitsKey, maxHits);
        let target = k + 1;
        while (target < reqs.length && (reqs[target].flag as string) === "PAUSE_IF") target++;
        if (target < reqs.length) {
            asm.getLocal(R_SCRATCH2);
            asm.not();
            const skipRnifStore = asm.ifTrueForward();
            asm.getLocal(R_STORAGE);
            asm.pushTrue();
            asm.setProperty(pool.publicMultiname(`_rnif_${g}_${target}`));
            asm.patchJumpHere(skipRnifStore);
            rnifTargets.push({ g, k: target });
        }
    } else if (flag === "ADD_HITS" || flag === "SUB_HITS") {
        // Contributor — handled elsewhere
    } else {
        // Normal, MEASURED, MEASURED_IF, TRIGGER
        const ahsInfo = ahsChains.get(k);
        if (ahsInfo && maxHits > 0) {
            emitAhsTerminalTracking(asm, pool, hitsKey, maxHits, g, ahsInfo);
        } else {
            emitNormalHitTracking(asm, pool, hitsKey, maxHits);
        }

        // TRIGGER tracking
        if (hasTrigger && AFFECTS_ALLMET.has(flag)) {
            const trackerKey = flag === "TRIGGER" ? "_atm" : "_antm";
            const mnTracker = pool.publicMultiname(trackerKey);
            if (maxHits > 0) {
                emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
                asm.getLocal(R_SCRATCH1);
                asm.pushNumber(maxHits);
                asm.greaterEquals();
                const satPatch = asm.ifTrueForward();
                asm.getLocal(R_STORAGE);
                asm.pushFalse();
                asm.setProperty(mnTracker);
                asm.patchJumpHere(satPatch);
            } else {
                asm.getLocal(R_SCRATCH2);
                const satPatch = asm.ifTrueForward();
                asm.getLocal(R_STORAGE);
                asm.pushFalse();
                asm.setProperty(mnTracker);
                asm.patchJumpHere(satPatch);
            }
        }

        // MEASURED_IF gate tracking
        if (flag === "MEASURED_IF") {
            const mnMifOk = pool.publicMultiname(`_mifOk_${g}`);
            if (maxHits > 0) {
                emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
                asm.getLocal(R_SCRATCH1);
                asm.pushNumber(maxHits);
                asm.greaterEquals();
                const mifPatch = asm.ifTrueForward();
                asm.getLocal(R_STORAGE);
                asm.pushFalse();
                asm.setProperty(mnMifOk);
                asm.patchJumpHere(mifPatch);
            } else {
                asm.getLocal(R_SCRATCH2);
                const mifPatch = asm.ifTrueForward();
                asm.getLocal(R_STORAGE);
                asm.pushFalse();
                asm.setProperty(mnMifOk);
                asm.patchJumpHere(mifPatch);
            }
        }
    }
}

function emitGroupRequirements(
    asm: AVM2Code, pool: AVM2ConstantPool,
    reqs: Array<Record<string, unknown>>,
    formulas: Array<{ bytesA: Uint8Array; bytesB: Uint8Array }>,
    g: number,
    hasTrigger: boolean,
    rnifTargets: Array<{ g: number; k: number }>,
    pauseIfIndices: Set<number>,
): void {
    asm.pushTrue();
    asm.setLocal(R_ALL_MET);

    // Source accumulator
    const hasSource = reqs.some(r => {
        const f = (r.flag as string) || "";
        return f === "ADD_SOURCE" || f === "SUB_SOURCE";
    });
    if (hasSource) {
        asm.getLocal(R_STORAGE);
        asm.pushByte(0);
        asm.setProperty(pool.publicMultiname("_sa"));
    }

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

        if (pauseIfIndices.has(k)) continue;

        // --- ADD_SOURCE / SUB_SOURCE ---
        if (flag === "ADD_SOURCE" || flag === "SUB_SOURCE") {
            const { bytesA } = formulas[k];
            asm.rawBytes(bytesA);
            asm.setLocal(R_VAL_A);
            if (req.typeA === "DELTA") {
                const notInit = emitDeltaCore(asm, pool, `dA${g}_${k}`, `dAi${g}_${k}`, R_VAL_A);
                const donePatch = asm.jumpForward();
                asm.patchJumpHere(notInit);
                asm.pushByte(0);
                asm.setLocal(R_VAL_A);
                asm.patchJumpHere(donePatch);
            }
            // Accumulate
            const mnSa = pool.publicMultiname("_sa");
            asm.getLocal(R_STORAGE);
            asm.getLocal(R_STORAGE);
            asm.getProperty(mnSa);
            asm.getLocal(R_VAL_A);
            if (flag === "ADD_SOURCE") asm.add(); else asm.subtract();
            asm.setProperty(mnSa);
            continue;
        }

        // --- ADD_HITS / SUB_HITS contributor ---
        if (ahsContributorSet.has(k)) {
            const { bytesA, bytesB } = formulas[k];
            const nextReqPatches: number[] = [];
            if (maxHits > 0) {
                emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
                asm.getLocal(R_SCRATCH1);
                asm.pushNumber(maxHits);
                asm.greaterEquals();
                nextReqPatches.push(asm.ifTrueForward());
            }
            emitRequirementEval(asm, pool, req, k, bytesA, bytesB, nextReqPatches, g);
            if (maxHits > 0) {
                const mnHits = pool.publicMultiname(hitsKey);
                emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
                asm.getLocal(R_SCRATCH2);
                asm.not();
                const skip1 = asm.ifTrueForward();
                asm.getLocal(R_SCRATCH1);
                asm.pushNumber(maxHits);
                asm.greaterEquals();
                const skip2 = asm.ifTrueForward();
                asm.getLocal(R_SCRATCH1);
                asm.increment();
                asm.setLocal(R_SCRATCH1);
                asm.getLocal(R_STORAGE);
                asm.getLocal(R_SCRATCH1);
                asm.setProperty(mnHits);
                asm.patchJumpHere(skip1);
                asm.patchJumpHere(skip2);
            } else {
                const mnHits = pool.publicMultiname(hitsKey);
                asm.getLocal(R_SCRATCH2);
                asm.not();
                const skip = asm.ifTrueForward();
                emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
                asm.getLocal(R_SCRATCH1);
                asm.increment();
                asm.setLocal(R_SCRATCH1);
                asm.getLocal(R_STORAGE);
                asm.getLocal(R_SCRATCH1);
                asm.setProperty(mnHits);
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
            if (termIdx >= reqs.length) return;

            emitChain(asm, pool, reqs, memberIndices, termIdx, formulas, g);

            const termReq = reqs[termIdx];
            const termFlag = (termReq.flag as string) || "";
            const termMaxHits = (termReq.maxHits as number) || 0;
            const termHitsKey = `h${g}_${termIdx}`;

            emitPostComparison(asm, pool, termFlag, termHitsKey, termMaxHits, hasTrigger, rnifTargets, g, termIdx, reqs, ahsChains);
            k = termIdx;
            continue;
        }

        // --- Standalone requirement ---
        const { bytesA, bytesB } = formulas[k];
        const nextReqPatches: number[] = [];

        const isAhsTerminal = ahsChains.has(k);
        if (maxHits > 0 && !isAhsTerminal) {
            emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
            asm.getLocal(R_SCRATCH1);
            asm.pushNumber(maxHits);
            asm.greaterEquals();
            nextReqPatches.push(asm.ifTrueForward());
        }

        emitRequirementEval(asm, pool, req, k, bytesA, bytesB, nextReqPatches, g);

        // Source accumulator consumption
        if (hasSource) {
            const mnSa = pool.publicMultiname("_sa");
            asm.getLocal(R_STORAGE);
            asm.getProperty(mnSa);
            asm.setLocal(R_SCRATCH1);
            asm.getLocal(R_SCRATCH1);
            asm.pushByte(0);
            asm.equals();
            const skipAccPatch = asm.ifTrueForward();
            asm.getLocal(R_VAL_A);
            asm.getLocal(R_SCRATCH1);
            asm.add();
            asm.setLocal(R_VAL_A);
            emitComparison(asm, req.cmp as string);
            asm.patchJumpHere(skipAccPatch);
            // Reset accumulator
            asm.getLocal(R_STORAGE);
            asm.pushByte(0);
            asm.setProperty(mnSa);
        }

        emitPostComparison(asm, pool, flag, hitsKey, maxHits, hasTrigger, rnifTargets, g, k, reqs, ahsChains);

        for (const p of nextReqPatches) asm.patchJumpHere(p);
    }
}

function emitMeasuredEpilogue(
    asm: AVM2Code, pool: AVM2ConstantPool,
    groups: Array<Record<string, unknown>>,
    allGroupFormulas: Array<Array<{ bytesA: Uint8Array; bytesB: Uint8Array }>>,
): void {
    const mnCur = pool.publicMultiname("_mCur");
    const mnTgt = pool.publicMultiname("_mTgt");

    for (let g = 0; g < groups.length; g++) {
        const reqs = groups[g].requirements as Array<Record<string, unknown>>;
        for (let k = 0; k < reqs.length; k++) {
            const req = reqs[k];
            if ((req.flag as string) !== "MEASURED") continue;
            const maxHits = (req.maxHits as number) || 0;

            if (maxHits > 0) {
                // Hit Count Mode
                const hitsKey = `h${g}_${k}`;
                emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);

                const ahsChains = detectAhsChains(reqs);
                const ahsInfo = ahsChains.get(k);
                if (ahsInfo) {
                    for (let i = 0; i < ahsInfo.contributors.length; i++) {
                        const cKey = `h${g}_${ahsInfo.contributors[i]}`;
                        emitReadHitsToReg(asm, pool, cKey, R_SCRATCH2);
                        asm.getLocal(R_SCRATCH1);
                        asm.getLocal(R_SCRATCH2);
                        if (ahsInfo.flags[i] === "ADD_HITS") asm.add(); else asm.subtract();
                        asm.setLocal(R_SCRATCH1);
                    }
                }

                asm.getLocal(R_STORAGE);
                asm.getLocal(R_SCRATCH1);
                asm.setProperty(mnCur);
                asm.getLocal(R_STORAGE);
                asm.pushNumber(maxHits);
                asm.setProperty(mnTgt);
            } else {
                // Value Mode
                const { bytesA, bytesB } = allGroupFormulas[g][k];
                asm.rawBytes(bytesA);
                asm.setLocal(R_SCRATCH1);
                asm.rawBytes(bytesB);
                asm.setLocal(R_SCRATCH2);
                asm.getLocal(R_STORAGE);
                asm.getLocal(R_SCRATCH1);
                asm.setProperty(mnCur);
                asm.getLocal(R_STORAGE);
                asm.getLocal(R_SCRATCH2);
                asm.setProperty(mnTgt);
            }

            // MEASURED_IF gate
            let hasMeasuredIf = false;
            for (const r of reqs) {
                if ((r.flag as string) === "MEASURED_IF") { hasMeasuredIf = true; break; }
            }
            if (hasMeasuredIf) {
                asm.getLocal(R_STORAGE);
                asm.getProperty(pool.publicMultiname(`_mifOk_${g}`));
                const skipZero = asm.ifTrueForward();
                asm.getLocal(R_STORAGE);
                asm.pushByte(0);
                asm.setProperty(mnCur);
                asm.patchJumpHere(skipZero);
            }

            break; // Only first MEASURED per group
        }
    }
}

// ============================================================================
// Achievement body compilation
// ============================================================================

function compileAchievementBody(
    asset: Record<string, unknown>,
    pool: AVM2ConstantPool,
): Uint8Array {
    const groups = asset.groups as Array<Record<string, unknown>> | undefined;
    if (!groups || groups.length === 0) {
        throw new Error("Achievement has no groups");
    }

    for (const group of groups) {
        const type = group.type as string;
        if (type !== "CORE" && type !== "ALT") throw new Error(`Unknown group type: ${type}`);
        const reqs = group.requirements as Array<Record<string, unknown>> | undefined;
        if (!reqs) throw new Error("Group has no requirements array");
        for (const req of reqs) {
            const flag = (req.flag as string) || "";
            if (!KNOWN_FLAGS.has(flag)) throw new Error(`Unknown requirement flag: ${flag}`);
        }
    }

    // Analysis
    let hasResetIf = false, hasTrigger = false, hasMeasured = false;
    for (const group of groups) {
        const reqs = group.requirements as Array<Record<string, unknown>>;
        for (const req of reqs) {
            const f = (req.flag as string) || "";
            if (f === "RESET_IF") hasResetIf = true;
            if (f === "TRIGGER") hasTrigger = true;
            if (f === "MEASURED" || f === "MEASURED_IF") hasMeasured = true;
        }
    }

    // Pre-compile all formulas
    const ctx: CompileContext = { nextRememberKey: 0 };
    const regs = ACH_FORMULA_REGS;
    const allGroupFormulas: Array<Array<{ bytesA: Uint8Array; bytesB: Uint8Array }>> = [];
    for (const group of groups) {
        const reqs = group.requirements as Array<Record<string, unknown>>;
        const gFormulas: Array<{ bytesA: Uint8Array; bytesB: Uint8Array }> = [];
        for (const req of reqs) {
            const bytesA = compileFormulaToBytes(req.addressA as string, ctx, regs, pool);
            const bytesB = compileFormulaToBytes(req.addressB as string, ctx, regs, pool);
            gFormulas.push({ bytesA, bytesB });
        }
        allGroupFormulas.push(gFormulas);
    }

    const asm = new AVM2Code(pool);

    // Prologue: push scope for getlex support
    asm.getLocal(0);
    asm.pushScope();

    if (hasResetIf) {
        asm.pushFalse();
        asm.setLocal(R_RESET_FIRED);
    }
    if (hasTrigger) {
        asm.getLocal(R_STORAGE);
        asm.pushTrue();
        asm.setProperty(pool.publicMultiname("_antm"));
        asm.getLocal(R_STORAGE);
        asm.pushTrue();
        asm.setProperty(pool.publicMultiname("_atm"));
    }
    for (let g = 0; g < groups.length; g++) {
        const reqs = (groups[g] as Record<string, unknown>).requirements as Array<Record<string, unknown>>;
        for (const r of reqs) {
            if ((r.flag as string) === "MEASURED_IF") {
                asm.getLocal(R_STORAGE);
                asm.pushTrue();
                asm.setProperty(pool.publicMultiname(`_mifOk_${g}`));
                break;
            }
        }
    }

    const rnifTargets: Array<{ g: number; k: number }> = [];

    // Per-group evaluation
    for (let g = 0; g < groups.length; g++) {
        const group = groups[g] as Record<string, unknown>;
        const reqs = group.requirements as Array<Record<string, unknown>>;
        const formulas = allGroupFormulas[g];

        const pauseIfIndices = new Set<number>();
        for (let k = 0; k < reqs.length; k++) {
            if ((reqs[k].flag as string) === "PAUSE_IF") pauseIfIndices.add(k);
        }
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

        // PAUSE_IF phase
        if (groupHasPauseIf) {
            asm.pushFalse();
            asm.setLocal(R_ALL_MET);

            for (let k = 0; k < reqs.length; k++) {
                if (!pauseIfIndices.has(k)) continue;
                const req = reqs[k];
                const flag = (req.flag as string) || "";

                if (CHAIN_FLAGS.has(flag)) {
                    const memberIndices: number[] = [k];
                    let t = k + 1;
                    while (t < reqs.length && CHAIN_FLAGS.has((reqs[t].flag as string) || "")) {
                        memberIndices.push(t);
                        t++;
                    }
                    emitChain(asm, pool, reqs, memberIndices, t, formulas, g);
                    const pReq = reqs[t];
                    const pMaxHits = (pReq.maxHits as number) || 0;
                    const pHitsKey = `h${g}_${t}`;
                    emitPauseIfFire(asm, pool, pHitsKey, pMaxHits);
                    k = t;
                    continue;
                }

                if (flag !== "PAUSE_IF") continue;

                const maxHits = (req.maxHits as number) || 0;
                const hitsKey = `h${g}_${k}`;
                const { bytesA, bytesB } = formulas[k];
                if (maxHits > 0) {
                    emitReadHitsToReg(asm, pool, hitsKey, R_SCRATCH1);
                    asm.getLocal(R_SCRATCH1);
                    asm.pushNumber(maxHits);
                    asm.greaterEquals();
                    const alreadyLockedPatch = asm.ifTrueForward();
                    const patchesPif: number[] = [];
                    emitRequirementEval(asm, pool, req, k, bytesA, bytesB, patchesPif, g);
                    emitPauseIfFire(asm, pool, hitsKey, maxHits);
                    for (const p of patchesPif) asm.patchJumpHere(p);
                    const skipLockedPatch = asm.jumpForward();
                    asm.patchJumpHere(alreadyLockedPatch);
                    asm.pushTrue();
                    asm.setLocal(R_ALL_MET);
                    asm.patchJumpHere(skipLockedPatch);
                } else {
                    const patchesPif: number[] = [];
                    emitRequirementEval(asm, pool, req, k, bytesA, bytesB, patchesPif, g);
                    emitPauseIfFire(asm, pool, hitsKey, maxHits);
                    for (const p of patchesPif) asm.patchJumpHere(p);
                }
            }

            // If paused: delta-only, group=false
            asm.getLocal(R_ALL_MET);
            asm.not();
            const notPausedPatch = asm.ifTrueForward();
            emitGroupDeltaOnly(asm, pool, reqs, formulas, g);
            if (groups.length > 1) {
                asm.getLocal(R_STORAGE);
                asm.pushFalse();
                asm.setProperty(pool.publicMultiname(`_g${g}`));
            } else {
                asm.pushFalse();
                asm.setLocal(R_ALL_MET);
            }
            skipGroupPatch = asm.jumpForward();
            asm.patchJumpHere(notPausedPatch);
        }

        // Normal evaluation
        emitGroupRequirements(asm, pool, reqs, formulas, g, hasTrigger, rnifTargets, pauseIfIndices);

        if (groups.length > 1) {
            asm.getLocal(R_STORAGE);
            asm.getLocal(R_ALL_MET);
            asm.setProperty(pool.publicMultiname(`_g${g}`));
        }

        if (groupHasPauseIf) {
            asm.patchJumpHere(skipGroupPatch);
        }
    }

    // RESET_NEXT_IF epilogue
    for (const target of rnifTargets) {
        const targetKey = `_rnif_${target.g}_${target.k}`;
        const hitsKey = `h${target.g}_${target.k}`;
        asm.getLocal(R_STORAGE);
        asm.getProperty(pool.publicMultiname(targetKey));
        asm.not();
        const skipRnif = asm.ifTrueForward();
        asm.getLocal(R_STORAGE);
        asm.pushByte(0);
        asm.setProperty(pool.publicMultiname(hitsKey));
        asm.getLocal(R_STORAGE);
        asm.pushFalse();
        asm.setProperty(pool.publicMultiname(targetKey));
        asm.patchJumpHere(skipRnif);
    }

    // RESET_IF epilogue
    if (hasResetIf) {
        asm.getLocal(R_RESET_FIRED);
        asm.not();
        const noResetPatch = asm.ifTrueForward();
        for (let g = 0; g < groups.length; g++) {
            const reqs = (groups[g] as Record<string, unknown>).requirements as Array<Record<string, unknown>>;
            for (let k = 0; k < reqs.length; k++) {
                const mh = (reqs[k].maxHits as number) || 0;
                const f = (reqs[k].flag as string) || "";
                if (mh > 0 || f === "ADD_HITS" || f === "SUB_HITS") {
                    asm.getLocal(R_STORAGE);
                    asm.pushByte(0);
                    asm.setProperty(pool.publicMultiname(`h${g}_${k}`));
                }
            }
        }
        asm.pushByte(0);
        asm.returnValue();
        asm.patchJumpHere(noResetPatch);
    }

    // Group logic
    if (groups.length > 1) {
        asm.getLocal(R_STORAGE);
        asm.getProperty(pool.publicMultiname("_g0"));
        asm.setLocal(R_ALL_MET);

        const hasAlt = groups.some((gr, i) => i > 0 && (gr as Record<string, unknown>).type === "ALT");
        if (hasAlt) {
            asm.pushFalse();
            asm.setLocal(R_SCRATCH1); // anyAltPassed
            for (let g = 1; g < groups.length; g++) {
                if ((groups[g] as Record<string, unknown>).type !== "ALT") continue;
                // anyAltPassed = anyAltPassed OR storage._g<g>
                asm.getLocal(R_SCRATCH1);
                asm.not();
                asm.getLocal(R_STORAGE);
                asm.getProperty(pool.publicMultiname(`_g${g}`));
                asm.not();
                asm.multiply();
                asm.not();
                asm.setLocal(R_SCRATCH1);
            }
            // R_ALL_MET = R_ALL_MET AND anyAltPassed
            asm.getLocal(R_ALL_MET);
            asm.not(); asm.not();
            asm.getLocal(R_SCRATCH1);
            asm.not(); asm.not();
            asm.multiply();
            asm.setLocal(R_ALL_MET);
        }
    }

    // TRIGGER / primed epilogue
    if (hasTrigger) {
        asm.getLocal(R_STORAGE);
        asm.getProperty(pool.publicMultiname("_antm"));
        asm.not(); asm.not();
        asm.getLocal(R_STORAGE);
        asm.getProperty(pool.publicMultiname("_atm"));
        asm.not();
        asm.multiply();
        asm.setLocal(R_SCRATCH1); // primed
        asm.getLocal(R_STORAGE);
        asm.getLocal(R_SCRATCH1);
        asm.setProperty(pool.publicMultiname("_primed"));
        asm.getLocal(R_SCRATCH1);
        asm.not();
        const notPrimedPatch = asm.ifTrueForward();
        asm.pushFalse();
        asm.setLocal(R_ALL_MET);
        asm.patchJumpHere(notPrimedPatch);
    }

    // MEASURED epilogue
    if (hasMeasured) {
        emitMeasuredEpilogue(asm, pool, groups as Array<Record<string, unknown>>, allGroupFormulas);
    }

    // Return
    asm.getLocal(R_ALL_MET);
    asm.not();
    const notTriggeredPatch = asm.ifTrueForward();
    asm.pushByte(1);
    asm.returnValue();
    asm.patchJumpHere(notTriggeredPatch);
    asm.pushByte(0);
    asm.returnValue();

    return asm.toBytes();
}

// ============================================================================
// Rich Presence compilation
// ============================================================================

const RP_R_GAMEROOT = 1;
const RP_R_STORAGE = 2;
const RP_R_TEMP = 3;
const RP_R_ARR = 4;
const RP_R_MATCH = 5;
const RP_R_IDX = 6;
const RP_LOCAL_COUNT = 7;

const RP_FORMULA_REGS: FormulaRegs = {
    gameRoot: RP_R_GAMEROOT,
    storage: RP_R_STORAGE,
    temp: RP_R_TEMP,
    arr: RP_R_ARR,
    match: RP_R_MATCH,
    idx: RP_R_IDX,
};

function compileRichPresenceBody(
    asset: Record<string, unknown>,
    pool: AVM2ConstantPool,
): Uint8Array {
    const formula = String(asset.formula ?? '""');
    const dslBytecode = Formula.compile(formula) as string[];
    const ctx: CompileContext = { nextRememberKey: 0 };
    const asm = new AVM2Code(pool);

    // Push scope for getlex support
    asm.getLocal(0);
    asm.pushScope();

    if (!compileDSLFormula(dslBytecode, asm, ctx, RP_FORMULA_REGS, pool)) {
        throw new Error(`Failed to compile Rich Presence formula: ${formula}`);
    }

    asm.returnValue();
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
 * Compile all achievements and Rich Presence to native AVM2 functions,
 * packaged as one SWF.
 *
 * The SWF defines class __NativeEval with static properties:
 *   __NativeEval.ach = [achFn0, achFn1, ...]
 *   __NativeEval.rp  = [rpFn0, rpFn1, ...]
 */
export function compileAchievementsSWF(assets: unknown[]): NativeAchResult {
    const pool = new AVM2ConstantPool();
    const compiledIndices: number[] = [];
    const functionBodies: Uint8Array[] = [];
    const rpCompiledIndices: number[] = [];
    const rpFunctionBodies: Uint8Array[] = [];

    for (let i = 0; i < (assets as Array<Record<string, unknown>>).length; i++) {
        const asset = (assets as Array<Record<string, unknown>>)[i];
        if (asset == null) continue;

        if (asset.type === "RICH_PRESENCE") {
            const body = compileRichPresenceBody(asset, pool);
            rpCompiledIndices.push(i);
            rpFunctionBodies.push(body);
        } else {
            const body = compileAchievementBody(asset, pool);
            compiledIndices.push(i);
            functionBodies.push(body);
        }
    }

    const abc = buildNativeEvalABC(
        pool,
        functionBodies,
        rpFunctionBodies,
        ACH_LOCAL_COUNT,
        RP_LOCAL_COUNT,
    );

    const swf = buildAVM2SWF(abc);

    return { swf, compiledIndices, rpCompiledIndices };
}
