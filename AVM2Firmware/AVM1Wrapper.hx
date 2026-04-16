/**
 * Minimal AVM2 wrapper for AVM1 firmware.
 *
 * Exists solely to suppress the Flash Player right-click context menu,
 * which is only possible in AS3 (Flash 11.2+). Loads the real AVM1
 * firmware SWF inside itself — the AS2 code runs unmodified.
 */
import flash.display.Sprite;
import flash.display.Loader;
import flash.display.StageAlign;
import flash.display.StageScaleMode;
import flash.events.Event;
import flash.events.MouseEvent;
import flash.net.URLRequest;

class AVM1Wrapper extends Sprite {
    public static function main() {
        flash.Lib.current.addChild(new AVM1Wrapper());
    }

    public function new() {
        super();
        addEventListener(Event.ADDED_TO_STAGE, onAddedToStage);
    }

    private function onAddedToStage(_:Event):Void {
        removeEventListener(Event.ADDED_TO_STAGE, onAddedToStage);

        stage.align = StageAlign.TOP_LEFT;
        stage.scaleMode = StageScaleMode.NO_SCALE;
        flash.Lib.fscommand("showmenu", "false");

        // Suppress right-click context menu
        var cm = new flash.ui.ContextMenu();
        cm.hideBuiltInItems();
        contextMenu = cm;
        stage.addEventListener(MouseEvent.RIGHT_CLICK, function(_:MouseEvent):Void {});

        // Load the real AVM1 firmware, passing through the port param
        // so the AS2 firmware knows which port to connect to.
        var firmwareUrl:String = "avm1-firmware.swf";
        try {
            var myUrl:String = flash.Lib.current.loaderInfo.url;
            if (myUrl != null) {
                var portIdx:Int = myUrl.indexOf("port=");
                if (portIdx >= 0) {
                    var portStr:String = myUrl.substr(portIdx + 5);
                    var ampIdx:Int = portStr.indexOf("&");
                    if (ampIdx >= 0) portStr = portStr.substr(0, ampIdx);
                    firmwareUrl = "avm1-firmware.swf?port=" + portStr;
                }
            }
        } catch (e:Dynamic) {}
        var loader = new Loader();
        addChild(loader);
        loader.load(new URLRequest(firmwareUrl));
    }
}
