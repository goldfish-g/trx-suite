// The stats' addresses: the app's reports, the summary the stats page
// shows, and what the server notes about its own answers.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { MAX_EVENTS_PER_REQUEST, readStatsEvent, STATS_RANGES, type StatsRange, type StatsResponse } from '../../../shared/stats.ts';
import type { Context } from '../app.ts';
import type { Config } from '../config.ts';
import { badRequest, HttpError } from '../errors.ts';
import { requestPath } from '../files.ts';
import { readAccounts } from '../session.ts';
import type { Stats } from './stats.ts';

/** What one address may report in a window: a busy player sends a few a minute. */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_EVENTS = 600;
/** Paths of the server itself, which bots' guesses are never among. */
const SERVER_PATHS = /^\/(?:api|auth|engines|flyby|ring|sfx|assets|stats)(?:\/|$)/;

export function isStatsHost(request: FastifyRequest, config: Config): boolean {
    return config.statsHost !== '' && request.hostname.toLowerCase() === config.statsHost;
}

function rateLimiter(now: () => number) {
    const windows = new Map<string, { start: number; n: number }>();
    return (address: string, n: number): boolean => {
        const time = now();
        let window = windows.get(address);
        if (window === undefined || time - window.start >= RATE_WINDOW_MS) {
            if (windows.size > 50_000) {
                for (const [key, entry] of windows) if (time - entry.start >= RATE_WINDOW_MS) windows.delete(key);
            }
            window = { start: time, n: 0 };
            windows.set(address, window);
        }
        window.n += n;
        return window.n <= RATE_EVENTS;
    };
}

export function registerStatsRoutes(app: FastifyInstance, context: Context, stats: Stats): void {
    const { config } = context;
    const allow = rateLimiter(context.now);

    app.post('/api/stats/events', async (request, reply) => {
        const body: unknown = request.body;
        const raw = typeof body === 'object' && body !== null ? (body as { events?: unknown }).events : undefined;
        if (!Array.isArray(raw) || raw.length > MAX_EVENTS_PER_REQUEST) {
            throw badRequest(`Send {"events": [...]} with at most ${MAX_EVENTS_PER_REQUEST} events.`);
        }
        if (!allow(request.ip, raw.length)) throw new HttpError(429, 'too_many', 'Too many reports from this address; try later.');
        const now = context.now();
        const events = raw.map((event) => readStatsEvent(event, now)).filter((event) => event !== null);
        stats.take(events, {
            address: request.ip,
            userAgent: String(request.headers['user-agent'] ?? '').slice(0, 512),
            accounts: readAccounts(request, config),
        });
        return reply.code(204).send();
    });

    app.get<{ Querystring: { range?: string } }>('/api/stats', async (request, reply): Promise<StatsResponse> => {
        const range = STATS_RANGES.includes(request.query.range as StatsRange) ? (request.query.range as StatsRange) : '30';
        reply.header('cache-control', 'public, max-age=60');
        return stats.summary(range);
    });

    // Bytes that went out in full, by what they were.
    app.addHook('onResponse', async (request, reply) => {
        if (request.method !== 'GET' || isStatsHost(request, config)) return;
        if (reply.statusCode !== 200 && reply.statusCode !== 206) return;
        // A download cut short never ends its answer.
        if (!reply.raw.writableEnded) return;
        const length = Number(reply.getHeader('content-length'));
        if (Number.isFinite(length)) stats.sent(requestPath(request), length);
    });

    // Bots knocking on doors this server does not have.
    app.addHook('onRequest', async (request) => {
        if (isStatsHost(request, config)) return;
        const path = requestPath(request);
        if (SERVER_PATHS.test(path)) return;
        let decoded = path;
        try {
            decoded = decodeURIComponent(path);
        } catch {
            // Counted as it came.
        }
        stats.probe(decoded);
    });
}
