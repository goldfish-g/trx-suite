// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, MeResponse, PollResponse, SteamStartResponse } from '../../shared/api.ts';
import { GOG, RELEVANT_STEAM_APPS, STEAM } from '../../shared/games.ts';
import { SESSION_COOKIE } from '../src/session.ts';
import {
    account,
    fakeFetch,
    json,
    makeApp,
    makeFixture,
    sessionCookies,
    sessionFrom,
    type FakeCall,
    type FakeRoute,
    type Fixture,
} from './helpers.ts';

const STEAM_ID = '76561198012345678';
const OPENID = 'https://steamcommunity.com/openid/login';
const OWNED_GAMES = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';
const SUMMARIES = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';

let fixture: Fixture;
let app: FastifyInstance | undefined;

beforeAll(async () => {
    fixture = await makeFixture();
});
afterAll(async () => {
    await fixture.cleanup();
});
afterEach(async () => {
    await app?.close();
    app = undefined;
});

interface SteamFakes {
    isValid?: boolean;
    owned?: unknown;
    ownedRoute?: FakeRoute;
    summaries?: FakeRoute;
}

async function steamApp(fakes: SteamFakes = {}) {
    const fake = fakeFetch({
        [OPENID]: () => new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${fakes.isValid ?? true}\n`),
        [OWNED_GAMES]:
            fakes.ownedRoute ??
            (() =>
                json(
                    fakes.owned ?? {
                        response: { game_count: 1, games: [{ appid: STEAM.remasteredI_III, playtime_forever: 600 }] },
                    },
                )),
        [SUMMARIES]:
            fakes.summaries ??
            (() =>
                json({
                    response: {
                        players: [
                            { steamid: STEAM_ID, personaname: 'Lara', avatarmedium: 'https://avatars.steamstatic.com/abc_medium.jpg' },
                        ],
                    },
                })),
    });
    app = await makeApp(fixture, {}, { fetch: fake.fetch });
    return { app, calls: fake.calls };
}

async function start(server: FastifyInstance): Promise<SteamStartResponse & { returnTo: string }> {
    const response = await server.inject({ method: 'POST', url: '/api/auth/steam/start' });
    expect(response.statusCode).toBe(200);
    const body = response.json<SteamStartResponse>();
    const returnTo = new URL(body.url).searchParams.get('openid.return_to');
    expect(returnTo).not.toBeNull();
    return { ...body, returnTo: returnTo! };
}

/** The address Steam sends the player back to: return_to plus its assertion. */
function callbackUrl(returnTo: string, overrides: Record<string, string | null> = {}): string {
    const fields: Record<string, string | null> = {
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'id_res',
        'openid.op_endpoint': OPENID,
        'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
        'openid.identity': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
        'openid.return_to': returnTo,
        'openid.response_nonce': '2026-11-05T12:00:00Zb5oQ1nU3w8K0',
        'openid.assoc_handle': '1234567890',
        'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
        'openid.sig': 'W0e4xEZ0vB4kPZ8H3l0Gm5aQn2E=',
        ...overrides,
    };
    const assertion = new URLSearchParams(Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== null));
    const url = new URL(returnTo);
    return `${url.pathname}${url.search}&${assertion}`;
}

function callsTo(calls: FakeCall[], target: string): FakeCall[] {
    return calls.filter((call) => call.url.origin + call.url.pathname === target);
}

describe('POST /api/auth/steam/start', () => {
    it('answers 503 without an API key', async () => {
        app = await makeApp(fixture, { steamApiKey: undefined });
        const response = await app.inject({ method: 'POST', url: '/api/auth/steam/start' });
        expect(response.statusCode).toBe(503);
        expect(response.json<ApiError>().error).toBe('steam_disabled');
    });

    it('builds the OpenID request', async () => {
        const { app: server } = await steamApp();
        const { url, state } = await start(server);
        const parsed = new URL(url);
        expect(parsed.origin + parsed.pathname).toBe(OPENID);
        expect(Object.fromEntries(parsed.searchParams)).toEqual({
            'openid.ns': 'http://specs.openid.net/auth/2.0',
            'openid.mode': 'checkid_setup',
            'openid.return_to': `http://localhost:3002/auth/steam/callback?state=${state}`,
            'openid.realm': 'http://localhost:3002',
            'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
            'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
        });
        expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    });
});

