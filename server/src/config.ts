// Server settings, read once from the environment at startup.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Config {
    port: number;
    host: string;
    /** Where players reach the app, without a trailing slash. Steam returns here. */
    publicUrl: string;
    /** Signs session cookies. */
    sessionSecret: string;
    /** Steam sign-in needs a Web API key to ask what an account owns. */
    steamApiKey: string | undefined;
    /** Holds catalog.json; paths inside it resolve against this. */
    dataDir: string;
    enginesDir: string;
    /** The built page (vite build output). */
    staticDir: string;
    /** Offers POST /api/auth/mock, for end-to-end tests. Never in production. */
    authMock: boolean;
    httpsKeyFile: string | undefined;
    httpsCertFile: string | undefined;
    /** TRCustoms, which the custom levels browser lists, and where its images live. */
    trcustomsUrl: string;
    trcustomsMediaUrl: string;
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

/**
 * A secret kept in a file, as a mounted Docker secret is, so it stays out of
 * the container's environment. Surrounding whitespace is dropped.
 */
function readSecret(path: string | undefined, name: string, cwd: string): string | undefined {
    const file = nonEmpty(path);
    if (file === undefined) return undefined;
    let text: string;
    try {
        text = readFileSync(resolve(cwd, file), 'utf8');
    } catch (error) {
        throw new ConfigError(`${name} names a file that cannot be read: ${(error as Error).message}`);
    }
    const secret = text.trim();
    if (secret === '') throw new ConfigError(`${name} names an empty file.`);
    return secret;
}

export function loadConfig(env: NodeJS.ProcessEnv, cwd = process.cwd()): LoadedConfig {
    const warnings: string[] = [];
    const production = env.NODE_ENV === 'production';
    const port = parsePort(nonEmpty(env.PORT));

    let sessionSecret = nonEmpty(env.SESSION_SECRET) ?? readSecret(env.SESSION_SECRET_FILE, 'SESSION_SECRET_FILE', cwd);
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

    const steamApiKey = nonEmpty(env.STEAM_API_KEY) ?? readSecret(env.STEAM_API_KEY_FILE, 'STEAM_API_KEY_FILE', cwd);
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
            dataDir,
            enginesDir: resolve(cwd, nonEmpty(env.ENGINES_DIR) ?? resolve(dataDir, 'engines')),
            staticDir: resolve(cwd, nonEmpty(env.STATIC_DIR) ?? 'dist'),
            authMock,
            httpsKeyFile: httpsKeyFile && resolve(cwd, httpsKeyFile),
            httpsCertFile: httpsCertFile && resolve(cwd, httpsCertFile),
            trcustomsUrl: (nonEmpty(env.TRCUSTOMS_URL) ?? 'https://trcustoms.org').replace(/\/+$/, ''),
            trcustomsMediaUrl: (nonEmpty(env.TRCUSTOMS_MEDIA_URL) ?? 'https://data.trcustoms.org/media').replace(/\/*$/, '/'),
        },
        warnings,
    };
}
