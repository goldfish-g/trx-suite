// The levels the Browse section has fetched from TRCustoms, a page at a
// time, kept for each game, order and search while the page is open, so
// switching tabs back and forth shows them at once.

import { create } from 'zustand';
import type { CustomLevelGame, CustomLevelSort, CustomLevelSummary } from '../../shared/api.ts';
import { fetchLevelPage } from './api';

export interface BrowseQuery {
    game: CustomLevelGame;
    sort: CustomLevelSort;
    search: string;
}

export interface BrowseList {
    levels: CustomLevelSummary[];
    /** The last page fetched, 0 before the first. */
    page: number;
    /** How many pages there are, once the first has come. */
    pages: number | null;
    total: number | null;
    loading: boolean;
    error: string | null;
}

export const SORTS: readonly { sort: CustomLevelSort; label: string }[] = [
    { sort: 'newest', label: 'Newest' },
    { sort: 'rating', label: 'Top rated' },
    { sort: 'downloads', label: 'Most downloaded' },
    { sort: 'name', label: 'A–Z' },
];

const EMPTY: BrowseList = { levels: [], page: 0, pages: null, total: null, loading: false, error: null };

export const useBrowse = create<{ lists: Record<string, BrowseList> }>(() => ({ lists: {} }));

export function browseKey({ game, sort, search }: BrowseQuery): string {
    return `${game}|${sort}|${search.trim().toLowerCase()}`;
}

export function browseList(query: BrowseQuery): BrowseList {
    return useBrowse.getState().lists[browseKey(query)] ?? EMPTY;
}

function put(key: string, list: BrowseList): void {
    useBrowse.setState((state) => ({ lists: { ...state.lists, [key]: list } }));
}

export function hasMore(list: BrowseList): boolean {
    return list.pages === null || list.page < list.pages;
}

/** Fetches the next page of a list, unless one is on its way or there is none. */
export async function loadMore(query: BrowseQuery): Promise<void> {
    const key = browseKey(query);
    const list = browseList(query);
    if (list.loading || !hasMore(list)) return;
    put(key, { ...list, loading: true, error: null });
    try {
        const next = await fetchLevelPage(query.game, list.page + 1, query.sort, query.search);
        const current = browseList(query);
        // A level that moved between pages while paging must not show twice.
        const seen = new Set(current.levels.map((level) => level.id));
        put(key, {
            levels: [...current.levels, ...next.levels.filter((level) => !seen.has(level.id))],
            page: next.levels.length === 0 ? Math.max(current.page, next.pages) : next.page,
            pages: next.pages,
            total: next.total,
            loading: false,
            error: null,
        });
    } catch (error) {
        put(key, { ...browseList(query), loading: false, error: error instanceof Error ? error.message : String(error) });
    }
}
