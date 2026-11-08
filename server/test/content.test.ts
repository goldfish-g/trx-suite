// @vitest-environment node
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, CatalogResponse, FlybyManifest } from '../../shared/api.ts';
import { STEAM } from '../../shared/games.ts';
import { parseRange } from '../src/files.ts';
import { ARCHIVE, LEVEL, account, makeApp, makeFixture, oldGogAccount, sessionCookies, type Fixture } from './helpers.ts';

let fixture: Fixture;
let app: FastifyInstance;

beforeAll(async () => {
    fixture = await makeFixture();
    app = await makeApp(fixture);
});
afterAll(async () => {
    await app.close();
    await fixture.cleanup();
});

const remastered = sessionCookies([account('steam', [STEAM.remasteredI_III])]);

async function catalog(cookies?: Record<string, string>) {
    const response = await app.inject({ url: '/api/catalog', ...(cookies ? { cookies } : {}) });
    expect(response.statusCode).toBe(200);
    const body = response.json<CatalogResponse>();
    return Object.fromEntries(body.entries.map((entry) => [entry.id, entry]));
}

describe('GET /api/catalog', () => {
    it('lists the official games whose archives exist, locked unless free', async () => {
        const entries = await catalog();
        expect(Object.keys(entries)).toEqual(['tr1', 'tr2', 'tr3', 'tr4', 'tr1-ub', 'tr3-la']);
        expect(entries.tr1).toEqual({
            id: 'tr1',
            mod: 'tr1',
            engine: 1,
            name: 'Tomb Raider',
            url: '/api/gamedata/tr1',
            sizeBytes: ARCHIVE.length,
            access: 'owned',
            unlocked: false,
        });
        expect(entries['tr1-ub']).toMatchObject({ access: 'free', unlocked: true });
        expect(Object.values(entries).filter((entry) => entry.unlocked).map((entry) => entry.id)).toEqual(['tr1-ub']);
    });

    it('unlocks tr1, tr2, tr3 and tr3-la, not tr4, for Steam remastered I–III', async () => {
        const entries = await catalog(remastered);
        for (const id of ['tr1', 'tr2', 'tr3', 'tr3-la', 'tr1-ub']) expect(entries[id]?.unlocked, id).toBe(true);
        expect(entries.tr4?.unlocked).toBe(false);
    });

    it('unlocks everything for both remasters', async () => {
        const entries = await catalog(sessionCookies([account('steam', [STEAM.remasteredI_III, STEAM.remasteredIV_VI])]));
        expect(Object.values(entries).every((entry) => entry.unlocked)).toBe(true);
    });

    it('unlocks nothing for a GOG account an old session still holds', async () => {
        // GOG Tomb Raider 4's product id.
        const entries = await catalog(sessionCookies([oldGogAccount([1207663513])]));
        expect(entries.tr4?.unlocked).toBe(false);
    });
});

