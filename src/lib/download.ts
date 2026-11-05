// Downloads that survive an unstable network and a reload of the page.
//
// A download resumes from the last byte it received with a Range request,
// retries with growing waits, and treats a connection that stops sending as
// dropped. With a resume key, the bytes received so far are kept in
// IndexedDB every few megabytes, so a download that a reload or a crash cut
// short carries on where it stopped next time.

import { getDb } from './db';

const PART_BYTES = 8 * 1024 * 1024;
const MAX_WAIT_MS = 15_000;
// A connection that sends nothing for this long counts as dropped.
const STALL_MS = 20_000;
// How many attempts in a row may fail without receiving a single byte.
const MAX_FAILURES = 12;

/** What a resumable download has kept so far. Its parts are stored apart. */
export interface PartialDownload {
    key: string;
    url: string;
    total: number | null;
    received: number;
    partCount: number;
}

export interface PartialDownloadPart {
    key: string;
    index: number;
    blob: Blob;
}

export interface DownloadProgress {
    received: number;
    total: number | null;
}

export interface RetryNotice {
    /** How many attempts in a row have failed. */
    failures: number;
    waitMs: number;
    reason: string;
}

export interface DownloadOptions {
    /** Keeps the received bytes under this key, so a later call can resume. */
    resumeKey?: string;
    expectedSize?: number;
    signal?: AbortSignal;
    onProgress?: (progress: DownloadProgress) => void;
    onRetry?: (notice: RetryNotice) => void;
}

/** A failure that trying again cannot fix, such as a missing file. */
class FatalDownloadError extends Error {}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                reject(signal.reason);
            },
            { once: true },
        );
    });
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function totalFromHeaders(response: Response, offset: number): number | null {
    const range = response.headers.get('Content-Range');
    const fromRange = range === null ? NaN : Number(range.split('/')[1]);
    if (Number.isFinite(fromRange)) return fromRange;
    const length = Number(response.headers.get('Content-Length'));
    return Number.isFinite(length) && length > 0 ? offset + length : null;
}

async function loadPartial(key: string, url: string): Promise<Blob[] | null> {
    const db = await getDb();
    const partial = await db.get('partials', key);
    if (partial === undefined || partial.url !== url) return null;
    const parts: Blob[] = [];
    for (let index = 0; index < partial.partCount; index++) {
        const part = await db.get('partialParts', [key, index]);
        if (part === undefined) return null;
        parts.push(part.blob);
    }
    return parts;
}

/** Forgets what a resumable download kept, once its result is safe. */
export async function discardPartial(key: string): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(['partials', 'partialParts'], 'readwrite');
    await tx.objectStore('partials').delete(key);
    const parts = tx.objectStore('partialParts');
    for await (const cursor of parts.iterate(IDBKeyRange.bound([key, 0], [key, Infinity]))) {
        await cursor.delete();
    }
    await tx.done;
}

