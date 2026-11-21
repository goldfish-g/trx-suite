// The server's checker (src/custom/convert/check.ts): the page's converter
// and archive reader as one Node script, with every package it uses inside,
// since the server's image installs none of the page's. Built after the
// page into server-dist/checker/; server/src/unplayable.ts runs it.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { converterVersion } from './vite/converter-version';

const root = fileURLToPath(new URL('.', import.meta.url));

/** UnRAR's WebAssembly as base64 (virtual:unrar-wasm), so the checker needs no file beside it. */
function unrarWasm(): Plugin {
    const id = 'virtual:unrar-wasm';
    return {
        name: 'unrar-wasm',
        resolveId: (source) => (source === id ? '\0' + id : null),
        load(loaded) {
            if (loaded !== '\0' + id) return null;
            const path = createRequire(import.meta.url).resolve('node-unrar-js/esm/js/unrar.wasm');
            return `export default ${JSON.stringify(readFileSync(path).toString('base64'))};`;
        },
    };
}

export default defineConfig({
    publicDir: false,
    plugins: [unrarWasm()],
    define: { __CONVERTER_VERSION__: JSON.stringify(converterVersion(root)) },
    ssr: { noExternal: true, target: 'node' },
    build: {
        ssr: `${root}src/custom/convert/check.ts`,
        outDir: `${root}server-dist/checker`,
        emptyOutDir: true,
        target: 'node22',
        rollupOptions: { output: { entryFileNames: 'check.mjs', chunkFileNames: '[name]-[hash].mjs' } },
    },
});