describe('GET /api/gamedata/:id', () => {
    it('refuses a locked game with 403', async () => {
        const response = await app.inject({ url: '/api/gamedata/tr1' });
        expect(response.statusCode).toBe(403);
        expect(response.json<ApiError>()).toEqual({
            error: 'locked',
            message: 'Sign in with a Steam account that owns Tomb Raider to download it.',
        });
        expect(response.headers['cross-origin-embedder-policy']).toBe('require-corp');
    });

    it('refuses a locked game to an owner of another one, Range or not', async () => {
        const plain = await app.inject({ url: '/api/gamedata/tr4', cookies: remastered });
        expect(plain.statusCode).toBe(403);
        const ranged = await app.inject({ url: '/api/gamedata/tr4', cookies: remastered, headers: { range: 'bytes=0-9' } });
        expect(ranged.statusCode).toBe(403);
    });

    it('sends free games to anyone', async () => {
        const response = await app.inject({ url: '/api/gamedata/tr1-ub' });
        expect(response.statusCode).toBe(200);
        expect(response.rawPayload.equals(ARCHIVE)).toBe(true);
        expect(response.headers['content-type']).toBe('application/zip');
        expect(response.headers['accept-ranges']).toBe('bytes');
        expect(response.headers['content-length']).toBe(String(ARCHIVE.length));
        expect(response.headers['cache-control']).toBe('private, no-cache');
    });

    it('sends an owned game', async () => {
        const response = await app.inject({ url: '/api/gamedata/tr3-la', cookies: remastered });
        expect(response.statusCode).toBe(200);
        expect(response.rawPayload.equals(ARCHIVE)).toBe(true);
    });

    it('answers 404 for unknown games and missing archives', async () => {
        for (const id of ['tr9', 'nope', 'tr2-gm']) {
            const response = await app.inject({ url: `/api/gamedata/${id}`, cookies: remastered });
            expect(response.statusCode, id).toBe(404);
            expect(response.json<ApiError>().error).toBe('not_found');
        }
    });

    it('answers ranges with 206', async () => {
        const cases: Array<[string, number, number]> = [
            ['bytes=0-99', 0, 99],
            ['bytes=900-', 900, 999],
            ['bytes=-10', 990, 999],
            ['bytes=990-5000', 990, 999],
        ];
        for (const [range, start, end] of cases) {
            const response = await app.inject({ url: '/api/gamedata/tr1', cookies: remastered, headers: { range } });
            expect(response.statusCode, range).toBe(206);
            expect(response.headers['content-range']).toBe(`bytes ${start}-${end}/${ARCHIVE.length}`);
            expect(response.headers['content-length']).toBe(String(end - start + 1));
            expect(response.rawPayload.equals(ARCHIVE.subarray(start, end + 1)), range).toBe(true);
        }
    });

    it('answers 416 for a range past the end', async () => {
        const response = await app.inject({ url: '/api/gamedata/tr1', cookies: remastered, headers: { range: 'bytes=1000-' } });
        expect(response.statusCode).toBe(416);
        expect(response.headers['content-range']).toBe(`bytes */${ARCHIVE.length}`);
        expect(response.json<ApiError>().error).toBe('range_not_satisfiable');
        expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    });

    it('sends the whole file for ranges it ignores', async () => {
        for (const range of ['bytes=50-10', 'bytes=0-1,5-6', 'items=0-5', 'bytes=x-y']) {
            const response = await app.inject({ url: '/api/gamedata/tr1-ub', headers: { range } });
            expect(response.statusCode, range).toBe(200);
            expect(response.rawPayload.length).toBe(ARCHIVE.length);
        }
    });

    it('honours If-Range only while the file is unchanged', async () => {
        const first = await app.inject({ url: '/api/gamedata/tr1-ub' });
        const etag = String(first.headers.etag);
        expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
        const same = await app.inject({ url: '/api/gamedata/tr1-ub', headers: { range: 'bytes=10-19', 'if-range': etag } });
        expect(same.statusCode).toBe(206);
        const changed = await app.inject({ url: '/api/gamedata/tr1-ub', headers: { range: 'bytes=10-19', 'if-range': '"other"' } });
        expect(changed.statusCode).toBe(200);
        expect(changed.rawPayload.length).toBe(ARCHIVE.length);
        const byDate = await app.inject({
            url: '/api/gamedata/tr1-ub',
            headers: { range: 'bytes=10-19', 'if-range': String(first.headers['last-modified']) },
        });
        expect(byDate.statusCode).toBe(206);
    });

    it('answers If-None-Match with 304', async () => {
        const first = await app.inject({ url: '/api/gamedata/tr1-ub' });
        const second = await app.inject({ url: '/api/gamedata/tr1-ub', headers: { 'if-none-match': String(first.headers.etag) } });
        expect(second.statusCode).toBe(304);
        expect(second.rawPayload.length).toBe(0);
    });

    it('answers HEAD with the length and no body', async () => {
        const whole = await app.inject({ method: 'HEAD', url: '/api/gamedata/tr1-ub' });
        expect(whole.statusCode).toBe(200);
        expect(whole.headers['content-length']).toBe(String(ARCHIVE.length));
        expect(whole.rawPayload.length).toBe(0);
        const part = await app.inject({ method: 'HEAD', url: '/api/gamedata/tr1-ub', headers: { range: 'bytes=0-99' } });
        expect(part.statusCode).toBe(206);
        expect(part.headers['content-length']).toBe('100');
        const locked = await app.inject({ method: 'HEAD', url: '/api/gamedata/tr1' });
        expect(locked.statusCode).toBe(403);
    });
});

describe('parseRange', () => {
    it('reads single ranges and refuses what lies outside the file', () => {
        expect(parseRange(undefined, 10)).toBeNull();
        expect(parseRange('bytes=0-0', 10)).toEqual({ start: 0, end: 0 });
        expect(parseRange('bytes=-20', 10)).toEqual({ start: 0, end: 9 });
        expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable');
        expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
        expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
        expect(parseRange('bytes=-', 10)).toBeNull();
    });
});

