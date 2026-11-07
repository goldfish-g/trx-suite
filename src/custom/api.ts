// Asks this app's server about TRCustoms' levels (server/src/trcustoms.ts).

import type { ApiError, CustomLevelDetails, CustomLevelGame, CustomLevelPage, CustomLevelSort } from '../../shared/api.ts';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, { signal });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(navigator.onLine ? 'The server did not answer. Please try again in a moment.' : 'You are offline. Browsing TRCustoms needs a connection; your installed levels play without one.');
    }
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        throw new Error(body?.message ?? `The server answered ${response.status}.`);
    }
    return (await response.json()) as T;
}

export function fetchLevelPage(
    game: CustomLevelGame,
    page: number,
    sort: CustomLevelSort,
    search: string,
    signal?: AbortSignal,
): Promise<CustomLevelPage> {
    const query = new URLSearchParams({ game: String(game), page: String(page), sort });
    if (search.trim() !== '') query.set('search', search.trim());
    return getJson(`/api/trcustoms/levels?${query}`, signal);
}

export function fetchLevelDetails(id: number, signal?: AbortSignal): Promise<CustomLevelDetails> {
    return getJson(`/api/trcustoms/levels/${id}`, signal);
}
