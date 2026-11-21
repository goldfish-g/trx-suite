// @vitest-environment node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { STEAM } from '../../shared/games.ts';
import type { StatsEvent, StatsResponse } from '../../shared/stats.ts';
import { readStatsEvent } from '../../shared/stats.ts';
import { botProbeOf, browserOf, referrerOf, systemOf } from '../src/stats/agent.ts';
import { countryOf, MaxMindDb } from '../src/stats/geo.ts';
import { account, fakeFetch, json, makeApp, makeFixture, sessionCookies, type Fixture } from './helpers.ts';

const SITE = 'https://trcustoms.test';
const CHROME_ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const FIREFOX_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const STATS_PAGE = '<!doctype html><title>Stats</title>';

let fixture: Fixture;
let app: FastifyInstance;
let clock = Date.parse('2026-11-21T12:00:00Z');
const now = () => clock;

beforeAll(async () => {
    fixture = await makeFixture();
    await mkdir(join(fixture.staticDir, 'stats'), { recursive: true });
    await writeFile(join(fixture.staticDir, 'stats', 'index.html'), STATS_PAGE);
    const fake = fakeFetch({
        [`${SITE}/api/levels/3718/`]: () =>
            json({ id: 3718, name: 'The Hidden Palace', authors: [{ username: 'Builder' }], engine: { id: 3, name: 'TR2' } }),
    });
    app = await makeApp(fixture, {}, { fetch: fake.fetch, now });
});
afterAll(async () => {
    await app.close();
    await fixture.cleanup();
});

function send(events: unknown[], options: { address?: string; agent?: string; cookies?: Record<string, string>; site?: string } = {}) {
    return app.inject({
        method: 'POST',
        url: '/api/stats/events',
        payload: { events },
        headers: {
            'x-forwarded-for': options.address ?? '203.0.113.7',
            'user-agent': options.agent ?? CHROME_ANDROID,
            ...(options.site === undefined ? {} : { 'sec-fetch-site': options.site }),
        },
        cookies: options.cookies ?? {},
    });
}

async function summary(range = 'all'): Promise<StatsResponse> {
    // Past the summary's minute in the cache.
    clock += 61_000;
    const response = await app.inject({ url: `/api/stats?range=${range}` });
    expect(response.statusCode).toBe(200);
    return response.json<StatsResponse>();
}

const open = (extra: Partial<StatsEvent> = {}): StatsEvent =>
    ({ type: 'open', at: clock, screen: 'phone', display: 'app', look: 'tr2', lang: 'pt', ...extra }) as StatsEvent;

