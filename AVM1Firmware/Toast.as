/**
 * Toast Notification System for AVM1 (AS2)
 *
 * Displays slide-up notifications with image, title, description, and label.
 * Supports stacking and left/right alignment.
 * Used for achievement unlocks, game info, etc.
 */
class Toast {
    // Toast dimensions and styling
    private static var PADDING:Number = 10;
    private static var MARGIN:Number = 16;
    private static var TOAST_GAP:Number = 8;
    private static var IMAGE_SIZE:Number = 64;
    private static var TEXT_GAP:Number = 2;
    private static var MIN_TEXT_WIDTH:Number = 180;
    private static var CORNER_RADIUS:Number = 6;
    private static var BG_COLOR:Number = 0x1F2937;
    private static var BG_ALPHA:Number = 95;

    // Text colors
    private static var TITLE_COLOR:Number = 0xFFFFFF;
    private static var DESC_COLOR:Number = 0xFACC15;   // Yellow
    private static var LABEL_COLOR:Number = 0x2DD4BF;  // Teal

    // Font sizes
    private static var TITLE_SIZE:Number = 16;
    private static var DESC_SIZE:Number = 12;
    private static var LABEL_SIZE:Number = 11;

    // Animation settings
    private static var SLIDE_SPEED:Number = 8;
    private static var DISPLAY_TIME:Number = 4000; // ms
    private static var HIDE_OFFSET:Number = 40;  // How far to slide off-screen when hovered

    // Animation states
    private static var STATE_SLIDE_UP:Number = 0;
    private static var STATE_DISPLAY:Number = 1;
    private static var STATE_SLIDE_DOWN:Number = 2;

    // Active toasts (for stacking) - separate for left and right
    private static var activeToastsLeft:Array = [];
    private static var activeToastsRight:Array = [];
    private static var toastDepth:Number = 999999;

    // Host clip for toast containers. In parent mode this is _root (the
    // firmware owns _level0). In child mode this must be the firmware's own
    // clip (__raflash) — creating clips on the game's _root at high depths
    // can stop the game's timeline and interfere with its display list.
    private static var hostClip:MovieClip;

    /**
     * Set the clip that toast containers will be created on.
     */
    public static function setHostClip(clip:MovieClip):Void {
        hostClip = clip;
    }

    /**
     * Show a toast notification
     * @param title Main title text (white, large)
     * @param description Description text (yellow)
     * @param label Label text (teal)
     * @param align "left" or "right" (default: "right")
     * @param imageUrl URL to load badge image from (optional)
     */
    public static function show(title:String, description:String, label:String, align:String, imageUrl:String):Void {
        if (align == undefined || align == null || align == "") {
            align = "left";
        }
        createToast(title, description, label, align, imageUrl);
    }

