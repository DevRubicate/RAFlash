# TODO - Codebase Audit Findings

## Critical

### 1. Negative fake ID generation
- **File:** `RADisplay/src/js/app.ts:67`
- **Issue:** `Math.floor(Math.random() * -0xFFFFFF)` always produces negative IDs. Should be positive.
- **Conclusion:** FALSE POSITIVE. Negative IDs are intentional per project convention (CLAUDE.md: "Negative IDs are used for local/unpromoted entities"). Not a bug.
- instructions: Intentional. Add comment explaining that negative ids are used for local non-synced assets.

### 2. Off-by-one in OBJECT_ACCESS optimization boundary check
- **Files:** `AVM1Firmware/Main.as:2559-2564`, `AVM2Firmware/Evaluate.hx:566-571`
- **Issue:** Both firmwares have the same bug: the bounds check allows accessing one index past the validated range in the bytecode fast-path for simple property access.
- **Conclusion:** FALSE POSITIVE. Verified both checks carefully. AVM1: `i + amount + 2 <= end` with amount=6 gives `i+8 <= end`, meaning `i+7` (the last access) is within bounds. AVM2: `i + amount < formula.length` with amount=6 gives `i+6 < length`, and the last access is `formula[i+6]`, also within bounds. Both are correct.
- instructions: Add a comment explaining the bounds math. This has now been flagged by three separate reviews — a one-line comment like "// amount=6: accesses i+2..i+7, check guarantees i+7 < end" would prevent repeat false alarms.

