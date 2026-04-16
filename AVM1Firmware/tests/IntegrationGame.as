/**
 * Self-Playing Integration Test Game
 *
 * A minimal AS2 game that auto-advances through predictable state each frame.
 * Used by integration-harness.ts to test the full RAFlash stack end-to-end:
 * real Flash Player, real firmware, real achievement evaluation.
 *
 * All state is on _root so the firmware can introspect it via stage.* DSL.
 *
 * State timeline (by frame number):
 *   Frame  5: gold=50, bat dies (health=0)
 *   Frame 15: gold=150, goblin dies (health=0)
 *   Frame 20: gold=200
 *   Frame 25: gold=250, flags.poisoned=true
 *   Frame 30: gold=300, player starts taking damage (-5/frame)
 *   Frame 50: gold=500, level=2, player dies (health=0, alive=false)
 *   Frame 60: nested.deep.value changes from 42 to 99
 */
class IntegrationGame {
    public static function main():Void {
        // Frame counter for deterministic timing
        _root.frameNum = 0;

        // Simple scalars
        _root.gold = 0;
        _root.level = 1;
        _root.score = 0;

        // Nested object (plain Object, not MovieClip)
        _root.player = { health: 100, x: 50, y: 100, alive: true };

        // Array of enemies
        _root.enemies = [
            { name: "goblin", health: 30 },
            { name: "bat", health: 10 },
            { name: "dragon", health: 200 }
        ];

        // Nested deep structure
        _root.nested = { deep: { value: 42 } };

        // Flags object
        _root.flags = { poisoned: false, shielded: true };

        // Self-play loop
        _root.onEnterFrame = function():Void {
            _root.frameNum++;
            var f:Number = _root.frameNum;

            // Gold increases by 10 each frame
            _root.gold += 10;

            // Score tracks gold
            _root.score = _root.gold * 2;

            // Level up every 500 gold
            _root.level = Math.floor(_root.gold / 500) + 1;

            // Bat health decreases by 2/frame, dies at frame 5
            if (_root.enemies[1].health > 0) {
                _root.enemies[1].health -= 2;
                if (_root.enemies[1].health < 0) _root.enemies[1].health = 0;
            }

            // Goblin health decreases by 2/frame, dies at frame 15
            if (_root.enemies[0].health > 0) {
                _root.enemies[0].health -= 2;
                if (_root.enemies[0].health < 0) _root.enemies[0].health = 0;
            }

            // Player gets poisoned at frame 25
            if (f == 25) _root.flags.poisoned = true;

            // Player takes damage after frame 30
            if (f > 30) {
                _root.player.health -= 5;
                if (_root.player.health <= 0) {
                    _root.player.health = 0;
                    _root.player.alive = false;
                }
            }

            // Deep nested value changes at frame 60
            if (f == 60) _root.nested.deep.value = 99;
        };
    }
}
