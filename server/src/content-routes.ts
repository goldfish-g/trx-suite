// What players download: the catalog and its archives, engine builds, and
// the flyby levels behind the menus and the objects on their ring.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { CatalogResponse } from '../../shared/api.ts';
import { isUnlocked } from '../../shared/games.ts';
import type { Context } from './app.ts';
import { catalogEntries, findArchive, findFlyby, flybyManifest } from './catalog.ts';
import { HttpError, notFound } from './errors.ts';
import { requestPath, resolveInside, sendFile, statFile } from './files.ts';
import { ownershipOf, readAccounts } from './session.ts';

const NO_CACHE = 'no-cache';

async function engineVersions(enginesDir: string): Promise<string[]> {
    try {
        const entries = await readdir(enginesDir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    } catch {
        return [];
    }
}

export function registerContentRoutes(app: FastifyInstance, context: Context): void {
    const { config, loadCatalog } = context;

    app.get('/api/catalog', async (request): Promise<CatalogResponse> => {
        const catalog = await loadCatalog();
        return { entries: await catalogEntries(catalog, readAccounts(request, config)) };
    });

    // Every request, each Range request of a download included, proves
    // ownership afresh from the session cookie.
    app.get<{ Params: { id: string } }>('/api/gamedata/:id', async (request, reply) => {
        const archive = findArchive(await loadCatalog(), request.params.id);
        const stats = archive && (await statFile(archive.path));
        if (!archive || !stats) throw notFound('This server does not offer that game.');
        if (!isUnlocked(archive.game, ownershipOf(readAccounts(request, config)))) {
            throw new HttpError(
                403,
                'locked',
                `Sign in with Steam or GOG with an account that owns ${archive.game.title} to download it.`,
            );
        }
        // private: the answer depends on who asks, so shared caches must not
        // keep it.
        return sendFile(request, reply, archive.path, stats, { cacheControl: 'private, no-cache' });
    });

    app.get('/engines/manifest.json', async (request, reply) => {
        const path = join(config.enginesDir, 'manifest.json');
        const stats = await statFile(path);
        if (stats) return sendFile(request, reply, path, stats, { cacheControl: NO_CACHE });
        return { versions: await engineVersions(config.enginesDir) };
    });

    app.get('/engines/*', async (request, reply) => {
        const path = resolveInside(config.enginesDir, requestPath(request).slice('/engines/'.length));
        const stats = path && (await statFile(path));
        if (!path || !stats) throw notFound();
        return sendFile(request, reply, path, stats, { cacheControl: NO_CACHE });
    });

    app.get('/flyby/manifest.json', async () => flybyManifest(await loadCatalog()));

    // Build the ring's models while the server starts, not when the first
    // player asks.
    app.addHook('onReady', async () => {
        void loadCatalog()
            .then((catalog) => context.ringModels(catalog))
            .catch((error: unknown) => app.log.warn(`ring models: ${(error as Error).message}`));
    });

    app.get('/ring/manifest.json', async (_request, reply) => {
        reply.header('cache-control', NO_CACHE);
        return (await context.ringModels(await loadCatalog())).manifest;
    });

    // Each file's name carries a hash of its contents, so it never changes.
    app.get<{ Params: { file: string } }>('/ring/:file', async (request, reply) => {
        const json = (await context.ringModels(await loadCatalog())).files.get(request.params.file);
        if (json === undefined) throw notFound();
        return reply.header('cache-control', 'public, max-age=31536000, immutable').type('application/json').send(json);
    });

    app.get<{ Params: { mod: string; file: string } }>('/flyby/:mod/:file', async (request, reply) => {
        const level = findFlyby(await loadCatalog(), request.params.mod, request.params.file);
        const stats = level && (await statFile(level.path));
        if (!level || !stats) throw notFound();
        return sendFile(request, reply, level.path, stats, { cacheControl: NO_CACHE });
    });
}
