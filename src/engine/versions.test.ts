// The engine builds the server offers, and the one a profile plays.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function withOffered(list: string[], online = true) {
    vi.resetModules();
    vi.stubGlobal('navigator', { onLine: online });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ versions: list })));
    return import('./versions');
}

describe('engine versions', () => {
    beforeEach(() => vi.unstubAllGlobals());
    afterEach(() => vi.unstubAllGlobals());

    it('orders builds by the TRX release and the commits after it, newest first', async () => {
        const { loadEngineVersions } = await withOffered(['1.5.0', '1.12', '1.12-17-g319a4c2', '1.12-3-gabcdef0', '1.11.1']);
        expect(await loadEngineVersions()).toEqual(['1.12-17-g319a4c2', '1.12-3-gabcdef0', '1.12', '1.11.1', '1.5.0']);
    });

    it('keeps a profile on its build while the server offers it', async () => {
        const { offeredEngine } = await withOffered(['1.12-17-g319a4c2', '1.5.0']);
        expect(await offeredEngine('1.5.0')).toBe('1.5.0');
    });

    it('moves a profile whose build the server no longer offers onto the newest', async () => {
        const { offeredEngine } = await withOffered(['1.12-3-gabcdef0', '1.12-17-g319a4c2']);
        expect(await offeredEngine('1.5.0')).toBe('1.12-17-g319a4c2');
    });

    it('leaves a profile on its build offline, where the browser may still hold it', async () => {
        const { offeredEngine } = await withOffered(['1.12-17-g319a4c2'], false);
        expect(await offeredEngine('1.5.0')).toBe('1.5.0');
    });
});
