// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CustomLevelDetails, CustomLevelPage } from '../../shared/api.ts';
import { fakeFetch, json, makeApp, makeFixture, type FakeCall, type Fixture } from './helpers.ts';

const SITE = 'https://trcustoms.test';
const MEDIA = 'https://data.trcustoms.test/media/';
const STORAGE = 'https://storage.test/levels/3718-Some-Level.zip';
const ARCHIVE = Buffer.from(Array.from({ length: 300 }, (_, index) => index % 256));
const COVER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const level = {
    id: 3718,
    name: 'Some Level',
    description: '**Bold** start',
    engine: { id: 5, name: 'TR1' },
    duration: { id: 2, name: 'Medium (1+ hours)' },
    difficulty: null,
    genres: [{ id: 2, name: 'Adventure' }],
    tags: [{ id: 9, name: 'Egypt' }],
    authors: [{ id: 1, username: 'Lara', first_name: '', last_name: '', picture: null }],
    created: '2026-01-01T00:00:00Z',
    release_date: '2026-01-02',
    cover: { id: 1, url: `${MEDIA}level_images/0107b43a-2dfc-4834-b812-77f44e14ad5e.jpg` },
    screenshots: [
        { id: 2, position: 1, file: { id: 3, url: `${MEDIA}level_images/second.jpg` } },
        { id: 4, position: 0, file: { id: 5, url: `${MEDIA}level_images/first.png` } },
        { id: 6, position: 2, file: { id: 7, url: 'https://elsewhere.test/level_images/x.jpg' } },
    ],
    last_updated: '2026-02-01T00:00:00Z',
    last_file: { id: 4242, version: 3, size: ARCHIVE.length, url: `${SITE}/api/level_files/4242/download` },
    download_count: 12,
    review_count: 3,
    walkthrough_count: 1,
    rating_class: { id: 1, name: 'Very positive', position: 4 },
};

let fixture: Fixture;
let app: FastifyInstance;
let calls: FakeCall[];
let storageUp = true;

function rangeOf(header: string | null): Buffer | null {
    const match = /^bytes=(\d+)-$/.exec(header ?? '');
    return match === null ? null : ARCHIVE.subarray(Number(match[1]));
}

beforeAll(async () => {
    fixture = await makeFixture();
    const fake = fakeFetch({
        [`${SITE}/api/levels/`]: ({ url }) =>
            url.searchParams.get('page') === '9'
                ? json({ detail: 'Invalid page.' }, 404)
                : json({ current_page: 1, last_page: 4, total_count: 90, results: [level, { ...level, id: 1, engine: { id: 6, name: 'TEN' }, rating_class: null, last_file: null, cover: null }] }),
        [`${SITE}/api/levels/3718/`]: () => json(level),
        [`${SITE}/api/levels/5/`]: () => json({ detail: 'Not found.' }, 404),
        [`${MEDIA}level_images/0107b43a-2dfc-4834-b812-77f44e14ad5e.jpg`]: () =>
            new Response(COVER, { headers: { 'content-type': 'image/jpeg' } }),
        // TRCustoms answers the slashless link with a 301, then the signed storage link.
        [`${SITE}/api/level_files/4242/download/`]: () => new Response(null, { status: 302, headers: { location: STORAGE } }),
        [`${SITE}/api/level_files/4243/download/`]: () => new Response(null, { status: 302, headers: { location: `${SITE}/404` } }),
        [STORAGE]: ({ headers }) => {
            if (!storageUp) return new Response('down', { status: 503 });
            const part = rangeOf(headers.get('range'));
            if (part === null) {
                return new Response(ARCHIVE, {
                    headers: { 'content-length': String(ARCHIVE.length), 'accept-ranges': 'bytes', 'content-type': 'application/zip', 'x-amz-meta': 'secret' },
                });
            }
            return new Response(part, {
                status: 206,
                headers: {
                    'content-length': String(part.length),
                    'content-range': `bytes ${ARCHIVE.length - part.length}-${ARCHIVE.length - 1}/${ARCHIVE.length}`,
                    'content-type': 'application/zip',
                },
            });
        },
    });
    calls = fake.calls;
    app = await makeApp(fixture, {}, { fetch: fake.fetch });
});

afterAll(async () => {
    await app.close();
    await fixture.cleanup();
});

