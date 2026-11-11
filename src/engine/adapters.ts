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
    /** The engine is about to play this mod, and reads its files next. */
    prepareMod(mod: string): Promise<void>;
    /** The engine reads this mod's saves next: the moment to bring in the cloud's. */
    beforeLoad?(mod: string): Promise<void>;
    /** The storage at this path is read in, and the game reads its settings from it next. */
    storageRead?(path: string): void;
    /** What the game saved is in the browser's storage now. */
    onFlushed?(): void;
}

export interface SessionAdapters {
    adapters: TrxAdapters;
    /** Writes what is pending to persistent storage now. */
    flushNow(): Promise<void>;
    /** The mods whose storage the engine has read in. */
    loadedMods(): string[];
}

/** A profile's storage for one mod: a directory backed by a database of its own. */
interface Storage {
    path: string;
    /** The mounted file system, as IDBFS knows it. */
    mount: unknown;
    /** Whether the database's files have been read in yet. */
    loaded: boolean;
}

interface Idbfs {
    syncfs(mount: unknown, populate: boolean, callback: (error: unknown) => void): void;
}

/**
 * Copies one storage's files between the engine and its database. Writing
 * out makes the database match the directory, deleting what the directory
 * lacks, so a storage must be read in before it is ever written out: FS.syncfs,
 * which does every mount at once, would wipe a storage mounted but not read.
 */
function syncStorage(engine: TrxEngine, storage: Storage, populate: boolean): Promise<void> {
    return new Promise((resolve, reject) =>
        (engine.idbfs as Idbfs).syncfs(storage.mount, populate, (error) => (error ? reject(error) : resolve())),
    );
}

function parentOf(path: string): string {
    return path.slice(0, path.lastIndexOf('/')) || '/';
}

export function createAdapters(hooks: AdapterHooks): SessionAdapters {
    const storages = new Map<string, Storage>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let flushing: Promise<void> = Promise.resolve();

    const flushNow = () => {
        if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        const loaded = [...storages.values()].filter((storage) => storage.loaded);
        if (loaded.length === 0) return flushing;
        flushing = flushing
            .then(async () => {
                const engine = hooks.getEngine();
                for (const storage of loaded) await syncStorage(engine, storage, false);
                hooks.onFlushed?.();
            })
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
            const path = profileStoragePath(hooks.profileId, mod);
            if (!storages.has(path)) {
                engine.fs.mkdirTree(path);
                const root = engine.fs.mount(engine.idbfs, {}, path);
                storages.set(path, { path, mount: root.mount, loaded: false });
            }
            engine.fs.mkdirTree(parentOf(mountPath));
            if (!engine.fs.analyzePath(mountPath).exists) {
                engine.fs.symlink(path, mountPath);
            }
            hooks.onStorageMod(mod);
            await hooks.prepareMod(mod);
            await hooks.beforeLoad?.(mod);
        },

        syncPersistenceIn: async () => {
            const engine = hooks.getEngine();
            // What the game wrote to storages already read in goes out first.
            await flushNow();
            for (const storage of storages.values()) {
                if (storage.loaded) continue;
                await syncStorage(engine, storage, true);
                storage.loaded = true;
                // Reading in replaces what the directory holds, so the
                // directories the engine writes into come after it.
                engine.fs.mkdirTree(`${storage.path}/saves`);
                engine.fs.mkdirTree(`${storage.path}/cfg`);
                hooks.storageRead?.(storage.path);
            }
        },

        flushPersistence: () => {
            if (flushTimer !== null) return;
            flushTimer = setTimeout(() => void flushNow(), FLUSH_DELAY_MS);
        },
    };
    const loadedMods = () =>
        [...storages.values()].filter((storage) => storage.loaded).map((storage) => storage.path.slice(storage.path.lastIndexOf('/') + 1));
    return { adapters, flushNow, loadedMods };
}
