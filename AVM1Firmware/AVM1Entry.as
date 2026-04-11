/**
 * AVM1 Firmware Entry Point
 *
 * Simple entry point that calls Main.init(self), where `self` is the
 * timeline that owns the frame 1 action — i.e. the firmware SWF's own
 * root MovieClip. MTASC's frame 1 actions implicitly call
 * EntryClass.main(this) so the typed param receives it.
 *
 * Forwarding `self` lets the child-mode bootstrap attach onEnterFrame to
 * the firmware's own clip rather than to _root (which in child mode would
 * clobber the game's _root onEnterFrame handler).
 *
 * Separated from Main so Main.as can be used in tests without entry point
 * conflicts.
 */
class AVM1Entry {
    public static function main(self:MovieClip):Void {
        Main.init(self);
    }
}
