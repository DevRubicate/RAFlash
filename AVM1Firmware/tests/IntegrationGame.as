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
 *   Frame  5: gold=50, bat dies (health=0), inventory gains "potion"
 *   Frame 10: gold=100, inventory gains "shield", combo resets to 0
 *   Frame 15: gold=150, goblin dies (health=0), inventory gains "sword"
 *   Frame 20: gold=200, combo resets to 0, phase="combat"
 *   Frame 25: gold=250, flags.poisoned=true
 *   Frame 30: gold=300, player starts taking damage (-5/frame), combo resets to 0, phase="danger"
 *   Frame 40: gold=400, combo resets to 0, phase="critical"
 *   Frame 50: gold=500, level=2, player dies (health=0, alive=false), combo resets to 0
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
        _root.player = { health: 100, x: 50, y: 100, alive: true, mana: 50, speed: 10, name: "Hero" };

        // Array of enemies
        _root.enemies = [
            { name: "goblin", health: 30, damage: 5 },
            { name: "bat", health: 10, damage: 2 },
            { name: "dragon", health: 200, damage: 25 }
        ];

        // Nested deep structure
        _root.nested = { deep: { value: 42 } };

        // Flags object
        _root.flags = { poisoned: false, shielded: true };

        // Inventory array (grows over time, for len() testing)
        _root.inventory = [];

        // Combo counter (resets periodically, for delta testing)
        _root.combo = 0;

        // Game phase string (changes over time)
        _root.phase = "explore";

        // Track alive enemy count
        _root.aliveEnemies = 3;

        // Empty object for null/empty tests
        _root.emptyObj = {};

        // Multiplier for arithmetic tests
        _root.multiplier = 3;

        // Extra nested structure for deeper traversal
        _root.world = {
            zone1: { name: "forest", difficulty: 1, boss: { name: "treant", defeated: false } },
            zone2: { name: "cave", difficulty: 2, boss: { name: "spider", defeated: false } }
        };

        // Self-play loop
        _root.onEnterFrame = function():Void {
            _root.frameNum++;
            var f:Number = _root.frameNum;

            // Gold increases by 10 each frame
            _root.gold += 10;

            // Score tracks gold (always gold * 2)
            _root.score = _root.gold * 2;

            // Level up every 500 gold
            _root.level = Math.floor(_root.gold / 500) + 1;

            // Combo increases each frame, resets every 10 frames
            _root.combo++;
            if (f % 10 == 0) _root.combo = 0;

            // Player mana regenerates slowly (cap at 100)
            if (_root.player.mana < 100) _root.player.mana += 1;

            // Player speed increases with level
            _root.player.speed = 10 + (_root.level - 1) * 5;

            // Bat health decreases by 2/frame, dies at frame 5
            if (_root.enemies[1].health > 0) {
                _root.enemies[1].health -= 2;
                if (_root.enemies[1].health < 0) _root.enemies[1].health = 0;
                if (_root.enemies[1].health == 0) _root.aliveEnemies--;
            }

            // Goblin health decreases by 2/frame, dies at frame 15
            if (_root.enemies[0].health > 0) {
                _root.enemies[0].health -= 2;
                if (_root.enemies[0].health < 0) _root.enemies[0].health = 0;
                if (_root.enemies[0].health == 0) _root.aliveEnemies--;
            }

            // Inventory grows at specific frames
            if (f == 5) _root.inventory.push("potion");
            if (f == 10) _root.inventory.push("shield");
            if (f == 15) _root.inventory.push("sword");

            // Phase changes at specific frames
            if (f == 20) _root.phase = "combat";
            if (f == 30) _root.phase = "danger";
            if (f == 40) _root.phase = "critical";

            // Player gets poisoned at frame 25
            if (f == 25) _root.flags.poisoned = true;

            // Zone bosses get defeated
            if (f == 15) _root.world.zone1.boss.defeated = true;
            if (f == 35) _root.world.zone2.boss.defeated = true;

            // Player takes damage after frame 30
            if (f > 30) {
                _root.player.health -= 5;
                if (_root.player.health <= 0) {
                    _root.player.health = 0;
                    _root.player.alive = false;
                }
            }

            // Multiplier changes at frame 45
            if (f == 45) _root.multiplier = 5;

            // Deep nested value changes at frame 60
            if (f == 60) _root.nested.deep.value = 99;
        };
    }
}
