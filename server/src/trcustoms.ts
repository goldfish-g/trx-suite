// Custom levels from TRCustoms (trcustoms.org), passed through to the page.
// TRCustoms sends no CORS headers and its images no Cross-Origin-Resource-
// Policy, so a cross-origin isolated page, as the engine needs, can reach
// neither. This server lists and describes levels in the trimmed form the
// page shows, sends their images, and streams their archives: every request
// of a download, each resume included, gets a fresh link to the storage
// behind TRCustoms, whose links work for a minute.

import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FastifyInstance } from 'fastify';
import type {
    CustomLevelDetails,
    CustomLevelFile,
    CustomLevelGame,
    CustomLevelPage,
    CustomLevelSort,
    CustomLevelSummary,
} from '../../shared/api.ts';
import type { Context } from './app.ts';
import { badRequest, HttpError, notFound } from './errors.ts';
import { call, isRecord, readJson, type Upstream } from './upstream.ts';

const UPSTREAM: Upstream = { service: 'TRCustoms', code: 'trcustoms_unreachable' };

/** TRCustoms' engine ids for the games the converter takes. */
const ENGINE_IDS: Record<CustomLevelGame, number> = { 1: 5, 2: 3, 3: 4 };
const GAMES_BY_ENGINE = new Map<number, CustomLevelGame>([
    [5, 1],
    [3, 2],
    [4, 3],
]);

const SORTS: Record<CustomLevelSort, string> = {
    newest: '-created',
    rating: '-rating',
    downloads: '-download_count',
    name: 'name',
};

const PAGE_SIZE = 24;
const JSON_TTL_MS = 5 * 60_000;
const JSON_CACHE_ENTRIES = 300;
const MEDIA_CACHE_BYTES = 64 * 1024 * 1024;
/** Until the storage answers; after that the page notices a stalled download itself. */
const STORAGE_TIMEOUT_MS = 20_000;
/** TRCustoms names every image after a UUID. */
const MEDIA_PATH = /^level_images\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp|gif)$/i;
const PASSED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'content-disposition'];

export interface TrcustomsOptions {
    /** TRCustoms itself, such as https://trcustoms.org. */
    baseUrl: string;
    /** Where its images live, such as https://data.trcustoms.org/media/. */
    mediaUrl: string;
}

