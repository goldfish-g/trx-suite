// The official games this app offers, and who may download each from the
// server. Shared by the page and the server, so both agree on what a store
// purchase unlocks.

export type EngineNumber = 1 | 2 | 3 | 4;

/** How a game becomes available to download from the server. */
export type GameAccess =
    /** Released by its publisher for free, so anyone may download it. */
    | { kind: 'free' }
    /** Downloadable for players who own one of these store products. */
    | { kind: 'owned'; steamApps: readonly number[]; gogProducts: readonly number[] };

export interface OfficialGame {
    /** Catalog id and the directory the engine reads it from, games/<mod>/. */
    mod: string;
    engine: EngineNumber;
    title: string;
    /** A short label for tight spots, such as the ring of games. */
    shortTitle: string;
    year: number;
    /** The game an expansion builds on. */
    expansionOf?: string;
    access: GameAccess;
}

/** Steam app ids. */
export const STEAM = {
    tr1: 224960,
    tr2: 225300,
    tr3: 225320,
    tr4: 224980,
    remasteredI_III: 2478970,
    remasteredIV_VI: 2525380,
} as const;

/** GOG product ids. Packs grant their games' ids too; they are listed in case one does not. */
export const GOG = {
    tr1: 1207663463,
    tr2: 1207663483,
    tr3: 1207663493,
    tr4: 1207663513,
    remasteredI_III: 1407750955,
    remasteredIV_VI: 1288534304,
    remasteredI_VI: 1446538488,
} as const;

function owned(steamApps: number[], gogProducts: number[]): GameAccess {
    return { kind: 'owned', steamApps, gogProducts };
}

/**
 * The store versions of Tomb Raider II and III do not include their
 * expansions, so only the remaster unlocks The Lost Artifact. Unfinished
 * Business and The Golden Mask were given away by their publisher.
 */
export const OFFICIAL_GAMES: readonly OfficialGame[] = [
    {
        mod: 'tr1',
        engine: 1,
        title: 'Tomb Raider',
        shortTitle: 'Tomb Raider',
        year: 1996,
        access: owned([STEAM.tr1, STEAM.remasteredI_III], [GOG.tr1, GOG.remasteredI_III, GOG.remasteredI_VI]),
    },
    {
        mod: 'tr2',
        engine: 2,
        title: 'Tomb Raider II',
        shortTitle: 'Tomb Raider II',
        year: 1997,
        access: owned([STEAM.tr2, STEAM.remasteredI_III], [GOG.tr2, GOG.remasteredI_III, GOG.remasteredI_VI]),
    },
    {
        mod: 'tr3',
        engine: 3,
        title: 'Tomb Raider III',
        shortTitle: 'Tomb Raider III',
        year: 1998,
        access: owned([STEAM.tr3, STEAM.remasteredI_III], [GOG.tr3, GOG.remasteredI_III, GOG.remasteredI_VI]),
    },
    {
        mod: 'tr4',
        engine: 4,
        title: 'The Last Revelation',
        shortTitle: 'Tomb Raider IV',
        year: 1999,
        access: owned([STEAM.tr4, STEAM.remasteredIV_VI], [GOG.tr4, GOG.remasteredIV_VI, GOG.remasteredI_VI]),
    },
    {
        mod: 'tr1-ub',
        engine: 1,
        title: 'Unfinished Business',
        shortTitle: 'Gold',
        year: 1998,
        expansionOf: 'tr1',
        access: { kind: 'free' },
    },
    {
        mod: 'tr2-gm',
        engine: 2,
        title: 'The Golden Mask',
        shortTitle: 'Golden Mask',
        year: 1999,
        expansionOf: 'tr2',
        access: { kind: 'free' },
    },
    {
        mod: 'tr3-la',
        engine: 3,
        title: 'The Lost Artifact',
        shortTitle: 'Lost Artifact',
        year: 2000,
        expansionOf: 'tr3',
        access: owned([STEAM.remasteredI_III], [GOG.remasteredI_III, GOG.remasteredI_VI]),
    },
];

export function findOfficialGame(mod: string): OfficialGame | undefined {
    return OFFICIAL_GAMES.find((game) => game.mod === mod);
}

/** What a player has proven to own, as the server checked it. */
export interface Ownership {
    steamApps: readonly number[];
    gogProducts: readonly number[];
}

/** Whether a player may download a game from the server. */
export function isUnlocked(game: OfficialGame, ownership: Ownership): boolean {
    if (game.access.kind === 'free') return true;
    const { steamApps, gogProducts } = game.access;
    return (
        steamApps.some((app) => ownership.steamApps.includes(app)) ||
        gogProducts.some((product) => ownership.gogProducts.includes(product))
    );
}

/** Every Steam app that unlocks something, to ask Steam about just those. */
export const RELEVANT_STEAM_APPS: readonly number[] = [
    ...new Set(OFFICIAL_GAMES.flatMap((game) => (game.access.kind === 'owned' ? game.access.steamApps : []))),
];

export const RELEVANT_GOG_PRODUCTS: readonly number[] = [
    ...new Set(OFFICIAL_GAMES.flatMap((game) => (game.access.kind === 'owned' ? game.access.gogProducts : []))),
];
