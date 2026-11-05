// In development Vite serves the page and hands everything else to the API
// server (scripts/dev.mjs starts both). Wire it in with
//   server: { proxy: apiProxy(process.env.TRX_API_URL ?? 'http://localhost:3002') }
// The API server sets the cross-origin isolation headers on every response,
// and the proxy passes them through unchanged.

import type { ProxyOptions } from 'vite';

/** The paths the API server answers; everything else is the page's. */
const SERVER_PATHS = '^/(?:api|auth|engines|flyby)(?:[/?]|$)';

export function apiProxy(target: string): Record<string, ProxyOptions> {
    return {
        [SERVER_PATHS]: {
            target,
            // Keep the browser's Host: the server builds its own addresses
            // from PUBLIC_URL, and logs are clearer this way.
            changeOrigin: false,
            // X-Forwarded-Proto tells the server whether the browser used
            // https, which decides the session cookie's Secure flag.
            xfwd: true,
            // The API server may itself run https with a self-signed
            // certificate (HTTPS_KEY/HTTPS_CERT) for testing on phones.
            secure: false,
        },
    };
}
