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
 * Measure Notification System for AVM2 (AS3/Haxe)
 *
 * Displays fade-in/fade-out progress notifications with image, title, description, and progress.
 * Supports stacking on the right side of the screen.
 * Used for showing achievement progress like "3/5 coins collected".
 *
 * Port of AVM1Firmware/Measure.as.
 */
class Measure extends Sprite {
    private static inline var PADDING:Int = 10;
    private static inline var MARGIN:Int = 16;
    private static inline var MEASURE_GAP:Int = 8;
    private static inline var IMAGE_SIZE:Int = 64;
    private static inline var TEXT_GAP:Int = 2;
    private static inline var MIN_TEXT_WIDTH:Int = 180;
    private static inline var CORNER_RADIUS:Int = 6;
    private static inline var BG_COLOR:Int = 0x1F2937;
    private static inline var BG_ALPHA:Float = 0.95;

    private static inline var TITLE_COLOR:Int = 0xFFFFFF;
    private static inline var DESC_COLOR:Int = 0xFACC15;
    private static inline var PROGRESS_COLOR:Int = 0x2DD4BF;

    private static inline var TITLE_SIZE:Int = 16;
    private static inline var DESC_SIZE:Int = 12;
    private static inline var PROGRESS_SIZE:Int = 11;

    private static inline var FADE_SPEED:Float = 5;
    private static inline var DISPLAY_TIME:Int = 5000;

    private static inline var STATE_FADE_IN:Int = 0;
    private static inline var STATE_DISPLAY:Int = 1;
    private static inline var STATE_FADE_OUT:Int = 2;

    private static var activeMeasures:Array<Measure> = [];
    private static var measureByAsset:Map<Int, Measure> = new Map();

    // Instance state
    private var state:Int;
    private var targetY:Float;
    private var measureHeight:Float;
    private var displayStartTime:Float;
    private var assetId:Null<Int>;
    private var titleField:TextField;
    private var descField:TextField;
    private var progressField:TextField;

    public static function clearAll():Void {
        for (measure in activeMeasures) {
            measure.removeEventListener(Event.ENTER_FRAME, measure.onEnterFrame);
            if (measure.parent != null) measure.parent.removeChild(measure);
        }
        activeMeasures = [];
        measureByAsset = new Map();
    }

    public static function show(title:String, description:String, progress:String, imageUrl:String):Void {
        new Measure(title, description, progress, imageUrl, null);
    }

    public static function showOrReset(title:String, description:String, progress:String, imageUrl:String, assetId:Int):Void {
        if (measureByAsset.exists(assetId)) {
            var existing:Measure = measureByAsset.get(assetId);
            if (existing.alpha > 0) {
                // Update text and reset timer
                existing.titleField.text = title;
                existing.descField.text = description;
                existing.progressField.text = progress;

                var titleFormat = new TextFormat();
                titleFormat.font = "_sans";
                titleFormat.size = TITLE_SIZE;
                titleFormat.color = TITLE_COLOR;
                titleFormat.bold = true;
                existing.titleField.setTextFormat(titleFormat);

                var descFormat = new TextFormat();
                descFormat.font = "_sans";
                descFormat.size = DESC_SIZE;
                descFormat.color = DESC_COLOR;
                existing.descField.setTextFormat(descFormat);

                var progressFormat = new TextFormat();
                progressFormat.font = "_sans";
                progressFormat.size = PROGRESS_SIZE;
                progressFormat.color = PROGRESS_COLOR;
                existing.progressField.setTextFormat(progressFormat);

                existing.displayStartTime = Timer.stamp() * 1000;
                if (existing.state == STATE_FADE_OUT) {
                    existing.state = STATE_DISPLAY;
                    existing.alpha = 1.0;
                }
                return;
            }
        }
        var m = new Measure(title, description, progress, imageUrl, assetId);
        measureByAsset.set(assetId, m);
    }

