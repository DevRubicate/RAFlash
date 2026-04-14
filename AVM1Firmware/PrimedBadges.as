/**
 * Primed Badges UI Component for AVM1 (AS2)
 *
 * Displays persistent badge images in the top-right corner when achievements
 * are in the "primed" state (all non-TRIGGER conditions met, TRIGGER pending).
 * Multiple badges stack vertically downward from the top-right corner.
 */
class PrimedBadges {
    // Dimensions and styling
    private static var IMAGE_SIZE:Number = 32;
    private static var MARGIN:Number = 0;
    private static var GAP:Number = 4;
    private static var ALPHA:Number = 75;  // 25% transparent = 75% opaque
    private static var HIDE_OFFSET:Number = 40;  // How far to slide off-screen

    // Track active badges by asset ID
    private static var activeBadges:Object = {};  // assetId -> MovieClip
    private static var badgeOrder:Array = [];     // assetIds in display order (right to left)
    private static var DEPTH_MIN:Number = 999500;
    private static var DEPTH_MAX:Number = 999900;
    private static var badgeDepth:Number = 999500;

    // Host clip — set to the firmware's own clip in child mode so we don't
    // create clips on the game's _root (which can stop its timeline).
    private static var hostClip:MovieClip;

    public static function setHostClip(clip:MovieClip):Void {
        hostClip = clip;
    }

    /**
     * Show a primed badge for an achievement
     * @param assetId The achievement ID
     * @param imageUrl URL to load badge image from
     */
    public static function show(assetId:Number, imageUrl:String):Void {
        // Don't create duplicate badges
        if (activeBadges[assetId] != undefined) {
            return;
        }

        // Create container MovieClip
        var host:MovieClip = (hostClip != null) ? hostClip : _root;
        if (badgeDepth > DEPTH_MAX) badgeDepth = DEPTH_MIN;
        var container:MovieClip = host.createEmptyMovieClip("primedBadge_" + assetId, badgeDepth++);
        container._alpha = ALPHA;

        // Draw background (dark gray rounded square)
        container.beginFill(0x1F2937, 95);
        drawRoundedRect(container, 0, 0, IMAGE_SIZE, IMAGE_SIZE, 4);
        container.endFill();

        // Create image holder
        var imageHolder:MovieClip = container.createEmptyMovieClip("imageHolder", 1);

        // Draw placeholder background
        imageHolder.beginFill(0x374151, 100);
        drawRoundedRect(imageHolder, 0, 0, IMAGE_SIZE, IMAGE_SIZE, 3);
        imageHolder.endFill();

        // Create inner clip for loaded image
        var imageTarget:MovieClip = imageHolder.createEmptyMovieClip("imageTarget", 2);

        // Check if image is preloaded in cache
        var cachedImage:MovieClip = Main.getBadgeImage(assetId);

        if (cachedImage != null && cachedImage._width > 0) {
            // Copy pixels from cached image
            var bmpClass:Function = _global.flash.display.BitmapData;
            if (bmpClass != null) {
                var bmp:Object = new bmpClass(IMAGE_SIZE, IMAGE_SIZE, false, 0x374151);
                bmp.draw(cachedImage);
                imageTarget.attachBitmap(bmp, 1);
            } else {
                // BitmapData not available, use HTTP load
                loadImageViaHttp(imageUrl, imageTarget);
            }
        } else {
            // Not cached yet, use HTTP load
            loadImageViaHttp(imageUrl, imageTarget);
        }

        // Store badge
        activeBadges[assetId] = container;
        badgeOrder.push(assetId);

        // Store target X for animation
        container.targetX = Stage.width - IMAGE_SIZE;
        container.hiddenX = Stage.width + HIDE_OFFSET;
        container.badgeY = MARGIN + (badgeOrder.length - 1) * (IMAGE_SIZE + GAP);
        container.badgeSize = IMAGE_SIZE;

        // Check mouse position each frame and animate
        container.onEnterFrame = function():Void {
            // Check if mouse is in the badge's original zone (not the current position)
            var mouseInZone:Boolean = (_root._xmouse >= this.targetX &&
                                       _root._xmouse <= this.targetX + this.badgeSize &&
                                       _root._ymouse >= this.badgeY &&
                                       _root._ymouse <= this.badgeY + this.badgeSize);

            var destX:Number = mouseInZone ? this.hiddenX : this.targetX;
            var dx:Number = destX - this._x;
            if (Math.abs(dx) > 1) {
                this._x += dx * 0.3;
            } else {
                this._x = destX;
            }
        };

        // Position all badges
        repositionBadges();
    }