describe('reading events', () => {
    it('keeps what it knows and drops the rest', () => {
        const at = clock;
        expect(readStatsEvent({ type: 'open', at, screen: 'phone', display: 'tab', look: 'tr1', lang: 'PT', referrer: 'WWW.Reddit.com', extra: 1 }, at)).toEqual({
            type: 'open',
            at,
            screen: 'phone',
            display: 'tab',
            look: 'tr1',
            lang: 'pt',
            referrer: 'www.reddit.com',
        });
        expect(readStatsEvent({ type: 'open', at, screen: 'phone', display: 'tab', look: 'tr1', lang: 'not a language', referrer: 'javascript:alert(1)' }, at)).toEqual({
            type: 'open',
            at,
            screen: 'phone',
            display: 'tab',
            look: 'tr1',
        });
        expect(readStatsEvent({ type: 'open', at, screen: 'tv', display: 'tab', look: 'tr1' }, at)).toBeNull();
        expect(readStatsEvent({ type: 'install', at, what: 'game', game: 'tr9' }, at)).toBeNull();
        expect(readStatsEvent({ type: 'install', at, what: 'trcustoms', level: 3718 }, at)).toEqual({ type: 'install', at, what: 'trcustoms', level: 3718 });
        // Too far back, or from the future.
        expect(readStatsEvent({ type: 'appinstalled', at: at - 31 * 86_400_000 }, at)).toBeNull();
        expect(readStatsEvent({ type: 'appinstalled', at: at + 3_600_000 }, at)).toBeNull();
        // A session's minutes are whole and few.
        const play = { type: 'play', at, session: 'abcdefgh12', game: 'tr1', minutes: 1, total: 5, weekday: 2, hour: 21 };
        expect(readStatsEvent(play, at)).toEqual(play);
        expect(readStatsEvent({ ...play, minutes: 0.5 }, at)).toBeNull();
        expect(readStatsEvent({ ...play, minutes: 1000 }, at)).toBeNull();
        expect(readStatsEvent({ ...play, game: 'custom', level: 3718 }, at)).toEqual({ ...play, game: 'custom', level: 3718 });
        expect(readStatsEvent({ ...play, level: 3718 }, at)).toEqual(play);
        // Lara cannot hit more than she fired.
        const lara = { type: 'lara', at, game: 'tr1', deaths: 3, secrets: 1, kills: 4, pickups: 6, distance: 812, ammoUsed: 10, ammoHits: 7, medipacks: 1.5, levels: 1 };
        expect(readStatsEvent(lara, at)).toEqual(lara);
        expect(readStatsEvent({ ...lara, ammoHits: 11 }, at)).toBeNull();
        expect(readStatsEvent({ ...lara, deaths: -1 }, at)).toBeNull();
    });

    it('tells browsers, systems, sites and bots apart', () => {
        expect([browserOf(CHROME_ANDROID), systemOf(CHROME_ANDROID)]).toEqual(['Chrome', 'Android']);
        expect([browserOf(FIREFOX_WINDOWS), systemOf(FIREFOX_WINDOWS)]).toEqual(['Firefox', 'Windows']);
        const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
        expect([browserOf(safari), systemOf(safari)]).toEqual(['Safari', 'iOS']);
        const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
        expect(browserOf(edge)).toBe('Edge');
        expect(referrerOf('old.reddit.com')).toBe('Reddit');
        expect(referrerOf('trcustoms.org')).toBe('TRCustoms');
        expect(referrerOf('www.google.co.uk')).toBe('Google');
        expect(referrerOf('buy-cheap-pills.example')).toBe('Other sites');
        expect(botProbeOf('/wp-admin/setup-config.php')).toBe('WordPress');
        expect(botProbeOf('/.env')).toBe('Secrets and settings');
        expect(botProbeOf('/@fs/etc/passwd')).toBe('Developer servers');
        expect(botProbeOf('/play/abc')).toBeNull();
        expect(botProbeOf('/')).toBeNull();
    });
});

describe('the country database', () => {
    it('finds the record of an address', () => {
        const db = new MaxMindDb(tinyDatabase());
        expect(countryOf(db.lookup('1.2.3.4'))).toBe('AU');
        expect(countryOf(db.lookup('2.2.3.4'))).toBeNull();
        expect(countryOf(db.lookup('::ffff:1.9.9.9'))).toBe('AU');
        expect(db.lookup('not an address')).toBeNull();
        expect(db.buildEpoch).toBe(1_700_000_000);
    });
});

