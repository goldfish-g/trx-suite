// The games the TRX engine plays, and how their files are recognised.

export type EngineNumber = 1 | 2 | 3 | 4;

export interface Game {
    /** The directory the engine reads the game from, games/<mod>/. */
    mod: string;
    engine: EngineNumber;
    title: string;
    /** The game an expansion builds on. */
    expansionOf?: string;
    /** A game whose files this one cannot start without. */
    requires?: string;
}

export const GAMES: readonly Game[] = [
    { mod: 'tr1', engine: 1, title: 'Tomb Raider' },
    // Unfinished Business opens on Tomb Raider's title level.
    { mod: 'tr1-ub', engine: 1, title: 'Unfinished Business', expansionOf: 'tr1', requires: 'tr1' },
    { mod: 'tr1-demo-pc', engine: 1, title: 'Tomb Raider (PC demo)' },
    { mod: 'tr2', engine: 2, title: 'Tomb Raider II' },
    { mod: 'tr2-gm', engine: 2, title: 'The Golden Mask', expansionOf: 'tr2' },
    { mod: 'tr3', engine: 3, title: 'Tomb Raider III' },
    { mod: 'tr3-la', engine: 3, title: 'The Lost Artifact', expansionOf: 'tr3' },
    { mod: 'tr4', engine: 4, title: 'The Last Revelation' },
];

export const ENGINE_NAMES: Record<EngineNumber, string> = {
    1: 'TR1',
    2: 'TR2',
    3: 'TR3',
    4: 'TR4',
};

export const LEVEL_EXTENSIONS: Record<EngineNumber, readonly string[]> = {
    1: ['.phd', '.psx', '.tub'],
    2: ['.tr2', '.psx'],
    3: ['.tr2', '.psx'],
    4: ['.tr4'],
};

export function findGame(mod: string): Game | undefined {
    return GAMES.find((game) => game.mod === mod);
}

/** A custom level's mod directory, from the name the player gives it. */
export function customMod(name: string): string {
    const slug = name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return `custom-${slug || 'level'}`;
}