    /**
     * Hide a primed badge for an achievement
     * @param assetId The achievement ID
     */
    public static function hide(assetId:Number):Void {
        var badge:MovieClip = activeBadges[assetId];
        if (badge == undefined) {
            return;
        }

        // Remove from tracking
        delete activeBadges[assetId];

        // Remove from order array
        for (var i:Number = 0; i < badgeOrder.length; i++) {
            if (badgeOrder[i] == assetId) {
                badgeOrder.splice(i, 1);
                break;
            }
        }

        // Remove MovieClip
        badge.removeMovieClip();

        // Reposition remaining badges
        repositionBadges();
    }

    /**
     * Reposition all badges (top to bottom from top-right corner)
     */
    private static function repositionBadges():Void {
        var stageWidth:Number = Stage.width;

        for (var i:Number = 0; i < badgeOrder.length; i++) {
            var assetId:Number = badgeOrder[i];
            var badge:MovieClip = activeBadges[assetId];
            if (badge != undefined) {
                // Update target positions
                badge.targetX = stageWidth - IMAGE_SIZE;
                badge.hiddenX = stageWidth + HIDE_OFFSET;
                badge.badgeY = MARGIN + (i * (IMAGE_SIZE + GAP));
                badge._y = badge.badgeY;

                // Set initial X if not set yet
                if (badge._x == undefined || badge._x == 0) {
                    badge._x = badge.targetX;
                }
            }
        }
    }

    /**
     * Load image via HTTP (fallback when cache miss or BitmapData unavailable)
     */
    private static function loadImageViaHttp(imageUrl:String, imageTarget:MovieClip):Void {
        var mcLoader:MovieClipLoader = new MovieClipLoader();
        var listener:Object = {};

        listener.onLoadInit = function(target:MovieClip):Void {
            // Scale image to fit
            var scaleX:Number = PrimedBadges.IMAGE_SIZE / target._width;
            var scaleY:Number = PrimedBadges.IMAGE_SIZE / target._height;
            var scale:Number = Math.min(scaleX, scaleY);
            target._width = target._width * scale;
            target._height = target._height * scale;
            target._x = (PrimedBadges.IMAGE_SIZE - target._width) / 2;
            target._y = (PrimedBadges.IMAGE_SIZE - target._height) / 2;
            mcLoader.removeListener(listener);
        };

        listener.onLoadError = function(target:MovieClip, errorCode:String, httpStatus:Number):Void {
            mcLoader.removeListener(listener);
        };

        mcLoader.addListener(listener);
        mcLoader.loadClip(imageUrl, imageTarget);
    }

    /**
     * Draw a rounded rectangle
     */
    private static function drawRoundedRect(mc:MovieClip, x:Number, y:Number, w:Number, h:Number, r:Number):Void {
        mc.moveTo(x + r, y);
        mc.lineTo(x + w - r, y);
        mc.curveTo(x + w, y, x + w, y + r);
        mc.lineTo(x + w, y + h - r);
        mc.curveTo(x + w, y + h, x + w - r, y + h);
        mc.lineTo(x + r, y + h);
        mc.curveTo(x, y + h, x, y + h - r);
        mc.lineTo(x, y + r);
        mc.curveTo(x, y, x + r, y);
    }
}
