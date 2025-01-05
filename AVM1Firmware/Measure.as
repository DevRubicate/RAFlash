/**
 * Measure Notification System for AVM1 (AS2)
 *
 * Displays fade-in/fade-out progress notifications with image, title, description, and progress.
 * Supports stacking on the right side of the screen.
 * Used for showing achievement progress like "Achievement Name", "Description", "1/5".
 */
class Measure {
    // Measure dimensions and styling
    private static var PADDING:Number = 10;
    private static var MARGIN:Number = 16;
    private static var MEASURE_GAP:Number = 8;
    private static var IMAGE_SIZE:Number = 64;
    private static var TEXT_GAP:Number = 2;
    private static var MIN_TEXT_WIDTH:Number = 180;
    private static var CORNER_RADIUS:Number = 6;
    private static var BG_COLOR:Number = 0x1F2937;
    private static var BG_ALPHA:Number = 95;

    // Text colors (same as Toast)
    private static var TITLE_COLOR:Number = 0xFFFFFF;
    private static var DESC_COLOR:Number = 0xFACC15;   // Yellow
    private static var PROGRESS_COLOR:Number = 0x2DD4BF;  // Teal

    // Font sizes (same as Toast)
    private static var TITLE_SIZE:Number = 16;
    private static var DESC_SIZE:Number = 12;
    private static var PROGRESS_SIZE:Number = 11;

    // Animation settings
    private static var FADE_SPEED:Number = 5;     // Alpha change per frame (out of 100)
    private static var DISPLAY_TIME:Number = 5000; // ms (5 seconds)

    // Animation states
    private static var STATE_FADE_IN:Number = 0;
    private static var STATE_DISPLAY:Number = 1;
    private static var STATE_FADE_OUT:Number = 2;

    // Active measures (for stacking) - right side only
    private static var activeMeasures:Array = [];
    private static var measureDepth:Number = 998000;

    // Track measures by asset ID for timer resets
    private static var measureByAsset:Object = {};

    /**
     * Show a measure notification
     * @param title Main title text (white, large)
     * @param description Description text (yellow)
     * @param progress Progress text like "1/5" (teal)
     * @param imageUrl URL to load badge image from (optional)
     */
    public static function show(title:String, description:String, progress:String, imageUrl:String):Void {
        createMeasure(title, description, progress, imageUrl, null);
    }

    /**
     * Show a measure notification for an asset, or reset timer if already showing
     * @param title Main title text (white, large)
     * @param description Description text (yellow)
     * @param progress Progress text like "1/5" (teal)
     * @param imageUrl URL to load badge image from (optional)
     * @param assetId The asset ID to track (for timer reset)
     */
    public static function showOrReset(title:String, description:String, progress:String, imageUrl:String, assetId:Number):Void {
        // Initialize tracking object if needed
        if (measureByAsset == null) {
            measureByAsset = {};
        }

        var existing:MovieClip = measureByAsset[assetId];
        if (existing != null && existing._alpha > 0) {
            // Update all text fields and reset timer
            existing.titleField.text = title;
            existing.descField.text = description;
            existing.progressField.text = progress;

            // Reapply text formats
            var titleFormat:TextFormat = new TextFormat();
            titleFormat.font = "_sans";
            titleFormat.size = TITLE_SIZE;
            titleFormat.color = TITLE_COLOR;
            titleFormat.bold = true;
            existing.titleField.setTextFormat(titleFormat);

            var descFormat:TextFormat = new TextFormat();
            descFormat.font = "_sans";
            descFormat.size = DESC_SIZE;
            descFormat.color = DESC_COLOR;
            descFormat.bold = false;
            existing.descField.setTextFormat(descFormat);

            var progressFormat:TextFormat = new TextFormat();
            progressFormat.font = "_sans";
            progressFormat.size = PROGRESS_SIZE;
            progressFormat.color = PROGRESS_COLOR;
            progressFormat.bold = false;
            existing.progressField.setTextFormat(progressFormat);

            existing.displayStartTime = getTimer();
            // If fading out, switch back to display state
            if (existing.state == STATE_FADE_OUT) {
                existing.state = STATE_DISPLAY;
                existing._alpha = 100;
            }
        } else {
            // Create new measure and track it
            var mc:MovieClip = createMeasure(title, description, progress, imageUrl, assetId);
            measureByAsset[assetId] = mc;
        }
    }

