// Steam sign-in: OpenID 2.0 proves which account the player holds, then the
// Web API says which of our games it owns.

import type { LinkedAccount } from '../../shared/api.ts';
import { RELEVANT_STEAM_APPS } from '../../shared/games.ts';
import { HttpError } from './errors.ts';
import { call, getJson, isRecord, type Fetch, type Upstream } from './upstream.ts';

export const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
/**
 * check_authentication only vouches for the fields listed in openid.signed.
 * An assertion that leaves one of these out could carry a forged value next
 * to a genuine signature.
 */
const MUST_BE_SIGNED = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce'];

const STEAM: Upstream = { service: 'Steam', code: 'steam_unavailable' };

export function steamLoginUrl(returnTo: string, realm: string): string {
    const params = new URLSearchParams({
        'openid.ns': OPENID_NS,
        'openid.mode': 'checkid_setup',
        'openid.return_to': returnTo,
        'openid.realm': realm,
        'openid.identity': IDENTIFIER_SELECT,
        'openid.claimed_id': IDENTIFIER_SELECT,
    });
    return `${STEAM_OPENID_ENDPOINT}?${params}`;
}

function rejected(): HttpError {
    return new HttpError(400, 'steam_invalid', 'Steam could not confirm this sign-in. Please start again from the app.');
}

/**
 * Checks Steam's answer on the callback and asks Steam to confirm it signed
 * it. Returns the 64-bit Steam id.
 */
export async function verifySteamAssertion(query: URLSearchParams, expectedReturnTo: string, fetchFn: Fetch): Promise<string> {
    const openid = new Map<string, string>();
    for (const [key, value] of query) {
        if (!key.startsWith('openid.')) continue;
        // Which copy would Steam check, and which would we believe?
        if (openid.has(key)) throw rejected();
        openid.set(key, value);
    }

    if (openid.get('openid.mode') === 'cancel') {
        throw new HttpError(400, 'steam_cancelled', 'The sign-in was cancelled on Steam.');
    }
    if (openid.get('openid.mode') !== 'id_res' || openid.get('openid.ns') !== OPENID_NS) throw rejected();
    if (openid.get('openid.op_endpoint') !== STEAM_OPENID_ENDPOINT) throw rejected();
    if (openid.get('openid.return_to') !== expectedReturnTo) throw rejected();
    const claimedId = openid.get('openid.claimed_id') ?? '';
    const steamId = CLAIMED_ID.exec(claimedId)?.[1];
    if (steamId === undefined || openid.get('openid.identity') !== claimedId) throw rejected();
    const signed = (openid.get('openid.signed') ?? '').split(',');
    if (!MUST_BE_SIGNED.every((field) => signed.includes(field)) || !openid.get('openid.sig')) throw rejected();

    const body = new URLSearchParams([...openid]);
    body.set('openid.mode', 'check_authentication');
    const response = await call(fetchFn, STEAM, STEAM_OPENID_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!response.ok) {
        throw new HttpError(502, STEAM.code, `Steam turned the check down (HTTP ${response.status}). Please try again.`);
    }
    const lines = (await response.text()).split('\n').map((line) => line.trim());
    if (!lines.includes('is_valid:true')) throw rejected();
    return steamId;
}

function apiUrl(path: string, params: Record<string, string>): URL {
    const url = new URL(path, 'https://api.steampowered.com/');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
}

interface OwnedGames {
    owned: number[];
    privateProfile: boolean;
}

async function ownedGames(steamId: string, apiKey: string, fetchFn: Fetch): Promise<OwnedGames> {
    const url = apiUrl('IPlayerService/GetOwnedGames/v1/', {
        key: apiKey,
        steamid: steamId,
        include_played_free_games: '1',
        include_free_sub: '1',
        skip_unvetted_apps: '0',
    });
    RELEVANT_STEAM_APPS.forEach((app, index) => url.searchParams.set(`appids_filter[${index}]`, String(app)));
    const body = await getJson(fetchFn, STEAM, url);
    const response = isRecord(body) && isRecord(body.response) ? body.response : {};
    // Steam leaves game_count out, rather than answering 0, when the
    // profile's game details are private.
    if (typeof response.game_count !== 'number') return { owned: [], privateProfile: true };
    const games = Array.isArray(response.games) ? response.games : [];
    const appIds = games.map((game) => (isRecord(game) ? game.appid : undefined));
    const owned = RELEVANT_STEAM_APPS.filter((app) => appIds.includes(app));
    return { owned, privateProfile: false };
}

interface Profile {
    name: string;
    avatarUrl?: string;
}

async function profile(steamId: string, apiKey: string, fetchFn: Fetch): Promise<Profile> {
    const fallback = { name: `Steam account ${steamId}` };
    try {
        const body = await getJson(fetchFn, STEAM, apiUrl('ISteamUser/GetPlayerSummaries/v2/', { key: apiKey, steamids: steamId }));
        const players = isRecord(body) && isRecord(body.response) ? body.response.players : undefined;
        const player: unknown = Array.isArray(players) ? players[0] : undefined;
        if (!isRecord(player)) return fallback;
        const result: Profile = {
            name: typeof player.personaname === 'string' && player.personaname.trim() ? player.personaname.slice(0, 64) : fallback.name,
        };
        if (typeof player.avatarmedium === 'string' && player.avatarmedium.startsWith('https://')) {
            result.avatarUrl = player.avatarmedium;
        }
        return result;
    } catch {
        // The name and picture are cosmetic; ownership is what matters.
        return fallback;
    }
}

/** Asks Steam what the account owns and what it is called. */
export async function fetchSteamAccount(steamId: string, apiKey: string, fetchFn: Fetch, now = Date.now()): Promise<LinkedAccount> {
    const [games, who] = await Promise.all([ownedGames(steamId, apiKey, fetchFn), profile(steamId, apiKey, fetchFn)]);
    const account: LinkedAccount = {
        provider: 'steam',
        id: steamId,
        name: who.name,
        checkedAt: new Date(now).toISOString(),
        owned: games.owned,
    };
    if (who.avatarUrl) account.avatarUrl = who.avatarUrl;
    if (games.privateProfile) account.privateProfile = true;
    return account;
}
