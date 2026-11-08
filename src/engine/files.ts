// Keeps the engine's file system holding the games a session can play. TRX
// plays every game, and offers to switch to any whose files it finds, but
// holding every installed game in memory at once would not fit on a phone. So
// every game's files are there, the ones not being played as empty stand-ins
// the engine can list but not read. Switching to one starts a new session.

import { GAMES, type EngineNumber } from '../games/catalog';
import type { GameDataFile, GameDataRecord } from '../gamedata/types';

/** The part of the engine's file system staging uses. */
export interface StagingFs {
    mkdirTree(path: string): void;
    /** canOwn hands the buffer over instead of copying it, which the caller must not touch again. */
    writeFile(path: string, data: Uint8Array, opts?: { canOwn?: boolean }): void;
    analyzePath(path: string): { exists: boolean };
    readdir(path: string): string[];
    unlink(path: string): void;
}

export interface StagedGame {
    record: GameDataRecord;
    files: readonly GameDataFile[];
}

const EMPTY = new Uint8Array(0);

const LEVEL_FILE = /\.(phd|tub|tr2|tr4|psx)$/;
/** The levels a custom level may take from the game it builds on: TRX looks for its title and home levels there. */
const BORROWED_LEVEL = /(?:^|\/)(?:title(?:_[a-z0-9]+)?\.(?:phd|tr2|tr4)|gym\.phd|assault\.tr2|house\.tr2)$/;

/**
 * The files of the game a custom level builds on that its session keeps:
 * music, sound, videos and pictures, which TRX looks for in that game when
 * the level brings none, and its title and home levels. Without its other
 * levels the game is no longer one TRX can start, so its game switcher has
 * nothing to offer, and the custom level plays on its own.
 */
export function borrowedFiles<T extends { path: string }>(files: readonly T[]): T[] {
    return files.filter((file) => {
        const path = file.path.toLowerCase();
        return !LEVEL_FILE.test(path) || BORROWED_LEVEL.test(path);
    });
}

/**
 * Takes the game flow away from every game in the engine's file system but
 * these, so the engine cannot start them: the ones it carries itself, such
 * as The Golden Mask's levels and Tomb Raider's PC demo, which it would
 * otherwise offer in its game switcher even beside a custom level. The
 * engines' own trN-level games, which play lone level files, stay. This
 * changes only the copy in the session's memory.
 */
export function hideOtherGames(fs: StagingFs, keep: ReadonlySet<string>): string[] {
    if (!fs.analyzePath('/games').exists) return [];
    const hidden: string[] = [];
    for (const mod of fs.readdir('/games')) {
        if (mod === '.' || mod === '..' || keep.has(mod) || mod.endsWith('-level')) continue;
        const gameflow = `/games/${mod}/gameflow.json5`;
        if (!fs.analyzePath(gameflow).exists) continue;
        fs.unlink(gameflow);
        hidden.push(mod);
    }
    return hidden;
}

function absolute(path: string): string {
    return `/${path}`;
}

export class GameFiles {
    /** Paths that hold their real contents. */
    private readonly filled = new Set<string>();
    /** Paths this session made, which may be emptied again; the engine's own files are not among them. */
    private readonly standIns = new Set<string>();

    private readonly fs: StagingFs;
    private readonly games: readonly StagedGame[];

    /** The first game is the one the profile plays; it wins where two share a path. */
    constructor(fs: StagingFs, games: readonly StagedGame[]) {
        this.fs = fs;
        this.games = games;
    }

    /** Puts an empty file wherever a game has one and the engine has none, so the engine sees every game. */
    placeStandIns(): void {
        for (const { files } of this.games) {
            for (const file of files) {
                const path = absolute(file.path);
                if (this.standIns.has(file.path) || this.fs.analyzePath(path).exists) continue;
                this.fs.mkdirTree(path.slice(0, path.lastIndexOf('/')));
                this.fs.writeFile(path, EMPTY);
                this.standIns.add(file.path);
            }
        }
    }

    /**
     * The games a mod plays with: its own files, and the other games of its
     * generation (TRX's engine version, as in --engine) that it builds on.
     * An official game takes only the game it is an expansion of, if any:
     * Unfinished Business needs Tomb Raider's title level, but Tomb Raider
     * needs nothing of Unfinished Business, which would only fill memory as
     * the level starts. Anything else, such as a custom level or the demo
     * the engine carries, takes every game of its generation the session
     * holds. Null for a mod this session knows nothing of, such as a lone
     * level's.
     */
    gamesFor(mod: string): StagedGame[] | null {
        const named = this.games.filter((game) => game.record.mod === mod);
        const official = GAMES.find((game) => game.mod === mod);
        const engine: EngineNumber | undefined = named[0]?.record.engine ?? official?.engine;
        if (engine === undefined) return null;
        if (official !== undefined && named[0]?.record.layout === 'game') {
            const base = official.requires ?? official.expansionOf;
            return [...named, ...this.games.filter((game) => base !== undefined && game.record.mod === base && game.record.layout === 'game')];
        }
        const sameEngine = this.games.filter(
            (game) => !named.includes(game) && game.record.layout === 'game' && game.record.engine === engine,
        );
        return [...named, ...sameEngine];
    }

    /**
     * Fills in the files a mod plays with and empties the rest. Does nothing
     * for a mod it knows nothing of.
     */
    async use(mod: string, onProgress?: (done: number, total: number) => void): Promise<void> {
        const games = this.gamesFor(mod);
        if (games === null) return;

        const kept = new Set(games.flatMap((game) => game.files.map((file) => file.path)));
        for (const path of this.filled) {
            if (kept.has(path) || !this.standIns.has(path)) continue;
            this.fs.writeFile(absolute(path), EMPTY);
            this.filled.delete(path);
        }

        const pending = this.pendingFiles(games);
        const total = pending.reduce((sum, file) => sum + file.blob.size, 0);
        let done = 0;
        for (const file of pending) {
            const path = absolute(file.path);
            this.fs.mkdirTree(path.slice(0, path.lastIndexOf('/')));
            // Handed over, not copied: one copy of each file in memory as the level starts.
            this.fs.writeFile(path, new Uint8Array(await file.blob.arrayBuffer()), { canOwn: true });
            this.filled.add(file.path);
            done += file.blob.size;
            onProgress?.(done, total);
        }
    }

    /** The files of these games not yet filled in, each path once. */
    private pendingFiles(games: readonly StagedGame[]): GameDataFile[] {
        const seen = new Set<string>();
        const pending: GameDataFile[] = [];
        for (const { files } of games) {
            for (const file of files) {
                if (seen.has(file.path) || this.filled.has(file.path)) continue;
                seen.add(file.path);
                pending.push(file);
            }
        }
        return pending;
    }
}

/** The official game a custom level builds on: its gameflow's "extends", else its engine's game. */
export function baseModOf(record: GameDataRecord): string {
    return record.extendsMod ?? `tr${record.engine}`;
}