/** Downloads url to a Blob, resuming and retrying as the network allows. */
export async function download(url: string, options: DownloadOptions = {}): Promise<Blob> {
    const { resumeKey, signal, onProgress, onRetry } = options;
    let parts: Blob[] = [];
    let received = 0;
    let total = options.expectedSize ?? null;
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;

    if (resumeKey !== undefined) {
        const kept = await loadPartial(resumeKey, url);
        if (kept !== null) {
            parts = kept;
            received = kept.reduce((sum, part) => sum + part.size, 0);
        } else {
            await discardPartial(resumeKey);
        }
    }

    const keepPending = async () => {
        if (pendingBytes > 0) {
            parts.push(new Blob(pending as BlobPart[]));
            pending = [];
            pendingBytes = 0;
            if (resumeKey !== undefined) {
                const db = await getDb();
                const tx = db.transaction(['partials', 'partialParts'], 'readwrite');
                await tx.objectStore('partialParts').put({
                    key: resumeKey,
                    index: parts.length - 1,
                    blob: parts[parts.length - 1]!,
                });
                await tx.objectStore('partials').put({
                    key: resumeKey,
                    url,
                    total,
                    received,
                    partCount: parts.length,
                });
                await tx.done;
            }
        }
    };

    const startOver = async () => {
        parts = [];
        pending = [];
        pendingBytes = 0;
        received = 0;
        if (resumeKey !== undefined) await discardPartial(resumeKey);
    };

    // Runs one request, and returns once every byte has arrived.
    const attempt = async (): Promise<void> => {
        const guard = new AbortController();
        const abort = () => guard.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        let stall: ReturnType<typeof setTimeout> | undefined;
        const poke = () => {
            clearTimeout(stall);
            stall = setTimeout(() => guard.abort(new Error('the connection stalled')), STALL_MS);
        };
        try {
            poke();
            const headers: HeadersInit = received > 0 ? { Range: `bytes=${received}-` } : {};
            const response = await fetch(url, { headers, cache: 'no-store', signal: guard.signal });
            if (response.status === 416 && total !== null && received === total) return;
            if (!response.ok) {
                const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
                const message = `the server answered ${response.status} ${response.statusText}`.trim();
                if (retryable) throw new Error(message);
                // The server explains refusals, such as a game the player has not unlocked.
                const explained = await response
                    .json()
                    .then((body: { message?: unknown }) => (typeof body.message === 'string' ? body.message : null))
                    .catch(() => null);
                throw new FatalDownloadError(explained ?? message);
            }
            if (received > 0 && response.status !== 206) {
                // The server sent the whole file again, so it starts over.
                await startOver();
            }
            total ??= totalFromHeaders(response, received);
            if (response.body === null) throw new Error('the response has no body');
            const reader = response.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                poke();
                pending.push(value);
                pendingBytes += value.byteLength;
                received += value.byteLength;
                onProgress?.({ received, total });
                if (pendingBytes >= PART_BYTES) await keepPending();
            }
            if (total !== null && received !== total) {
                throw new Error(`the download stopped at ${received} of ${total} bytes`);
            }
        } finally {
            clearTimeout(stall);
            signal?.removeEventListener('abort', abort);
            await keepPending();
        }
    };

    onProgress?.({ received, total });
    let failures = 0;
    for (;;) {
        signal?.throwIfAborted();
        const before = received;
        try {
            await attempt();
            break;
        } catch (error) {
            signal?.throwIfAborted();
            if (error instanceof FatalDownloadError) throw error;
            if (total !== null && received > total) await startOver();
            failures = received > before ? 1 : failures + 1;
            if (failures > MAX_FAILURES) {
                throw new Error(`${describe(error)}, and ${MAX_FAILURES} tries in a row got nothing`);
            }
            const waitMs = Math.min(1000 * 2 ** (failures - 1), MAX_WAIT_MS);
            onRetry?.({ failures, waitMs, reason: describe(error) });
            await sleep(waitMs, signal);
        }
    }
    return new Blob(parts);
}

/** Asks the server which version of url it has, without downloading it. */
async function fetchVersion(url: string): Promise<{ version: string; size?: number } | null> {
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            cache: 'no-store',
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) return null;
        const size = Number(response.headers.get('Content-Length'));
        const version = [
            response.headers.get('ETag'),
            response.headers.get('Last-Modified'),
            response.headers.get('Content-Length'),
        ].join('|');
        return { version, size: size > 0 ? size : undefined };
    } catch {
        return null;
    }
}

export interface CachedDownloadOptions extends Omit<DownloadOptions, 'resumeKey'> {
    cacheName: string;
}

/**
 * Downloads url like download does, and keeps the result in Cache Storage
 * under the version the server reports, so it downloads once per version.
 * When the server cannot be reached, the last version kept is used.
 */
export async function downloadCached(url: string, options: CachedDownloadOptions): Promise<Blob> {
    const { cacheName, ...rest } = options;
    const absolute = new URL(url, location.href).href;
    const cache = await caches.open(cacheName).catch(() => null);
    const kept = (await cache?.keys())?.filter((request) => request.url.startsWith(`${absolute}?v=`)) ?? [];
    const server = await fetchVersion(absolute);

    if (server === null && kept.length > 0) {
        const response = await cache?.match(kept[kept.length - 1]!);
        if (response !== undefined) {
            const blob = await response.blob();
            rest.onProgress?.({ received: blob.size, total: blob.size });
            return blob;
        }
    }

    const key = `${absolute}?v=${encodeURIComponent(server?.version ?? 'unknown')}`;
    const hit = await cache?.match(key);
    if (hit !== undefined) {
        const blob = await hit.blob();
        if (server?.size === undefined || blob.size === server.size) {
            rest.onProgress?.({ received: blob.size, total: blob.size });
            return blob;
        }
    }

    const resumeKey = `cache:${key}`;
    const blob = await download(absolute, {
        ...rest,
        expectedSize: rest.expectedSize ?? server?.size,
        resumeKey,
    });
    if (cache !== null) {
        try {
            await cache.put(key, new Response(blob));
            for (const request of kept) {
                if (request.url !== key) await cache.delete(request);
            }
        } catch {
            // Out of storage: the file still works, it downloads again next time.
        }
    }
    await discardPartial(resumeKey);
    return blob;
}
