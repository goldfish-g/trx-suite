// Calls to Steam and GOG. Their failures become HttpErrors the player can
// read; the request URL is never part of one, because Steam's carries our
// API key.

import { HttpError } from './errors.ts';

export type Fetch = typeof globalThis.fetch;

const TIMEOUT_MS = 15_000;

export interface Upstream {
    /** Who answered, for messages: "Steam", "GOG". */
    service: string;
    /** The ApiError code for "could not reach them". */
    code: string;
}

/** Fetches, turning network failures and timeouts into a 502 the player can read. */
export async function call(fetchFn: Fetch, upstream: Upstream, url: string | URL, init: RequestInit = {}): Promise<Response> {
    try {
        return await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
        throw new HttpError(502, upstream.code, `${upstream.service} did not answer. Please try again in a moment.`);
    }
}

export async function readJson(response: Response, upstream: Upstream): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        throw new HttpError(502, upstream.code, `${upstream.service} sent an answer this server could not read. Please try again.`);
    }
}

/** Fetches JSON that must come back with a 2xx status. */
export async function getJson(fetchFn: Fetch, upstream: Upstream, url: string | URL, init?: RequestInit): Promise<unknown> {
    const response = await call(fetchFn, upstream, url, init);
    if (!response.ok) {
        throw new HttpError(
            502,
            upstream.code,
            `${upstream.service} turned the request down (HTTP ${response.status}). Please try again in a moment.`,
        );
    }
    return readJson(response, upstream);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
