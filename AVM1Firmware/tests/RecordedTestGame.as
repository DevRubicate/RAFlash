/**
 * Recorded-Test Integration Test Game
 *
 * A minimal AS2 game designed to be driven externally by the Recorded
 * Test harness (tests/ratest.ts). All state advancement is explicit —
 * the game does NOT use onEnterFrame to mutate state, so the simulation
 * only moves forward when the harness calls game.tick() (via the
 * firmware's invokeMethod command).
 *
 * Exposed "controls":
 *   _root.tick()            -- advance simulation by one step
 *   _root.fireButton.onRelease()  -- fire a bullet (increments fireCount)
 *   _root.resetButton.onRelease() -- reset counters and bullets
 *   _root.startGame()       -- state: idle -> playing
 *   _root.endGame()         -- state: playing -> gameOver
 *
 * Exposed state (readable via the DSL):
 *   stage.fireCount         -- number of times fire was clicked
 *   stage.resetCount        -- number of times reset was clicked
 *   stage.state             -- "idle" | "playing" | "gameOver"
 *   stage.tickCount         -- total ticks advanced
 *   stage.player.x          -- player x position (advances with ticks when playing)
 *   stage.bullets[i].x      -- bullet positions (advance with ticks)
 *   stage.bulletCount       -- number of active bullets (== stage.bullets.length)
 *   stage.lastFired         -- tickCount at which the last bullet was fired
 */
class RecordedTestGame {
    public static function main():Void {
        // --- Core state ---
        _root.fireCount = 0;
        _root.resetCount = 0;
        _root.tickCount = 0;
        _root.state = "idle";
        _root.lastFired = -1;

        _root.player = { x: 0, y: 100, speed: 5 };
        _root.bullets = [];
        _root.bulletCount = 0;

        // --- Button: fire ---
        // A MovieClip so it looks like a real button to the DSL. Its
        // onRelease handler is what the harness "clicks" via invokeMethod.
        var fireBtn:MovieClip = _root.createEmptyMovieClip("fireButton", 10);
        fireBtn._x = 50;
        fireBtn._y = 500;
        fireBtn.label = "Fire";
        fireBtn.onRelease = function():Void {
            _root.fireCount++;
            _root.lastFired = _root.tickCount;
            // Spawn a bullet starting at the player's current x
            var bullet:Object = {
                id: _root.bullets.length,
                x: _root.player.x,
                y: _root.player.y,
                vx: 20
            };
            _root.bullets.push(bullet);
            _root.bulletCount = _root.bullets.length;
        };

        // --- Button: reset ---
        var resetBtn:MovieClip = _root.createEmptyMovieClip("resetButton", 11);
        resetBtn._x = 200;
        resetBtn._y = 500;
        resetBtn.label = "Reset";
        resetBtn.onRelease = function():Void {
            _root.resetCount++;
            _root.fireCount = 0;
            _root.tickCount = 0;
            _root.player.x = 0;
            _root.bullets = [];
            _root.bulletCount = 0;
            _root.state = "idle";
            _root.lastFired = -1;
        };

        // --- State machine transitions ---
        _root.startGame = function():Void {
            if (_root.state == "idle") _root.state = "playing";
        };
        _root.endGame = function():Void {
            if (_root.state == "playing") _root.state = "gameOver";
        };

        // --- Deterministic tick: the only thing that advances simulation ---
        _root.tick = function():Number {
            _root.tickCount++;
            if (_root.state == "playing") {
                _root.player.x += _root.player.speed;
            }
            // Advance bullets; cull anything offscreen (x >= 800)
            var kept:Array = [];
            for (var i:Number = 0; i < _root.bullets.length; i++) {
                var b:Object = _root.bullets[i];
                b.x += b.vx;
                if (b.x < 800) kept.push(b);
            }
            _root.bullets = kept;
            _root.bulletCount = _root.bullets.length;
            return _root.tickCount;
        };

        // --- Echo helper: lets us verify invokeMethod argument passing ---
        _root.echo = function(a, b, c):String {
            return String(a) + "|" + String(b) + "|" + String(c);
        };
    }
}
