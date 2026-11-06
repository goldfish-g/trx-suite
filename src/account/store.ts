// Who the player is to the server: the store accounts they signed in with
// and the games those unlock, plus the server's catalog. Both are kept in
// the browser so the menus still know them offline.

import { create } from 'zustand';
import type {
    ApiError,
    CatalogEntry,
    CatalogResponse,
    GogStartResponse,
    MeResponse,
    PollResponse,
    Provider,
    SteamStartResponse,
} from '../../shared/api.ts';

const ME_KEY = 'trx-suite:me';
const CATALOG_KEY = 'trx-suite:catalog';

interface AccountState {
    me: MeResponse | null;
    catalog: CatalogEntry[];
    /** Whether the last request reached the server. */
    online: boolean;
    loaded: boolean;
}

function readCache<T>(key: string): T | null {
    try {
        const text = localStorage.getItem(key);
        return text === null ? null : (JSON.parse(text) as T);
    } catch {
        return null;
    }
}

function writeCache(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Private windows may refuse; the menus then just forget offline.
    }
}

export const useAccount = create<AccountState>(() => ({
    me: readCache<MeResponse>(ME_KEY),
    catalog: readCache<CatalogEntry[]>(CATALOG_KEY) ?? [],
    online: navigator.onLine,
    loaded: false,
}));

export class ApiRequestError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        ...init,
        headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
        credentials: 'same-origin',
        cache: 'no-store',
    });
    const body = (await response.json().catch(() => null)) as (T & Partial<ApiError>) | null;
    if (!response.ok) {
        throw new ApiRequestError(body?.message ?? `The server answered ${response.status}.`);
    }
    if (body === null) throw new ApiRequestError('The server sent an empty answer.');
    return body;
}

function setMe(me: MeResponse): void {
    writeCache(ME_KEY, me);
    useAccount.setState({ me, online: true });
}

/** Asks the server who the player is and what it offers them. */
export async function refreshAccount(): Promise<void> {
    try {
        const [me, catalog] = await Promise.all([
            api<MeResponse>('/api/me'),
            api<CatalogResponse>('/api/catalog'),
        ]);
        writeCache(CATALOG_KEY, catalog.entries);
        setMe(me);
        useAccount.setState({ catalog: catalog.entries, loaded: true });
    } catch (error) {
        console.warn('[account] the server is out of reach:', error);
        useAccount.setState({ online: false, loaded: true });
    }
}

async function refreshCatalog(): Promise<void> {
    const catalog = await api<CatalogResponse>('/api/catalog');
    writeCache(CATALOG_KEY, catalog.entries);
    useAccount.setState({ catalog: catalog.entries });
}

async function signedIn(me: MeResponse): Promise<MeResponse> {
    setMe(me);
    await refreshCatalog().catch(() => {});
    return me;
}

export interface SignInHandle {
    /** Settles once the player finished signing in on the store's page. */
    done: Promise<MeResponse>;
    cancel(): void;
    /** The page to open, if the browser blocked the window. */
    url: string;
}

const POLL_MS = 2000;
const POLL_LIMIT_MS = 10 * 60 * 1000;

/**
 * Signs in with Steam: opens Steam's page, then asks the server until Steam
 * sent the player back. Polling (rather than a redirect back to the app)
 * works even where the store page opens outside the installed app.
 */
export async function startSteamSignIn(): Promise<SignInHandle> {
    // Open the window before awaiting, while the click still counts as one.
    const popup = window.open('about:blank', 'trx-suite-steam', 'popup,width=820,height=760');
    let start: SteamStartResponse;
    try {
        start = await api<SteamStartResponse>('/api/auth/steam/start', { method: 'POST' });
    } catch (error) {
        popup?.close();
        throw error;
    }
    if (popup !== null && !popup.closed) popup.location.href = start.url;

    let cancelled = false;
    let wake: (() => void) | null = null;
    const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; state?: string } | null;
        if (event.origin === location.origin && data?.type === 'trx-suite-auth' && data.state === start.state) wake?.();
    };
    window.addEventListener('message', onMessage);

    const done = (async () => {
        const deadline = Date.now() + POLL_LIMIT_MS;
        try {
            while (!cancelled && Date.now() < deadline) {
                await new Promise<void>((resolve) => {
                    wake = resolve;
                    setTimeout(resolve, POLL_MS);
                });
                if (cancelled) break;
                let answer: PollResponse;
                try {
                    answer = await api<PollResponse>(`/api/auth/poll?state=${encodeURIComponent(start.state)}`);
                } catch {
                    continue; // a dropped request; ask again
                }
                if (answer.status === 'done') return await signedIn(answer.me);
                if (answer.status === 'error') throw new ApiRequestError(answer.message);
            }
            throw new ApiRequestError(cancelled ? 'Signing in was cancelled.' : 'Signing in took too long. Try again.');
        } finally {
            window.removeEventListener('message', onMessage);
        }
    })();
    return {
        done,
        url: start.url,
        cancel() {
            cancelled = true;
            wake?.();
            popup?.close();
        },
    };
}

/** The GOG page to sign in on; GOG then shows a page whose address the player pastes back. */
export async function gogSignInUrl(): Promise<string> {
    return (await api<GogStartResponse>('/api/auth/gog/start')).url;
}

export async function completeGogSignIn(input: string): Promise<MeResponse> {
    const me = await api<MeResponse>('/api/auth/gog/complete', { method: 'POST', body: JSON.stringify({ input }) });
    return signedIn(me);
}

export async function unlinkAccount(provider: Provider): Promise<void> {
    const me = await api<MeResponse>(`/api/accounts/${provider}`, { method: 'DELETE' });
    await signedIn(me);
}

export async function signOut(): Promise<void> {
    await api<unknown>('/api/logout', { method: 'POST' }).catch(() => {});
    await refreshAccount();
}

/** Only on servers started with AUTH_MOCK=1, for tests. */
export async function mockSignIn(provider: Provider, owned: number[]): Promise<MeResponse> {
    const me = await api<MeResponse>('/api/auth/mock', { method: 'POST', body: JSON.stringify({ provider, owned }) });
    return signedIn(me);
}

window.addEventListener('online', () => void refreshAccount());
