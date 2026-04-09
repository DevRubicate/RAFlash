import type { UserProfileData } from "./types.ts";

const PROFILES_DIR = "RACache/users";

export class UserProfile {
    static currentName: string | null = null;
    static data: UserProfileData | null = null;
    static dirty = false;

    /**
     * List available profile names.
     * If no profiles exist, auto-creates a "Guest" profile.
     */
    static async listUsers(): Promise<string[]> {
        try {
            await Deno.mkdir(PROFILES_DIR, { recursive: true });
        } catch { /* exists */ }

        const names: string[] = [];
        try {
            for await (const entry of Deno.readDir(PROFILES_DIR)) {
                if (entry.isFile && entry.name.endsWith(".json")) {
                    names.push(entry.name.slice(0, -5));
                }
            }
        } catch { /* empty */ }

        if (!names.includes("Guest")) {
            await this.createUser("Guest");
            names.push("Guest");
        }

        return names.sort();
    }

    /**
     * Load an existing profile from disk.
     */
    static async loadUser(name: string): Promise<void> {
        const path = `${PROFILES_DIR}/${name}.json`;
        const content = await Deno.readTextFile(path);
        this.data = JSON.parse(content) as UserProfileData;
        this.currentName = name;
        this.dirty = false;

        // Guest profile resets each session — clear all game data on load
        if (name === "Guest") {
            this.data.games = {};
            this.dirty = true;
            await this.saveUser();
        }
    }

    /**
     * Create a new profile and load it.
     */
    static async createUser(name: string): Promise<void> {
        const sanitized = name.replace(/[/\\:*?"<>|]/g, "").trim();
        if (!sanitized) throw new Error("Invalid profile name");

        await Deno.mkdir(PROFILES_DIR, { recursive: true });

        const profile: UserProfileData = {
            name: sanitized,
            created: new Date().toISOString(),
            games: {},
        };

        await Deno.writeTextFile(
            `${PROFILES_DIR}/${sanitized}.json`,
            JSON.stringify(profile, null, 2)
        );

        this.data = profile;
        this.currentName = sanitized;
        this.dirty = false;
    }

    /**
     * Save the current profile to disk if dirty.
     */
    static async saveUser(): Promise<void> {
        if (!this.dirty || !this.currentName || !this.data) return;
        await Deno.writeTextFile(
            `${PROFILES_DIR}/${this.currentName}.json`,
            JSON.stringify(this.data, null, 2)
        );
        this.dirty = false;
    }

    /**
     * Record an achievement unlock for the current game.
     */
    static recordUnlock(gameHash: string, assetId: number): void {
        if (!this.data) return;

        if (!this.data.games[gameHash]) {
            this.data.games[gameHash] = { unlocked: [] };
        }

        const game = this.data.games[gameHash];
        if (!game.unlocked.includes(assetId)) {
            game.unlocked.push(assetId);
            game.lastPlayed = new Date().toISOString();
            this.dirty = true;
        }
    }

    /**
     * Get unlocked asset IDs for a game.
     */
    static getUnlockedIds(gameHash: string): number[] {
        return this.data?.games[gameHash]?.unlocked || [];
    }

    /**
     * Reset profile state between game sessions.
     */
    static reset(): void {
        this.currentName = null;
        this.data = null;
        this.dirty = false;
    }
}
