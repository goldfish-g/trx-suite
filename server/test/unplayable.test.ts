// @vitest-environment node
// Levels players report TRX cannot play: the server checks each with the
// converter before the lists mark it, and checks again with a new converter.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CustomLevelDetails, CustomLevelPage } from '../../shared/api.ts';
import type { Checker, CheckVerdict } from '../src/unplayable.ts';
import { fakeFetch, json, makeApp, makeFixture, type Fixture } from './helpers.ts';

const SITE = 'https://trcustoms.test';
const REASON = 'TRX cannot play this level: it is a mod of Tomb Raider I-III Remastered.';

function level(id: number, fileId: number, engine = { id: 4, name: 'TR3' }) {
    return {
        id,
        name: `Level ${id}`,
        engine,
        authors: [],
        last_file: { id: fileId, version: 1, size: 20, url: `${SITE}/api/level_files/${fileId}/download` },
        download_count: 1,
        review_count: 0,
    };
}

const LEVELS = [level(3972, 4806), level(3718, 4242), level(1, 11, { id: 6, name: 'TEN' }), ...Array.from({ length: 12 }, (_, i) => level(100 + i, 900 + i))];

let fixture: Fixture;
let apps: FastifyInstance[] = [];
let downloads: number[] = [];

/** TRCustoms with these levels; each file's bytes name its level. */
function trcustoms() {
    const routes: Parameters<typeof fakeFetch>[0] = {
        [`${SITE}/api/levels/`]: () => json({ current_page: 1, last_page: 1, total_count: LEVELS.length, results: LEVELS }),
    };
    for (const entry of LEVELS) {
        routes[`${SITE}/api/levels/${entry.id}/`] = () => json(entry);
        routes[`${SITE}/api/level_files/${entry.last_file.id}/download/`] = () =>
            new Response(null, { status: 302, headers: { location: `https://storage.test/${entry.last_file.id}.zip` } });
        routes[`https://storage.test/${entry.last_file.id}.zip`] = () => {
            downloads.push(entry.last_file.id);
            return new Response(`archive of level ${entry.id}`);
        };
    }
    return fakeFetch(routes).fetch;
}

/** A converter that finds level 3972 unplayable, as the real one does Outbreak. */
function fakeChecker(version: string, verdictFor: (archive: string) => CheckVerdict | Promise<CheckVerdict> = (text) => (text.includes('3972') ? { verdict: 'unplayable', reason: REASON } : { verdict: 'playable' })) {
    const checked: string[] = [];
    const checker: Checker = {
        version,
        async check(archive) {
            const text = await readFile(archive, 'utf8');
            checked.push(text);
            return verdictFor(text);
        },
    };
    return { checker, checked };
}

async function start(checker: Checker | null): Promise<FastifyInstance> {
    const app = await makeApp(fixture, { stats: false }, { fetch: trcustoms(), checker });
    await app.ready();
    apps.push(app);
    return app;
}

const report = (app: FastifyInstance, id: number, fileId: unknown, remoteAddress = '127.0.0.1') =>
    app.inject({ method: 'POST', url: `/api/trcustoms/levels/${id}/unplayable`, payload: { fileId }, remoteAddress });

async function listed(app: FastifyInstance, id: number) {
    const page = (await app.inject({ url: '/api/trcustoms/levels?game=3' })).json<CustomLevelPage>();
    return page.levels.find((entry) => entry.id === id)!;
}

beforeEach(async () => {
    fixture = await makeFixture();
    downloads = [];
});

afterEach(async () => {
    for (const app of apps) await app.close();
    apps = [];
    await fixture.cleanup();
});

