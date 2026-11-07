// Runs a profile: fetches its engine, hands it the game files, and plays
// until the engine exits.

import { getGameData, listGameData, listGameDataFiles } from '../gamedata/store';
import type { GameDataRecord } from '../gamedata/types';
import { GAMES, type EngineNumber } from '../games/catalog';
import type { RetryNotice } from '../lib/download';
import { markProfilePlayed, noteStorageMod } from '../profiles/store';
import type { ProfileRecord } from '../profiles/types';
import { createAdapters } from './adapters';
import { GameFiles, type StagedGame } from './files';
import { loadEngine } from './load';
import type { TrxEngine } from './types';

export type SessionStage =
    | { kind: 'engine'; received: number; total: number | null }
    | { kind: 'starting' }
    | { kind: 'files'; done: number; total: number }
    | { kind: 'gate'; pass: () => void }
    | { kind: 'running' };

export interface SessionOptions {
    profile: ProfileRecord;
    /** The game to start, when not the profile's own: one the player switched to in the engine. */
    mod?: string;
    canvas: HTMLCanvasElement;
    signal: AbortSignal;
    onStage(stage: SessionStage): void;
    onRetry(notice: RetryNotice): void;
    /**
     * The player picked another game in the engine. The page starts a new
     * session for it, which reads that game's files in afresh; the engine's
     * own restart would hold up a running game while they load.
     */
    onSwitchMod(mod: string): void;
}

/** What a browser must offer for the engine to run, or why it falls short. */
export function checkBrowserSupport(): string | null {
    if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
        return 'The engine needs this page served over HTTPS with cross-origin isolation (the COOP and COEP headers).';
    }
    if (document.createElement('canvas').getContext('webgl2') === null) {
        return 'This browser or device does not offer WebGL 2, which the engine draws with.';
    }
    return null;
}

/**
 * The game data a session can play: the profile's own, then every installed
 * game, which expansions and custom levels build on and the in-game game
 * switcher offers, one per game. Other custom levels stay out, so they never
 * weigh on a session they are not part of.
 */
async function gameDataFor(profile: ProfileRecord): Promise<StagedGame[]> {
    const own = await getGameData(profile.gamedataId);
    if (own === undefined || own.status !== 'ready') {
        throw new Error('The game data for this profile is not ready. Check the library.');
    }
    // Newest last, so a game imported twice plays its newer copy.
    const others = new Map<string, GameDataRecord>();
    for (const record of await listGameData()) {
        if (record.id === own.id || record.mod === own.mod) continue;
        if (record.status === 'ready' && record.layout === 'game') others.set(record.mod, record);
    }
    return Promise.all(
        [own, ...others.values()].map(async (record) => ({ record, files: await listGameDataFiles(record.id) })),
    );
}

/** A mod's generation, TRX's engine version, from its game data or the games TRX knows. */
function engineOf(mod: string, games: readonly StagedGame[]): EngineNumber | undefined {
    return games.find((game) => game.record.mod === mod)?.record.engine ?? GAMES.find((game) => game.mod === mod)?.engine;
}

/** What the engine is told to play. A lone level plays through trN-level. */
function engineArgs(profile: ProfileRecord, own: GameDataRecord, mod: string, engine: EngineNumber): string[] {
    const args = ['--engine', String(engine)];
    if (mod === profile.mod && own.layout === 'level' && own.startLevel !== undefined) {
        return [...args, '--level', `/${own.startLevel}`];
    }
    return [...args, '--mod', mod];
}

/** Plays a profile, and resolves with the engine's exit code once it exits. */
export async function runSession(options: SessionOptions): Promise<number> {
    const { profile, canvas, signal, onStage, onRetry, onSwitchMod } = options;
    const games = await gameDataFor(profile);
    const own = games[0]!.record;
    const switched = options.mod !== undefined && options.mod !== profile.mod ? options.mod : null;
    const mod = switched ?? profile.mod;
    const engineNumber = (switched !== null ? engineOf(switched, games) : undefined) ?? profile.engine;
    // The game the engine opened storage for first; opening another means the player switched.
    let playing: string | null = null;

    onStage({ kind: 'engine', received: 0, total: null });
    const loaded = await loadEngine(profile.engineVersion, {
        signal,
        onRetry,
        onProgress: ({ received, total }) => onStage({ kind: 'engine', received, total }),
    });
    signal.throwIfAborted();

    onStage({ kind: 'starting' });
    let engine: TrxEngine | null = null;
    const { adapters, flushNow } = createAdapters({
        profileId: profile.id,
        getEngine: () => {
            if (engine === null) throw new Error('The engine has not started yet.');
            return engine;
        },
        onGateOpen: (pass) =>
            onStage({
                kind: 'gate',
                pass: () => {
                    onStage({ kind: 'running' });
                    pass();
                },
            }),
        onStorageMod: (mod) => void noteStorageMod(profile.id, mod),
        prepareMod: async (next) => {
            playing ??= next;
            if (next === playing) return;
            await flushNow();
            onStage({ kind: 'starting' });
            onSwitchMod(next);
            // The engine waits here until the page makes way for the new session.
            await new Promise<never>(() => {});
        },
    });
    engine = await loaded.createTRX({
        canvas,
        adapters,
        jsUrl: loaded.jsUrl,
        wasmUrl: loaded.wasmUrl,
        dataUrl: loaded.dataUrl,
    });
    loaded.releaseStartupFiles();

    const started = engine;
    const onResize = () => started.syncViewport();
    const onHide = () => {
        if (document.visibilityState === 'hidden') void flushNow();
    };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onHide);
    try {
        // Every game is there for the engine to offer, but only the one
        // played, with the games it builds on, takes up memory.
        const files = new GameFiles(started.fs, games);
        files.placeStandIns();
        await files.use(switched ?? own.mod, (done, total) => onStage({ kind: 'files', done, total }));
        await markProfilePlayed(profile.id);
        return await started.run(engineArgs(profile, own, mod, engineNumber));
    } finally {
        window.removeEventListener('resize', onResize);
        window.visualViewport?.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onHide);
        await flushNow();
    }
}