    /**
     * Create and animate a measure
     * @return The created MovieClip container
     */
    private static function createMeasure(title:String, description:String, progress:String, imageUrl:String, assetId:Number):MovieClip {
        // Create container MovieClip at a very high depth (above game content)
        var container:MovieClip = _root.createEmptyMovieClip("measure_" + measureDepth, measureDepth++);
        container.assetId = assetId;

        // Create text formats
        var titleFormat:TextFormat = new TextFormat();
        titleFormat.font = "_sans";
        titleFormat.size = TITLE_SIZE;
        titleFormat.color = TITLE_COLOR;
        titleFormat.bold = true;

        var descFormat:TextFormat = new TextFormat();
        descFormat.font = "_sans";
        descFormat.size = DESC_SIZE;
        descFormat.color = DESC_COLOR;
        descFormat.bold = false;

        var progressFormat:TextFormat = new TextFormat();
        progressFormat.font = "_sans";
        progressFormat.size = PROGRESS_SIZE;
        progressFormat.color = PROGRESS_COLOR;
        progressFormat.bold = false;

        // Create title field
        container.createTextField("titleField", 3, 0, 0, 400, 100);
        var titleField:TextField = container.titleField;
        titleField.autoSize = "left";
        titleField.wordWrap = false;
        titleField.selectable = false;
        titleField.embedFonts = false;
        titleField.text = title;
        titleField.setTextFormat(titleFormat);

        // Create description field
        container.createTextField("descField", 4, 0, 0, 400, 100);
        var descField:TextField = container.descField;
        descField.autoSize = "left";
        descField.wordWrap = false;
        descField.selectable = false;
        descField.embedFonts = false;
        descField.text = description;
        descField.setTextFormat(descFormat);

        // Create progress field
        container.createTextField("progressField", 5, 0, 0, 400, 100);
        var progressField:TextField = container.progressField;
        progressField.autoSize = "left";
        progressField.wordWrap = false;
        progressField.selectable = false;
        progressField.embedFonts = false;
        progressField.text = progress;
        progressField.setTextFormat(progressFormat);

        // Calculate dimensions
        var maxTextWidth:Number = Math.max(titleField.textWidth, descField.textWidth, progressField.textWidth) + 4;
        var textWidth:Number = Math.max(MIN_TEXT_WIDTH, maxTextWidth);
        var boxWidth:Number = PADDING + IMAGE_SIZE + PADDING + textWidth + PADDING;
        var boxHeight:Number = IMAGE_SIZE + PADDING * 2;

        // Draw rounded rectangle background
        container.beginFill(BG_COLOR, BG_ALPHA);
        drawRoundedRect(container, 0, 0, boxWidth, boxHeight, CORNER_RADIUS);
        container.endFill();

        // Create image holder
        var imageX:Number = PADDING;
        var imageY:Number = PADDING;
        var imageHolder:MovieClip = container.createEmptyMovieClip("imageHolder", 2);
        imageHolder._x = imageX;
        imageHolder._y = imageY;

        // Load image if URL provided, otherwise draw placeholder
        if (imageUrl != undefined && imageUrl != null && imageUrl != "") {
            // Draw background first (in case image has transparency or fails to load)
            imageHolder.beginFill(0x374151, 100);
            drawRoundedRect(imageHolder, 0, 0, IMAGE_SIZE, IMAGE_SIZE, 4);
            imageHolder.endFill();

            // Create inner clip for the loaded image
            var imageTarget:MovieClip = imageHolder.createEmptyMovieClip("imageTarget", 1);

            // Check if image is preloaded in cache
            var urlParts:Array = imageUrl.split("/");
            var imageAssetId:Number = Number(urlParts[urlParts.length - 1]);
            var cachedImage:MovieClip = Main.getBadgeImage(imageAssetId);

            if (cachedImage != null && cachedImage._width > 0) {
                // Copy pixels from cached image by drawing into this clip
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
        } else {
            // Draw placeholder (dark gray square with gauge icon)
            imageHolder.beginFill(0x374151, 100);
            drawRoundedRect(imageHolder, 0, 0, IMAGE_SIZE, IMAGE_SIZE, 4);
            imageHolder.endFill();

            // Draw gauge/progress icon in center
            imageHolder.lineStyle(2, 0x9CA3AF, 100);
            var cx:Number = IMAGE_SIZE / 2;
            var cy:Number = IMAGE_SIZE / 2;
            var r:Number = 16;
            // Draw arc (270 degrees)
            drawArc(imageHolder, cx, cy, r, -135, 135);
            // Draw needle
            imageHolder.lineStyle(2, 0x9CA3AF, 100);
            imageHolder.moveTo(cx, cy);
            imageHolder.lineTo(cx + 8, cy - 8);
        }

        // Position text fields (same layout as Toast)
        var textX:Number = PADDING + IMAGE_SIZE + PADDING;
        var textStartY:Number = PADDING + 4;
        var lineHeight1:Number = titleField.textHeight + TEXT_GAP;
        var lineHeight2:Number = descField.textHeight + TEXT_GAP;

        titleField._x = textX;
        titleField._y = textStartY;
        descField._x = textX;
        descField._y = textStartY + lineHeight1;
        progressField._x = textX;
        progressField._y = textStartY + lineHeight1 + lineHeight2;

        // Store height for stacking calculations
        container.measureHeight = boxHeight;

        // Position measure (right side, start at final Y but invisible)
        var stageWidth:Number = Stage.width;
        var stageHeight:Number = Stage.height;

        container._x = stageWidth - boxWidth - MARGIN;

        // Calculate target Y based on existing measures
        var targetY:Number = stageHeight - boxHeight - MARGIN;

        // Push existing measures upward
        for (var i:Number = 0; i < activeMeasures.length; i++) {
            var existingMeasure:MovieClip = activeMeasures[i];
            existingMeasure.targetY -= (boxHeight + MEASURE_GAP);
        }

        // Set initial position and alpha
        container._y = targetY;
        container._alpha = 0; // Start invisible

        // Add to active measures
        activeMeasures.push(container);

        // Animation state stored on container
        container.state = STATE_FADE_IN;
        container.targetY = targetY;
        container.stageHeight = stageHeight;
        container.displayStartTime = 0;

        // Animate using onEnterFrame
        container.onEnterFrame = function():Void {
            var dy:Number = this.targetY - this._y;

            switch (this.state) {
                case Measure.STATE_FADE_IN:
                    this._alpha += Measure.FADE_SPEED;
                    if (this._alpha >= 100) {
                        this._alpha = 100;
                        this.state = Measure.STATE_DISPLAY;
                        this.displayStartTime = getTimer();
                    }
                    // Also follow target Y if pushed
                    if (Math.abs(dy) > 1) {
                        this._y += dy * 0.3;
                    }
                    break;

                case Measure.STATE_DISPLAY:
                    // Keep following target Y if pushed by newer measures
                    if (Math.abs(dy) > 1) {
                        this._y += dy * 0.3;
                    }
                    if (getTimer() - this.displayStartTime >= Measure.DISPLAY_TIME) {
                        this.state = Measure.STATE_FADE_OUT;
                    }
                    break;

                case Measure.STATE_FADE_OUT:
                    this._alpha -= Measure.FADE_SPEED;
                    // Also follow target Y while fading
                    if (Math.abs(dy) > 1) {
                        this._y += dy * 0.3;
                    }
                    if (this._alpha <= 0) {
                        Measure.removeMeasure(this);
                        delete this.onEnterFrame;
                        this.removeMovieClip();
                    }
                    break;
            }
        };

        return container;
    }

    /**
     * Remove a measure from the active list and asset tracking
     */
    private static function removeMeasure(measure:MovieClip):Void {
        // Clear asset tracking if this measure was tracked
        if (measure.assetId != null && measureByAsset != null) {
            delete measureByAsset[measure.assetId];
        }
        for (var i:Number = 0; i < activeMeasures.length; i++) {
            if (activeMeasures[i] == measure) {
                activeMeasures.splice(i, 1);
                break;
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
            var scaleX:Number = Measure.IMAGE_SIZE / target._width;
            var scaleY:Number = Measure.IMAGE_SIZE / target._height;
            var scale:Number = Math.min(scaleX, scaleY);
            target._width = target._width * scale;
            target._height = target._height * scale;
            target._x = (Measure.IMAGE_SIZE - target._width) / 2;
            target._y = (Measure.IMAGE_SIZE - target._height) / 2;
        };

        listener.onLoadError = function(target:MovieClip, errorCode:String, httpStatus:Number):Void {
            // Silently ignore - measure will show without image
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

    /**
     * Draw an arc (for gauge icon)
     */
    private static function drawArc(mc:MovieClip, cx:Number, cy:Number, r:Number, startAngle:Number, endAngle:Number):Void {
        var segments:Number = 20;
        var angleStep:Number = (endAngle - startAngle) / segments;
        var angleRad:Number = startAngle * Math.PI / 180;

        mc.moveTo(cx + Math.cos(angleRad) * r, cy + Math.sin(angleRad) * r);

        for (var i:Number = 1; i <= segments; i++) {
            angleRad = (startAngle + angleStep * i) * Math.PI / 180;
            mc.lineTo(cx + Math.cos(angleRad) * r, cy + Math.sin(angleRad) * r);
        }
    }
}