    public function new(title:String, description:String, progress:String, imageUrl:String, assetId:Null<Int>) {
        super();
        this.assetId = assetId;

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

        var progressFormat = new TextFormat();
        progressFormat.font = "_sans";
        progressFormat.size = PROGRESS_SIZE;
        progressFormat.color = PROGRESS_COLOR;

        // Create text fields
        titleField = new TextField();
        titleField.autoSize = TextFieldAutoSize.LEFT;
        titleField.wordWrap = false;
        titleField.selectable = false;
        titleField.text = title;
        titleField.defaultTextFormat = titleFormat;
        titleField.setTextFormat(titleFormat);

        descField = new TextField();
        descField.autoSize = TextFieldAutoSize.LEFT;
        descField.wordWrap = false;
        descField.selectable = false;
        descField.text = description;
        descField.defaultTextFormat = descFormat;
        descField.setTextFormat(descFormat);

        progressField = new TextField();
        progressField.autoSize = TextFieldAutoSize.LEFT;
        progressField.wordWrap = false;
        progressField.selectable = false;
        progressField.text = progress;
        progressField.defaultTextFormat = progressFormat;
        progressField.setTextFormat(progressFormat);

        // Calculate dimensions
        var maxTextWidth = Math.max(Math.max(titleField.textWidth, descField.textWidth), progressField.textWidth) + 4;
        var textWidth = Math.max(MIN_TEXT_WIDTH, maxTextWidth);
        var boxWidth = PADDING + IMAGE_SIZE + PADDING + textWidth + PADDING;
        measureHeight = IMAGE_SIZE + PADDING * 2;

        // Draw background
        var g = this.graphics;
        g.beginFill(BG_COLOR, BG_ALPHA);
        g.drawRoundRect(0, 0, boxWidth, measureHeight, CORNER_RADIUS, CORNER_RADIUS);
        g.endFill();

        // Image holder
        var imageHolder = new Sprite();
        imageHolder.x = PADDING;
        imageHolder.y = PADDING;
        addChild(imageHolder);

        var ig = imageHolder.graphics;
        ig.beginFill(0x374151, 1);
        ig.drawRoundRect(0, 0, IMAGE_SIZE, IMAGE_SIZE, 4, 4);
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
                // Silently ignore — measure will show without image
            });
            loader.load(new URLRequest(imageUrlCopy));
            imageHolder.addChild(loader);
        } else {
            // Draw gauge icon placeholder
            ig.lineStyle(2, 0x9CA3AF, 1);
            var cx:Float = IMAGE_SIZE / 2;
            var cy:Float = IMAGE_SIZE / 2;
            var r:Float = 16;
            drawArc(ig, cx, cy, r, -135, 135);
            ig.moveTo(cx, cy);
            ig.lineTo(cx + 8, cy - 8);
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
        progressField.x = textX;
        progressField.y = textStartY + lineHeight1 + lineHeight2;

        addChild(titleField);
        addChild(descField);
        addChild(progressField);

        // Position on screen
        var stage = flash.Lib.current.stage;
        var stageWidth = stage.stageWidth;
        var stageHeight = stage.stageHeight;

        this.x = stageWidth - boxWidth - MARGIN;
        targetY = stageHeight - measureHeight - MARGIN;

        // Push existing measures upward
        for (existing in activeMeasures) {
            existing.targetY -= (measureHeight + MEASURE_GAP);
        }

        this.y = targetY;
        this.alpha = 0;

        activeMeasures.push(this);
        state = STATE_FADE_IN;
        displayStartTime = 0;

        flash.Lib.current.addChild(this);
        addEventListener(Event.ENTER_FRAME, onEnterFrame);
    }

    private function onEnterFrame(e:Event):Void {
        var dy = targetY - this.y;

        switch (state) {
            case STATE_FADE_IN:
                this.alpha += FADE_SPEED / 100;
                if (this.alpha >= 1.0) {
                    this.alpha = 1.0;
                    state = STATE_DISPLAY;
                    displayStartTime = Timer.stamp() * 1000;
                }
                if (Math.abs(dy) > 1) this.y += dy * 0.3;

            case STATE_DISPLAY:
                if (Math.abs(dy) > 1) this.y += dy * 0.3;
                if (Timer.stamp() * 1000 - displayStartTime >= DISPLAY_TIME) {
                    state = STATE_FADE_OUT;
                }

            case STATE_FADE_OUT:
                this.alpha -= FADE_SPEED / 100;
                if (Math.abs(dy) > 1) this.y += dy * 0.3;
                if (this.alpha <= 0) {
                    removeMeasure();
                }
        }
    }

    private function removeMeasure():Void {
        if (assetId != null) {
            measureByAsset.remove(assetId);
        }
        activeMeasures.remove(this);
        removeEventListener(Event.ENTER_FRAME, onEnterFrame);
        if (this.parent != null) {
            this.parent.removeChild(this);
        }
    }

    private static function drawArc(g:Graphics, cx:Float, cy:Float, r:Float, startAngle:Float, endAngle:Float):Void {
        var segments:Int = 20;
        var angleStep:Float = (endAngle - startAngle) / segments;
        var angleRad:Float = startAngle * Math.PI / 180;

        g.moveTo(cx + Math.cos(angleRad) * r, cy + Math.sin(angleRad) * r);

        var i:Int = 1;
        while (i <= segments) {
            angleRad = (startAngle + angleStep * i) * Math.PI / 180;
            g.lineTo(cx + Math.cos(angleRad) * r, cy + Math.sin(angleRad) * r);
            i++;
        }
    }
}
