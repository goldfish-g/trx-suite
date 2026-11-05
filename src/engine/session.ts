// Runs a profile: fetches its engine, hands it the game files, and plays
// until the engine exits.

import { getGameData, listGameData, listGameDataFiles } from '../gamedata/store';
import type { GameDataRecord } from '../gamedata/types';
import type { RetryNotice } from '../lib/download';
import { markProfilePlayed, noteStorageMod } from '../profiles/store';
import type { ProfileRecord } from '../profiles/types';
import { createAdapters } from './adapters';
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
    canvas: HTMLCanvasElement;
    signal: AbortSignal;
    onStage(stage: SessionStage): void;
    onRetry(notice: RetryNotice): void;
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
 * The game data a profile plays with: its own, and the games for the same
 * engine, which expansions and custom levels build on and the in-game mod
 * switcher offers. Other custom levels stay out, so they never weigh on a
 * session they are not part of.
 */
async function gameDataFor(profile: ProfileRecord): Promise<GameDataRecord[]> {
    const own = await getGameData(profile.gamedataId);
    if (own === undefined || own.status !== 'ready') {
        throw new Error('The game data for this profile is not ready. Check the library.');
    }
    const others = (await listGameData()).filter(
        (record) =>
            record.id !== own.id && record.status === 'ready' && record.engine === own.engine && record.layout === 'game',
    );
    return [own, ...others];
}

async function stageFiles(
    engine: TrxEngine,
    records: GameDataRecord[],
    onProgress: (done: number, total: number) => void,
): Promise<void> {
    const total = records.reduce((sum, record) => sum + record.sizeBytes, 0);
    let done = 0;
    for (const record of records) {
        for (const file of await listGameDataFiles(record.id)) {
            const path = `/${file.path}`;
            engine.fs.mkdirTree(path.slice(0, path.lastIndexOf('/')));
            engine.fs.writeFile(path, new Uint8Array(await file.blob.arrayBuffer()));
            done += file.blob.size;
            onProgress(done, total);
        }
    }
}

/** What the engine is told to play. A lone level plays through trN-level. */
function engineArgs(profile: ProfileRecord, own: GameDataRecord): string[] {
    const engine = ['--engine', String(profile.engine)];
    if (own.layout === 'level' && own.startLevel !== undefined) {
        return [...engine, '--level', `/${own.startLevel}`];
    }
    return [...engine, '--mod', profile.mod];
}

/** Plays a profile, and resolves with the engine's exit code once it exits. */
export async function runSession(options: SessionOptions): Promise<number> {
    const { profile, canvas, signal, onStage, onRetry } = options;
    const records = await gameDataFor(profile);

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
        await stageFiles(started, records, (done, total) => onStage({ kind: 'files', done, total }));
        await markProfilePlayed(profile.id);
        return await started.run(engineArgs(profile, records[0]!));
    } finally {
        window.removeEventListener('resize', onResize);
        window.visualViewport?.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onHide);
        await flushNow();
    }
}
