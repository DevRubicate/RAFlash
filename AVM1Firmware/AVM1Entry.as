/**
 * AVM1 Firmware Entry Point
 *
 * Simple entry point that calls Main.init().
 * Separated to allow Main.as to be used in tests without entry point conflicts.
 */
class AVM1Entry {
    public static function main():Void {
        Main.init();
    }
}
