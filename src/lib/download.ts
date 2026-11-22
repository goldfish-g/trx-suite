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
    /**
     * Lets the browser's HTTP cache keep the file, for an address that names
     * its version. Other downloads bypass it, which would only hold a second
     * copy.
     */
    httpCache?: boolean;
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

/**
 * Whether the server compressed its answer. Its Content-Length then counts
 * the compressed bytes, while the body arrives unpacked: it says nothing of
 * the file's size.
 */
function isCompressed(response: Response): boolean {
    const encoding = response.headers.get('Content-Encoding')?.trim().toLowerCase();
    return encoding !== undefined && encoding !== '' && encoding !== 'identity';
}

function totalFromHeaders(response: Response, offset: number): number | null {
    const range = response.headers.get('Content-Range');
    const fromRange = range === null ? NaN : Number(range.split('/')[1]);
    if (Number.isFinite(fromRange)) return fromRange;
    if (isCompressed(response)) return null;
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
            // Copies of their bytes, a part at a time. A Blob read from
            // IndexedDB and stored again is, in Safari, the same stored data,
            // which goes when the parts are discarded: the file kept from them
            // would then no longer read ("The object can not be found here").
            for (const part of kept) parts.push(new Blob([await part.arrayBuffer()]));
            received = parts.reduce((sum, part) => sum + part.size, 0);
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
            const response = await fetch(url, { headers, cache: options.httpCache === true ? 'default' : 'no-store', signal: guard.signal });
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
        const size = isCompressed(response) ? NaN : Number(response.headers.get('Content-Length'));
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

/** A file kept by version (see downloadStored). */
export interface StoredFile {
    /** The address of the version, as `<address>?v=<version>`. */
    key: string;
    /** The absolute address, which names no version. */
    url: string;
    blob: Blob;
}

export interface StoredDownloadOptions extends Omit<DownloadOptions, 'resumeKey'> {
    /**
     * The Cache Storage cache earlier versions of the app kept the file in,
     * whose copy plays when the server cannot be reached and nothing is
     * stored yet. It goes before the file downloads anew, to make room.
     */
    legacyCache?: string;
}

export interface StoredDownload {
    blob: Blob;
    /** The address of the version the blob holds, as `url?v=<version>`. */
    url: string;
    /** Whether the server answered, or the file is the last version kept. */
    reachable: boolean;
}

/**
 * Downloads url like download does, and keeps the result in IndexedDB under
 * the version the server reports, so it downloads once per version. When the
 * server cannot be reached, the last version kept is used. With httpCache,
 * the download goes to the version's own address, which the browser's HTTP
 * cache may keep too.
 *
 * IndexedDB, not Cache Storage: a Blob read back from IndexedDB stays on
 * disk until something reads it, while Safari brings a whole Cache Storage
 * answer into the page's memory, several times over, as soon as it is
 * matched. For the engine's 350 MB package that came to 1.5 GB, more than
 * iOS lets a page have.
 */
export async function downloadStored(url: string, options: StoredDownloadOptions): Promise<StoredDownload> {
    const { legacyCache, ...rest } = options;
    const absolute = new URL(url, location.href).href;
    const db = await getDb();
    const kept = await db.getAllKeysFromIndex('stored', 'byUrl', absolute);
    const server = await fetchVersion(absolute);
    const found = (blob: Blob, key: string): StoredDownload => {
        rest.onProgress?.({ received: blob.size, total: blob.size });
        return { blob, url: key, reachable: server !== null };
    };

    if (server === null) {
        const last = kept.length > 0 ? await db.get('stored', kept[kept.length - 1]!) : undefined;
        if (last !== undefined) return found(last.blob, last.key);
        const legacy = legacyCache === undefined ? null : await readLegacyCache(legacyCache, absolute);
        if (legacy !== null) return found(legacy.blob, legacy.url);
    }

    const key = `${absolute}?v=${encodeURIComponent(server?.version ?? 'unknown')}`;
    const hit = await db.get('stored', key);
    if (hit !== undefined && (server?.size === undefined || hit.blob.size === server.size)) {
        if (await readable(hit.blob)) return found(hit.blob, key);
        // Stored by an earlier version from parts since discarded: it downloads again.
        await db.delete('stored', key);
    }

    const resumeKey = `cache:${key}`;
    // Older versions, kept for offline use, make room for this one first.
    for (const old of kept) {
        if (old !== key) await db.delete('stored', old);
    }
    if (legacyCache !== undefined && typeof caches !== 'undefined') await caches.delete(legacyCache).catch(() => false);
    let blob = await download(rest.httpCache === true ? key : absolute, {
        ...rest,
        expectedSize: rest.expectedSize ?? server?.size,
        resumeKey,
    });
    try {
        await db.put('stored', { key, url: absolute, blob });
        // The stored copy, which waits on disk, rather than the one just put together.
        blob = (await db.get('stored', key))?.blob ?? blob;
    } catch (error) {
        // Out of storage: the file still works, from the download's own
        // parts, which stay for the next time, which then needs no download.
        // Discarding them would leave the blob reading from files gone.
        console.warn(`[download] ${absolute} could not be stored:`, error);
        return { blob, url: key, reachable: server !== null };
    }
    await discardPartial(resumeKey);
    return { blob, url: key, reachable: server !== null };
}

/** The last version of url an earlier version of the app kept in Cache Storage. */
async function readLegacyCache(cacheName: string, absolute: string): Promise<{ blob: Blob; url: string } | null> {
    try {
        if (typeof caches === 'undefined' || !(await caches.has(cacheName))) return null;
        const cache = await caches.open(cacheName);
        const request = (await cache.keys()).filter((kept) => kept.url.startsWith(`${absolute}?v=`)).at(-1);
        const response = request === undefined ? undefined : await cache.match(request);
        return response === undefined ? null : { blob: await response.blob(), url: request!.url };
    } catch {
        return null;
    }
}

/** Forgets every stored file whose address keep turns down. */
export async function forgetStored(keep: (url: string) => boolean): Promise<void> {
    const db = await getDb();
    for (const key of await db.getAllKeys('stored')) {
        const url = key.slice(0, key.lastIndexOf('?v='));
        if (!keep(url)) await db.delete('stored', key);
    }
}

/** Whether a stored Blob's first and last bytes still read, as they do unless its data is gone. */
async function readable(blob: Blob): Promise<boolean> {
    try {
        await blob.slice(0, 1).arrayBuffer();
        await blob.slice(Math.max(0, blob.size - 1)).arrayBuffer();
        return true;
    } catch {
        return false;
    }
}
