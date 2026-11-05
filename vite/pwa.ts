// Writes the service worker (vite/sw-template.js) into the build, with the
// list of files the app needs to open offline and a version that changes
// whenever any of them does.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

/** Public files that are served, not part of the app shell. */
const NOT_PRECACHED = /^(engines|flyby|gd|dev)\//;
/** Font subsets for scripts the app never shows. */
const SKIPPED_FONTS = /(cyrillic|greek|vietnamese)/;

function listFiles(directory: string, root = directory): string[] {
    let out: string[] = [];
    let names: string[] = [];
    try {
        names = readdirSync(directory);
    } catch {
        return out;
    }
    for (const name of names) {
        const path = join(directory, name);
        const rel = relative(root, path).replace(/\\/g, '/');
        if (NOT_PRECACHED.test(`${rel}/`) || NOT_PRECACHED.test(rel)) continue;
        if (statSync(path).isDirectory()) out = out.concat(listFiles(path, root));
        else if (!name.startsWith('.') && !name.endsWith('.md')) out.push(rel);
    }
    return out;
}

export function serviceWorker(templatePath: string, publicDir: string): Plugin {
    return {
        name: 'trx-web:service-worker',
        apply: 'build',
        generateBundle(_options, bundle) {
            const built = Object.keys(bundle).filter(
                (file) => !file.endsWith('.map') && !SKIPPED_FONTS.test(file) && file !== 'sw.js',
            );
            const urls = [...new Set(['/', '/index.html', ...built.map((file) => `/${file}`), ...listFiles(publicDir).map((file) => `/${file}`)])].sort();
            const hash = createHash('sha256');
            for (const file of built) {
                const chunk = bundle[file]!;
                hash.update(file);
                hash.update(chunk.type === 'chunk' ? chunk.code : typeof chunk.source === 'string' ? chunk.source : Buffer.from(chunk.source));
            }
            const version = hash.digest('hex').slice(0, 12);
            const source = readFileSync(templatePath, 'utf8')
                .replaceAll('__VERSION__', JSON.stringify(version))
                .replaceAll('__PRECACHE__', JSON.stringify(urls, null, 2));
            this.emitFile({ type: 'asset', fileName: 'sw.js', source });
        },
    };
}