    /**
     * Create and animate a toast
     */
    private static function createToast(title:String, description:String, label:String, align:String, imageUrl:String):Void {
        var isRight:Boolean = (align != "left");
        var activeToasts:Array = isRight ? activeToastsRight : activeToastsLeft;

        // Create container MovieClip at a very high depth (above game content)
        var host:MovieClip = (hostClip != null) ? hostClip : _root;
        var container:MovieClip = host.createEmptyMovieClip("toast_" + toastDepth, toastDepth++);

        // Create text fields to measure sizes
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

        var labelFormat:TextFormat = new TextFormat();
        labelFormat.font = "_sans";
        labelFormat.size = LABEL_SIZE;
        labelFormat.color = LABEL_COLOR;
        labelFormat.bold = false;

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

        // Create label field
        container.createTextField("labelField", 5, 0, 0, 400, 100);
        var labelField:TextField = container.labelField;
        labelField.autoSize = "left";
        labelField.wordWrap = false;
        labelField.selectable = false;
        labelField.embedFonts = false;
        labelField.text = label;
        labelField.setTextFormat(labelFormat);

        // Calculate dimensions
        var maxTextWidth:Number = Math.max(titleField.textWidth, descField.textWidth, labelField.textWidth) + 4;
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
            var assetId:Number = Number(urlParts[urlParts.length - 1]);
            var cachedImage:MovieClip = Main.getBadgeImage(assetId);

            if (cachedImage != null && cachedImage._width > 0) {
                // Copy pixels from cached image by drawing into this clip
                // Create a BitmapData to copy the cached image
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
            // Draw placeholder (dark gray square with star icon)
            imageHolder.beginFill(0x374151, 100);
            drawRoundedRect(imageHolder, 0, 0, IMAGE_SIZE, IMAGE_SIZE, 4);
            imageHolder.endFill();

            // Draw star icon in center
            imageHolder.lineStyle(0);
            imageHolder.beginFill(0x9CA3AF, 100);
            drawStar(imageHolder, IMAGE_SIZE / 2, IMAGE_SIZE / 2, 12, 6, 5);
            imageHolder.endFill();
        }

        // Position text fields
        var textX:Number = PADDING + IMAGE_SIZE + PADDING;
        var textStartY:Number = PADDING + 4;
        var lineHeight1:Number = titleField.textHeight + TEXT_GAP;
        var lineHeight2:Number = descField.textHeight + TEXT_GAP;

        titleField._x = textX;
        titleField._y = textStartY;
        descField._x = textX;
        descField._y = textStartY + lineHeight1;
        labelField._x = textX;
        labelField._y = textStartY + lineHeight1 + lineHeight2;

        // Store dimensions for stacking and hover detection
        container.toastHeight = boxHeight;
        container.toastWidth = boxWidth;
        container.toastAlign = align;

        // Position toast (start below screen)
        var stageWidth:Number = Stage.width;
        var stageHeight:Number = Stage.height;

        // Calculate X positions for normal and hidden states
        if (isRight) {
            container.targetX = stageWidth - boxWidth - MARGIN;
            container.hiddenX = stageWidth + HIDE_OFFSET;
        } else {
            container.targetX = MARGIN;
            container.hiddenX = -boxWidth - HIDE_OFFSET;
        }
        container._x = container.targetX;
        container._y = stageHeight; // Start below screen

        // Calculate target Y based on existing toasts
        var targetY:Number = stageHeight - boxHeight - MARGIN;

        // Push existing toasts upward
        for (var i:Number = 0; i < activeToasts.length; i++) {
            var existingToast:MovieClip = activeToasts[i];
            existingToast.targetY -= (boxHeight + TOAST_GAP);
        }

        // Add to active toasts
        activeToasts.push(container);

        // Animation state stored on container
        container.state = STATE_SLIDE_UP;
        container.targetY = targetY;
        container.stageHeight = stageHeight;
        container.displayStartTime = 0;

        // Animate using onEnterFrame
        container.onEnterFrame = function():Void {
            // Check if mouse is in the toast's zone (use targetX, not current _x)
            var mouseInZone:Boolean = (_root._xmouse >= this.targetX &&
                                       _root._xmouse <= this.targetX + this.toastWidth &&
                                       _root._ymouse >= this.targetY &&
                                       _root._ymouse <= this.targetY + this.toastHeight);

            // Animate X position based on hover
            var destX:Number = mouseInZone ? this.hiddenX : this.targetX;
            var dx:Number = destX - this._x;
            if (Math.abs(dx) > 1) {
                this._x += dx * 0.3;
            } else {
                this._x = destX;
            }

            // Animate Y position based on state
            var dy:Number = this.targetY - this._y;

            switch (this.state) {
                case Toast.STATE_SLIDE_UP:
                    if (Math.abs(dy) > Toast.SLIDE_SPEED) {
                        this._y += (dy < 0 ? -Toast.SLIDE_SPEED : Toast.SLIDE_SPEED);
                    } else {
                        this._y = this.targetY;
                        this.state = Toast.STATE_DISPLAY;
                        this.displayStartTime = getTimer();
                    }
                    break;

                case Toast.STATE_DISPLAY:
                    // Keep following target Y if pushed by newer toasts
                    if (Math.abs(dy) > 1) {
                        this._y += dy * 0.3;
                    }
                    if (getTimer() - this.displayStartTime >= Toast.DISPLAY_TIME) {
                        this.state = Toast.STATE_SLIDE_DOWN;
                    }
                    break;

                case Toast.STATE_SLIDE_DOWN:
                    this._y += Toast.SLIDE_SPEED;
                    if (this._y >= this.stageHeight) {
                        Toast.removeToast(this, this.toastAlign);
                        delete this.onEnterFrame;
                        this.removeMovieClip();
                    }
                    break;
            }
        };
    }

    /**
     * Remove a toast from the active list
     */
    private static function removeToast(toast:MovieClip, align:String):Void {
        var activeToasts:Array = (align == "left") ? activeToastsLeft : activeToastsRight;
        for (var i:Number = 0; i < activeToasts.length; i++) {
            if (activeToasts[i] == toast) {
                activeToasts.splice(i, 1);
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
            var scaleX:Number = Toast.IMAGE_SIZE / target._width;
            var scaleY:Number = Toast.IMAGE_SIZE / target._height;
            var scale:Number = Math.min(scaleX, scaleY);
            target._width = target._width * scale;
            target._height = target._height * scale;
            target._x = (Toast.IMAGE_SIZE - target._width) / 2;
            target._y = (Toast.IMAGE_SIZE - target._height) / 2;
        };

        listener.onLoadError = function(target:MovieClip, errorCode:String, httpStatus:Number):Void {
            // Silently ignore - toast will show without image
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
     * Draw a simple star shape
     */
    private static function drawStar(mc:MovieClip, cx:Number, cy:Number, outerR:Number, innerR:Number, points:Number):Void {
        var angle:Number = -Math.PI / 2;
        var step:Number = Math.PI / points;

        mc.moveTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);

        for (var i:Number = 0; i < points * 2; i++) {
            angle += step;
            var r:Number = (i % 2 == 0) ? innerR : outerR;
            mc.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        }
    }
}