describe('GET /api/me', () => {
    it('lists the free games for a stranger', async () => {
        const response = await app.inject({ url: '/api/me' });
        expect(response.json()).toEqual({
            accounts: [],
            unlocked: ['tr1-ub', 'tr2-gm'],
            providers: { steam: true, mock: false },
        });
        expect(response.headers['cache-control']).toBe('private, no-cache');
    });

    it('says Steam is off without an API key', async () => {
        const noSteam = await makeApp(fixture, { steamApiKey: undefined });
        expect((await noSteam.inject({ url: '/api/me' })).json().providers.steam).toBe(false);
        await noSteam.close();
    });
});

describe('/flyby', () => {
    it('lists only the levels on disk', async () => {
        const response = await app.inject({ url: '/flyby/manifest.json' });
        expect(response.statusCode).toBe(200);
        expect(response.json<FlybyManifest>()).toEqual({
            levels: [{ url: '/flyby/tr3/house.tr2', file: 'house.tr2', name: 'Croft Manor', mod: 'tr3' }],
        });
    });

    it('serves a listed level to anyone, with Range', async () => {
        const whole = await app.inject({ url: '/flyby/tr3/house.tr2' });
        expect(whole.statusCode).toBe(200);
        expect(whole.rawPayload.equals(LEVEL)).toBe(true);
        const part = await app.inject({ url: '/flyby/tr3/house.tr2', headers: { range: 'bytes=0-4' } });
        expect(part.statusCode).toBe(206);
        expect(part.body).toBe('flyby');
    });

    it('serves nothing else', async () => {
        for (const url of ['/flyby/tr2/missing.tr2', '/flyby/tr2/house.tr2', '/flyby/house.tr2', '/flyby/tr3/..%2Fcatalog.json']) {
            expect((await app.inject({ url })).statusCode, url).toBe(404);
        }
    });
});

describe('/engines', () => {
    it('lists the version directories when there is no manifest', async () => {
        const response = await app.inject({ url: '/engines/manifest.json' });
        expect(response.json()).toEqual({ versions: ['1.4.0', '1.5.0', '1.10.0'] });
        expect(response.headers['cross-origin-embedder-policy']).toBe('require-corp');
    });

    it('serves the manifest file when there is one', async () => {
        const other = await makeFixture();
        await writeFile(join(other.enginesDir, 'manifest.json'), '{"versions":["1.5.0"]}');
        const otherApp = await makeApp(other);
        const response = await otherApp.inject({ url: '/engines/manifest.json' });
        expect(response.body).toBe('{"versions":["1.5.0"]}');
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        await otherApp.close();
        await other.cleanup();
    });

    it('serves engine files with Range and the right types', async () => {
        const wasm = await app.inject({ url: '/engines/1.5.0/TRX.wasm' });
        expect(wasm.statusCode).toBe(200);
        expect(wasm.headers['content-type']).toBe('application/wasm');
        expect(wasm.headers['cache-control']).toBe('no-cache');
        const part = await app.inject({ url: '/engines/1.5.0/TRX.wasm', headers: { range: 'bytes=1-3' } });
        expect(part.statusCode).toBe(206);
        expect(part.body).toBe('asm');
        const js = await app.inject({ url: '/engines/1.5.0/trx-engine.js' });
        expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    });

    it('lets the browser keep an engine file at the address of its version', async () => {
        const head = await app.inject({ method: 'HEAD', url: '/engines/1.5.0/TRX.wasm' });
        const version = [head.headers.etag, head.headers['last-modified'], head.headers['content-length']].join('|');
        const kept = await app.inject({ url: `/engines/1.5.0/TRX.wasm?v=${encodeURIComponent(version)}` });
        expect(kept.statusCode).toBe(200);
        expect(kept.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        // An address from before the file changed has to ask again.
        const stale = await app.inject({ url: `/engines/1.5.0/TRX.wasm?v=${encodeURIComponent('"5-1"|Thu, 01 Jan 2026 00:00:00 GMT|5')}` });
        expect(stale.headers['cache-control']).toBe('no-cache');
        expect((await app.inject({ url: '/engines/1.5.0/TRX.wasm?v=unknown' })).headers['cache-control']).toBe('no-cache');
    });

    it('stays inside the engines directory', async () => {
        for (const url of ['/engines/..%2Fcatalog.json', '/engines/%2e%2e/catalog.json', '/engines/1.5.0', '/engines/1.5.0/nope.js']) {
            expect((await app.inject({ url })).statusCode, url).toBe(404);
        }
    });
});
