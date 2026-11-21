// The stats page (stats.tombs.nexus): a small page of its own, built after
// the app into dist/stats, so the app's service worker never carries it.
// The server answers its host with dist/stats/index.html.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiProxy } from './vite/proxy';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    root: `${root}src/stats-page`,
    base: '/stats/',
    publicDir: false,
    plugins: [react()],
    server: { proxy: apiProxy(process.env.TRX_API_URL ?? 'http://localhost:3002') },
    build: { outDir: `${root}dist/stats`, emptyOutDir: true, target: 'es2022' },
});
