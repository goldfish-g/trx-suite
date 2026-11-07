// Who the player is: the session, and signing in with Steam or (in tests)
// a made-up account.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
    LinkedAccount,
    MeResponse,
    MockLoginRequest,
    PollResponse,
    Provider,
    SteamStartResponse,
} from '../../shared/api.ts';
import type { Context } from './app.ts';
import { HttpError, badRequest } from './errors.ts';
import { authResultPage } from './pages.ts';
import { buildMe, mergeAccount, readAccounts, writeAccounts } from './session.ts';
import { fetchSteamAccount, steamLoginUrl, verifySteamAssertion } from './steam.ts';

function isProvider(value: unknown): value is Provider {
    return value === 'steam';
}

function bodyObject(request: FastifyRequest): Record<string, unknown> {
    const body: unknown = request.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw badRequest('Send a JSON object.');
    }
    return body as Record<string, unknown>;
}

export function registerAccountRoutes(app: FastifyInstance, context: Context): void {
    const { config, logins } = context;

    app.get('/api/me', async (request): Promise<MeResponse> => buildMe(readAccounts(request, config), config));

    app.post('/api/logout', async (request, reply): Promise<MeResponse> => {
        writeAccounts(request, reply, [], config);
        return buildMe([], config);
    });

    app.delete<{ Params: { provider: string } }>('/api/accounts/:provider', async (request, reply): Promise<MeResponse> => {
        const { provider } = request.params;
        if (!isProvider(provider)) throw badRequest(`There is no store called "${provider}".`);
        const accounts = readAccounts(request, config).filter((account) => account.provider !== provider);
        writeAccounts(request, reply, accounts, config);
        return buildMe(accounts, config);
    });

    // --- Steam -------------------------------------------------------------

    app.post('/api/auth/steam/start', async (): Promise<SteamStartResponse> => {
        if (config.steamApiKey === undefined) {
            throw new HttpError(503, 'steam_disabled', 'Steam sign-in is not set up on this server.');
        }
        const { state, login } = logins.create(
            (state) => `${config.publicUrl}/auth/steam/callback?${new URLSearchParams({ state })}`,
        );
        return { url: steamLoginUrl(login.returnTo, config.publicUrl), state };
    });

    app.get('/auth/steam/callback', async (request, reply) => {
        // The raw query, not Fastify's parse: every openid.* field goes back
        // to Steam exactly as it arrived.
        const queryStart = request.url.indexOf('?');
        const query = new URLSearchParams(queryStart === -1 ? '' : request.url.slice(queryStart + 1));
        const state = query.get('state') ?? '';
        const login = state ? logins.get(state) : undefined;

        reply
            .type('text/html; charset=utf-8')
            .header('cache-control', 'no-store')
            .header('referrer-policy', 'no-referrer');
        const page = (ok: boolean, title: string, message: string, withState = true) =>
            authResultPage({ ok, title, message, appUrl: config.publicUrl, ...(withState ? { state } : {}) });

        if (!login) {
            return reply.code(410).send(page(false, 'Sign-in expired', 'This sign-in took too long or was already finished.', false));
        }
        if (login.callbackSeen) {
            return reply.code(409).send(page(false, 'Already used', 'This sign-in was already finished.', false));
        }
        login.callbackSeen = true;

        try {
            if (config.steamApiKey === undefined) {
                throw new HttpError(503, 'steam_disabled', 'Steam sign-in is not set up on this server.');
            }
            const steamId = await verifySteamAssertion(query, login.returnTo, context.fetch);
            const account = await fetchSteamAccount(steamId, config.steamApiKey, context.fetch, context.now());
            login.result = { account };
            const message = account.privateProfile
                ? `Signed in as ${account.name}, but Steam keeps this account's game details private, so it could not say which games you own.`
                : `Signed in as ${account.name}.`;
            return reply.send(page(true, 'Signed in with Steam', message));
        } catch (error) {
            const message = error instanceof HttpError ? error.message : 'Something went wrong while checking with Steam.';
            if (!(error instanceof HttpError) || error.statusCode >= 500) {
                request.log.warn({ err: error }, 'Steam sign-in failed');
            }
            login.result = { error: message };
            return reply.code(error instanceof HttpError ? error.statusCode : 500).send(page(false, 'Not signed in', message));
        }
    });

    app.get<{ Querystring: { state?: unknown } }>('/api/auth/poll', async (request, reply): Promise<PollResponse> => {
        const state = request.query.state;
        if (typeof state !== 'string' || state === '') throw badRequest('Say which sign-in to check: ?state=…');
        const login = logins.get(state);
        if (!login) return { status: 'error', message: 'This sign-in expired. Please start again.' };
        if (!login.result) return { status: 'pending' };

        logins.delete(state);
        if ('error' in login.result) return { status: 'error', message: login.result.error };
        // This request comes from the app itself, so the cookie lands in the
        // app's cookie jar wherever the player signed in on Steam.
        const accounts = mergeAccount(readAccounts(request, config), login.result.account);
        writeAccounts(request, reply, accounts, config);
        return { status: 'done', me: buildMe(accounts, config) };
    });

    // --- Made-up accounts, for end-to-end tests ----------------------------

    if (config.authMock) {
        app.post('/api/auth/mock', async (request, reply): Promise<MeResponse> => {
            const body = bodyObject(request) as Partial<Record<keyof MockLoginRequest, unknown>>;
            if (!isProvider(body.provider)) throw badRequest('provider must be "steam".');
            // Capped so the session cookie stays under the browsers' 4 KB limit.
            if (!Array.isArray(body.owned) || body.owned.length > 50 || !body.owned.every((id) => Number.isSafeInteger(id))) {
                throw badRequest('owned must be a list of store ids.');
            }
            if (body.name !== undefined && typeof body.name !== 'string') throw badRequest('name must be text.');
            const account: LinkedAccount = {
                provider: body.provider,
                id: `mock-${body.provider}`,
                name: (body.name as string | undefined)?.slice(0, 64) || 'Mock Steam player',
                checkedAt: new Date(context.now()).toISOString(),
                owned: body.owned as number[],
            };
            if (body.privateProfile === true) account.privateProfile = true;
            const accounts = mergeAccount(readAccounts(request, config), account);
            writeAccounts(request, reply, accounts, config);
            return buildMe(accounts, config);
        });
    }
}
