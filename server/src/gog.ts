// GOG sign-in. GOG gives third parties no OAuth, so this follows GOG Galaxy's
// own flow (see config.ts): the player signs in on GOG, lands on an
// embed.gog.com page whose address carries a one-time code, and pastes that
// address into the app. The token the code buys is used once, to read the
// account's name and games, and then forgotten.

import type { LinkedAccount } from '../../shared/api.ts';
import { RELEVANT_GOG_PRODUCTS } from '../../shared/games.ts';
import { HttpError, badRequest } from './errors.ts';
import { call, getJson, isRecord, readJson, type Fetch, type Upstream } from './upstream.ts';

export const GOG_REDIRECT_URI = 'https://embed.gog.com/on_login_success?origin=client';

const GOG: Upstream = { service: 'GOG', code: 'gog_unavailable' };

export function gogLoginUrl(clientId: string): string {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: GOG_REDIRECT_URI,
        response_type: 'code',
        layout: 'client2',
    });
    return `https://auth.gog.com/auth?${params}`;
}

const CODE = /^[A-Za-z0-9._~-]{8,4096}$/;

/** The sign-in code from the address the player pasted, or from the bare code. */
export function extractGogCode(input: unknown): string {
    if (typeof input !== 'string' || input.trim() === '') {
        throw badRequest('Paste the address GOG showed after you signed in.', 'gog_code_missing');
    }
    const text = input.trim();

    if (/[/?=&]/.test(text)) {
        let url: URL;
        try {
            url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
        } catch {
            throw badRequest('That does not look like the address GOG showed. Copy the whole address from the address bar.', 'gog_code_invalid');
        }
        const error = url.searchParams.get('error');
        if (error) {
            const detail = url.searchParams.get('error_description');
            throw badRequest(`GOG did not sign you in${detail ? `: ${detail}` : ''}. Please try again.`, 'gog_denied');
        }
        const code = url.searchParams.get('code');
        if (!code || !CODE.test(code)) {
            throw badRequest(
                'That address has no sign-in code in it. Sign in on GOG, then copy the address of the page you land on.',
                'gog_code_invalid',
            );
        }
        return code;
    }

    if (!CODE.test(text)) {
        throw badRequest('That does not look like a GOG sign-in code. Copy the whole address from the address bar.', 'gog_code_invalid');
    }
    return text;
}

async function exchangeCode(code: string, clientId: string, clientSecret: string, fetchFn: Fetch): Promise<string> {
    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: GOG_REDIRECT_URI,
    });
    const response = await call(fetchFn, GOG, `https://auth.gog.com/token?${params}`);
    if (response.status >= 400 && response.status < 500) {
        // invalid_grant, mostly: the code was used already, or it expired.
        throw badRequest(
            'GOG did not accept that sign-in code. Codes work once and only for a few minutes, so sign in on GOG again and paste the new address.',
            'gog_code_rejected',
        );
    }
    if (!response.ok) {
        throw new HttpError(502, GOG.code, `GOG could not sign you in right now (HTTP ${response.status}). Please try again in a moment.`);
    }
    const body = await readJson(response, GOG);
    if (!isRecord(body) || typeof body.access_token !== 'string' || !body.access_token) {
        throw new HttpError(502, GOG.code, 'GOG sent an answer this server could not read. Please try again.');
    }
    return body.access_token;
}

/** Trades the code for the account's name and the games it owns that unlock something here. */
export async function fetchGogAccount(
    code: string,
    clientId: string,
    clientSecret: string,
    fetchFn: Fetch,
    now = Date.now(),
): Promise<LinkedAccount> {
    const token = await exchangeCode(code, clientId, clientSecret, fetchFn);
    const init = { headers: { authorization: `Bearer ${token}` } };
    const [user, games] = await Promise.all([
        getJson(fetchFn, GOG, 'https://embed.gog.com/userData.json', init),
        getJson(fetchFn, GOG, 'https://embed.gog.com/user/data/games', init),
    ]);

    if (!isRecord(user)) throw new HttpError(502, GOG.code, 'GOG sent an answer this server could not read. Please try again.');
    const rawId = user.galaxyUserId ?? user.userId;
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
    if (!id || user.isLoggedIn === false) {
        throw new HttpError(502, GOG.code, 'GOG did not say which account signed in. Please try again.');
    }
    const name = typeof user.username === 'string' && user.username.trim() ? user.username.slice(0, 64) : `GOG account ${id}`;

    const ownedIds = (isRecord(games) && Array.isArray(games.owned) ? games.owned : []).map(Number);
    return {
        provider: 'gog',
        id,
        name,
        checkedAt: new Date(now).toISOString(),
        owned: RELEVANT_GOG_PRODUCTS.filter((product) => ownedIds.includes(product)),
    };
}