describe('GET /api/trcustoms/levels', () => {
    it('lists one game’s levels from TRCustoms in the page’s own shape', async () => {
        const response = await app.inject({ url: '/api/trcustoms/levels?game=1&sort=rating&search=%20egypt%20' });
        expect(response.statusCode).toBe(200);
        const page = response.json<CustomLevelPage>();
        expect(page).toMatchObject({ page: 1, pages: 4, total: 90 });
        expect(page.levels[0]).toEqual({
            id: 3718,
            name: 'Some Level',
            game: 1,
            engineName: 'TR1',
            authors: ['Lara'],
            difficulty: null,
            duration: 'Medium (1+ hours)',
            rating: { name: 'Very positive', position: 4 },
            genres: ['Adventure'],
            cover: '/api/trcustoms/media/level_images/0107b43a-2dfc-4834-b812-77f44e14ad5e.jpg',
            releaseDate: '2026-01-02',
            downloads: 12,
            reviews: 3,
            file: { id: 4242, version: 3, sizeBytes: ARCHIVE.length, url: '/api/trcustoms/files/4242' },
        });
        expect(page.levels[1]).toMatchObject({ game: null, rating: null, file: null, cover: null });

        const asked = calls.find((call) => call.url.pathname === '/api/levels/')!.url.searchParams;
        expect(Object.fromEntries(asked)).toEqual({ engines: '5', page: '1', page_size: '24', sort: '-rating', search: 'egypt' });
    });

    it('maps TR2 and TR3 to TRCustoms’ engine ids', async () => {
        await app.inject({ url: '/api/trcustoms/levels?game=2' });
        await app.inject({ url: '/api/trcustoms/levels?game=3' });
        const engines = calls.filter((call) => call.url.pathname === '/api/levels/').map((call) => call.url.searchParams.get('engines'));
        expect(engines).toContain('3');
        expect(engines).toContain('4');
    });

    it('answers an empty page past the end', async () => {
        const response = await app.inject({ url: '/api/trcustoms/levels?game=1&page=9' });
        expect(response.json<CustomLevelPage>()).toEqual({ levels: [], page: 9, pages: 8, total: 0 });
    });

    it('refuses games the converter does not take', async () => {
        expect((await app.inject({ url: '/api/trcustoms/levels?game=4' })).statusCode).toBe(400);
        expect((await app.inject({ url: '/api/trcustoms/levels' })).statusCode).toBe(400);
    });
});

describe('GET /api/trcustoms/levels/:id', () => {
    it('describes a level, with its screenshots in order and only TRCustoms’ own', async () => {
        const response = await app.inject({ url: '/api/trcustoms/levels/3718' });
        expect(response.statusCode).toBe(200);
        const details = response.json<CustomLevelDetails>();
        expect(details).toMatchObject({
            id: 3718,
            description: '**Bold** start',
            tags: ['Egypt'],
            walkthroughs: 1,
            pageUrl: `${SITE}/levels/3718`,
            screenshots: ['/api/trcustoms/media/level_images/first.png', '/api/trcustoms/media/level_images/second.jpg'],
        });
    });

    it('passes on a level TRCustoms does not have', async () => {
        expect((await app.inject({ url: '/api/trcustoms/levels/5' })).statusCode).toBe(404);
        expect((await app.inject({ url: '/api/trcustoms/levels/abc' })).statusCode).toBe(404);
    });
});

describe('GET /api/trcustoms/media/*', () => {
    it('sends TRCustoms’ images as this server’s own, cached for good', async () => {
        const response = await app.inject({ url: '/api/trcustoms/media/level_images/0107b43a-2dfc-4834-b812-77f44e14ad5e.jpg' });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('image/jpeg');
        expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
        expect(response.headers['cache-control']).toContain('immutable');
        expect(response.rawPayload.equals(COVER)).toBe(true);

        const before = calls.length;
        await app.inject({ url: '/api/trcustoms/media/level_images/0107b43a-2dfc-4834-b812-77f44e14ad5e.jpg' });
        expect(calls.length).toBe(before);
    });

    it('fetches nothing but level images', async () => {
        for (const path of ['../secret.jpg', 'user_pictures/a.jpg', 'level_images/a.exe', 'level_images/a/b.jpg']) {
            const response = await app.inject({ url: `/api/trcustoms/media/${path}` });
            expect(response.statusCode, path).toBe(404);
        }
    });
});

describe('GET /api/trcustoms/files/:id', () => {
    it('streams the archive from the storage TRCustoms points to', async () => {
        const response = await app.inject({ url: '/api/trcustoms/files/4242' });
        expect(response.statusCode).toBe(200);
        expect(response.rawPayload.equals(ARCHIVE)).toBe(true);
        expect(response.headers['content-length']).toBe(String(ARCHIVE.length));
        expect(response.headers['accept-ranges']).toBe('bytes');
        expect(response.headers['x-amz-meta']).toBeUndefined();
        expect(response.headers['cache-control']).toBe('private, no-store');
    });

    it('resumes with a Range request', async () => {
        const response = await app.inject({ url: '/api/trcustoms/files/4242', headers: { range: 'bytes=100-' } });
        expect(response.statusCode).toBe(206);
        expect(response.headers['content-range']).toBe(`bytes 100-299/${ARCHIVE.length}`);
        expect(response.rawPayload.equals(ARCHIVE.subarray(100))).toBe(true);
        const storage = calls.filter((call) => call.url.href === STORAGE).at(-1)!;
        expect(storage.headers.get('range')).toBe('bytes=100-');
    });

    it('answers 404 where TRCustoms leads to its 404 page', async () => {
        expect((await app.inject({ url: '/api/trcustoms/files/4243' })).statusCode).toBe(404);
        expect((await app.inject({ url: '/api/trcustoms/files/x' })).statusCode).toBe(404);
    });

    it('answers 502 when the storage fails, so the page tries again', async () => {
        storageUp = false;
        try {
            expect((await app.inject({ url: '/api/trcustoms/files/4242' })).statusCode).toBe(502);
        } finally {
            storageUp = true;
        }
    });
});
