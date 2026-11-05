// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, GogStartResponse, MeResponse } from '../../shared/api.ts';
import { GOG, STEAM } from '../../shared/games.ts';
import { GOG_GALAXY_CLIENT_ID } from '../src/config.ts';
import { extractGogCode, gogLoginUrl } from '../src/gog.ts';
import { account, fakeFetch, json, makeApp, makeFixture, sessionCookies, sessionFrom, type FakeRoute, type Fixture } from './helpers.ts';

const TOKEN = 'https://auth.gog.com/token';
const USER = 'https://embed.gog.com/userData.json';
const GAMES = 'https://embed.gog.com/user/data/games';
const CODE = 'Xq2pL9vR7sT4uW1yZ3aB5cD8eF0gH6jK-mN_oP';
const REDIRECT = 'https://embed.gog.com/on_login_success?origin=client';

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

async function gogApp(token?: FakeRoute) {
    const fake = fakeFetch({
        [TOKEN]:
            token ??
            ((call) =>
                call.url.searchParams.get('code') === CODE
                    ? json({ access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600, user_id: '48628349957132247' })
                    : json({ error: 'invalid_grant', error_description: 'Invalid authorization code' }, 400)),
        [USER]: () => json({ isLoggedIn: true, userId: '1234', galaxyUserId: '48628349957132247', username: 'winston' }),
        [GAMES]: () => json({ owned: [GOG.tr4, 1207658924, GOG.tr1] }),
    });
    app = await makeApp(fixture, {}, { fetch: fake.fetch });
    return { app, calls: fake.calls };
}

function complete(server: FastifyInstance, input: unknown, cookies?: Record<string, string>) {
    return server.inject({ method: 'POST', url: '/api/auth/gog/complete', payload: { input }, ...(cookies ? { cookies } : {}) });
}

describe('GET /api/auth/gog/start', () => {
    it("points at GOG Galaxy's sign-in", async () => {
        app = await makeApp(fixture, { gogClientId: GOG_GALAXY_CLIENT_ID });
        const response = await app.inject({ url: '/api/auth/gog/start' });
        expect(response.json<GogStartResponse>()).toEqual({
            url: `https://auth.gog.com/auth?client_id=${GOG_GALAXY_CLIENT_ID}&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2`,
        });
    });

    it('uses the configured client', () => {
        expect(gogLoginUrl('my-client')).toContain('client_id=my-client&');
    });
});