describe('POST /api/stats/events', () => {
    it('counts a visitor once a day, however often they open the app', async () => {
        const before = await summary();
        expect((await send([open(), open()])).statusCode).toBe(204);
        expect((await send([open({ display: 'tab' } as Partial<StatsEvent>)])).statusCode).toBe(204);
        expect((await send([open({ screen: 'desktop', look: 'tr1' } as Partial<StatsEvent>)], { address: '198.51.100.9', agent: FIREFOX_WINDOWS })).statusCode).toBe(204);
        const after = await summary();
        expect(after.totals.visits - before.totals.visits).toBe(4);
        expect(after.totals.visitors - before.totals.visitors).toBe(2);
        // No country database in the tests.
        expect(after.countries).toContainEqual({ key: 'unknown', n: after.totals.visitors });
        expect(after.devices.screen).toEqual(expect.arrayContaining([{ key: 'phone', n: 1 }, { key: 'desktop', n: 1 }]));
        expect(after.devices.browser).toEqual(expect.arrayContaining([{ key: 'Chrome', n: 1 }, { key: 'Firefox', n: 1 }]));
        expect(after.devices.lang).toContainEqual({ key: 'pt', n: 2 });

        // The next day, they count again.
        clock += 86_400_000;
        await send([open()]);
        const nextDay = await summary();
        expect(nextDay.totals.visitors - after.totals.visitors).toBe(1);
        expect(nextDay.daily.at(-1)).toMatchObject({ visits: 1, visitors: 1 });
    });

    it('counts one person per address, and each browser there as a device', async () => {
        const before = await summary();
        await send([open()], { address: '203.0.113.99' });
        await send([open({ screen: 'desktop' } as Partial<StatsEvent>)], { address: '203.0.113.99', agent: FIREFOX_WINDOWS });
        const after = await summary();
        expect(after.totals.visits - before.totals.visits).toBe(2);
        expect(after.totals.visitors - before.totals.visitors).toBe(1);
        const browsers = (stats: StatsResponse, key: string) => stats.devices.browser.find((entry) => entry.key === key)?.n ?? 0;
        expect(browsers(after, 'Chrome') - browsers(before, 'Chrome')).toBe(1);
        expect(browsers(after, 'Firefox') - browsers(before, 'Firefox')).toBe(1);
    });

    it('turns away what is not a list of events, and other sites', async () => {
        expect((await app.inject({ method: 'POST', url: '/api/stats/events', payload: { events: 'no' } })).statusCode).toBe(400);
        expect((await send(Array.from({ length: 51 }, () => open()))).statusCode).toBe(400);
        expect((await send([open()], { site: 'cross-site' })).statusCode).toBe(403);
        // Events it cannot read are left out; the rest count.
        const before = await summary();
        expect((await send([{ type: 'nonsense' }, open()], { address: '192.0.2.50' })).statusCode).toBe(204);
        expect((await summary()).totals.visits - before.totals.visits).toBe(1);
    });

    it('counts minutes, sessions, the longest session, and who is playing now', async () => {
        const before = await summary();
        const play = (session: string, total: number, extra: object = {}) => ({
            type: 'play',
            at: clock,
            session,
            game: 'tr2',
            minutes: 1,
            total,
            weekday: 4,
            hour: 21,
            ...extra,
        });
        await send([play('session-one', 1), play('session-one', 2), play('session-one', 3)]);
        await send([play('session-two', 1, { game: 'custom', level: 3718 }), play('session-two', 600, { game: 'custom', level: 3718, minutes: 5 })]);
        const after = await summary();
        expect(after.totals.minutesPlayed - before.totals.minutesPlayed).toBe(9);
        expect(after.totals.plays - before.totals.plays).toBe(2);
        expect(after.totals.playingNow).toBe(2);
        expect(after.games.find((game) => game.game === 'tr2')).toMatchObject({ minutes: 3, plays: 1 });
        expect(after.hours[4 * 24 + 21]).toBe(9);
        expect(after.longestSession).toEqual({ minutes: 600, game: 'custom', day: expect.any(String) });
        expect(after.levels[0]).toMatchObject({ id: 3718, name: 'The Hidden Palace', authors: ['Builder'], game: 2, minutes: 6 });

        // A few minutes without a word, and they are not playing any more.
        clock += 4 * 60_000;
        expect((await summary()).totals.playingNow).toBe(0);
    });

    it('counts installs, by game and by TRCustoms level', async () => {
        await send([
            { type: 'install', at: clock, what: 'game', game: 'tr1' },
            { type: 'install', at: clock, what: 'trcustoms', level: 3718 },
            { type: 'install', at: clock, what: 'trcustoms', level: 3718 },
            { type: 'install', at: clock, what: 'file' },
            { type: 'appinstalled', at: clock },
        ]);
        const after = await summary('7');
        expect(after.totals).toMatchObject({ gameInstalls: 1, levelInstalls: 2, fileInstalls: 1, appInstalls: 1 });
        expect(after.levels[0]).toMatchObject({ id: 3718, installs: 2 });
        expect(after.games.find((game) => game.game === 'custom')?.installs).toBe(3);
    });

    it('lists the 20 most installed levels', async () => {
        await send(Array.from({ length: 25 }, (_, index) => ({ type: 'install', at: clock, what: 'trcustoms', level: 9000 + index })), { address: '192.0.2.77' });
        const after = await summary('7');
        expect(after.levels).toHaveLength(20);
        // Unknown to TRCustoms: named by number.
        expect(after.levels.find((level) => level.id === 9000)?.name).toBe('TRCustoms level 9000');
    });

    it("adds up what Lara did, half medipacks and all", async () => {
        const lara = { type: 'lara', at: clock, game: 'tr1', deaths: 2, secrets: 1, kills: 5, pickups: 3, distance: 400, ammoUsed: 20, ammoHits: 12, medipacks: 0.5, levels: 1 };
        await send([lara, { ...lara, medipacks: 1 }]);
        const after = await summary('7');
        expect(after.lara).toMatchObject({ deaths: 4, secrets: 2, kills: 10, medipacks: 1.5, levels: 2, ammoUsed: 40, ammoHits: 24 });
        expect(after.games.find((game) => game.game === 'tr1')?.deaths).toBe(4);
    });

    it('counts signed-in players by Steam account, and those who come back', async () => {
        const lara = account('steam', [STEAM.tr1, STEAM.remasteredI_III]);
        const winston = account('steam', [], { id: '76561198000000002', privateProfile: true });
        await send([open()], { cookies: sessionCookies([lara]), address: '192.0.2.1' });
        await send([open()], { cookies: sessionCookies([winston]), address: '192.0.2.2' });
        clock += 86_400_000;
        await send([open()], { cookies: sessionCookies([lara]), address: '192.0.2.1' });
        const after = await summary();
        expect(after.totals).toMatchObject({ players: 2, returningPlayers: 1 });
        expect(after.steam.owned).toEqual(expect.arrayContaining([{ key: 'tr1', n: 1 }, { key: 'remasteredI_III', n: 1 }]));
        expect(after.steam.private).toBe(1);
    });
});

