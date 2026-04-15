package;

import flash.display.Sprite;
import flash.display.Graphics;
import flash.display.Loader;
import flash.text.TextField;
import flash.text.TextFormat;
import flash.text.TextFieldAutoSize;
import flash.events.Event;
import flash.events.IOErrorEvent;
import flash.net.URLRequest;
import haxe.Timer;

/**
 * Toast Notification System for AVM2 (AS3/Haxe)
 *
 * Displays slide-up notifications with image, title, description, and label.
 * Supports stacking and left/right alignment.
 * Used for achievement unlocks, game info, etc.
 */
class Toast extends Sprite {
    // Toast dimensions and styling
    private static inline var PADDING:Int = 10;
    private static inline var MARGIN:Int = 16;
    private static inline var TOAST_GAP:Int = 8;
    private static inline var IMAGE_SIZE:Int = 64;
    private static inline var TEXT_GAP:Int = 2;
    private static inline var MIN_TEXT_WIDTH:Int = 180;
    private static inline var CORNER_RADIUS:Int = 6;
    private static inline var BG_COLOR:Int = 0x1F2937;
    private static inline var BG_ALPHA:Float = 0.95;
    private static inline var HIDE_OFFSET:Int = 40;

    // Text colors
    private static inline var TITLE_COLOR:Int = 0xFFFFFF;
    private static inline var DESC_COLOR:Int = 0xFACC15;   // Yellow
    private static inline var LABEL_COLOR:Int = 0x2DD4BF;  // Teal

    // Font sizes
    private static inline var TITLE_SIZE:Int = 16;
    private static inline var DESC_SIZE:Int = 12;
    private static inline var LABEL_SIZE:Int = 11;

    // Animation settings
    private static inline var SLIDE_SPEED:Float = 8;
    private static inline var DISPLAY_TIME:Int = 4000; // ms

    // Animation states
    private static inline var STATE_SLIDE_UP:Int = 0;
    private static inline var STATE_DISPLAY:Int = 1;
    private static inline var STATE_SLIDE_DOWN:Int = 2;

    // Active toasts (for stacking) - separate for left and right
    private static var activeToastsLeft:Array<Toast> = [];
    private static var activeToastsRight:Array<Toast> = [];

    // Instance variables
    private var state:Int;
    private var targetY:Float;
    private var stageHeight:Float;
    private var toastHeight:Float;
    private var toastAlign:String;
    private var displayStartTime:Float;
    private var targetX:Float;
    private var hiddenX:Float;
    private var toastWidth:Float;

    public static function clearAll():Void {
        for (toast in activeToastsLeft) {
            toast.removeEventListener(Event.ENTER_FRAME, toast.onEnterFrame);
            if (toast.parent != null) toast.parent.removeChild(toast);
        }
        for (toast in activeToastsRight) {
            toast.removeEventListener(Event.ENTER_FRAME, toast.onEnterFrame);
            if (toast.parent != null) toast.parent.removeChild(toast);
        }
        activeToastsLeft = [];
        activeToastsRight = [];
    }

    /**
     * Show a toast notification
     * @param title Main title text (white, large)
     * @param description Description text (yellow)
     * @param label Label text (teal)
     * @param align "left" or "right" (default: "right")
     * @param imageUrl URL to load badge image from (optional)
     */
    public static function show(title:String, description:String, label:String, align:String, imageUrl:String = null):Void {
        if (align == null || align == "") {
            align = "left";
        }
        new Toast(title, description, label, align, imageUrl);
    }

