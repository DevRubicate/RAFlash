package;

import flash.display.Sprite;
import flash.text.TextField;
import flash.text.TextFormat;
import flash.events.MouseEvent;

import Main;
import Network;


class FilePicker extends Sprite {
    private var currentPath:Array<String> = [];
    private var backButton:TextField;

    public function new() {
        super();
        loadFiles();
        flash.Lib.current.stage.addChild(this);
    }

    private function loadFiles():Void {
        Network.command('readDirectory', {path: '/' + currentPath.join('/')}, (message:Dynamic) -> {
            populateFileList(message.params);
        });
    }

    private function populateFileList(files:Array<{name: String, type: String}>):Void {
        // Clear previous items
        while (this.numChildren > 0) {
            this.removeChildAt(0);
        }
        var offset = 0;

        // Create a 'Back' button
        if(currentPath.length > 1) {
            backButton = createButton('Back', 10, offset);
            backButton.addEventListener(MouseEvent.CLICK, onBackButtonClick);
            addChild(backButton);
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
                this.addChild(fileButton);
                offset += 30;
            } else if(file.type == 'file') {
                final extension = file.name.split('.').pop();
                if(extension == 'swf') {
                    var fileButton = createButton(file.name, 10, offset);
                    fileButton.addEventListener(MouseEvent.CLICK, function(event:MouseEvent) {
                        clickFile(file.name);
                    });
                    this.addChild(fileButton);
                    offset += 30;
                }
            } else {
                trace('Unknown file type: ' + file.type);
            }
        }
    }

    private function createButton(label:String, x:Float, y:Float):TextField {
        var button = new TextField();
        var format = new TextFormat('Arial', 16, 0xFFFFFF, true);
        button.defaultTextFormat = format;
        button.text = label;
        button.width = 200;
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
        currentPath.pop();
        loadFiles();
    }

    private function clickFile(file:String):Void {
        flash.Lib.current.stage.removeChild(this);
        currentPath.push(file);
        Main.loadEmbeddedSWF('/' + currentPath.join('/'));
    }
    private function clickDirectory(directory:String):Void {
        currentPath.push(directory);
        loadFiles();
    }
}
