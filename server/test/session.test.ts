// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MeResponse } from '../../shared/api.ts';
import { GOG, STEAM } from '../../shared/games.ts';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, mergeAccount, signSession, unlockedIds, verifySession } from '../src/session.ts';
import { TEST_SECRET, account, makeApp, makeFixture, sessionCookies, type Fixture } from './helpers.ts';

describe('session tokens', () => {
    const accounts = [account('steam', [STEAM.remasteredI_III], { avatarUrl: 'https://example.com/a.jpg' }), account('gog', [GOG.tr4])];

    it('round-trips the accounts', () => {
        expect(verifySession(signSession(accounts, TEST_SECRET), TEST_SECRET)).toEqual(accounts);
    });

    it('rejects a token signed with another secret', () => {
        expect(verifySession(signSession(accounts, 'another-secret-another-secret-12345'), TEST_SECRET)).toBeNull();
    });

    it('rejects edited claims', () => {
        const token = signSession([account('steam', [])], TEST_SECRET);
        const [, signature] = token.split('.');
        const forged = Buffer.from(JSON.stringify({ accounts: [account('steam', [STEAM.tr4])], exp: 4102444800 })).toString('base64url');
        expect(verifySession(`${forged}.${signature}`, TEST_SECRET)).toBeNull();
    });

    it('rejects a truncated or altered signature', () => {
        const token = signSession(accounts, TEST_SECRET);
        expect(verifySession(token.slice(0, -2), TEST_SECRET)).toBeNull();
        const last = token.at(-1) === 'A' ? 'B' : 'A';
        expect(verifySession(token.slice(0, -1) + last, TEST_SECRET)).toBeNull();
    });

    it('rejects garbage', () => {
        for (const token of [undefined, '', 'abc', '.', 'a.b.c', '.sig', 'payload.']) {
            expect(verifySession(token, TEST_SECRET)).toBeNull();
        }
    });

    it('expires with the cookie', () => {
        const now = Date.UTC(2026, 0, 1);
        const token = signSession(accounts, TEST_SECRET, now);
        expect(verifySession(token, TEST_SECRET, now + (SESSION_MAX_AGE_SECONDS - 60) * 1000)).not.toBeNull();
        expect(verifySession(token, TEST_SECRET, now + (SESSION_MAX_AGE_SECONDS + 60) * 1000)).toBeNull();
    });

    it('keeps one account per store', () => {
        const merged = mergeAccount(accounts, account('steam', [STEAM.tr1], { id: '76561198000000002' }));
        expect(merged.map((a) => [a.provider, a.id])).toEqual([
            ['gog', '48628349957132247'],
            ['steam', '76561198000000002'],
        ]);
    });
});

describe('unlocks', () => {
    it('gives everyone the free expansions', () => {
        expect(unlockedIds([])).toEqual(['tr1-ub', 'tr2-gm']);
    });

    it('unlocks I–III and The Lost Artifact for Steam remastered I–III, but not IV', () => {
        const ids = unlockedIds([account('steam', [STEAM.remasteredI_III])]);
        expect(ids).toEqual(expect.arrayContaining(['tr1', 'tr2', 'tr3', 'tr3-la', 'tr1-ub', 'tr2-gm']));
        expect(ids).not.toContain('tr4');
    });

    it('unlocks only the game itself for a classic store copy', () => {
        expect(unlockedIds([account('steam', [STEAM.tr3])])).toEqual(['tr3', 'tr1-ub', 'tr2-gm']);
    });

    it('unlocks IV for GOG Tomb Raider 4', () => {
        expect(unlockedIds([account('gog', [GOG.tr4])])).toEqual(['tr4', 'tr1-ub', 'tr2-gm']);
    });

    it('does not let a Steam id count as a GOG product', () => {
        expect(unlockedIds([account('gog', [STEAM.tr1])])).toEqual(['tr1-ub', 'tr2-gm']);
    });
});

describe('the session cookie over HTTP', () => {
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

    it('treats a forged cookie as signed out', async () => {
        const forged = sessionCookies([account('steam', [STEAM.remasteredI_III])], 'not-the-server-secret-not-the-server-secret');
        const response = await app.inject({ url: '/api/me', cookies: forged });
        expect(response.statusCode).toBe(200);
        const me = response.json<MeResponse>();
        expect(me.accounts).toEqual([]);
        expect(me.unlocked).toEqual(['tr1-ub', 'tr2-gm']);
    });

    it('reads a genuine cookie', async () => {
        const response = await app.inject({ url: '/api/me', cookies: sessionCookies([account('gog', [GOG.tr4])]) });
        const me = response.json<MeResponse>();
        expect(me.accounts).toHaveLength(1);
        expect(me.unlocked).toContain('tr4');
        expect(me.providers).toEqual({ steam: true, gog: true, mock: false });
    });

    it('sets HttpOnly, SameSite=Lax, Path=/, 180 days, and Secure only over https', async () => {
        const mockApp = await makeApp(fixture, { authMock: true });
        const body = { provider: 'gog', owned: [] };
        const plain = await mockApp.inject({ method: 'POST', url: '/api/auth/mock', payload: body });
        const header = String(plain.headers['set-cookie']);
        expect(header).toContain(`${SESSION_COOKIE}=`);
        expect(header).toMatch(/HttpOnly/i);
        expect(header).toMatch(/SameSite=Lax/i);
        expect(header).toMatch(/Path=\//);
        expect(header).toMatch(new RegExp(`Max-Age=${SESSION_MAX_AGE_SECONDS}`));
        expect(header).not.toMatch(/Secure/i);

        const proxied = await mockApp.inject({
            method: 'POST',
            url: '/api/auth/mock',
            payload: body,
            headers: { 'x-forwarded-proto': 'https' },
        });
        expect(String(proxied.headers['set-cookie'])).toMatch(/Secure/i);
        await mockApp.close();

        const httpsApp = await makeApp(fixture, { authMock: true, publicUrl: 'https://trx.example.com' });
        const behindProxy = await httpsApp.inject({ method: 'POST', url: '/api/auth/mock', payload: body });
        expect(String(behindProxy.headers['set-cookie'])).toMatch(/Secure/i);
        await httpsApp.close();
    });
});
