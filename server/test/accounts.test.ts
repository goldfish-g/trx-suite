// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError, MeResponse } from '../../shared/api.ts';
import { STEAM } from '../../shared/games.ts';
import { SESSION_COOKIE } from '../src/session.ts';
import { account, makeApp, makeFixture, sessionCookies, sessionFrom, type Fixture } from './helpers.ts';

let fixture: Fixture;
let app: FastifyInstance;
let mockApp: FastifyInstance;

beforeAll(async () => {
    fixture = await makeFixture();
    app = await makeApp(fixture);
    mockApp = await makeApp(fixture, { authMock: true });
});
afterAll(async () => {
    await app.close();
    await mockApp.close();
    await fixture.cleanup();
});

function cleared(response: { headers: Record<string, unknown> }): boolean {
    const header = String(response.headers['set-cookie']);
    return header.startsWith(`${SESSION_COOKIE}=;`) && /Expires=Thu, 01 Jan 1970/.test(header);
}

describe('POST /api/auth/mock', () => {
    it('does not exist without AUTH_MOCK=1', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/auth/mock', payload: { provider: 'steam', owned: [STEAM.tr1] } });
        expect(response.statusCode).toBe(404);
        expect(sessionFrom(response)).toBeUndefined();
        expect((await app.inject({ url: '/api/me' })).json<MeResponse>().providers.mock).toBe(false);
    });

    it('signs in a made-up account with AUTH_MOCK=1', async () => {
        expect((await mockApp.inject({ url: '/api/me' })).json<MeResponse>().providers.mock).toBe(true);

        const steam = await mockApp.inject({
            method: 'POST',
            url: '/api/auth/mock',
            payload: { provider: 'steam', name: 'Test Lara', owned: [STEAM.remasteredI_III] },
        });
        expect(steam.statusCode).toBe(200);
        const first = steam.json<MeResponse>();
        expect(first.accounts).toEqual([
            { provider: 'steam', id: 'mock-steam', name: 'Test Lara', checkedAt: expect.any(String), owned: [STEAM.remasteredI_III] },
        ]);
        expect(first.unlocked).not.toContain('tr4');

        // Signing in again replaces the account.
        const again = await mockApp.inject({
            method: 'POST',
            url: '/api/auth/mock',
            payload: { provider: 'steam', owned: [STEAM.tr4], privateProfile: true },
            cookies: { [SESSION_COOKIE]: sessionFrom(steam)! },
        });
        const second = again.json<MeResponse>();
        expect(second.accounts).toHaveLength(1);
        expect(second.accounts[0]).toMatchObject({ name: 'Mock Steam player', privateProfile: true });
        expect(second.unlocked).toContain('tr4');

        const download = await mockApp.inject({ url: '/api/gamedata/tr4', cookies: { [SESSION_COOKIE]: sessionFrom(again)! } });
        expect(download.statusCode).toBe(200);
    });

    it('checks what it is given', async () => {
        for (const payload of [{ provider: 'epic', owned: [] }, { provider: 'steam' }, { provider: 'steam', owned: ['x'] }, { provider: 'steam', owned: [], name: 5 }, { provider: 'gog', owned: [] }]) {
            const response = await mockApp.inject({ method: 'POST', url: '/api/auth/mock', payload });
            expect(response.statusCode, JSON.stringify(payload)).toBe(400);
            expect(response.json<ApiError>().error).toBe('bad_request');
        }
    });
});

describe('signing out', () => {
    const steam = sessionCookies([account('steam', [STEAM.remasteredI_III])]);

    it('clears the cookie when the Steam account goes', async () => {
        const response = await app.inject({ method: 'DELETE', url: '/api/accounts/steam', cookies: steam });
        expect(response.statusCode).toBe(200);
        const me = response.json<MeResponse>();
        expect(me.accounts).toEqual([]);
        expect(me.unlocked).toEqual(['tr1-ub', 'tr2-gm']);
        expect(cleared(response)).toBe(true);
    });

    it('refuses unknown stores, GOG among them now', async () => {
        for (const store of ['epic', 'gog']) {
            const response = await app.inject({ method: 'DELETE', url: `/api/accounts/${store}`, cookies: steam });
            expect(response.statusCode, store).toBe(400);
            expect(sessionFrom(response)).toBeUndefined();
        }
    });

    it('logs out entirely', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/logout', cookies: steam });
        expect(response.statusCode).toBe(200);
        expect(response.json<MeResponse>()).toMatchObject({ accounts: [], unlocked: ['tr1-ub', 'tr2-gm'] });
        expect(cleared(response)).toBe(true);
    });

    it('accepts a bodyless POST sent as JSON', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/logout', headers: { 'content-type': 'application/json' } });
        expect(response.statusCode).toBe(200);
    });

    it('refuses a logout from another site', async () => {
        const response = await app.inject({ method: 'POST', url: '/api/logout', cookies: steam, headers: { 'sec-fetch-site': 'cross-site' } });
        expect(response.statusCode).toBe(403);
        expect(response.json<ApiError>().error).toBe('cross_site');
        expect(response.headers['set-cookie']).toBeUndefined();
        const sameSite = await app.inject({ method: 'POST', url: '/api/logout', cookies: steam, headers: { 'sec-fetch-site': 'same-origin' } });
        expect(sameSite.statusCode).toBe(200);
    });
});
