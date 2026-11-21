// What search engines may index. Only the public address (shared/site.ts
// SITE_URL) is indexed, and there only the home page and the stats page:
// the home server, test servers and copies elsewhere answer robots.txt with
// "Disallow: /" and mark every answer noindex, so they never compete with
// the public site or show up in results. The page's other routes (a game,
// /play/<profile>) and the API are marked noindex everywhere; robots.txt
// leaves them open, since the crawler renders the page with the API's
// answers and must be able to read the noindex.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SITE_URL } from '../../shared/site.ts';
import type { Config } from './config.ts';
import { requestPath } from './files.ts';
import { isStatsHost } from './stats/routes.ts';

/** Whether this server is the public site, which search engines may index. */
export function isPublicSite(config: Config): boolean {
    return config.publicUrl === SITE_URL;
}

/** Whether a page route's answer may show up in search results. */
function indexable(request: FastifyRequest, config: Config): boolean {
    if (!isPublicSite(config)) return false;
    if (isStatsHost(request, config)) return true;
    const path = requestPath(request);
    return path === '/' || path === '/index.html';
}

export function registerSeoRoutes(app: FastifyInstance, config: Config): void {
    const publicSite = isPublicSite(config);

    app.addHook('onSend', async (request, reply, payload) => {
        if (reply.hasHeader('x-robots-tag')) return payload;
        const type = String(reply.getHeader('content-type') ?? '');
        // Pages and API answers; images and scripts are not results anyway.
        if (!publicSite || type.startsWith('application/json') || (type.startsWith('text/html') && !indexable(request, config))) {
            reply.header('x-robots-tag', 'noindex');
        }
        return payload;
    });

    app.get('/robots.txt', async (_request, reply) => {
        reply.type('text/plain; charset=utf-8').header('cache-control', 'public, max-age=3600');
        if (!publicSite) return 'User-agent: *\nDisallow: /\n';
        // The stats host names the app's sitemap too, which lets that list its page.
        return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
    });

    app.get('/sitemap.xml', async (request, reply) => {
        if (!publicSite || isStatsHost(request, config)) return reply.code(404).type('text/plain; charset=utf-8').send('Not found.');
        reply.type('application/xml; charset=utf-8').header('cache-control', 'public, max-age=3600');
        const urls = [`${SITE_URL}/`];
        if (config.statsHost !== '') urls.push(`${new URL(SITE_URL).protocol}//${config.statsHost}/`);
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            ...urls.map((url) => `  <url><loc>${url}</loc></url>`),
            '</urlset>',
            '',
        ].join('\n');
    });
}