describe('what the server sees for itself', () => {
    it('counts bots looking for holes, and bytes sent', async () => {
        const before = await summary('7');
        await app.inject({ url: '/wp-login.php' });
        await app.inject({ url: '/.env' });
        await app.inject({ url: '/api/gamedata/tr1-ub' });
        const after = await summary('7');
        const bots = (summary: StatsResponse) => summary.bots.reduce((sum, bot) => sum + bot.n, 0);
        expect(bots(after) - bots(before)).toBe(2);
        const games = (summary: StatsResponse) => summary.bytes.find((kind) => kind.key === 'games')?.n ?? 0;
        expect(games(after) - games(before)).toBe(1000);
    });
});

describe('the stats page', () => {
    it('answers on the stats host, and the app everywhere else', async () => {
        const stats = await app.inject({ url: '/', headers: { host: 'stats.localhost' } });
        expect(stats.statusCode).toBe(200);
        expect(stats.body).toBe(STATS_PAGE);
        expect((await app.inject({ url: '/anything', headers: { host: 'stats.localhost' } })).body).toBe(STATS_PAGE);
        const page = await app.inject({ url: '/', headers: { host: 'localhost:3002' } });
        expect(page.body).not.toBe(STATS_PAGE);
        const api = await app.inject({ url: '/api/stats?range=nonsense', headers: { host: 'stats.localhost' } });
        expect(api.json<StatsResponse>().range).toBe('30');
        expect(api.headers['cache-control']).toBe('public, max-age=60');
    });
});

/** A MaxMind DB that puts 1.0.0.0/8 in Australia and knows nothing else. */
function tinyDatabase(): Buffer {
    const nodeCount = 8;
    const prefix = 0b00000001;
    const data = Buffer.concat([
        Buffer.from([0xe1, 0x47]),
        Buffer.from('country'),
        Buffer.from([0xe1, 0x48]),
        Buffer.from('iso_code'),
        Buffer.from([0x42]),
        Buffer.from('AU'),
    ]);
    const tree = Buffer.alloc(nodeCount * 6);
    for (let node = 0; node < nodeCount; node++) {
        const bit = (prefix >> (7 - node)) & 1;
        const next = node === nodeCount - 1 ? nodeCount + 16 : node + 1;
        tree.writeUIntBE(bit === 0 ? next : nodeCount, node * 6, 3);
        tree.writeUIntBE(bit === 1 ? next : nodeCount, node * 6 + 3, 3);
    }
    const metadata = Buffer.concat([
        Buffer.from('abcdef4d61784d696e642e636f6d', 'hex'),
        Buffer.from([0xe4, 0x4a]),
        Buffer.from('node_count'),
        Buffer.from([0xc1, nodeCount]),
        Buffer.from([0x4b]),
        Buffer.from('record_size'),
        Buffer.from([0xa1, 24]),
        Buffer.from([0x4a]),
        Buffer.from('ip_version'),
        Buffer.from([0xa1, 4]),
        Buffer.from([0x4b]),
        Buffer.from('build_epoch'),
        Buffer.from([0xc4]),
        Buffer.from(Uint8Array.of(0x65, 0x53, 0xf1, 0x00)),
    ]);
    return Buffer.concat([tree, Buffer.alloc(16), data, metadata]);
}

describe('the app address of the stats', () => {
    it('leads to the stats host', async () => {
        const response = await app.inject({ url: '/stats', headers: { host: 'localhost:3002' } });
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe('http://stats.localhost/');
    });
});
