package;

import flash.display.Sprite;
import flash.display.Graphics;
import flash.display.Loader;
import flash.events.Event;
import flash.events.IOErrorEvent;
import flash.net.URLRequest;

/**
 * Primed Badges UI Component for AVM2 (AS3/Haxe)
 *
 * Displays persistent badge images in the top-right corner when achievements
 * are in the "primed" state (all non-TRIGGER conditions met, TRIGGER pending).
 * Multiple badges stack vertically downward. Slides off-screen on mouse hover.
 *
 * Port of AVM1Firmware/PrimedBadges.as.
 */
class PrimedBadges extends Sprite {
    private static inline var IMAGE_SIZE:Int = 32;
    private static inline var MARGIN:Int = 0;
    private static inline var GAP:Int = 4;
    private static inline var BADGE_ALPHA:Float = 0.75;
    private static inline var HIDE_OFFSET:Int = 40;

    private static var activeBadges:Map<Int, PrimedBadges> = new Map();
    private static var badgeOrder:Array<Int> = [];

    // Instance state
    private var badgeAssetId:Int;
    private var targetX:Float;
    private var hiddenX:Float;
    private var badgeY:Float;

    public static function show(assetId:Int, imageUrl:String):Void {
        if (activeBadges.exists(assetId)) return;
        new PrimedBadges(assetId, imageUrl);
    }

    public static function clearAll():Void {
        for (assetId in activeBadges.keys()) {
            hide(assetId);
        }
    }

    public static function hide(assetId:Int):Void {
        if (!activeBadges.exists(assetId)) return;

        var badge = activeBadges.get(assetId);
        activeBadges.remove(assetId);
        badgeOrder.remove(assetId);

        badge.removeEventListener(Event.ENTER_FRAME, badge.onEnterFrame);
        if (badge.parent != null) {
            badge.parent.removeChild(badge);
        }

        repositionBadges();
    }

    public function new(assetId:Int, imageUrl:String) {
        super();
        badgeAssetId = assetId;
        this.alpha = BADGE_ALPHA;

        // Draw background
        var g = this.graphics;
        g.beginFill(0x1F2937, 0.95);
        g.drawRoundRect(0, 0, IMAGE_SIZE, IMAGE_SIZE, 4, 4);
        g.endFill();

        // Image holder
        var imageHolder = new Sprite();
        addChild(imageHolder);

        var ig = imageHolder.graphics;
        ig.beginFill(0x374151, 1);
        ig.drawRoundRect(0, 0, IMAGE_SIZE, IMAGE_SIZE, 3, 3);
        ig.endFill();

        if (imageUrl != null && imageUrl != "") {
            var imageUrlCopy = imageUrl;
            var loader = new Loader();
            loader.contentLoaderInfo.addEventListener(Event.COMPLETE, function(e:Event):Void {
                var content = loader.content;
                var sx = IMAGE_SIZE / content.width;
                var sy = IMAGE_SIZE / content.height;
                var s = Math.min(sx, sy);
                content.width = content.width * s;
                content.height = content.height * s;
                content.x = (IMAGE_SIZE - content.width) / 2;
                content.y = (IMAGE_SIZE - content.height) / 2;
            });
            loader.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR, function(e:Event):Void {
                // Silently ignore — badge will show placeholder
            });
            loader.load(new URLRequest(imageUrlCopy));
            imageHolder.addChild(loader);
        }

        // Store and position
        activeBadges.set(assetId, this);
        badgeOrder.push(assetId);

        var stage = flash.Lib.current.stage;
        targetX = stage.stageWidth - IMAGE_SIZE;
        hiddenX = stage.stageWidth + HIDE_OFFSET;
        badgeY = MARGIN + (badgeOrder.length - 1) * (IMAGE_SIZE + GAP);

        this.x = targetX;
        this.y = badgeY;

        flash.Lib.current.addChild(this);
        addEventListener(Event.ENTER_FRAME, onEnterFrame);

        repositionBadges();
    }

    private function onEnterFrame(e:Event):Void {
        var stage = flash.Lib.current.stage;
        var mouseX = stage.mouseX;
        var mouseY = stage.mouseY;

        // Check if mouse is in the badge's original zone
        var mouseInZone = (mouseX >= targetX && mouseX <= targetX + IMAGE_SIZE &&
                           mouseY >= badgeY && mouseY <= badgeY + IMAGE_SIZE);

        var destX:Float = mouseInZone ? hiddenX : targetX;
        var dx = destX - this.x;
        if (Math.abs(dx) > 1) {
            this.x += dx * 0.3;
        } else {
            this.x = destX;
        }
    }

    private static function repositionBadges():Void {
        var stage = flash.Lib.current.stage;
        var stageWidth = stage.stageWidth;

        var i:Int = 0;
        while (i < badgeOrder.length) {
            var id = badgeOrder[i];
            if (activeBadges.exists(id)) {
                var badge = activeBadges.get(id);
                badge.targetX = stageWidth - IMAGE_SIZE;
                badge.hiddenX = stageWidth + HIDE_OFFSET;
                badge.badgeY = MARGIN + (i * (IMAGE_SIZE + GAP));
                badge.y = badge.badgeY;
            }
            i++;
        }
    }
}
