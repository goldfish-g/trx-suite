// The main theme of the games whose levels the server flies through for
// everyone (catalog.json's "flyby"), read out of the game's archive: a
// music file of its own, or one track of Tomb Raider III's cdaudio.wad.
// The page turns ADPCM into something a browser plays (src/audio/themes.ts).

import type { Catalog } from './catalog.ts';
import { statFile } from './files.ts';
import { listZip, readZipEntry, readZipRange, type ZipEntry } from './zip.ts';
import { findThemeFile, MAIN_THEMES, themeType, WAD_TABLE_BYTES, wadEntry } from '../../shared/themes.ts';

export interface ThemeSource {
    archive: string;
    entry: ZipEntry;
    /** The track's bytes within the entry, for cdaudio.wad. */
    range?: { offset: number; size: number };
    type: string;
    /** Changes when the file does, for the address. */
    tag: string;
}

const found = new Map<string, { stamp: string; source: ThemeSource | null }>();

/** The theme of a game in the catalog, or null without one. */
export async function findServerTheme(catalog: Catalog, mod: string): Promise<ThemeSource | null> {
    const archive = catalog.games.get(mod);
    const main = MAIN_THEMES[mod];
    const stats = archive === undefined ? null : await statFile(archive);
    if (archive === undefined || main === undefined || stats === null) return null;
    const stamp = `${archive}:${stats.size}:${stats.mtimeMs}`;
    const cached = found.get(mod);
    if (cached?.stamp === stamp) return cached.source;
    let source: ThemeSource | null = null;
    const entries = await listZip(archive);
    const file = findThemeFile(
        entries.map((entry) => entry.path),
        main.track,
    );
    const entry = file === null ? undefined : entries.find((candidate) => candidate.path === file.path);
    if (file !== null && entry !== undefined) {
        if (file.wadEntry === undefined) {
            source = { archive, entry, type: themeType(file.path), tag: `${entry.size}` };
        } else {
            const range = wadEntry(await readZipRange(archive, entry, 0, WAD_TABLE_BYTES), file.wadEntry);
            if (range !== null) source = { archive, entry, range, type: 'audio/wav', tag: `${entry.size}-${range.offset}` };
        }
    }
    found.set(mod, { stamp, source });
    return source;
}

export async function readTheme(source: ThemeSource): Promise<Uint8Array> {
    return source.range === undefined
        ? readZipEntry(source.archive, source.entry)
        : readZipRange(source.archive, source.entry, source.range.offset, source.range.size);
}

export function themeUrl(mod: string, source: ThemeSource): string {
    return `/flyby/theme/${encodeURIComponent(mod)}?v=${encodeURIComponent(source.tag)}`;
}
