// The session cookie: the store accounts a player signed in with, signed so
// it cannot be edited to claim games. It holds what the stores said each
// account owns, never what that unlocks: unlocks are worked out from the
// accounts on every request, so changing the rules never needs a new sign-in.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LinkedAccount, MeResponse, Provider } from '../../shared/api.ts';
import { OFFICIAL_GAMES, isUnlocked, type Ownership } from '../../shared/games.ts';
import type { Config } from './config.ts';

export const SESSION_COOKIE = 'trxsuite_session';
export const SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

interface SessionClaims {
    accounts: LinkedAccount[];
    /**
     * Unix seconds. The browser drops the cookie after Max-Age, but a copied
     * cookie would otherwise stay valid forever.
     */
    exp: number;
}

function mac(payload: string, secret: string): Buffer {
    return createHmac('sha256', secret).update(payload).digest();
}

export function signSession(accounts: LinkedAccount[], secret: string, now = Date.now()): string {
    const claims: SessionClaims = { accounts, exp: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${payload}.${mac(payload, secret).toString('base64url')}`;
}

/** The accounts in a session token, or null when it is missing, forged or expired. */
export function verifySession(token: string | undefined, secret: string, now = Date.now()): LinkedAccount[] | null {
    if (!token) return null;
    const dot = token.indexOf('.');
    if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
    const payload = token.slice(0, dot);
    // Compared as text: decoding would ignore the spare bits in the last
    // character and accept several spellings of one signature.
    const given = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(mac(payload, secret).toString('base64url'));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    let claims: unknown;
    try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (typeof claims !== 'object' || claims === null) return null;
    const { accounts, exp } = claims as Partial<Record<keyof SessionClaims, unknown>>;
    if (typeof exp !== 'number' || exp * 1000 <= now || !Array.isArray(accounts)) return null;
    // Signed by us, but possibly by an older version with another shape.
    return accounts.map(sanitizeAccount).filter((account) => account !== null);
}

function isProvider(value: unknown): value is Provider {
    return value === 'steam' || value === 'gog';
}

function sanitizeAccount(value: unknown): LinkedAccount | null {
    if (typeof value !== 'object' || value === null) return null;
    const raw = value as Record<string, unknown>;
    if (!isProvider(raw.provider) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
    if (typeof raw.checkedAt !== 'string' || !Array.isArray(raw.owned)) return null;
    const account: LinkedAccount = {
        provider: raw.provider,
        id: raw.id,
        name: raw.name,
        checkedAt: raw.checkedAt,
        owned: raw.owned.filter((id): id is number => Number.isSafeInteger(id)),
    };
    if (typeof raw.avatarUrl === 'string') account.avatarUrl = raw.avatarUrl;
    if (raw.privateProfile === true) account.privateProfile = true;
    return account;
}

/** A session holds one account per store; signing in again replaces it. */
export function mergeAccount(accounts: readonly LinkedAccount[], account: LinkedAccount): LinkedAccount[] {
    return [...accounts.filter((existing) => existing.provider !== account.provider), account];
}

export function ownershipOf(accounts: readonly LinkedAccount[]): Ownership {
    return {
        steamApps: accounts.filter((account) => account.provider === 'steam').flatMap((account) => account.owned),
        gogProducts: accounts.filter((account) => account.provider === 'gog').flatMap((account) => account.owned),
    };
}

/** Every official game this player may download, free ones included. */
export function unlockedIds(accounts: readonly LinkedAccount[]): string[] {
    const ownership = ownershipOf(accounts);
    return OFFICIAL_GAMES.filter((game) => isUnlocked(game, ownership)).map((game) => game.mod);
}

export function buildMe(accounts: LinkedAccount[], config: Config): MeResponse {
    return {
        accounts,
        unlocked: unlockedIds(accounts),
        providers: { steam: config.steamApiKey !== undefined, gog: true, mock: config.authMock },
    };
}

/** The requesting player's accounts; a bad cookie counts as signed out. */
export function readAccounts(request: FastifyRequest, config: Config): LinkedAccount[] {
    return verifySession(request.cookies[SESSION_COOKIE], config.sessionSecret) ?? [];
}

function cookieOptions(request: FastifyRequest, config: Config) {
    return {
        path: '/',
        httpOnly: true,
        sameSite: 'lax' as const,
        // Plain http only in development; a proxy that ends TLS for us says
        // so through X-Forwarded-Proto, or PUBLIC_URL does.
        secure: request.protocol === 'https' || config.publicUrl.startsWith('https:'),
    };
}

/** Stores the accounts in the reply's cookie, or clears it when there are none. */
export function writeAccounts(
    request: FastifyRequest,
    reply: FastifyReply,
    accounts: LinkedAccount[],
    config: Config,
): void {
    const options = cookieOptions(request, config);
    if (accounts.length === 0) {
        reply.clearCookie(SESSION_COOKIE, options);
        return;
    }
    reply.setCookie(SESSION_COOKIE, signSession(accounts, config.sessionSecret), {
        ...options,
        maxAge: SESSION_MAX_AGE_SECONDS,
    });
}
