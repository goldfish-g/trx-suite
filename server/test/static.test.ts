// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiError } from '../../shared/api.ts';
import { ConfigError, loadConfig } from '../src/config.ts';
import { authResultPage } from '../src/pages.ts';
import { INDEX_HTML, makeApp, makeFixture, type Fixture } from './helpers.ts';

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

function expectIsolation(response: { headers: Record<string, unknown> }, label: string): void {
    expect(response.headers['cross-origin-opener-policy'], label).toBe('same-origin');
    expect(response.headers['cross-origin-embedder-policy'], label).toBe('require-corp');
    expect(response.headers['cross-origin-resource-policy'], label).toBe('same-origin');
}

describe('the built page', () => {
    it('serves index.html at / without caching', async () => {
        const response = await app.inject({ url: '/' });
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(INDEX_HTML);
        expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
        expect(response.headers['cache-control']).toBe('no-cache');
        expectIsolation(response, '/');
    });

    it("falls back to index.html for the page's own routes", async () => {
        for (const url of ['/library', '/play/profile-1', '/settings/', '/play/a.b/c?x=1']) {
            const response = await app.inject({ url });
            expect(response.statusCode, url).toBe(200);
            expect(response.body, url).toBe(INDEX_HTML);
            expect(response.headers['cache-control'], url).toBe('no-cache');
        }
    });

    it('caches fingerprinted assets forever', async () => {
        const response = await app.inject({ url: '/assets/index-abc123.js' });
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8');
        expectIsolation(response, 'asset');
    });

    it('revalidates the service worker and the manifest', async () => {
        const sw = await app.inject({ url: '/sw.js' });
        expect(sw.statusCode).toBe(200);
        expect(sw.headers['cache-control']).toBe('no-cache');
        const manifest = await app.inject({ url: '/manifest.webmanifest' });
        expect(manifest.headers['cache-control']).toBe('no-cache');
        expect(manifest.headers['content-type']).toBe('application/manifest+json; charset=utf-8');
    });

    it('answers 404 for missing files rather than HTML', async () => {
        for (const url of ['/assets/missing.js', '/missing.png', '/assets/index-abc123.js.map']) {
            const response = await app.inject({ url });
            expect(response.statusCode, url).toBe(404);
            expect(response.json<ApiError>().error).toBe('not_found');
            expectIsolation(response, url);
        }
    });

    it('never serves hidden files or leaves the directory', async () => {
        for (const url of ['/.env', '/%2e%2e/data/catalog.json', '/assets/..%2F..%2Fdata%2Fcatalog.json']) {
            const response = await app.inject({ url });
            expect(response.body, url).not.toContain('hunter2');
            expect(response.body, url).not.toContain('games');
        }
    });

    it("keeps the server's own paths out of the fallback", async () => {
        for (const url of ['/api', '/api/nothing', '/auth/nothing', '/engines', '/flyby', '/flyby/unknown']) {
            const response = await app.inject({ url });
            expect(response.statusCode, url).toBe(404);
            expect(response.json<ApiError>()).toEqual({ error: 'not_found', message: 'Not found.' });
            expectIsolation(response, url);
        }
        const post = await app.inject({ method: 'POST', url: '/api/nothing' });
        expect(post.statusCode).toBe(404);
        expectIsolation(post, 'POST');
    });

    it('still answers when there is no built page', async () => {
        const bare = await makeApp(fixture, { staticDir: join(fixture.root, 'no-such-dir') });
        expect((await bare.inject({ url: '/' })).statusCode).toBe(404);
        expect((await bare.inject({ url: '/api/me' })).statusCode).toBe(200);
        await bare.close();
    });
});

