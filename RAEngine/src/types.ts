/**
 * Shared type definitions for RAFlash data structures.
 *
 * These interfaces describe the shape of data flowing between RAEngine,
 * the firmwares, and the devtools UI. All interfaces include an index
 * signature to allow additional dynamic/computed properties.
 */

export interface Requirement {
    id: number;
    flag: string;
    typeA: string;
    addressA: string;
    cmp: string;
    typeB: string;
    addressB: string;
    maxHits: number;
    // Computed fields (added by watchers at runtime)
    compiledA?: unknown[];
    compiledB?: unknown[];
    fastA?: unknown[] | null;
    fastB?: unknown[] | null;
    fastReq?: unknown[] | null;
    // Runtime state (managed by achievement engine)
    hits?: number;
    [key: string]: unknown;
}

export interface Group {
    id: number;
    type: string;
    requirements: Requirement[];
    [key: string]: unknown;
}

export type AssetState = 'ACTIVE' | 'INACTIVE' | 'TRIGGERED';

export interface Asset {
    id: number;
    type: string;
    name: string;
    progressionType?: string;
    points?: number;
    description?: string;
    formula?: string;
    category?: string;
    modified?: boolean;
    published?: boolean;
    badgeImage?: string;
    groups: Group[];
    // Runtime state
    state?: AssetState;
    _saved?: boolean;
    _modified?: boolean;
    _originalSnapshot?: Record<string, unknown>;
    compiledFormula?: unknown[];
    _richPresenceResult?: unknown;
    [key: string]: unknown;
}

export interface CodeNote {
    id: number;
    note: string;
    path: string;
    [key: string]: unknown;
}

export interface GameConfig {
    title: string;
    originUrl: string;
    badgeImage: string;
    scaleMode: string;  // "neutral", "showAll", "noBorder", "exactFit", "noScale"
    align: string;      // "neutral", "", "T", "B", "L", "R", "TL", "TR", "BL", "BR"
    [key: string]: unknown;
}

export interface AppDataStructure {
    assets: Asset[];
    codeNotes: CodeNote[];
    gameConfig: GameConfig;
    [key: string]: unknown;
}

export interface UserProfileGameData {
    unlocked: number[];
    lastPlayed?: string;
    [key: string]: unknown;
}

export interface UserProfileData {
    name: string;
    created: string;
    games: Record<string, UserProfileGameData>;
    [key: string]: unknown;
}