### 3. Incorrect salvage ratio calculation
- **File:** `RAEngine/src/JSONDiff.ts:318-328`
- **Issue:** Keys that exist in only one of the two compared objects are skipped entirely (not counted as differences). This inflates similarity scores, causing structurally different objects to be considered similar and producing incomplete diffs instead of full replacements.
- **Conclusion:** FALSE POSITIVE. Re-read the code: missing keys contribute 0 to `totalRatio` (they're skipped in the loop body), but `allKeys.size` (the divisor) includes ALL keys from both objects. So missing keys correctly reduce the ratio. Example: `{a:1}` vs `{a:1, b:2}` → totalRatio=1.0, allKeys.size=2, result=0.5. The math is correct.
- instructions: Fix the misleading docstring. It says "averages salvage ratios of all shared keys" but it divides by ALL keys (not just shared). Change it to something like "averages salvage ratios across all keys, treating missing keys as 0 similarity." The code is correct; the comment is what causes confusion.

### 4. timeout variable referenced before declaration
- **File:** `RADisplay/src/js/network.ts:205`
- **Issue:** The `wrapper` callback calls `clearTimeout(timeout)`, but `timeout` is declared with `const` after `wrapper` is defined. This will throw a `ReferenceError` when queued messages are processed before connection is ready.
- **Conclusion:** FALSE POSITIVE. JavaScript closures capture variable *bindings*, not values. `wrapper` holds a reference to the `timeout` variable slot, and by the time `wrapper` is actually *invoked* (when a response arrives), `timeout` has long been initialized. The TDZ only matters for synchronous access before the declaration line, not for deferred closure invocations. No ReferenceError is possible. Still, the ordering is confusing to read.
- instructions: by definition queued messages cannot be processed before a connection is ready, but let's clean this up to be less confusing.

## High

### 5. Silent stack underflow in Parser RPN evaluation
- **File:** `RAEngine/src/formula/Parser.ts:1047,1056,1131,1141`
- **Issue:** When evaluating RPN expressions for function calls and remembered values, insufficient operands cause a silent `break` instead of an error. Malformed expressions like `len(a +)` or `{x +}` will partially compile without any error message, producing incorrect bytecode.
- **Conclusion:** VALID. Confirmed. The `break` silently exits the RPN evaluation loop, leaving a partial/incorrect AST on the eval stack. This should throw a ParseError instead.
- instructions: Fix this.

### 6. Body extraction misalignment in HTTP proxy
- **File:** `RAEngine/src/SitelockProxy.ts:197`
- **Issue:** The header/body split finds the header end as a character index in the decoded string, then re-encodes to find the byte offset. Multi-byte UTF-8 characters in headers will cause the body offset to be wrong, corrupting request bodies.
- **Conclusion:** FALSE POSITIVE. The code is correct. It takes `request.slice(0, headerEndStr + 4)` — the header string including the `\r\n\r\n` — and re-encodes it with `TextEncoder.encode()` to get the exact byte length. Since `request` was decoded from `raw` using the same UTF-8 codec, re-encoding the header portion produces bytes identical to the original `raw` prefix. The resulting byte length is the correct offset to slice the body from `raw`. Multi-byte characters are handled correctly by the round-trip.
- instructions: Add a comment explaining the re-encode approach. This has been flagged by two reviews. Something like: "// Re-encode header string to find exact byte offset — UTF-8 round-trip is lossless, so byte length matches the original raw prefix."

### 7. Map iteration during modification
- **File:** `AVM2Firmware/Main.hx:249-251`
- **Issue:** `clearPendingCallbacks()` removes entries from the `callbacks` map while iterating over its keys. This can skip callbacks or cause undefined behavior.
- **Conclusion:** VALID. Haxe's `IntMap.keys()` on the Flash target returns a live iterator over the underlying data structure. Removing entries during iteration can cause the iterator to skip entries. Whether it manifests depends on the internal hash layout, making it intermittent.
- instructions: Fix this.

## Medium

### 8. Unguarded reply.params.result.output access
- **File:** `RADisplay/src/view/memory-search.vue:283`
- **Issue:** After checking `reply.success`, the code accesses `reply.params.result.output` without verifying `params` or `result` exist.
- **Conclusion:** VALID. The code trusts the server response shape after only checking `reply.success`. A malformed response (e.g. `{success: true, params: {}}`) would throw a TypeError. Compare with `memory-explorer.vue:755` which correctly uses `reply.params?.result?.output`.
- instructions: Fix this.

### 9. Missing null guard in clearAssetDeltaValues
- **File:** `AVM2Firmware/Achievement.hx:80-83`
- **Issue:** `untyped asset.groups` is cast to an array and iterated without null check. Malformed achievement data causes a null reference crash.
- **Conclusion:** VALID. `untyped asset.groups` is assigned directly to `groups:Array<Dynamic>` and immediately iterated with `groups.length`. If the asset JSON lacks a `groups` field, this is a null dereference. Same issue on line 83 with `groups[gj].requirements`.
- instructions: Fix this, make it resillient.

### 10. Carriage return not handled in Lexer
- **File:** `RAEngine/src/formula/Lexer.ts:566`
- **Issue:** `isNewline()` only checks `\n`, not `\r`. Windows-style `\r\n` line endings won't update row tracking correctly.
- **Conclusion:** VALID but minor. The `\r` is treated as whitespace and skipped, so formulas with `\r\n` still parse correctly — only the error reporting row/column numbers would be off. Not a correctness bug, but normalizing input is cleaner.
- instructions: I'd rather we enforce \n, so maybe add some sort of enforcement or auto conversation?

### 11. Unvalidated array index in native achievement functions
- **File:** `AVM2Firmware/Achievement.hx:299-300`
- **Issue:** `nativeRpFnMap.get(ai)` returns an index used directly to access `nativeRpFns` without bounds checking.
- **Conclusion:** MOSTLY VALID. The out-of-bounds access on `nativeRpFns[rpFnIdx]` would return null in Flash, and line 301 checks `if (rpFn != null)` before using it, so it won't crash. But it's sloppy — a corrupted map entry would silently skip rich presence updates with no logging. Adding a bounds check with a warning log would aid debugging.
- instructions: Fix this.

### 12. selectedAssetId could change between awaits
- **File:** `RADisplay/src/view/asset-editor.vue:464-465`
- **Issue:** Two sequential `await` calls use `selectedAssetId.value`, which could change if the user selects a different asset during the first await.
- **Conclusion:** VALID. `App.save()` sends a network request (async), during which the user can click a different asset. The subsequent `Network.send` then uses `selectedAssetId.value` which now points to the newly selected asset, not the one being cleared. Should snapshot the ID at function entry.
- instructions: Fix this.

## Low

### 13. Missing semicolons
- **Files:** `RAEngine/src/formula/unit/ObjectAccessExpressionUnit.ts:6`, `VoidUnit.ts:9`
- **Issue:** ASI handles it, but inconsistent with the rest of the codebase.
- **Conclusion:** VALID (cosmetic). Confirmed both files — line 6 in ObjectAccessExpressionUnit.ts and line 9 in VoidUnit.ts are missing semicolons after the return statement expression. Every other file in the codebase uses them.
- instructions: Fix this.

### 14. HTMLWindow process error swallowed
- **File:** `RAEngine/src/HTMLWindow.ts:28-30`
- **Issue:** `this.process.status.then(...)` has no `.catch()`, so if the process rejects, the window is never marked as closed.
- **Conclusion:** VALID. If the child process exits with an error (non-zero exit code), Deno's `process.status` rejects the promise. Without a `.catch()`, the window stays `isClosed = false` forever, and an unhandled rejection warning is logged.
- instructions: Fix this.

### 15. setData() allows overwriting methods
- **File:** `RADisplay/src/js/app.ts:71-79`
- **Issue:** `this[key] = value` with an arbitrary string key could overwrite internal methods like `save()` or `getFakeId()`.
- **Conclusion:** VALID. If the server or calling code ever passes a key like `"save"` or `"getFakeId"`, the method would be replaced with data, breaking the App object. Should use a dedicated data store or whitelist.
- instructions: Fix this.
