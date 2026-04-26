package;
import flash.display.Sprite;
import flash.net.__RAShim_S0_;

/**
 * Entry point for the AVM2 SharedObject shim SWF.
 *
 * The shim SWF's only purpose is to carry the __RAShim_S0_ class definition
 * so RAEngine's SWF rewriter can inject the DoABC tag into game SWFs. This
 * Sprite is never actually instantiated by Flash — we strip everything but
 * the DoABC tag(s) before injection.
 */
class AVM2ShimEntry extends Sprite {
    public function new() {
        super();
        // Force the shim class into the SWF by referencing it.
        var c:Class<Dynamic> = __RAShim_S0_;
    }
    static function main() {
        flash.Lib.current.addChild(new AVM2ShimEntry());
    }
}
