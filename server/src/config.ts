// Server settings, read once from the environment at startup.

import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * GOG offers no OAuth to third parties, so sign-in borrows the GOG Galaxy
 * client's public credentials, as Heroic, Lutris and lgogdownloader do.
 * They ship inside every Galaxy install and are not a secret of ours.
 */
export const GOG_GALAXY_CLIENT_ID = '46899977096215655';
export const GOG_GALAXY_CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9';

export interface Config {
    port: number;
    host: string;
    /** Where players reach the app, without a trailing slash. Steam returns here. */
    publicUrl: string;
    /** Signs session cookies. */
    sessionSecret: string;
    /** Steam sign-in needs a Web API key to ask what an account owns. */
    steamApiKey: string | undefined;
    gogClientId: string;
    gogClientSecret: string;
    /** Holds catalog.json; paths inside it resolve against this. */
    dataDir: string;
    enginesDir: string;
    /** The built page (vite build output). */
    staticDir: string;
    /** Offers POST /api/auth/mock, for end-to-end tests. Never in production. */
    authMock: boolean;
    httpsKeyFile: string | undefined;
    httpsCertFile: string | undefined;
}

export class ConfigError extends Error {}

export interface LoadedConfig {
    config: Config;
    /** Things worth telling whoever starts the server. */
    warnings: string[];
}

function nonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function parsePort(value: string | undefined): number {
    if (value === undefined) return 3002;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ConfigError(`PORT must be a port number, not "${value}".`);
    }
    return port;
}

function parsePublicUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new ConfigError(`PUBLIC_URL must be an absolute address such as https://trx.example.com, not "${value}".`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ConfigError('PUBLIC_URL must start with http:// or https://.');
    }
    if (url.search || url.hash) {
        throw new ConfigError('PUBLIC_URL must not carry a query or fragment.');
    }
    return url.href.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv, cwd = process.cwd()): LoadedConfig {
    const warnings: string[] = [];
    const production = env.NODE_ENV === 'production';
    const port = parsePort(nonEmpty(env.PORT));

    let sessionSecret = nonEmpty(env.SESSION_SECRET);
    if (sessionSecret === undefined) {
        if (production) throw new ConfigError('SESSION_SECRET must be set when NODE_ENV=production.');
        sessionSecret = randomBytes(32).toString('base64url');
        warnings.push('SESSION_SECRET is not set, so a random one was made: every restart signs players out.');
    } else if (sessionSecret.length < 32) {
        // A short secret makes forging session cookies, and with them game
        // unlocks, a matter of guessing.
        if (production) throw new ConfigError('SESSION_SECRET must be at least 32 characters long.');
        warnings.push('SESSION_SECRET is shorter than 32 characters; use a long random value in production.');
    }

    const authMock = env.AUTH_MOCK === '1';
    if (authMock) {
        if (production) throw new ConfigError('AUTH_MOCK=1 lets anyone unlock every game; it is refused when NODE_ENV=production.');
        warnings.push('AUTH_MOCK=1: anyone can sign in with a made-up account and unlock every game.');
    }

    const steamApiKey = nonEmpty(env.STEAM_API_KEY);
    if (steamApiKey === undefined) warnings.push('STEAM_API_KEY is not set, so Steam sign-in is off.');

    const httpsKeyFile = nonEmpty(env.HTTPS_KEY);
    const httpsCertFile = nonEmpty(env.HTTPS_CERT);
    if ((httpsKeyFile === undefined) !== (httpsCertFile === undefined)) {
        throw new ConfigError('Set both HTTPS_KEY and HTTPS_CERT to serve HTTPS, or neither.');
    }

    const scheme = httpsKeyFile ? 'https' : 'http';
    const publicUrl = parsePublicUrl(nonEmpty(env.PUBLIC_URL) ?? `${scheme}://localhost:${port}`);
    if (production && !publicUrl.startsWith('https:')) {
        warnings.push('PUBLIC_URL is not https: browsers only run the engine (SharedArrayBuffer) in secure contexts.');
    }

    const dataDir = resolve(cwd, nonEmpty(env.DATA_DIR) ?? 'data');
    return {
        config: {
            port,
            host: nonEmpty(env.HOST) ?? '0.0.0.0',
            publicUrl,
            sessionSecret,
            steamApiKey,
            gogClientId: nonEmpty(env.GOG_CLIENT_ID) ?? GOG_GALAXY_CLIENT_ID,
            gogClientSecret: nonEmpty(env.GOG_CLIENT_SECRET) ?? GOG_GALAXY_CLIENT_SECRET,
            dataDir,
            enginesDir: resolve(cwd, nonEmpty(env.ENGINES_DIR) ?? resolve(dataDir, 'engines')),
            staticDir: resolve(cwd, nonEmpty(env.STATIC_DIR) ?? 'dist'),
            authMock,
            httpsKeyFile: httpsKeyFile && resolve(cwd, httpsKeyFile),
            httpsCertFile: httpsCertFile && resolve(cwd, httpsCertFile),
        },
        warnings,
    };
}