// ------------------------------------------------------------ reading answers

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function count(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nameOf(value: unknown): string | null {
    return isRecord(value) && typeof value.name === 'string' ? value.name : null;
}

function names(value: unknown): string[] {
    return Array.isArray(value) ? value.map(nameOf).filter((name): name is string => name !== null) : [];
}

function authorName(value: unknown): string | null {
    if (!isRecord(value)) return null;
    return text(value.username) || [text(value.first_name), text(value.last_name)].filter(Boolean).join(' ') || null;
}

/** This server's address for one of TRCustoms' images, or null for one it would not pass on. */
function mediaPath(url: unknown, options: TrcustomsOptions): string | null {
    if (typeof url !== 'string' || !url.startsWith(options.mediaUrl)) return null;
    const path = url.slice(options.mediaUrl.length);
    return MEDIA_PATH.test(path) ? `/api/trcustoms/media/${path}` : null;
}

function fileOf(value: unknown): CustomLevelFile | null {
    if (!isRecord(value) || typeof value.id !== 'number') return null;
    return {
        id: value.id,
        version: count(value.version) || 1,
        sizeBytes: count(value.size),
        url: `/api/trcustoms/files/${value.id}`,
    };
}

function summaryOf(level: Record<string, unknown>, options: TrcustomsOptions): CustomLevelSummary {
    const engine = isRecord(level.engine) ? level.engine : {};
    const rating = isRecord(level.rating_class) ? level.rating_class : null;
    return {
        id: count(level.id),
        name: text(level.name) || 'Untitled',
        game: GAMES_BY_ENGINE.get(count(engine.id)) ?? null,
        engineName: text(engine.name),
        authors: (Array.isArray(level.authors) ? level.authors : []).map(authorName).filter((name): name is string => name !== null),
        difficulty: nameOf(level.difficulty),
        duration: nameOf(level.duration),
        rating: rating === null ? null : { name: text(rating.name), position: count(rating.position) },
        genres: names(level.genres),
        cover: isRecord(level.cover) ? mediaPath(level.cover.url, options) : null,
        releaseDate: text(level.release_date),
        downloads: count(level.download_count),
        reviews: count(level.review_count),
        file: fileOf(level.last_file),
    };
}

function detailsOf(level: Record<string, unknown>, options: TrcustomsOptions): CustomLevelDetails {
    const screenshots = (Array.isArray(level.screenshots) ? level.screenshots : [])
        .filter(isRecord)
        .sort((a, b) => count(a.position) - count(b.position))
        .map((shot) => (isRecord(shot.file) ? mediaPath(shot.file.url, options) : null))
        .filter((url): url is string => url !== null);
    return {
        ...summaryOf(level, options),
        description: text(level.description),
        tags: names(level.tags),
        screenshots,
        walkthroughs: count(level.walkthrough_count),
        lastUpdated: text(level.last_updated),
        pageUrl: `${options.baseUrl}/levels/${count(level.id)}`,
    };
}

// ------------------------------------------------------------ caches

/** Answers kept a few minutes, so paging back and forth spares TRCustoms. */
function jsonCache<T>(now: () => number) {
    const entries = new Map<string, { at: number; value: Promise<T> }>();
    return (key: string, load: () => Promise<T>): Promise<T> => {
        const hit = entries.get(key);
        if (hit !== undefined && now() - hit.at < JSON_TTL_MS) return hit.value;
        const value = load();
        entries.set(key, { at: now(), value });
        // A failure is not worth keeping.
        value.catch(() => {
            if (entries.get(key)?.value === value) entries.delete(key);
        });
        while (entries.size > JSON_CACHE_ENTRIES) entries.delete(entries.keys().next().value!);
        return value;
    };
}

interface Image {
    type: string;
    body: Buffer;
}

/** Images by path, the most recently used kept up to a total size. */
function imageCache() {
    const entries = new Map<string, Promise<Image>>();
    const sizes = new Map<string, number>();
    let total = 0;
    return (key: string, load: () => Promise<Image>): Promise<Image> => {
        const hit = entries.get(key);
        if (hit !== undefined) {
            entries.delete(key);
            entries.set(key, hit);
            return hit;
        }
        const value = load();
        entries.set(key, value);
        value.then(
            (image) => {
                if (entries.get(key) !== value) return;
                sizes.set(key, image.body.length);
                total += image.body.length;
                for (const old of entries.keys()) {
                    if (total <= MEDIA_CACHE_BYTES || old === key) break;
                    total -= sizes.get(old) ?? 0;
                    sizes.delete(old);
                    entries.delete(old);
                }
            },
            () => {
                if (entries.get(key) === value) entries.delete(key);
            },
        );
        return value;
    };
}

// ------------------------------------------------------------ routes

function parseGame(value: unknown): CustomLevelGame {
    const game = Number(value);
    if (game === 1 || game === 2 || game === 3) return game;
    throw badRequest('game must be 1, 2 or 3.');
}

function parseId(value: string, what: string): number {
    if (!/^\d{1,9}$/.test(value)) throw notFound(`There is no such ${what}.`);
    return Number(value);
}

export function registerTrcustomsRoutes(app: FastifyInstance, context: Context, options: TrcustomsOptions): void {
    const { fetch } = context;
    const lists = jsonCache<CustomLevelPage>(context.now);
    const levels = jsonCache<CustomLevelDetails>(context.now);
    const images = imageCache();

    app.get<{ Querystring: { game?: string; page?: string; sort?: string; search?: string } }>(
        '/api/trcustoms/levels',
        async (request, reply): Promise<CustomLevelPage> => {
            const game = parseGame(request.query.game);
            const page = Math.max(1, Math.min(10_000, Math.floor(Number(request.query.page ?? 1)) || 1));
            const sort = SORTS[request.query.sort as CustomLevelSort] ?? SORTS.newest;
            const search = (request.query.search ?? '').trim().slice(0, 100);
            const url = new URL('/api/levels/', options.baseUrl);
            url.searchParams.set('engines', String(ENGINE_IDS[game]));
            url.searchParams.set('page', String(page));
            url.searchParams.set('page_size', String(PAGE_SIZE));
            url.searchParams.set('sort', sort);
            if (search !== '') url.searchParams.set('search', search);

            reply.header('cache-control', 'private, max-age=120');
            return lists(url.href, async () => {
                const response = await call(fetch, UPSTREAM, url);
                // A page past the end answers 404 "Invalid page.".
                if (response.status === 404) return { levels: [], page, pages: page - 1, total: 0 };
                if (!response.ok) {
                    throw new HttpError(502, UPSTREAM.code, `TRCustoms turned the request down (HTTP ${response.status}). Please try again in a moment.`);
                }
                const body: unknown = await response.json().catch(() => null);
                if (!isRecord(body) || !Array.isArray(body.results)) {
                    throw new HttpError(502, UPSTREAM.code, 'TRCustoms sent an answer this server could not read.');
                }
                return {
                    levels: body.results.filter(isRecord).map((level) => summaryOf(level, options)),
                    page: count(body.current_page) || page,
                    pages: count(body.last_page),
                    total: count(body.total_count),
                };
            });
        },
    );

    app.get<{ Params: { id: string } }>('/api/trcustoms/levels/:id', async (request, reply): Promise<CustomLevelDetails> => {
        const id = parseId(request.params.id, 'level');
        reply.header('cache-control', 'private, max-age=120');
        return levels(String(id), async () => {
            const url = new URL(`/api/levels/${id}/`, options.baseUrl);
            const response = await call(fetch, UPSTREAM, url);
            if (response.status === 404) throw notFound('TRCustoms has no such level, or it is not public.');
            if (!response.ok) {
                await response.body?.cancel();
                throw new HttpError(502, UPSTREAM.code, `TRCustoms turned the request down (HTTP ${response.status}). Please try again in a moment.`);
            }
            const body = await readJson(response, UPSTREAM);
            if (!isRecord(body)) throw new HttpError(502, UPSTREAM.code, 'TRCustoms sent an answer this server could not read.');
            return detailsOf(body, options);
        });
    });

    app.get<{ Params: { '*': string } }>('/api/trcustoms/media/*', async (request, reply) => {
        const path = request.params['*'];
        if (!MEDIA_PATH.test(path)) throw notFound();
        const image = await images(path, async () => {
            const response = await call(fetch, UPSTREAM, options.mediaUrl + path);
            const type = response.headers.get('content-type') ?? '';
            if (!response.ok || !type.startsWith('image/')) {
                await response.body?.cancel();
                throw notFound('TRCustoms has no such image.');
            }
            return { type, body: Buffer.from(await response.arrayBuffer()) };
        });
        // Each image is named after a UUID, so it never changes.
        return reply.header('cache-control', 'public, max-age=31536000, immutable').type(image.type).send(image.body);
    });

    /** Follows TRCustoms' download link to the signed storage link it hands out. */
    const storageLink = async (fileId: number): Promise<string> => {
        let url = new URL(`/api/level_files/${fileId}/download/`, options.baseUrl);
        for (let hop = 0; hop < 4; hop++) {
            const response = await call(fetch, UPSTREAM, url, { redirect: 'manual' });
            await response.body?.cancel();
            // Servers that keep files themselves send the file straight away.
            if (response.status === 200) return url.href;
            const location = response.headers.get('location');
            if (response.status >= 300 && response.status < 400 && location !== null) {
                const next = new URL(location, url);
                // A file it does not have, or keeps hidden, leads to its 404 page.
                if (next.pathname.replace(/\/+$/, '') === '/404') break;
                if (next.origin === url.origin && next.pathname.startsWith('/api/')) {
                    url = next;
                    continue;
                }
                return next.href;
            }
            if (response.status === 404) break;
            throw new HttpError(502, UPSTREAM.code, `TRCustoms turned the download down (HTTP ${response.status}). Please try again in a moment.`);
        }
        throw notFound('TRCustoms does not have this file any more.');
    };

    app.get<{ Params: { id: string } }>('/api/trcustoms/files/:id', async (request, reply) => {
        const link = await storageLink(parseId(request.params.id, 'file'));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
        // A player who stops the download stops it here too.
        reply.raw.on('close', () => {
            if (!reply.raw.writableFinished) controller.abort();
        });
        const range = request.headers.range;
        let file: Response;
        try {
            file = await fetch(link, { headers: range === undefined ? {} : { range }, signal: controller.signal });
        } catch {
            throw new HttpError(502, UPSTREAM.code, 'The storage behind TRCustoms did not answer. Please try again in a moment.');
        } finally {
            clearTimeout(timer);
        }
        if (file.status !== 200 && file.status !== 206 && file.status !== 416) {
            await file.body?.cancel();
            throw new HttpError(502, UPSTREAM.code, `The storage behind TRCustoms answered HTTP ${file.status}. Please try again in a moment.`);
        }
        reply.code(file.status);
        for (const name of PASSED_HEADERS) {
            const value = file.headers.get(name);
            if (value !== null) reply.header(name, value);
        }
        reply.header('cache-control', 'private, no-store');
        if (file.body === null) return reply.send();
        return reply.send(Readable.fromWeb(file.body as unknown as WebReadableStream<Uint8Array>));
    });
}
