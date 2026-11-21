// @vitest-environment node
// Search engines may index the public site's home and stats pages, nothing
// else, and nothing at all of another server.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SITE_URL } from '../../shared/site.ts';
import { makeApp, makeFixture, type Fixture } from './helpers.ts';

let fixture: Fixture;
let app: FastifyInstance;

beforeEach(async () => {
    fixture = await makeFixture();
});

afterEach(async () => {
    await app.close();
    await fixture.cleanup();
});

describe('the public site', () => {
    beforeEach(async () => {
        app = await makeApp(fixture, { publicUrl: SITE_URL, statsHost: 'stats.tombs.nexus' });
    });

    it('lets search engines index the home page, with the sitemap', async () => {
        const robots = await app.inject({ url: '/robots.txt' });
        expect(robots.statusCode).toBe(200);
        expect(robots.headers['content-type']).toBe('text/plain; charset=utf-8');
        expect(robots.body).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

        const home = await app.inject({ url: '/' });
        expect(home.statusCode).toBe(200);
        expect(home.headers['x-robots-tag']).toBeUndefined();

        const sitemap = await app.inject({ url: '/sitemap.xml' });
        expect(sitemap.statusCode).toBe(200);
        expect(sitemap.headers['content-type']).toBe('application/xml; charset=utf-8');
        expect(sitemap.body).toContain(`<loc>${SITE_URL}/</loc>`);
        expect(sitemap.body).toContain('<loc>https://stats.tombs.nexus/</loc>');
    });

    it('keeps games, other page routes and the API out of results', async () => {
        for (const url of ['/play/profile-1', '/library', '/api/catalog', '/api/nothing']) {
            const response = await app.inject({ url });
            expect(response.headers['x-robots-tag'], url).toBe('noindex');
        }
        // Scripts and images are no results; they carry no mark.
        expect((await app.inject({ url: '/assets/index-abc123.js' })).headers['x-robots-tag']).toBeUndefined();
    });

    it('lets the stats page be indexed, naming the sitemap that lists it', async () => {
        const robots = await app.inject({ url: '/robots.txt', headers: { host: 'stats.tombs.nexus' } });
        expect(robots.body).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
        expect((await app.inject({ url: '/sitemap.xml', headers: { host: 'stats.tombs.nexus' } })).statusCode).toBe(404);
    });
});

describe('another server', () => {
    beforeEach(async () => {
        app = await makeApp(fixture, { publicUrl: 'https://trx.example.com' });
    });

    it('keeps out of search results altogether', async () => {
        const robots = await app.inject({ url: '/robots.txt' });
        expect(robots.body).toBe('User-agent: *\nDisallow: /\n');
        expect((await app.inject({ url: '/sitemap.xml' })).statusCode).toBe(404);
        for (const url of ['/', '/play/profile-1', '/api/catalog']) {
            expect((await app.inject({ url })).headers['x-robots-tag'], url).toBe('noindex');
        }
    });
});
