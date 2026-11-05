// The shell's answers to what the engine asks of the page.

import { profileStoragePath } from '../profiles/store';
import type { TrxAdapters, TrxEngine } from './types';

const FLUSH_DELAY_MS = 200;

export interface AdapterHooks {
    profileId: string;
    getEngine(): TrxEngine;
    /** The engine waits for the player; the page asks them to start. */
    onGateOpen(pass: () => void): void;
    /** The profile now keeps saves for this mod. */
    onStorageMod(mod: string): void;
}

export interface SessionAdapters {
    adapters: TrxAdapters;
    /** Writes what is pending to persistent storage now. */
    flushNow(): Promise<void>;
}

function syncfs(engine: TrxEngine, populate: boolean): Promise<void> {
    return new Promise((resolve, reject) =>
        engine.fs.syncfs(populate, (error) => (error ? reject(error) : resolve())),
    );
}

function parentOf(path: string): string {
    return path.slice(0, path.lastIndexOf('/')) || '/';
}

export function createAdapters(hooks: AdapterHooks): SessionAdapters {
    const mounted = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let flushing: Promise<void> = Promise.resolve();

    const flushNow = () => {
        if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (mounted.size === 0) return flushing;
        flushing = flushing
            .then(() => syncfs(hooks.getEngine(), false))
            .catch((error: unknown) => console.error('[storage] saving failed:', error));
        return flushing;
    };

    const adapters: TrxAdapters = {
        startGate: () => new Promise((resolve) => hooks.onGateOpen(resolve)),

        // The engine keeps a mod's saves under /persist/<mod>. Each profile
        // gets storage of its own for it, which that path then points to.
        mountPersistence: async (mountPath) => {
            const engine = hooks.getEngine();
            const mod = mountPath.slice(mountPath.lastIndexOf('/') + 1);
            const storage = profileStoragePath(hooks.profileId, mod);
            if (!mounted.has(storage)) {
                engine.fs.mkdirTree(storage);
                engine.fs.mount(engine.idbfs, {}, storage);
                mounted.add(storage);
            }
            engine.fs.mkdirTree(parentOf(mountPath));
            if (!engine.fs.analyzePath(mountPath).exists) {
                engine.fs.symlink(storage, mountPath);
            }
            hooks.onStorageMod(mod);
        },

        syncPersistenceIn: async () => {
            const engine = hooks.getEngine();
            await flushNow();
            await syncfs(engine, true);
            // Loading replaces what each mount holds, so the directories the
            // engine writes into come after it.
            for (const storage of mounted) {
                engine.fs.mkdirTree(`${storage}/saves`);
                engine.fs.mkdirTree(`${storage}/cfg`);
            }
        },

        flushPersistence: () => {
            if (flushTimer !== null) return;
            flushTimer = setTimeout(() => void flushNow(), FLUSH_DELAY_MS);
        },
    };
    return { adapters, flushNow };
}