describe('reports of unplayable levels', () => {
    it('marks a level only once the server’s own converter finds it unplayable', async () => {
        const { checker, checked } = fakeChecker('conv-1');
        const app = await start(checker);
        expect((await listed(app, 3972)).unplayable).toBeUndefined();

        expect((await report(app, 3972, 4806)).statusCode).toBe(202);
        await vi.waitFor(async () => expect((await listed(app, 3972)).unplayable).toBe(REASON));
        expect(checked).toEqual(['archive of level 3972']);
        const details = (await app.inject({ url: '/api/trcustoms/levels/3972' })).json<CustomLevelDetails>();
        expect(details.unplayable).toBe(REASON);
        expect((await listed(app, 3718)).unplayable).toBeUndefined();
        // The archive goes once it is checked.
        expect(await readdir(join(fixture.root, 'unplayable', 'downloads'))).toEqual([]);

        // Known now: no second download.
        await report(app, 3972, 4806);
        expect(downloads).toEqual([4806]);
    });

    it('marks nothing a report alone claims', async () => {
        const { checker, checked } = fakeChecker('conv-1');
        const app = await start(checker);
        await report(app, 3718, 4242);
        await vi.waitFor(() => expect(checked).toHaveLength(1));
        expect((await listed(app, 3718)).unplayable).toBeUndefined();
        // Checked playable with this converter: not checked again.
        await report(app, 3718, 4242);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(downloads).toEqual([4242]);
    });

    it('passes over files TRCustoms does not offer now, levels of other engines, and bad requests', async () => {
        const { checker } = fakeChecker('conv-1');
        const app = await start(checker);
        expect((await report(app, 3972, 4805)).statusCode).toBe(202);
        expect((await report(app, 1, 11)).statusCode).toBe(202);
        expect((await report(app, 3972, 'x')).statusCode).toBe(400);
        expect((await report(app, 3972, -1)).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url: '/api/trcustoms/levels/abc/unplayable', payload: { fileId: 1 } })).statusCode).toBe(404);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(downloads).toEqual([]);
    });

    it('takes ten reports a day from one address', async () => {
        const { checker } = fakeChecker('conv-1');
        const app = await start(checker);
        for (let i = 0; i < 12; i++) await report(app, 100 + i, 900 + i, '10.0.0.1');
        await report(app, 3972, 4806, '10.0.0.2');
        await vi.waitFor(() => expect(downloads).toHaveLength(11));
        expect(downloads).not.toContain(910);
        expect(downloads).toContain(4806);
    });

    it('checks again with a new converter, keeping the mark until it says otherwise', async () => {
        const first = await start(fakeChecker('conv-1').checker);
        await report(first, 3972, 4806);
        await vi.waitFor(async () => expect((await listed(first, 3972)).unplayable).toBe(REASON));
        await first.close();

        // A converter that now plays it, held back to look at the list meanwhile.
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        const second = await start(fakeChecker('conv-2', async () => (await held, { verdict: 'playable' })).checker);
        await vi.waitFor(() => expect(downloads).toEqual([4806, 4806]));
        expect((await listed(second, 3972)).unplayable).toBe(REASON);
        release();
        await vi.waitFor(async () => expect((await listed(second, 3972)).unplayable).toBeUndefined());
        const saved = JSON.parse(await readFile(join(fixture.root, 'unplayable', 'checks.json'), 'utf8'));
        expect(saved).toEqual([expect.objectContaining({ levelId: 3972, fileId: 4806, converter: 'conv-2', verdict: 'playable' })]);
    });

    it('records a conversion that fails otherwise, without marking the level', async () => {
        const app = await start(fakeChecker('conv-1', () => ({ verdict: 'error', message: 'out of memory' })).checker);
        await report(app, 3972, 4806);
        await vi.waitFor(() => expect(downloads).toEqual([4806]));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect((await listed(app, 3972)).unplayable).toBeUndefined();
        await report(app, 3972, 4806);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(downloads).toEqual([4806]);
    });

    it('stops a check under way when the server shuts down, keeping no verdict', async () => {
        let aborted = false;
        const checker: Checker = {
            version: 'conv-1',
            check: (_archive, _title, _modId, signal) =>
                new Promise((resolve) =>
                    signal?.addEventListener('abort', () => {
                        aborted = true;
                        resolve({ verdict: 'error', message: 'killed' });
                    }),
                ),
        };
        const app = await start(checker);
        await report(app, 3972, 4806);
        await vi.waitFor(() => expect(downloads).toEqual([4806]));
        await app.close();
        expect(aborted).toBe(true);
        await expect(readFile(join(fixture.root, 'unplayable', 'checks.json'), 'utf8')).rejects.toThrow();
    });

    it('passes reports over when there is no checker', async () => {
        const app = await start(null);
        expect((await report(app, 3972, 4806)).statusCode).toBe(202);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(downloads).toEqual([]);
        expect((await listed(app, 3972)).unplayable).toBeUndefined();
    });
});
