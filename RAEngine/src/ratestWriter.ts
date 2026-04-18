/**
 * Serialize a recorded stream of user-input + achievement-trigger events
 * into a `.ratest` file. The format emitted here must be round-trippable
 * through `parseRatest` in `tests/ratest.ts`.
 *
 * Timing is wall-clock: the delta between consecutive event timestamps
 * becomes a `pause <ms>` step. During live playback the game continues
 * running on its own onEnterFrame while paused, so wall-clock intervals
 * preserve the approximate player experience across any game (no
 * game-specific `tick()` method required).
 */

type RecordingEvent =
    | { kind: "click"; path: string; timestamp: number }
    | { kind: "triggered"; id: number; name?: string; timestamp: number };

export function serializeRatest(
    events: RecordingEvent[],
    gameHash: string,
    startTime: number | null,
): string {
    const lines: string[] = [];
    lines.push(`hash ${gameHash}`);
    lines.push("");

    // Seed prevTs with startTime so any wait between "recording armed" and
    // the first event (loading bar, intro anim, player hesitation) becomes
    // an initial `pause` step. Without this, playback fires the first
    // click the instant performResetGame returns — often too early.
    let prevTs: number | null = startTime;
    for (const ev of events) {
        if (prevTs !== null) {
            const delta = ev.timestamp - prevTs;
            if (delta > 0) lines.push(`pause ${delta}`);
        }
        switch (ev.kind) {
            case "click":
                lines.push(`click ${ev.path}`);
                break;
            case "triggered":
                lines.push(`assertTriggered ${ev.id}`);
                break;
        }
        prevTs = ev.timestamp;
    }

    return lines.join("\n") + "\n";
}
