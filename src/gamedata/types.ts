import type { EngineNumber } from '../games/catalog';

/** Where a set of game data came from. */
export type GameDataSource =
    /** An archive the server lists in its catalog. */
    | { kind: 'server'; entryId: string; url: string }
    /** Files the player picked on their device. */
    | { kind: 'upload'; name: string }
    /** An archive at an address the player gave. */
    | { kind: 'link'; url: string };

/**
 * How the files map to the engine's directories. A game sorts its files by
 * kind into levels/, music/, fmv/ and so on. A custom level keeps the tree
 * around its gameflow.json5 as it is. Level files without a gameflow go into
 * levels/, for the engine to play one of them on its own.
 */
export type GameDataLayout = 'game' | 'custom' | 'level';

export type GameDataStatus = 'importing' | 'ready' | 'failed';

export interface GameDataRecord {
    id: string;
    name: string;
    mod: string;
    engine: EngineNumber;
    layout: GameDataLayout;
    source: GameDataSource;
    status: GameDataStatus;
    /** Why the import failed, for a failed record. */
    error?: string;
    sizeBytes: number;
    fileCount: number;
    /** For the level layout, the level the engine starts, such as games/x/levels/a.tr2. */
    startLevel?: string;
    createdAt: string;
}

/** One file of a set of game data, at the path the engine reads it from. */
export interface GameDataFile {
    gamedataId: string;
    /** Relative to the engine's root, such as games/tr2/levels/wall.tr2. */
    path: string;
    blob: Blob;
}

/** An archive the server offers, as its catalog lists it. */
export interface ServerGameData {
    id: string;
    mod: string;
    engine: EngineNumber;
    name: string;
    url: string;
    sizeBytes: number;
}
