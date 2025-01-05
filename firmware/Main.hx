package;

import flash.system.LoaderContext;
import flash.system.ApplicationDomain;
import flash.system.SecurityDomain;

import flash.net.URLLoader;
import flash.net.URLRequest;
import flash.net.URLRequestMethod;
import flash.events.Event;
import flash.events.IOErrorEvent;

import flash.display.Loader;
import flash.display.MovieClip;
import flash.events.Event;
import flash.utils.ByteArray;
import flash.display.AVM1Movie;
import flash.display.StageAlign;
import flash.display.StageScaleMode;
import haxe.Resource;
import haxe.Timer;

import flash.text.TextField;
import flash.text.TextFormat;
import flash.text.TextFieldAutoSize;

import flash.net.Socket;
import flash.events.Event;
import flash.events.IOErrorEvent;
import flash.events.SecurityErrorEvent;

import flash.events.MouseEvent;
import flash.events.KeyboardEvent;
import flash.ui.Mouse;
import flash.ui.MouseCursor;

import flash.display.Sprite;
import flash.ui.ContextMenu;
import flash.ui.ContextMenuItem;
import flash.events.ContextMenuEvent;


import AS2Bridge;
import Network;
import FilePicker;

class Main extends MovieClip {
    private static var instance:Main;
    private var ready:Bool = false;
    private var embedded:Dynamic;

    public function new() {
        super();
        instance = this;
        Network.connect();
        new FilePicker();
    }
    public function setup() {
        addEventListener(Event.ENTER_FRAME, onEnterFrame);
    }
    private function onEnterFrame(event:Event):Void {
        stage.align = StageAlign.TOP_LEFT;
        stage.scaleMode = StageScaleMode.NO_SCALE;
        if(ready) {

        }
    }
    static public function loadEmbeddedSWF(path:String):Void {
        var resourceBytes = haxe.Resource.getBytes('AS2Firmware');
        if (resourceBytes == null) {
            trace('Error: Resource embeddedSWF not found.');
            return;
        }

        var byteArray:ByteArray = resourceBytes.getData();

        var loader:Loader = new Loader();
        loader.contentLoaderInfo.addEventListener(Event.COMPLETE, function(event:Event):Void {
            AS2Bridge.setupListener();

            var loadedContent = loader.content;
            if (Std.isOfType(loadedContent, AVM1Movie)) {
                //trace("Loaded SWF is an AVM1Movie (AS1/AS2).");
    
                instance.embedded = loader;
                instance.addChild(loader);
            } else if (Std.isOfType(loadedContent, MovieClip)) {
                //trace("Loaded SWF is a MovieClip (AS3).");
                var content:MovieClip = cast loadedContent;
    
                instance.embedded = content;
                instance.addChild(content);
                content.play();
            }
    
            // Delay the send operation by 1 second (1000 ms)
            Timer.delay(() -> {
                AS2Bridge.setupSender(path);
                instance.ready = true;
            }, 1000);
        });

        // Prepare the LoaderContext
        var context:LoaderContext = new LoaderContext();
        context.allowCodeImport = true; // Enable code execution in the loaded SWF
        context.applicationDomain = ApplicationDomain.currentDomain;
        context.securityDomain = null;

        loader.loadBytes(byteArray, context);
    }
    static public function main():Void {
        flash.Lib.fscommand('showmenu', 'false');
        flash.Lib.current.stage.addEventListener(KeyboardEvent.KEY_DOWN, onKeyDown);
        final main = new Main();
        flash.Lib.current.addChild(main);
        main.setup();
    }
    static private function onKeyDown(event:Event) {
        Network.command('showPopup', {url: 'internals/assets/asset-list.html', width: 800, height: 600, params: {}}, (message:Dynamic) -> {
            if(!message.success) {
                trace('Unable to open asset list');
            }
        });
    }
}
