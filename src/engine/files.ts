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
    writeFile(path: string, data: Uint8Array): void;
    analyzePath(path: string): { exists: boolean };
}

export interface StagedGame {
    record: GameDataRecord;
    files: readonly GameDataFile[];
}

const EMPTY = new Uint8Array(0);

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
     * generation (TRX's engine version, as in --engine), which expansions and
     * custom levels build on. Null for a mod this session knows nothing of,
     * such as a lone level's.
     */
    gamesFor(mod: string): StagedGame[] | null {
        const named = this.games.filter((game) => game.record.mod === mod);
        const engine: EngineNumber | undefined =
            named[0]?.record.engine ?? GAMES.find((game) => game.mod === mod)?.engine;
        if (engine === undefined) return null;
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
            this.fs.writeFile(path, new Uint8Array(await file.blob.arrayBuffer()));
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