    /**
     * Create a toast instance
     */
    public function new(title:String, description:String, label:String, align:String, imageUrl:String = null) {
        super();

        toastAlign = align;
        var imageUrlCopy = imageUrl; // Capture for closure
        var isRight = (align != "left");
        var activeToasts = isRight ? activeToastsRight : activeToastsLeft;

        // Create text formats
        var titleFormat = new TextFormat();
        titleFormat.font = "_sans";
        titleFormat.size = TITLE_SIZE;
        titleFormat.color = TITLE_COLOR;
        titleFormat.bold = true;

        var descFormat = new TextFormat();
        descFormat.font = "_sans";
        descFormat.size = DESC_SIZE;
        descFormat.color = DESC_COLOR;
        descFormat.bold = false;

        var labelFormat = new TextFormat();
        labelFormat.font = "_sans";
        labelFormat.size = LABEL_SIZE;
        labelFormat.color = LABEL_COLOR;
        labelFormat.bold = false;

        // Create title field
        var titleField = new TextField();
        titleField.autoSize = TextFieldAutoSize.LEFT;
        titleField.wordWrap = false;
        titleField.selectable = false;
        titleField.text = title;
        titleField.defaultTextFormat = titleFormat;
        titleField.setTextFormat(titleFormat);

        // Create description field
        var descField = new TextField();
        descField.autoSize = TextFieldAutoSize.LEFT;
        descField.wordWrap = false;
        descField.selectable = false;
        descField.text = description;
        descField.defaultTextFormat = descFormat;
        descField.setTextFormat(descFormat);

        // Create label field
        var labelField = new TextField();
        labelField.autoSize = TextFieldAutoSize.LEFT;
        labelField.wordWrap = false;
        labelField.selectable = false;
        labelField.text = label;
        labelField.defaultTextFormat = labelFormat;
        labelField.setTextFormat(labelFormat);

        // Calculate dimensions
        var maxTextWidth = Math.max(Math.max(titleField.textWidth, descField.textWidth), labelField.textWidth) + 4;
        var textWidth = Math.max(MIN_TEXT_WIDTH, maxTextWidth);
        var boxWidth = PADDING + IMAGE_SIZE + PADDING + textWidth + PADDING;
        toastHeight = IMAGE_SIZE + PADDING * 2;

        // Draw rounded rectangle background
        var g = this.graphics;
        g.beginFill(BG_COLOR, BG_ALPHA);
        g.drawRoundRect(0, 0, boxWidth, toastHeight, CORNER_RADIUS, CORNER_RADIUS);
        g.endFill();

        // Create image holder sprite
        var imageX = PADDING;
        var imageY = PADDING;
        var imageHolder = new Sprite();
        imageHolder.x = imageX;
        imageHolder.y = imageY;
        addChild(imageHolder);

        // Draw background (in case image has transparency or fails to load)
        var ig = imageHolder.graphics;
        ig.beginFill(0x374151, 1);
        ig.drawRoundRect(0, 0, IMAGE_SIZE, IMAGE_SIZE, 4, 4);
        ig.endFill();

        // Load image if URL provided, otherwise draw placeholder
        if (imageUrlCopy != null && imageUrlCopy != "") {
            var loader = new Loader();
            loader.contentLoaderInfo.addEventListener(Event.COMPLETE, function(e:Event):Void {
                // Scale and center the loaded image
                var content = loader.content;
                var scaleX = IMAGE_SIZE / content.width;
                var scaleY = IMAGE_SIZE / content.height;
                var scale = Math.min(scaleX, scaleY);
                content.width = content.width * scale;
                content.height = content.height * scale;
                content.x = (IMAGE_SIZE - content.width) / 2;
                content.y = (IMAGE_SIZE - content.height) / 2;
            });
            loader.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR, function(e:Event):Void {
                // Silently ignore — toast will show without image
            });
            loader.load(new URLRequest(imageUrlCopy));
            imageHolder.addChild(loader);
        } else {
            // Draw star icon placeholder
            ig.beginFill(0x9CA3AF, 1);
            drawStar(ig, IMAGE_SIZE / 2, IMAGE_SIZE / 2, 12, 6, 5);
            ig.endFill();
        }

        // Position text fields
        var textX = PADDING + IMAGE_SIZE + PADDING;
        var textStartY = PADDING + 4;
        var lineHeight1 = titleField.textHeight + TEXT_GAP;
        var lineHeight2 = descField.textHeight + TEXT_GAP;

