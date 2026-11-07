import { describe, expect, it, vi } from 'vitest';
import { createAdapters } from './adapters';
import type { TrxEngine } from './types';

/**
 * An engine whose storages behave as IDBFS does: syncing makes one side match
 * the other outright, deleting what the source lacks.
 */
function fakeEngine(databases: Map<string, Map<string, string>>) {
    const local = new Map<string, Map<string, string>>();
    const links = new Set<string>();
    const engine = {
        fs: {
            mkdirTree: () => {},
            writeFile: () => {},
            symlink: (_target: string, path: string) => void links.add(path),
            analyzePath: (path: string) => ({ exists: links.has(path) }),
            mount: (_type: unknown, _options: unknown, mountpoint: string) => {
                local.set(mountpoint, new Map());
                return { mount: { mountpoint } };
            },
            syncfs: () => {
                throw new Error('FS.syncfs does every mount at once');
            },
        },
        idbfs: {
            syncfs: (mount: { mountpoint: string }, populate: boolean, callback: (error: unknown) => void) => {
                const from = populate ? databases : local;
                const to = populate ? local : databases;
                to.set(mount.mountpoint, new Map(from.get(mount.mountpoint)));
                setTimeout(() => callback(null));
            },
        },
    };
    return { engine: engine as unknown as TrxEngine, local };
}

function session(databases: Map<string, Map<string, string>>) {
    const { engine, local } = fakeEngine(databases);
    const { adapters, flushNow } = createAdapters({
        profileId: 'p1',
        getEngine: () => engine,
        onGateOpen: () => {},
        onStorageMod: () => {},
        prepareMod: async () => {},
    });
    return { adapters, flushNow, local };
}

describe('saves', () => {
    it('are still there when the game starts again', async () => {
        const databases = new Map<string, Map<string, string>>();

        const first = session(databases);
        await first.adapters.mountPersistence('/persist/tr4');
        await first.adapters.syncPersistenceIn();
        first.local.get('/profiles/p1/tr4')!.set('saves/tr4/savegame_0.dat', 'Angkor Wat');
        await first.flushNow();

        const second = session(databases);
        await second.adapters.mountPersistence('/persist/tr4');
        await second.adapters.syncPersistenceIn();
        expect(second.local.get('/profiles/p1/tr4')!.get('saves/tr4/savegame_0.dat')).toBe('Angkor Wat');
        expect(databases.get('/profiles/p1/tr4')!.get('saves/tr4/savegame_0.dat')).toBe('Angkor Wat');
    });

    it('of one game survive switching to another and back', async () => {
        const databases = new Map([['/profiles/p1/tr2', new Map([['saves/tr2/savegame_0.dat', 'Great Wall']])]]);
        const { adapters, flushNow, local } = session(databases);
        await adapters.mountPersistence('/persist/tr4');
        await adapters.syncPersistenceIn();
        local.get('/profiles/p1/tr4')!.set('saves/tr4/savegame_0.dat', 'Angkor Wat');

        await adapters.mountPersistence('/persist/tr2');
        await adapters.syncPersistenceIn();
        expect(local.get('/profiles/p1/tr2')!.get('saves/tr2/savegame_0.dat')).toBe('Great Wall');
        await flushNow();
        expect(databases.get('/profiles/p1/tr4')!.get('saves/tr4/savegame_0.dat')).toBe('Angkor Wat');
        expect(databases.get('/profiles/p1/tr2')!.get('saves/tr2/savegame_0.dat')).toBe('Great Wall');
    });

    it('are written out shortly after the game asks', async () => {
        vi.useFakeTimers();
        try {
            const databases = new Map<string, Map<string, string>>();
            const { adapters, local } = session(databases);
            const mounted = adapters.mountPersistence('/persist/tr1');
            await vi.runAllTimersAsync();
            await mounted;
            const synced = adapters.syncPersistenceIn();
            await vi.runAllTimersAsync();
            await synced;
            local.get('/profiles/p1/tr1')!.set('saves/tr1/savegame_0.dat', 'Vilcabamba');
            adapters.flushPersistence();
            await vi.runAllTimersAsync();
            expect(databases.get('/profiles/p1/tr1')!.get('saves/tr1/savegame_0.dat')).toBe('Vilcabamba');
        } finally {
            vi.useRealTimers();
        }
    });
});
