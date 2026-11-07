/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
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
    worker: { format: 'es' },
    // The converter's worker uses fflate. Found only once a level is converted,
    // it would make the dev server reload the page mid-import.
    optimizeDeps: { include: ['fflate'] },
    build: { target: 'es2022' },
    // .work holds local scratch files, never tests of the project.
    test: { exclude: ['**/node_modules/**', '**/dist/**', '.work/**'] },
});