describe('POST /api/auth/gog/complete', () => {
    it('signs in from the pasted address and keeps only the games that matter', async () => {
        const { app: server, calls } = await gogApp();
        const response = await complete(server, `${REDIRECT}&code=${CODE}`);
        expect(response.statusCode).toBe(200);

        const token = calls.find((call) => call.url.href.startsWith(TOKEN));
        expect(Object.fromEntries(token!.url.searchParams)).toEqual({
            client_id: 'gog-client',
            client_secret: 'gog-secret',
            grant_type: 'authorization_code',
            code: CODE,
            redirect_uri: REDIRECT,
        });
        for (const target of [USER, GAMES]) {
            expect(calls.find((call) => call.url.href === target)?.headers.get('authorization')).toBe('Bearer ACCESS');
        }

        const me = response.json<MeResponse>();
        expect(me.accounts).toEqual([
            { provider: 'gog', id: '48628349957132247', name: 'winston', checkedAt: expect.any(String), owned: [GOG.tr1, GOG.tr4] },
        ]);
        expect(me.unlocked).toEqual(['tr1', 'tr4', 'tr1-ub', 'tr2-gm']);

        const session = sessionFrom(response);
        expect(session).toBeDefined();
        // Tokens are used once and never kept.
        const claims = Buffer.from(session!.split('.')[0]!, 'base64url').toString();
        expect(claims).not.toContain('ACCESS');
        expect(claims).not.toContain('REFRESH');
    });

    it('takes the bare code, or the address without its scheme', async () => {
        const { app: server } = await gogApp();
        expect((await complete(server, `  ${CODE}\n`)).statusCode).toBe(200);
        expect((await complete(server, `embed.gog.com/on_login_success?origin=client&code=${CODE}`)).statusCode).toBe(200);
    });

    it('adds GOG to an existing Steam session', async () => {
        const { app: server } = await gogApp();
        const response = await complete(server, CODE, sessionCookies([account('steam', [STEAM.remasteredI_III])]));
        const me = response.json<MeResponse>();
        expect(me.accounts.map((a) => a.provider)).toEqual(['steam', 'gog']);
        expect(me.unlocked).toEqual(['tr1', 'tr2', 'tr3', 'tr4', 'tr1-ub', 'tr2-gm', 'tr3-la']);
    });

    it('explains a code GOG turns down', async () => {
        const { app: server } = await gogApp();
        const response = await complete(server, `${REDIRECT}&code=expired-code-123456`);
        expect(response.statusCode).toBe(400);
        const body = response.json<ApiError>();
        expect(body.error).toBe('gog_code_rejected');
        expect(body.message).toMatch(/sign in on GOG again/);
        expect(sessionFrom(response)).toBeUndefined();
    });

    it('explains input that holds no code', async () => {
        const { app: server, calls } = await gogApp();
        const cases: Array<[unknown, string]> = [
            ['', 'gog_code_missing'],
            [undefined, 'gog_code_missing'],
            [42, 'gog_code_missing'],
            ['https://embed.gog.com/on_login_success?origin=client', 'gog_code_invalid'],
            ['this is not a code', 'gog_code_invalid'],
            ['https://embed.gog.com/on_login_success?origin=client&error=access_denied&error_description=Nope', 'gog_denied'],
        ];
        for (const [input, error] of cases) {
            const response = await complete(server, input);
            expect(response.statusCode, String(input)).toBe(400);
            expect(response.json<ApiError>().error, String(input)).toBe(error);
        }
        expect(calls).toHaveLength(0);
    });

    it('wants a JSON body', async () => {
        const { app: server } = await gogApp();
        const none = await server.inject({ method: 'POST', url: '/api/auth/gog/complete' });
        expect(none.statusCode).toBe(400);
        const text = await server.inject({
            method: 'POST',
            url: '/api/auth/gog/complete',
            headers: { 'content-type': 'text/plain' },
            payload: `{"input":"${CODE}"}`,
        });
        expect(text.statusCode).toBe(400);
        const broken = await server.inject({
            method: 'POST',
            url: '/api/auth/gog/complete',
            headers: { 'content-type': 'application/json' },
            payload: '{"input":',
        });
        expect(broken.statusCode).toBe(400);
        expect(broken.json<ApiError>().error).toBe('bad_request');
    });

    it('reports GOG being unreachable', async () => {
        const { app: server } = await gogApp(() => {
            throw new TypeError('fetch failed');
        });
        const response = await complete(server, CODE);
        expect(response.statusCode).toBe(502);
        expect(response.json<ApiError>()).toEqual({ error: 'gog_unavailable', message: 'GOG did not answer. Please try again in a moment.' });
    });

    it('refuses requests from other sites', async () => {
        const { app: server, calls } = await gogApp();
        const response = await server.inject({
            method: 'POST',
            url: '/api/auth/gog/complete',
            payload: { input: CODE },
            headers: { 'sec-fetch-site': 'cross-site' },
        });
        expect(response.statusCode).toBe(403);
        expect(calls).toHaveLength(0);
    });
});

describe('extractGogCode', () => {
    it('finds the code wherever it sits', () => {
        expect(extractGogCode(`https://embed.gog.com/on_login_success?origin=client&code=${CODE}`)).toBe(CODE);
        expect(extractGogCode(`https://embed.gog.com/on_login_success?code=${CODE}&origin=client`)).toBe(CODE);
        expect(extractGogCode(CODE)).toBe(CODE);
    });
});
