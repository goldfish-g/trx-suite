// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError } from '../../shared/api.ts';
import type { CloudIndex, CloudLevel, CloudProfile, CloudSaves, PutLevelRequest, PutProfileRequest, SavesConflict } from '../../shared/cloud.ts';
import { STEAM } from '../../shared/games.ts';
import { account, makeApp, makeFixture, sessionCookies, type Fixture } from './helpers.ts';

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

const lara = sessionCookies([account('steam', [STEAM.tr1])]);
const winston = sessionCookies([account('steam', [], { id: '76561198000000002', name: 'Winston' })]);

function hashOf(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function profile(id: string, extra: Partial<PutProfileRequest> = {}): PutProfileRequest {
    return {
        id,
        name: 'Tomb Raider',
        title: 'tr1',
        mod: 'tr1',
        engine: 1,
        engineVersion: '1.5.0',
        createdAt: '2026-11-01T10:00:00.000Z',
        lastPlayedAt: null,
        updatedAt: '2026-11-01T10:00:00.000Z',
        ...extra,
    };
}

async function putFile(cookies: Record<string, string>, bytes: Buffer) {
    return app.inject({
        method: 'PUT',
        url: `/api/cloud/files/${hashOf(bytes)}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: bytes,
        cookies,
    });
}

async function index(cookies: Record<string, string>): Promise<CloudIndex> {
    const response = await app.inject({ url: '/api/cloud', cookies });
    expect(response.statusCode).toBe(200);
    return response.json<CloudIndex>();
}

describe('the cloud', () => {
    it('is only for players signed in with Steam', async () => {
        const response = await app.inject({ url: '/api/cloud' });
        expect(response.statusCode).toBe(401);
        expect(response.json<ApiError>().error).toBe('signed_out');
    });

    it('starts empty', async () => {
        const empty = await index(winston);
        expect(empty).toMatchObject({ account: { provider: 'steam', id: '76561198000000002' }, profiles: [], levels: [], usage: { bytes: 0 } });
    });

    it('keeps profiles and merges what two devices say of one', async () => {
        const id = '11111111-1111-4111-8111-111111111111';
        const first = await app.inject({ method: 'PUT', url: `/api/cloud/profiles/${id}`, payload: profile(id), cookies: lara });
        expect(first.statusCode).toBe(200);
        expect(first.json<CloudProfile>()).toMatchObject({ id, name: 'Tomb Raider', saves: {} });

        // An older name loses; the latest play wins.
        const second = await app.inject({
            method: 'PUT',
            url: `/api/cloud/profiles/${id}`,
            payload: profile(id, { name: 'Old name', updatedAt: '2026-10-01T00:00:00.000Z', lastPlayedAt: '2026-11-05T00:00:00.000Z' }),
            cookies: lara,
        });
        expect(second.json<CloudProfile>()).toMatchObject({ name: 'Tomb Raider', lastPlayedAt: '2026-11-05T00:00:00.000Z' });
        const third = await app.inject({
            method: 'PUT',
            url: `/api/cloud/profiles/${id}`,
            payload: profile(id, { name: 'Lara', updatedAt: '2026-11-06T00:00:00.000Z' }),
            cookies: lara,
        });
        expect(third.json<CloudProfile>()).toMatchObject({ name: 'Lara', lastPlayedAt: '2026-11-05T00:00:00.000Z' });

        // Another account sees none of it.
        expect((await index(winston)).profiles).toEqual([]);
    });

    it('checks what it is given', async () => {
        const id = '22222222-2222-4222-8222-222222222222';
        for (const payload of [profile(id, { title: '../etc' }), profile(id, { engine: 7 as 1 }), profile(id, { name: '' }), profile('someone-else')]) {
            const response = await app.inject({ method: 'PUT', url: `/api/cloud/profiles/${id}`, payload, cookies: lara });
            expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        }
        const badId = await app.inject({ method: 'PUT', url: '/api/cloud/profiles/a%2Fb', payload: profile('a/b'), cookies: lara });
        expect(badId.statusCode).toBe(400);
    });

    it('keeps save files by revision and refuses changes built on old ones', async () => {
        const id = '33333333-3333-4333-8333-333333333333';
        await app.inject({ method: 'PUT', url: `/api/cloud/profiles/${id}`, payload: profile(id), cookies: lara });

        const save = Buffer.from('a save of Lost Valley');
        const hash = hashOf(save);
        // A list may only name files the cloud has.
        const early = await app.inject({
            method: 'PUT',
            url: `/api/cloud/saves/${id}/tr1`,
            payload: { baseRev: 0, files: { 'saves/tr1/save_tr1_00.dat': { hash, size: save.length, mtime: 1000 } } },
            cookies: lara,
        });
        expect(early.statusCode).toBe(400);
        expect(early.json<ApiError>().error).toBe('missing_file');

        expect((await putFile(lara, save)).statusCode).toBe(204);
        // A file must match its hash.
        const wrong = await app.inject({
            method: 'PUT',
            url: `/api/cloud/files/${hash}`,
            headers: { 'content-type': 'application/octet-stream' },
            payload: Buffer.from('something else'),
            cookies: lara,
        });
        expect(wrong.statusCode).toBe(400);

        const put = await app.inject({
            method: 'PUT',
            url: `/api/cloud/saves/${id}/tr1`,
            payload: { baseRev: 0, files: { 'saves/tr1/save_tr1_00.dat': { hash, size: 1, mtime: 1000 } } },
            cookies: lara,
        });
        expect(put.statusCode).toBe(200);
        expect(put.json<CloudSaves>()).toMatchObject({ rev: 1, files: { 'saves/tr1/save_tr1_00.dat': { hash, size: save.length, mtime: 1000 } } });

        // A second device that had not seen revision 1 is told so.
        const stale = await app.inject({
            method: 'PUT',
            url: `/api/cloud/saves/${id}/tr1`,
            payload: { baseRev: 0, files: {} },
            cookies: lara,
        });
        expect(stale.statusCode).toBe(409);
        expect(stale.json<SavesConflict>().saves.rev).toBe(1);

        // Paths stay inside saves/.
        for (const path of ['cfg/TR1X.json5', 'saves/../x', 'saves/tr1/../../x', 'saves/a/b/c/d/e', 'saves', 'saves/tr1/', '../saves/x']) {
            const response = await app.inject({
                method: 'PUT',
                url: `/api/cloud/saves/${id}/tr1`,
                payload: { baseRev: 1, files: { [path]: { hash, size: 1, mtime: 1 } } },
                cookies: lara,
            });
            expect(response.statusCode, path).toBe(400);
        }

        const read = await app.inject({ url: `/api/cloud/files/${hash}`, cookies: lara });
        expect(read.statusCode).toBe(200);
        expect(read.rawPayload.equals(save)).toBe(true);
        expect(read.headers['cache-control']).toContain('private');
        // Files belong to their account.
        expect((await app.inject({ url: `/api/cloud/files/${hash}`, cookies: winston })).statusCode).toBe(404);

        const listed = (await index(lara)).profiles.find((candidate) => candidate.id === id);
        expect(listed?.saves.tr1?.rev).toBe(1);
        expect((await index(lara)).usage.bytes).toBe(save.length);
    });

    it('keeps an account within its quota', async () => {
        const big = Buffer.alloc(700 * 1024, 1);
        expect((await putFile(winston, big)).statusCode).toBe(204);
        const more = await putFile(winston, Buffer.alloc(700 * 1024, 2));
        expect(more.statusCode).toBe(413);
        expect(more.json<ApiError>().error).toBe('cloud_full');
    });

    it('lists custom levels and takes one out with its profiles', async () => {
        const level: PutLevelRequest = {
            mod: 'custom-the-cave-1234',
            name: 'The Cave',
            engine: 2,
            layout: 'custom',
            source: { kind: 'trcustoms', levelId: 1234, fileId: 99, version: 2, sizeBytes: 5000 },
            summary: {
                id: 1234,
                name: 'The Cave',
                game: 2,
                engineName: 'TR2',
                authors: ['Someone'],
                difficulty: 'Easy',
                duration: 'Short',
                rating: { name: 'Positive', position: 2 },
                genres: ['Cave'],
                cover: 'https://evil.example/x.png',
                releaseDate: '2026-01-01',
                downloads: 5,
                reviews: 1,
                file: { id: 99, version: 2, sizeBytes: 5000, url: 'https://evil.example/file' },
            },
        };
        const put = await app.inject({ method: 'PUT', url: `/api/cloud/levels/${level.mod}`, payload: level, cookies: lara });
        expect(put.statusCode).toBe(200);
        const kept = put.json<CloudLevel>();
        // Only images and files through this server.
        expect(kept.summary?.cover).toBeNull();
        expect(kept.summary?.file?.url).toBe('/api/trcustoms/files/99');

        const id = '44444444-4444-4444-8444-444444444444';
        await app.inject({
            method: 'PUT',
            url: `/api/cloud/profiles/${id}`,
            payload: profile(id, { title: level.mod, mod: level.mod, engine: 2, name: 'The Cave' }),
            cookies: lara,
        });

        const removed = await app.inject({ method: 'DELETE', url: `/api/cloud/titles/${level.mod}`, cookies: lara });
        expect(removed.statusCode).toBe(200);
        const after = removed.json<CloudIndex>();
        expect(after.levels.map((entry) => entry.mod)).not.toContain(level.mod);
        expect(after.profiles.map((entry) => entry.id)).not.toContain(id);
        expect(after.removedLevels[level.mod]).toBeDefined();
        expect(after.removedProfiles[id]).toBeDefined();

        // A device that still has them does not put them back by itself...
        const again = await app.inject({ method: 'PUT', url: `/api/cloud/levels/${level.mod}`, payload: level, cookies: lara });
        expect(again.statusCode).toBe(410);
        const profileAgain = await app.inject({ method: 'PUT', url: `/api/cloud/profiles/${id}`, payload: profile(id), cookies: lara });
        expect(profileAgain.statusCode).toBe(410);
        // ...but adding the level again does.
        const restored = await app.inject({ method: 'PUT', url: `/api/cloud/levels/${level.mod}`, payload: { ...level, restore: true }, cookies: lara });
        expect(restored.statusCode).toBe(200);
        expect((await index(lara)).removedLevels[level.mod]).toBeUndefined();
    });

    it('deletes a profile with its saves, and clears files nothing uses', async () => {
        const id = '55555555-5555-4555-8555-555555555555';
        await app.inject({ method: 'PUT', url: `/api/cloud/profiles/${id}`, payload: profile(id), cookies: winston });
        const deleted = await app.inject({ method: 'DELETE', url: `/api/cloud/profiles/${id}`, cookies: winston });
        expect(deleted.statusCode).toBe(200);
        expect(deleted.json<CloudIndex>().removedProfiles[id]).toBeDefined();
        expect(deleted.json<CloudIndex>().profiles).toEqual([]);
    });

    it('keeps the latest theme a device picked', async () => {
        const put = (value: string, updatedAt: string) =>
            app.inject({ method: 'PUT', url: '/api/cloud/settings', payload: { theme: { value, updatedAt } }, cookies: lara });
        expect((await put('tr2', '2026-11-07T10:00:00.000Z')).json()).toEqual({ theme: { value: 'tr2', updatedAt: '2026-11-07T10:00:00.000Z' } });
        // An older pick, from a device that had not heard of the newer one, loses.
        expect((await put('tr3', '2026-11-06T10:00:00.000Z')).json()).toEqual({ theme: { value: 'tr2', updatedAt: '2026-11-07T10:00:00.000Z' } });
        expect((await put('tr3', '2026-11-08T10:00:00.000Z')).json()).toMatchObject({ theme: { value: 'tr3' } });
        expect((await index(lara)).settings.theme?.value).toBe('tr3');
        expect((await put('tr9', '2026-11-09T10:00:00.000Z')).statusCode).toBe(400);
        expect((await index(winston)).settings).toEqual({});
    });

    it('refuses other sites', async () => {
        const response = await app.inject({
            method: 'DELETE',
            url: '/api/cloud/titles/tr1',
            headers: { 'sec-fetch-site': 'cross-site' },
            cookies: lara,
        });
        expect(response.statusCode).toBe(403);
    });
});