describe('the Steam callback page', () => {
    it('escapes what it shows and keeps the script inert', () => {
        const html = authResultPage({
            ok: true,
            title: 'Signed in',
            message: 'Signed in as <img src=x onerror=alert(1)>.',
            state: '</script><script>alert(1)</script>',
            appUrl: 'https://trx.example.com',
        });
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&#60;img src=x');
        expect(html).not.toContain('</script><script>alert(1)');
        expect(html).toContain('postMessage(m,"https://trx.example.com")');
        expect(html).toContain("new BroadcastChannel('trx-suite-auth')");
    });

    it('does not close itself on failure', () => {
        const html = authResultPage({ ok: false, title: 'Not signed in', message: 'Nope.', state: 'abc', appUrl: 'http://localhost:3002' });
        expect(html).not.toContain('window.close()');
    });
});

describe('loadConfig', () => {
    it('fills in defaults for development', () => {
        const { config, warnings } = loadConfig({}, '/srv/trx');
        expect(config).toMatchObject({
            port: 3002,
            host: '0.0.0.0',
            publicUrl: 'http://localhost:3002',
            dataDir: '/srv/trx/data',
            enginesDir: '/srv/trx/data/engines',
            staticDir: '/srv/trx/dist',
            steamApiKey: undefined,
            authMock: false,
        });
        expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
        expect(warnings.join('\n')).toMatch(/SESSION_SECRET/);
    });

    it('reads the environment', () => {
        const { config } = loadConfig(
            {
                PORT: '8080',
                PUBLIC_URL: 'https://trx.example.com/',
                DATA_DIR: '/data',
                ENGINES_DIR: 'builds',
                SESSION_SECRET: 'x'.repeat(40),
                STEAM_API_KEY: 'KEY',
                AUTH_MOCK: '1',
            },
            '/srv/trx',
        );
        expect(config).toMatchObject({
            port: 8080,
            publicUrl: 'https://trx.example.com',
            dataDir: '/data',
            enginesDir: '/srv/trx/builds',
            sessionSecret: 'x'.repeat(40),
            steamApiKey: 'KEY',
            authMock: true,
        });
    });

    it('reads the Steam key from a file, as a mounted secret', () => {
        const dir = mkdtempSync(join(tmpdir(), 'trx-config-'));
        writeFileSync(join(dir, 'steam_api_key.txt'), '  0123456789ABCDEF0123456789ABCDEF\r\n');
        expect(loadConfig({ STEAM_API_KEY_FILE: 'steam_api_key.txt' }, dir).config.steamApiKey).toBe('0123456789ABCDEF0123456789ABCDEF');
        // The variable itself wins over the file.
        expect(loadConfig({ STEAM_API_KEY: 'KEY', STEAM_API_KEY_FILE: 'steam_api_key.txt' }, dir).config.steamApiKey).toBe('KEY');
        expect(() => loadConfig({ STEAM_API_KEY_FILE: 'missing.txt' }, dir)).toThrow(/STEAM_API_KEY_FILE/);
        writeFileSync(join(dir, 'empty.txt'), '\n');
        expect(() => loadConfig({ STEAM_API_KEY_FILE: 'empty.txt' }, dir)).toThrow(/empty/);
    });

    it('reads the session secret from a file, so restarts keep players signed in', () => {
        const dir = mkdtempSync(join(tmpdir(), 'trx-config-'));
        writeFileSync(join(dir, 'session_secret.txt'), `${'s'.repeat(43)}\n`);
        const { config, warnings } = loadConfig({ SESSION_SECRET_FILE: 'session_secret.txt' }, dir);
        expect(config.sessionSecret).toBe('s'.repeat(43));
        expect(warnings.join('\n')).not.toMatch(/SESSION_SECRET/);
    });

    it('insists on a session secret, and no mock sign-in, in production', () => {
        expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
        expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' })).toThrow(ConfigError);
        expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), AUTH_MOCK: '1' })).toThrow(ConfigError);
        expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40) })).not.toThrow();
    });

    it('refuses half an https setup and odd addresses', () => {
        expect(() => loadConfig({ HTTPS_KEY: 'key.pem' })).toThrow(ConfigError);
        expect(() => loadConfig({ PUBLIC_URL: 'trx.example.com' })).toThrow(ConfigError);
        expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigError);
    });
});
