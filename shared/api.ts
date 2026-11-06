// What the server answers, shared by the server and the page.

import type { EngineNumber } from './games.ts';

/** GET /api/catalog */
export interface CatalogResponse {
    entries: CatalogEntry[];
}

/** A game the server can send. */
export interface CatalogEntry {
    /** The official game's mod, such as tr2 or tr2-gm. */
    id: string;
    mod: string;
    engine: EngineNumber;
    name: string;
    /** Where to download the archive. Answers Range requests. */
    url: string;
    sizeBytes: number;
    access: 'free' | 'owned';
    /** Whether this player may download it now. */
    unlocked: boolean;
}

export type Provider = 'steam' | 'gog';

/** A store account the player signed in with. */
export interface LinkedAccount {
    provider: Provider;
    /** The store's id for the account. */
    id: string;
    /** The name the store shows for the account. */
    name: string;
    avatarUrl?: string;
    /** When the server last asked the store what the account owns. */
    checkedAt: string;
    /**
     * The games the account owns that unlock something here, as store ids.
     * Empty with privateProfile set when the store would not say.
     */
    owned: number[];
    /** Steam keeps game details private unless the player makes them public. */
    privateProfile?: boolean;
}

/** GET /api/me */
export interface MeResponse {
    accounts: LinkedAccount[];
    /** The catalog ids this player may download. */
    unlocked: string[];
    /** Which sign-in methods the server offers. */
    providers: { steam: boolean; gog: boolean; mock: boolean };
}

/** POST /api/auth/steam/start */
export interface SteamStartResponse {
    /** Open this page for the player to sign in on Steam. */
    url: string;
    /** Poll /api/auth/poll?state=… with it until the sign-in finishes. */
    state: string;
}

/** GET /api/auth/poll?state=… */
export type PollResponse =
    | { status: 'pending' }
    | { status: 'done'; me: MeResponse }
    | { status: 'error'; message: string };

/** GET /api/auth/gog/start */
export interface GogStartResponse {
    /** Open this page for the player to sign in on GOG. */
    url: string;
}

/** POST /api/auth/gog/complete, with the address GOG ended on, or its code. */
export interface GogCompleteRequest {
    input: string;
}

/** POST /api/auth/mock, offered only when the server runs with AUTH_MOCK=1. */
export interface MockLoginRequest {
    provider: Provider;
    name?: string;
    owned: number[];
    privateProfile?: boolean;
}

/** Any failed /api request answers with this body. */
export interface ApiError {
    error: string;
    message: string;
}

/** GET /flyby/manifest.json: the levels every player gets for the background. */
export interface FlybyManifest {
    levels: FlybyLevel[];
}

export interface FlybyLevel {
    /** Where to fetch the level file. */
    url: string;
    /** The level's file name, such as house.tr2, which also tells its engine apart. */
    file: string;
    name: string;
    /** The official game it comes from. */
    mod: string;
}

/** GET /ring/manifest.json: the game objects the server can show on the ring, by ring item. */
export interface RingManifest {
    models: Record<string, { url: string; name: string }>;
}

/** GET /ring/<item>.<version>.json: one object cut out of a level (shared/ring/extract.ts). */
export interface RingModelFile {
    name: string;
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
    blendStart: number;
    /** The atlas as a PNG data URL; its first row is v = 0. */
    texture: string;
}