describe('the Steam sign-in round trip', () => {
    it('verifies the assertion, reads ownership, and hands the account to the polling app', async () => {
        const { app: server, calls } = await steamApp();
        const { state, returnTo } = await start(server);

        const before = await server.inject({ url: `/api/auth/poll?state=${state}` });
        expect(before.json<PollResponse>()).toEqual({ status: 'pending' });

        const callback = await server.inject({ url: callbackUrl(returnTo) });
        expect(callback.statusCode).toBe(200);
        expect(callback.headers['content-type']).toBe('text/html; charset=utf-8');
        expect(callback.headers['cache-control']).toBe('no-store');
        expect(callback.headers['cross-origin-opener-policy']).toBe('same-origin');
        expect(callback.body).toContain('Signed in as Lara.');
        expect(callback.body).toContain(`state:"${state}"`);
        expect(callback.body).toContain('postMessage(m,"http://localhost:3002")');
        expect(callback.body).toContain('window.close()');
        // The callback cannot know which browser the app lives in, so it sets no cookie.
        expect(callback.headers['set-cookie']).toBeUndefined();

        const [check] = callsTo(calls, OPENID);
        expect(check?.method).toBe('POST');
        const checked = new URLSearchParams(check?.body);
        expect(checked.get('openid.mode')).toBe('check_authentication');
        expect(checked.get('openid.sig')).toBe('W0e4xEZ0vB4kPZ8H3l0Gm5aQn2E=');
        expect(checked.get('openid.claimed_id')).toBe(`https://steamcommunity.com/openid/id/${STEAM_ID}`);
        expect(checked.get('openid.return_to')).toBe(returnTo);
        expect(checked.has('state')).toBe(false);

        const [owned] = callsTo(calls, OWNED_GAMES);
        expect(owned?.url.searchParams.get('key')).toBe('STEAM-KEY');
        expect(owned?.url.searchParams.get('steamid')).toBe(STEAM_ID);
        expect(owned?.url.searchParams.get('include_played_free_games')).toBe('1');
        expect(owned?.url.searchParams.get('include_free_sub')).toBe('1');
        expect(owned?.url.searchParams.get('skip_unvetted_apps')).toBe('0');
        const filter = RELEVANT_STEAM_APPS.map((_, index) => Number(owned?.url.searchParams.get(`appids_filter[${index}]`)));
        expect(filter).toEqual([...RELEVANT_STEAM_APPS]);
        expect(callsTo(calls, SUMMARIES)[0]?.url.searchParams.get('steamids')).toBe(STEAM_ID);

        const done = await server.inject({ url: `/api/auth/poll?state=${state}` });
        expect(done.statusCode).toBe(200);
        const poll = done.json<PollResponse>();
        expect(poll.status).toBe('done');
        const me = (poll as { me: MeResponse }).me;
        expect(me.accounts).toEqual([
            {
                provider: 'steam',
                id: STEAM_ID,
                name: 'Lara',
                avatarUrl: 'https://avatars.steamstatic.com/abc_medium.jpg',
                checkedAt: expect.any(String),
                owned: [STEAM.remasteredI_III],
            },
        ]);
        expect(me.unlocked).toEqual(expect.arrayContaining(['tr1', 'tr2', 'tr3', 'tr3-la']));
        expect(me.unlocked).not.toContain('tr4');

        const session = sessionFrom(done);
        expect(session).toBeDefined();
        expect(String(done.headers['set-cookie'])).toMatch(/HttpOnly/i);
        const download = await server.inject({ url: '/api/gamedata/tr2', cookies: { [SESSION_COOKIE]: session! } });
        expect(download.statusCode).toBe(200);

        // A state hands over its account once.
        const again = await server.inject({ url: `/api/auth/poll?state=${state}` });
        expect(again.json<PollResponse>().status).toBe('error');
    });

    it('adds the Steam account to the session the app already has', async () => {
        const { app: server } = await steamApp();
        const { state, returnTo } = await start(server);
        await server.inject({ url: callbackUrl(returnTo) });
        const response = await server.inject({
            url: `/api/auth/poll?state=${state}`,
            cookies: sessionCookies([account('gog', [GOG.tr4])]),
        });
        const me = (response.json<PollResponse>() as { me: MeResponse }).me;
        expect(me.accounts.map((a) => a.provider).sort()).toEqual(['gog', 'steam']);
        expect(me.unlocked).toEqual(expect.arrayContaining(['tr1', 'tr4']));
    });

    it('records a private profile as owning nothing', async () => {
        const { app: server } = await steamApp({ owned: { response: {} } });
        const { state, returnTo } = await start(server);
        const callback = await server.inject({ url: callbackUrl(returnTo) });
        expect(callback.statusCode).toBe(200);
        expect(callback.body).toContain('private');
        const poll = (await server.inject({ url: `/api/auth/poll?state=${state}` })).json<PollResponse>();
        const me = (poll as { me: MeResponse }).me;
        expect(me.accounts[0]).toMatchObject({ provider: 'steam', owned: [], privateProfile: true });
        expect(me.unlocked).toEqual(['tr1-ub', 'tr2-gm']);
    });

    it('signs in someone who owns none of the games', async () => {
        const { app: server } = await steamApp({ owned: { response: { game_count: 0 } } });
        const { state, returnTo } = await start(server);
        await server.inject({ url: callbackUrl(returnTo) });
        const me = ((await server.inject({ url: `/api/auth/poll?state=${state}` })).json<PollResponse>() as { me: MeResponse }).me;
        expect(me.accounts[0]).toMatchObject({ owned: [] });
        expect(me.accounts[0]?.privateProfile).toBeUndefined();
    });

    it('falls back to a plain name when the profile cannot be read', async () => {
        const { app: server } = await steamApp({ summaries: () => new Response('nope', { status: 500 }) });
        const { state, returnTo } = await start(server);
        await server.inject({ url: callbackUrl(returnTo) });
        const me = ((await server.inject({ url: `/api/auth/poll?state=${state}` })).json<PollResponse>() as { me: MeResponse }).me;
        expect(me.accounts[0]?.name).toBe(`Steam account ${STEAM_ID}`);
    });
});

