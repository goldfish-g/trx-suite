// Builds the server: the page, the engine and game files, and sign-in.
// main.ts listens with it; the tests inject requests into it.

import { readFileSync } from 'node:fs';
import type { Server as HttpsServer } from 'node:https';
import { extname, join } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import {
    fastify,
    type FastifyError,
    type FastifyHttpsOptions,
    type FastifyInstance,
    type FastifyServerOptions,
} from 'fastify';
import type { ApiError } from '../../shared/api.ts';
import { registerAccountRoutes } from './account-routes.ts';
import { createCatalogStore, type Catalog, type LoadCatalog } from './catalog.ts';
import type { Config } from './config.ts';
import { registerContentRoutes } from './content-routes.ts';
import { HttpError, notFound } from './errors.ts';
import { requestPath, resolveInside, sendFile, statFile } from './files.ts';
import { createLoginStore, type LoginStore } from './logins.ts';
import { createRingModels, type RingModelSet } from './ring.ts';
import type { Fetch } from './upstream.ts';

export interface AppDeps {
    /** Reaches Steam and GOG; tests pass a fake. */
    fetch?: Fetch;
    now?: () => number;
    logger?: FastifyServerOptions['logger'];
}

/** What the route modules share. */
export interface Context {
    config: Config;
    fetch: Fetch;
    now: () => number;
    loadCatalog: LoadCatalog;
    logins: LoginStore;
    ringModels: (catalog: Catalog) => Promise<RingModelSet>;
}

/** Paths the page's client-side routes must never shadow. */
const SERVER_PATHS = /^\/(?:api|auth|engines|flyby|ring)(?:\/|$)/;
const API_PATHS = /^\/api(?:\/|$)/;
/** Vite fingerprints everything under /assets, so a name never changes meaning. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

const STATUS_CODES: Record<number, string> = {
    400: 'bad_request',
    404: 'not_found',
    405: 'method_not_allowed',
    413: 'too_large',
    415: 'unsupported_media_type',
};

function apiError(error: string, message: string): ApiError {
    return { error, message };
}

export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
    const options: FastifyServerOptions = {
        logger: deps.logger ?? false,
        // Behind a proxy, X-Forwarded-Proto says whether the player used
        // https, which decides the cookie's Secure flag. Nothing else here
        // trusts forwarded headers.
        trustProxy: true,
        bodyLimit: 64 * 1024,
    };
    const https =
        config.httpsKeyFile && config.httpsCertFile
            ? { key: readFileSync(config.httpsKeyFile), cert: readFileSync(config.httpsCertFile) }
            : null;
    // Fastify types an https server apart from an http one; the routes are
    // the same for both.
    const app = https
        ? (fastify({ ...options, https } as FastifyHttpsOptions<HttpsServer>) as unknown as FastifyInstance)
        : fastify(options);

    await app.register(fastifyCookie);

    // The engine needs SharedArrayBuffer, which browsers only allow on a
    // cross-origin isolated page, so every response carries these: the page,
    // its scripts, the engine files, and errors alike.
    app.addHook('onSend', async (request, reply, payload) => {
        reply.header('cross-origin-opener-policy', 'same-origin');
        reply.header('cross-origin-embedder-policy', 'require-corp');
        reply.header('cross-origin-resource-policy', 'same-origin');
        reply.header('x-content-type-options', 'nosniff');
        const api = API_PATHS.test(requestPath(request));
        if (!reply.hasHeader('cache-control')) reply.header('cache-control', api ? 'private, no-cache' : 'no-cache');
        if (api) reply.header('vary', 'Cookie');
        return payload;
    });

    // SameSite=Lax already keeps the cookie off other sites' form posts;
    // this also stops them from replacing a player's session with another.
    app.addHook('onRequest', async (request) => {
        if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
        if (request.headers['sec-fetch-site'] === 'cross-site') {
            throw new HttpError(403, 'cross_site', 'This server does not take requests from other sites.');
        }
    });

    // Bodyless POSTs sent with a JSON content type are common enough from
    // fetch() that refusing them would only cause confusion.
    const parseJson = app.getDefaultJsonParser('error', 'error');
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
        if (typeof body !== 'string' || body.trim() === '') done(null, undefined);
        else parseJson(request, body, done);
    });

    app.setErrorHandler((error: FastifyError, request, reply) => {
        if (error instanceof HttpError) return reply.code(error.statusCode).send(apiError(error.code, error.message));
        const status = error.statusCode ?? 500;
        if (status >= 400 && status < 500) {
            return reply.code(status).send(apiError(STATUS_CODES[status] ?? 'request_failed', error.message));
        }
        request.log.error({ err: error }, 'request failed');
        return reply.code(500).send(apiError('internal', 'Something went wrong on the server.'));
    });

    app.setNotFoundHandler((_request, reply) => reply.code(404).send(apiError('not_found', 'Not found.')));

    const context: Context = {
        config,
        fetch: deps.fetch ?? globalThis.fetch,
        now: deps.now ?? Date.now,
        loadCatalog: createCatalogStore(config.dataDir, app.log),
        logins: createLoginStore(deps.now),
        ringModels: createRingModels(app.log),
    };
    registerContentRoutes(app, context);
    registerAccountRoutes(app, context);
    registerPageRoutes(app, config);
    return app;
}

/** The built page, with index.html standing in for the page's own routes. */
function registerPageRoutes(app: FastifyInstance, config: Config): void {
    const indexPath = join(config.staticDir, 'index.html');

    app.get('/*', async (request, reply) => {
        const path = requestPath(request);
        if (SERVER_PATHS.test(path)) throw notFound();

        const file = resolveInside(config.staticDir, path);
        const stats = file && (await statFile(file));
        if (file && stats) {
            return sendFile(request, reply, file, stats, { cacheControl: path.startsWith('/assets/') ? IMMUTABLE : 'no-cache' });
        }

        // The page's routes have no extension; a missing script or image
        // should fail loudly rather than come back as HTML.
        if (!extname(path.slice(path.lastIndexOf('/') + 1))) {
            const indexStats = await statFile(indexPath);
            if (indexStats) return sendFile(request, reply, indexPath, indexStats, { cacheControl: 'no-cache' });
        }
        throw notFound();
    });
}
