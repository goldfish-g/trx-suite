// A throwaway data directory and built page, an app over them, and a fake
// fetch standing in for Steam and GOG.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LinkedAccount, Provider } from '../../shared/api.ts';
import { buildApp, type AppDeps } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { SESSION_COOKIE, signSession } from '../src/session.ts';
import type { Fetch } from '../src/upstream.ts';

/** Every archive holds these bytes, so Range answers can be checked exactly. */
export const ARCHIVE = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 251));
export const LEVEL = Buffer.from('flyby level bytes');
export const INDEX_HTML = '<!doctype html><title>TRX</title><div id="root"></div>';

export interface Fixture {
    root: string;
    dataDir: string;
    enginesDir: string;
    staticDir: string;
    cleanup(): Promise<void>;
}

async function put(path: string, content: string | Buffer): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
}

export async function makeFixture(): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), 'trx-suite-test-'));
    const dataDir = join(root, 'data');
    const enginesDir = join(dataDir, 'engines');
    const staticDir = join(root, 'dist');

    await put(
        join(dataDir, 'catalog.json'),
        JSON.stringify({
            games: {
                tr1: 'games/tr1.zip',
                'tr1-ub': 'games/tr1-ub.zip',
                tr2: 'games/tr2.zip',
                // Listed, but the file is not there.
                'tr2-gm': 'games/tr2-gm.zip',
                tr3: 'games/tr3.zip',
                'tr3-la': 'games/tr3-la.zip',
                tr4: 'games/tr4.zip',
                // Not an official game.
                tr9: 'games/tr9.zip',
            },
            flyby: [
                { file: 'flyby/house.tr2', name: 'Croft Manor', mod: 'tr3' },
                { file: 'flyby/missing.tr2', name: 'Nowhere', mod: 'tr2' },
            ],
        }),
    );
    for (const id of ['tr1', 'tr1-ub', 'tr2', 'tr3', 'tr3-la', 'tr4', 'tr9']) {
        await put(join(dataDir, 'games', `${id}.zip`), ARCHIVE);
    }
    await put(join(dataDir, 'flyby', 'house.tr2'), LEVEL);
    await put(join(enginesDir, '1.5.0', 'TRX.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    await put(join(enginesDir, '1.5.0', 'trx-engine.js'), 'export default 1;');
    await put(join(enginesDir, '1.10.0', 'trx-engine.js'), 'export default 2;');
    await put(join(enginesDir, '1.4.0', 'trx-engine.js'), 'export default 0;');

    await put(join(staticDir, 'index.html'), INDEX_HTML);
    await put(join(staticDir, 'assets', 'index-abc123.js'), 'console.log("app");');
    await put(join(staticDir, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    await put(join(staticDir, 'manifest.webmanifest'), '{"name":"TRX"}');
    await put(join(staticDir, '.env'), 'SECRET=hunter2');

    return { root, dataDir, enginesDir, staticDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export const TEST_SECRET = 'a-test-secret-that-is-long-enough-to-sign';

export function testConfig(fixture: Fixture, overrides: Partial<Config> = {}): Config {
    return {
        port: 3002,
        host: '127.0.0.1',
        publicUrl: 'http://localhost:3002',
        sessionSecret: TEST_SECRET,
        steamApiKey: 'STEAM-KEY',
        gogClientId: 'gog-client',
        gogClientSecret: 'gog-secret',
        dataDir: fixture.dataDir,
        enginesDir: fixture.enginesDir,
        staticDir: fixture.staticDir,
        authMock: false,
        httpsKeyFile: undefined,
        httpsCertFile: undefined,
        ...overrides,
    };
}

export function makeApp(fixture: Fixture, overrides: Partial<Config> = {}, deps: AppDeps = {}): Promise<FastifyInstance> {
    return buildApp(testConfig(fixture, overrides), deps);
}

export function account(provider: Provider, owned: number[], extra: Partial<LinkedAccount> = {}): LinkedAccount {
    return {
        provider,
        id: provider === 'steam' ? '76561198000000001' : '48628349957132247',
        name: provider === 'steam' ? 'Lara' : 'Winston',
        checkedAt: '2026-11-05T12:00:00.000Z',
        owned,
        ...extra,
    };
}

/** Cookies for inject() that sign the player in with these accounts. */
export function sessionCookies(accounts: LinkedAccount[], secret = TEST_SECRET) {
    return { [SESSION_COOKIE]: signSession(accounts, secret) };
}

export interface FakeCall {
    url: URL;
    method: string;
    headers: Headers;
    body: string | undefined;
}

export type FakeRoute = (call: FakeCall) => Response | Promise<Response>;

/** A fetch that answers from routes keyed by origin + path, and records every call. */
export function fakeFetch(routes: Record<string, FakeRoute>): { fetch: Fetch; calls: FakeCall[] } {
    const calls: FakeCall[] = [];
    const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const call: FakeCall = {
            url,
            method: init?.method ?? 'GET',
            headers: new Headers(init?.headers),
            body: init?.body === undefined || init.body === null ? undefined : String(init.body),
        };
        calls.push(call);
        const route = routes[url.origin + url.pathname];
        return route ? route(call) : new Response('no such fake route', { status: 404 });
    };
    return { fetch: fetchFn as Fetch, calls };
}

export function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function sessionFrom(response: { cookies: Array<{ name: string; value: string }> }): string | undefined {
    return response.cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value;
}
