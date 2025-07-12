package;

import flash.display.Sprite;
import flash.text.TextField;
import flash.text.TextFormat;
import flash.events.MouseEvent;
import flash.events.Event;
import flash.display.Shape;
import flash.geom.Rectangle;

import Main;
import Network;

class FilePicker extends Sprite {
    private var currentDirectory:Array<String> = [];
    private var backButton:TextField;
    private var fileList:Sprite;
    private var maskShape:Shape;
    private var scrollBar:Sprite;
    private var scrollBarBg:Sprite;
    private var offset:Float = 0;
    private var pathDisplay:TextField;

    public function new() {
        super();
        
        // Create path display at the top
        pathDisplay = new TextField();
        var pathFormat:TextFormat = new TextFormat('Arial', 14, 0xFFFFFF, true);
        pathDisplay.defaultTextFormat = pathFormat;
        pathDisplay.width = 220; // Adjust width for consistency
        pathDisplay.height = 20;
        pathDisplay.background = true;
        pathDisplay.backgroundColor = 0x444444;
        pathDisplay.border = true;
        pathDisplay.borderColor = 0xFFFFFF;
        pathDisplay.x = 10;
        pathDisplay.y = 10;
        pathDisplay.selectable = false;
        addChild(pathDisplay);

        // Create container for the file list
        fileList = new Sprite();
        fileList.y = 40; // Adjust for path display height
        addChild(fileList);

        // Create mask to clip overflowing content
        maskShape = new Shape();
        maskShape.graphics.beginFill(0x000000);
        maskShape.graphics.drawRect(0, 0, 220, 260); // Adjust width for consistency
        maskShape.graphics.endFill();
        maskShape.y = 40; // Adjust for path display height
        addChild(maskShape);
        fileList.mask = maskShape;

        // Create scrollbar background
        scrollBarBg = new Sprite();
        scrollBarBg.graphics.beginFill(0xCCCCCC);
        scrollBarBg.graphics.drawRect(230, 40, 10, 260); // Adjust for consistent alignment
        scrollBarBg.graphics.endFill();
        addChild(scrollBarBg);

        // Create scrollbar handle
        scrollBar = new Sprite();
        scrollBar.graphics.beginFill(0x666666);
        scrollBar.graphics.drawRect(0, 0, 10, 50); // Initial height of the scrollbar handle
        scrollBar.graphics.endFill();
        scrollBar.x = 230;
        scrollBar.y = 40; // Adjust for path display height
        scrollBar.addEventListener(MouseEvent.MOUSE_DOWN, onScrollBarMouseDown);
        addChild(scrollBar);

        flash.Lib.current.stage.addEventListener(MouseEvent.MOUSE_UP, onScrollBarMouseUp);
        flash.Lib.current.stage.addEventListener(MouseEvent.MOUSE_MOVE, onScrollBarMouseMove);

        flash.Lib.current.stage.addChild(this);
        this.x = (flash.Lib.current.stage.stageWidth - 220) / 2;
        this.y = 10;

        Network.command('getDirectoryInfo', {}, (message:Dynamic) -> {
            currentDirectory = message.params.currentDirectory;
            loadFiles();
        });
    }

    private function loadFiles():Void {
        updatePathDisplay();
        Network.command('readDirectory', {path: '/' + currentDirectory.join('/')}, (message:Dynamic) -> {
            populateFileList(cast message.params);
            resetScrollPosition();
        });
    }

    private function populateFileList(files:Array<{name: String, type: String}>):Void {
        // Clear previous items
        while (fileList.numChildren > 0) {
            fileList.removeChildAt(0);
        }

        offset = 0;

        // Create a 'Back' button
        if(currentDirectory.length > 0) {
            backButton = createButton('Back', 10, offset);
            backButton.addEventListener(MouseEvent.CLICK, onBackButtonClick);
            fileList.addChild(backButton);
            offset += 30;
        }

        // Create a button for each directory or file
        for (i in 0...files.length) {
            final file = files[i];
            if(file.type == 'directory') {
                var fileButton = createButton(file.name, 10, offset);
                fileButton.addEventListener(MouseEvent.CLICK, function(event:MouseEvent) {
                    clickDirectory(file.name);
                });
                fileList.addChild(fileButton);
                offset += 30;
            } else if(file.type == 'file') {
                final extension = file.name.split('.').pop();
                if(extension == 'swf') {
                    var fileButton = createButton(file.name, 10, offset);
                    fileButton.addEventListener(MouseEvent.CLICK, function(event:MouseEvent) {
                        clickFile(file.name);
                    });
                    fileList.addChild(fileButton);
                    offset += 30;
                }
            } else {
                trace('Unknown file type: ' + file.type);
            }
        }

        updateScrollBar();
    }

    private function resetScrollPosition():Void {
        fileList.y = 40; // Reset to below the path display
        scrollBar.y = 40; // Reset the scrollbar to the top of its track
    }

    private function updateScrollBar():Void {
        var contentHeight = offset;
        var viewHeight = maskShape.height;
        var ratio = viewHeight / contentHeight;

        if (ratio < 1) {
            scrollBar.height = ratio * viewHeight;
            scrollBar.visible = true;
        } else {
            scrollBar.visible = false;
        }

        // Ensure fileList is within bounds after update
        var maxScrollY = 40 + maskShape.height - contentHeight; // Account for path display offset
        if (fileList.y < maxScrollY) {
            fileList.y = maxScrollY;
        } else if (fileList.y > 40) {
            fileList.y = 40; // Keep fileList below the path display
        }
    }

    private function updatePathDisplay():Void {
        pathDisplay.text = '/' + currentDirectory.join('/');
    }

    private function createButton(label:String, x:Float, y:Float):TextField {
        var button = new TextField();
        var format = new TextFormat('Arial', 16, 0xFFFFFF, true);
        button.defaultTextFormat = format;
        button.text = label;
        button.width = 220; // Adjust width for consistency
        button.height = 25;
        button.background = true;
        button.backgroundColor = 0x333333;
        button.border = true;
        button.borderColor = 0xFFFFFF;
        button.x = x;
        button.y = y;
        button.selectable = false;
        return button;
    }

    private function onBackButtonClick(event:MouseEvent):Void {
        currentDirectory.pop();
        loadFiles();
    }

    private function clickFile(file:String):Void {
        flash.Lib.current.stage.removeChild(this);
        currentDirectory.push(file);
        Main.loadFile(currentDirectory.join('/'));
    }

    private function clickDirectory(directory:String):Void {
        currentDirectory.push(directory);
        loadFiles();
    }

    private var isDragging:Bool = false;
    private var dragStartY:Float;
    private var contentStartY:Float;

    private function onScrollBarMouseDown(event:MouseEvent):Void {
        isDragging = true;
        dragStartY = mouseY;
        contentStartY = fileList.y;
    }

    private function onScrollBarMouseUp(event:MouseEvent):Void {
        isDragging = false;
    }

    private function onScrollBarMouseMove(event:MouseEvent):Void {
        if (isDragging) {
            var deltaY = mouseY - dragStartY;
            var maxScroll = maskShape.height - scrollBar.height;
            scrollBar.y = Math.max(40, Math.min(40 + maxScroll, scrollBar.y + deltaY));

            var scrollRatio = (scrollBar.y - 40) / maxScroll;
            fileList.y = 40 - scrollRatio * (offset - maskShape.height);

            // Update the starting position for the drag now that we have moved the scrollbar
            dragStartY = mouseY;
        }
    }
}
