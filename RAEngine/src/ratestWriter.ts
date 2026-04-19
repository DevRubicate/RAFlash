/**
 * Serialize a recorded stream of user-input + achievement-trigger events
 * into a `.ratest` file. The format emitted here must be round-trippable
 * through `parseRatest` in `tests/ratest.ts`.
 *
 * Waits are element-based, not wall-clock: before every click we emit
 * `wait <path>`, which during playback polls the stage until the target
 * resolves (default 15s timeout). This replaces the older timing-based
 * `pause <ms>` approach, which was fragile across machines/runs. For
 * achievement-trigger events we emit `waitTriggered <id>` — same idea,
 * poll until the edit actually fires rather than guessing a delay.
 */

type RecordingEvent =
    | { kind: "click"; path: string; timestamp: number }
    | { kind: "triggered"; id: number; name?: string; timestamp: number };

export function serializeRatest(
    events: RecordingEvent[],
    gameHash: string,
    _startTime: number | null,
): string {
    const lines: string[] = [];
    lines.push(`hash ${gameHash}`);
    lines.push("");

    // No per-step pauses: inter-step timing is handled by the
    // global `playbackDelayMs` setting, applied by the runner between
    // every step. Keeping the recording itself pause-free means the
    // user can tune timing centrally instead of hand-editing files.
    for (const ev of events) {
        switch (ev.kind) {
            case "click":
                lines.push(`wait ${ev.path}`);
                lines.push(`click ${ev.path}`);
                break;
            case "triggered":
                lines.push(`waitTriggered ${ev.id}`);
                break;
        }
    }

    return lines.join("\n") + "\n";
}
