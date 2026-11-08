/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiProxy } from './vite/proxy';
import { serviceWorker } from './vite/pwa';

// COOP/COEP headers are required for SharedArrayBuffer, which the TRX
// engine uses for its threads. The API server sends them for what it
// serves; these cover the page while developing.
const crossOriginIsolationHeaders = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
};

const root = fileURLToPath(new URL('.', import.meta.url));

// Which converter the page runs, as a hash of its source: a level converted
// by another may lack fixes made since, and the custom levels screen offers
// to convert it again.
function converterVersion(): string {
    const hash = createHash('sha256');
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else hash.update(relative(root, path)).update(readFileSync(path));
        }
    };
    try {
        walk(join(root, 'converter/client/src/converter'));
        walk(join(root, 'converter/client/src/templates'));
    } catch {
        return 'unknown';
    }
    return hash.digest('hex').slice(0, 12);
}

// Serving over https (needed on phones: threads want a secure context) when
// a certificate is given.
const https =
    process.env.DEV_HTTPS_KEY && process.env.DEV_HTTPS_CERT
        ? { key: readFileSync(process.env.DEV_HTTPS_KEY), cert: readFileSync(process.env.DEV_HTTPS_CERT) }
        : undefined;

export default defineConfig({
    plugins: [react(), serviceWorker(`${root}vite/sw-template.js`, `${root}public`)],
    server: {
        headers: crossOriginIsolationHeaders,
        proxy: apiProxy(process.env.TRX_API_URL ?? 'http://localhost:3002'),
        https,
    },
    preview: { headers: crossOriginIsolationHeaders },
    define: { __CONVERTER_VERSION__: JSON.stringify(converterVersion()) },
    worker: { format: 'es' },
    // The converter's worker uses fflate. Found only once a level is converted,
    // it would make the dev server reload the page mid-import.
    optimizeDeps: { include: ['fflate'] },
    build: { target: 'es2022' },
    // .work holds local scratch files, never tests of the project.
    test: { exclude: ['**/node_modules/**', '**/dist/**', '.work/**'] },
});
