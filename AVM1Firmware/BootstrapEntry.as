/**
 * AVM1 Bootstrap Entry Point
 *
 * Tiny SWF that Flash Player opens as _level0 BEFORE the game loads.
 * Sets up the full stage environment — menu bar, scaleMode, alignment —
 * then loads game.swf into _level0, destroying itself. Stage properties
 * persist across loadMovie, so the game inherits a fully configured stage.
 *
 * Configuration is passed as FlashVars (?gameUrl=...&scaleMode=...&align=...)
 * which AS2 automatically exposes on _root.
 */
class BootstrapEntry {
    public static function main(self:MovieClip):Void {
        // Hide menu bar and suppress right-click
        fscommand("showmenu", "false");
        fscommand("allowscale", "false");
        var cm:ContextMenu = new ContextMenu();
        cm.hideBuiltInItems();
        MovieClip.prototype.menu = cm;
        Button.prototype.menu = cm;

        // Set stage properties if configured (skip "neutral" — let the game decide)
        var sm:String = _root.scaleMode;
        if (sm != undefined && sm != "" && sm != "neutral") {
            Stage.scaleMode = sm;
        }
        var al:String = _root.align;
        if (al != undefined && al != "" && al != "neutral") {
            Stage.align = al;
        }

        // Load the game SWF into _level0, replacing this bootstrap.
        // The game SWF has firmware loader bytecode injected, so it will
        // load the child firmware as a child clip on its own frame 1.
        var gameUrl:String = _root.gameUrl;
        if (gameUrl == undefined || gameUrl == "") {
            gameUrl = "http://raflash.local/game.swf";
        }
        _level0.loadMovie(gameUrl);
    }
}
