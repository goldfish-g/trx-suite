// Runs a profile: fetches its engine, hands it the game files, and plays
// until the engine exits.

import { pullSavesForSession, pushSavesForSession } from '../cloud/sync';
import { getGameData, listGameData, listGameDataFiles } from '../gamedata/store';
import type { GameDataRecord } from '../gamedata/types';
import { GAMES, type EngineNumber } from '../games/catalog';
import type { RetryNotice } from '../lib/download';
import { markProfilePlayed, noteStorageMod } from '../profiles/store';
import type { ProfileRecord } from '../profiles/types';
import { createAdapters } from './adapters';
import { baseModOf, borrowedFiles, GameFiles, hideOtherGames, type StagedGame } from './files';
import { loadEngine } from './load';
import type { TrxEngine } from './types';

const PUSH_DELAY_MS = 3000;

export type SessionStage =
    | { kind: 'engine'; received: number; total: number | null }
    | { kind: 'starting' }
    /** Bringing in the profile's saves from the cloud. */
    | { kind: 'cloud' }
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

/** Set once WebGL 2 worked on this device, so its absence later reads as a crash. */
const WEBGL_WORKED_KEY = 'trx-suite:webgl-worked';

/** What a browser must offer for the engine to run, or why it falls short. */
export function checkBrowserSupport(): string | null {
    if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
        return 'The engine needs this page served over HTTPS with cross-origin isolation (the COOP and COEP headers).';
    }
    if (document.createElement('canvas').getContext('webgl2') === null) {
        // Browsers switch WebGL off after their graphics process crashed,
        // say when memory ran out, until they start afresh.
        if (localStorage.getItem(WEBGL_WORKED_KEY) !== null) {
            return 'The browser has switched WebGL off for now, which it does after a crash. Close the app completely and open it again. If that is not enough, force stop the app and the browser in the device’s settings for apps, then open it again.';
        }
        return 'This browser or device does not offer WebGL 2, which the engine draws with.';
    }
    localStorage.setItem(WEBGL_WORKED_KEY, '1');
    return null;
}

/**
 * The game data a session can play. An official game comes with every other
 * installed game, which expansions build on and the in-game game switcher
 * offers, one per game. A custom level is kept apart: it comes with the game
 * it builds on alone, and only with what it may borrow from that game, so
 * the switcher offers nothing. Other custom levels always stay out, so they
 * never weigh on a session they are not part of.
 */
async function gameDataFor(profile: ProfileRecord): Promise<StagedGame[]> {
    const own = await getGameData(profile.gamedataId);
    if (own === undefined || own.status !== 'ready') {
        throw new Error('The game data for this profile is not ready. Check the library.');
    }
    // Newest last, so a game imported twice plays its newer copy.
    const games = new Map<string, GameDataRecord>();
    for (const record of await listGameData()) {
        if (record.id === own.id || record.mod === own.mod) continue;
        if (record.status === 'ready' && record.layout === 'game') games.set(record.mod, record);
    }
    const ownFiles = { record: own, files: await listGameDataFiles(own.id) };
    if (isolated(own)) {
        const base = games.get(baseModOf(own));
        if (base === undefined) return [ownFiles];
        return [ownFiles, { record: base, files: borrowedFiles(await listGameDataFiles(base.id)) }];
    }
    return [ownFiles, ...(await Promise.all([...games.values()].map(async (record) => ({ record, files: await listGameDataFiles(record.id) }))))];
}

/** Custom levels play on their own, without the game switcher. */
function isolated(record: GameDataRecord): boolean {
    return record.layout !== 'game';
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
    // A custom level has nothing to switch to.
    const switched = !isolated(own) && options.mod !== undefined && options.mod !== profile.mod ? options.mod : null;
    const mod = switched ?? profile.mod;
    // Converting a custom level settles its game, which may not be the one it was added as.
    const engineNumber = (switched !== null ? engineOf(switched, games) : undefined) ?? (isolated(own) ? own.engine : profile.engine);
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
    // New saves go to the cloud a moment after the game writes them.
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    let pushing: Promise<void> = Promise.resolve();
    const push = () => {
        if (pushTimer !== null) clearTimeout(pushTimer);
        pushTimer = null;
        pushing = pushing.then(() => pushSavesForSession(profile.id, loadedMods()));
        return pushing;
    };
    const { adapters, flushNow, loadedMods } = createAdapters({
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
        beforeLoad: async (mod) => {
            onStage({ kind: 'cloud' });
            await pullSavesForSession(profile.id, mod);
            onStage({ kind: 'starting' });
        },
        onFlushed: () => {
            if (pushTimer !== null) clearTimeout(pushTimer);
            pushTimer = setTimeout(() => void push(), PUSH_DELAY_MS);
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
        if (document.visibilityState === 'hidden') void flushNow().then(push);
    };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onHide);
    try {
        // Every game is there for the engine to offer, but only the one
        // played, with the games it builds on, takes up memory.
        const files = new GameFiles(started.fs, games);
        // A custom level has the engine to itself: the games the engine
        // carries would otherwise be there to switch to.
        if (isolated(own)) hideOtherGames(started.fs, new Set([own.mod, baseModOf(own)]));
        files.placeStandIns();
        await files.use(switched ?? own.mod, (done, total) => onStage({ kind: 'files', done, total }));
        await markProfilePlayed(profile.id);
        return await started.run(engineArgs(profile, own, mod, engineNumber));
    } finally {
        window.removeEventListener('resize', onResize);
        window.visualViewport?.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onHide);
        await flushNow();
        // The menus sync whatever does not make it in time.
        await Promise.race([push(), new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
}