        titleField.x = textX;
        titleField.y = textStartY;
        descField.x = textX;
        descField.y = textStartY + lineHeight1;
        labelField.x = textX;
        labelField.y = textStartY + lineHeight1 + lineHeight2;

        addChild(titleField);
        addChild(descField);
        addChild(labelField);

        // Get stage reference
        var stage = flash.Lib.current.stage;
        var stageWidth = stage.stageWidth;
        stageHeight = stage.stageHeight;

        // Calculate X positions for normal and hidden states
        toastWidth = boxWidth;
        if (isRight) {
            targetX = stageWidth - boxWidth - MARGIN;
            hiddenX = stageWidth + HIDE_OFFSET;
        } else {
            targetX = MARGIN;
            hiddenX = -boxWidth - HIDE_OFFSET;
        }
        this.x = targetX;
        this.y = stageHeight; // Start below screen

        // Calculate target Y
        targetY = stageHeight - toastHeight - MARGIN;

        // Push existing toasts upward
        for (existingToast in activeToasts) {
            existingToast.targetY -= (toastHeight + TOAST_GAP);
        }

        // Add to active toasts
        activeToasts.push(this);

        state = STATE_SLIDE_UP;
        displayStartTime = 0;

        // Add to stage
        flash.Lib.current.addChild(this);

        // Start animation
        addEventListener(Event.ENTER_FRAME, onEnterFrame);
    }

    /**
     * Draw a simple star shape
     */
    private static function drawStar(g:Graphics, cx:Float, cy:Float, outerR:Float, innerR:Float, points:Int):Void {
        var angle:Float = -Math.PI / 2;
        var step:Float = Math.PI / points;

        g.moveTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);

        for (i in 0...(points * 2)) {
            angle += step;
            var r = (i % 2 == 0) ? innerR : outerR;
            g.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        }
    }

    /**
     * Animation frame handler
     */
    private function onEnterFrame(e:Event):Void {
        // Check if mouse is in the toast's zone (use targetX, not current x)
        var stg = flash.Lib.current.stage;
        var mouseInZone = (stg.mouseX >= targetX && stg.mouseX <= targetX + toastWidth &&
                           stg.mouseY >= targetY && stg.mouseY <= targetY + toastHeight);

        // Animate X position based on hover
        var destX:Float = mouseInZone ? hiddenX : targetX;
        var dx = destX - this.x;
        if (Math.abs(dx) > 1) {
            this.x += dx * 0.3;
        } else {
            this.x = destX;
        }

        var dy = targetY - this.y;

        switch (state) {
            case STATE_SLIDE_UP:
                if (Math.abs(dy) > SLIDE_SPEED) {
                    this.y += (dy < 0 ? -SLIDE_SPEED : SLIDE_SPEED);
                } else {
                    this.y = targetY;
                    state = STATE_DISPLAY;
                    displayStartTime = Timer.stamp() * 1000;
                }

            case STATE_DISPLAY:
                // Keep following target Y if pushed by newer toasts
                if (Math.abs(dy) > 1) {
                    this.y += dy * 0.3;
                }
                if (Timer.stamp() * 1000 - displayStartTime >= DISPLAY_TIME) {
                    state = STATE_SLIDE_DOWN;
                }

            case STATE_SLIDE_DOWN:
                this.y += SLIDE_SPEED;
                if (this.y >= stageHeight) {
                    // Remove from active toasts (avoid Haxe's Array.remove which
                    // doesn't exist on AS3's native Array in shared ApplicationDomain)
                    var activeToasts = (toastAlign == "left") ? activeToastsLeft : activeToastsRight;
                    var idx = activeToasts.indexOf(this);
                    if (idx >= 0) activeToasts.splice(idx, 1);
                    removeEventListener(Event.ENTER_FRAME, onEnterFrame);
                    if (this.parent != null) {
                        this.parent.removeChild(this);
                    }
                }
        }
    }
}