describe('forged or broken Steam answers', () => {
    const forgeries: Array<[string, (returnTo: string) => Record<string, string | null>]> = [
        ['a claimed_id on another host', () => ({
            'openid.claimed_id': `https://evil.example/openid/id/${STEAM_ID}`,
            'openid.identity': `https://evil.example/openid/id/${STEAM_ID}`,
        })],
        ['a claimed_id over http', () => ({
            'openid.claimed_id': `http://steamcommunity.com/openid/id/${STEAM_ID}`,
            'openid.identity': `http://steamcommunity.com/openid/id/${STEAM_ID}`,
        })],
        ['a claimed_id with a short id', () => ({
            'openid.claimed_id': 'https://steamcommunity.com/openid/id/123',
            'openid.identity': 'https://steamcommunity.com/openid/id/123',
        })],
        ['an identity that differs from claimed_id', () => ({ 'openid.identity': 'https://steamcommunity.com/openid/id/76561198099999999' })],
        ['a return_to for another sign-in', (returnTo) => ({ 'openid.return_to': returnTo.replace(/state=.*/, 'state=someone-else') })],
        ['a return_to on another site', () => ({ 'openid.return_to': 'https://evil.example/auth/steam/callback' })],
        ['another OpenID provider', () => ({ 'openid.op_endpoint': 'https://evil.example/openid/login' })],
        ['an unsigned claimed_id', () => ({ 'openid.signed': 'signed,op_endpoint,identity,return_to,response_nonce,assoc_handle' })],
        ['a missing signature', () => ({ 'openid.sig': null })],
        ['a setup mode', () => ({ 'openid.mode': 'checkid_setup' })],
    ];

    for (const [label, overrides] of forgeries) {
        it(`rejects ${label} without asking Steam`, async () => {
            const { app: server, calls } = await steamApp();
            const { state, returnTo } = await start(server);
            const callback = await server.inject({ url: callbackUrl(returnTo, overrides(returnTo)) });
            expect(callback.statusCode).toBe(400);
            expect(callback.body).toContain('Steam could not confirm this sign-in');
            expect(callsTo(calls, OPENID)).toHaveLength(0);
            const poll = (await server.inject({ url: `/api/auth/poll?state=${state}` })).json<PollResponse>();
            expect(poll.status).toBe('error');
            expect(sessionFrom(await server.inject({ url: `/api/auth/poll?state=${state}` }))).toBeUndefined();
        });
    }

    it('rejects an assertion Steam does not vouch for', async () => {
        const { app: server, calls } = await steamApp({ isValid: false });
        const { state, returnTo } = await start(server);
        const callback = await server.inject({ url: callbackUrl(returnTo) });
        expect(callback.statusCode).toBe(400);
        expect(callsTo(calls, OPENID)).toHaveLength(1);
        expect(callsTo(calls, OWNED_GAMES)).toHaveLength(0);
        const poll = await server.inject({ url: `/api/auth/poll?state=${state}` });
        expect(poll.json<PollResponse>()).toEqual({ status: 'error', message: expect.stringContaining('could not confirm') });
        expect(sessionFrom(poll)).toBeUndefined();
    });

    it('rejects duplicated openid fields', async () => {
        const { app: server } = await steamApp();
        const { returnTo } = await start(server);
        const url = `${callbackUrl(returnTo)}&openid.claimed_id=${encodeURIComponent('https://steamcommunity.com/openid/id/76561198099999999')}`;
        expect((await server.inject({ url })).statusCode).toBe(400);
    });

    it('takes each assertion once', async () => {
        const { app: server } = await steamApp();
        const { returnTo } = await start(server);
        expect((await server.inject({ url: callbackUrl(returnTo) })).statusCode).toBe(200);
        expect((await server.inject({ url: callbackUrl(returnTo) })).statusCode).toBe(409);
    });

    it('turns away unknown states', async () => {
        const { app: server } = await steamApp();
        const callback = await server.inject({ url: '/auth/steam/callback?state=made-up&openid.mode=id_res' });
        expect(callback.statusCode).toBe(410);
        expect(callback.body).toContain('Sign-in expired');
        const poll = await server.inject({ url: '/api/auth/poll?state=made-up' });
        expect(poll.json<PollResponse>().status).toBe('error');
        expect((await server.inject({ url: '/api/auth/poll' })).statusCode).toBe(400);
    });

    it('reports a cancelled sign-in', async () => {
        const { app: server } = await steamApp();
        const { state, returnTo } = await start(server);
        const url = `${new URL(returnTo).pathname}${new URL(returnTo).search}&openid.ns=${encodeURIComponent('http://specs.openid.net/auth/2.0')}&openid.mode=cancel`;
        const callback = await server.inject({ url });
        expect(callback.statusCode).toBe(400);
        expect(callback.body).toContain('cancelled');
        const poll = (await server.inject({ url: `/api/auth/poll?state=${state}` })).json<PollResponse>();
        expect(poll).toEqual({ status: 'error', message: 'The sign-in was cancelled on Steam.' });
    });

    it('reports Steam being down', async () => {
        const { app: server } = await steamApp({ ownedRoute: () => new Response('Forbidden', { status: 403 }) });
        const { state, returnTo } = await start(server);
        const callback = await server.inject({ url: callbackUrl(returnTo) });
        expect(callback.statusCode).toBe(502);
        expect(callback.body).not.toContain('STEAM-KEY');
        const poll = (await server.inject({ url: `/api/auth/poll?state=${state}` })).json<PollResponse>();
        expect(poll).toEqual({ status: 'error', message: expect.stringContaining('HTTP 403') });
    });
});
