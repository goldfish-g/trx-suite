// The main theme of the game a flyby level comes from (shared/themes.ts):
// out of the player's own copy of the game, or from the server along with
// the levels it shows everyone. Either way it ends up as a file the
// browser plays: The Last Revelation's and Tomb Raider III's ADPCM is
// turned into PCM first, and a format the browser cannot play (Safari and
// Ogg, say) means no music rather than an error.

import { findThemeFile, MAIN_THEMES, themeType, WAD_TABLE_BYTES, wadEntry } from '../../shared/themes.ts';
import { getGameDataFile } from '../gamedata/store';
import { parseWav } from './wav';

export interface MenuTheme {
    /** The same for games that play the same piece. */
    key: string;
    /** The track as a file the browser plays, or null without one. */
    load(): Promise<Blob | null>;
}

/** The theme in a game of the library, given the paths of its files. */
export function libraryTheme(gamedataId: string, mod: string, paths: readonly string[]): MenuTheme | null {
    const main = MAIN_THEMES[mod];
    const file = main === undefined ? null : findThemeFile(paths, main.track);
    if (main === undefined || file === null) return null;
    return {
        key: main.key,
        async load() {
            const blob = await getGameDataFile(gamedataId, file.path);
            if (blob === undefined) return null;
            if (file.wadEntry === undefined) return playable(blob, themeType(file.path));
            // Only the table and the one track are read, not the whole 240 MB.
            const entry = wadEntry(new Uint8Array(await blob.slice(0, WAD_TABLE_BYTES).arrayBuffer()), file.wadEntry);
            return entry === null ? null : playable(blob.slice(entry.offset, entry.offset + entry.size), 'audio/wav');
        },
    };
}

/** The theme the server offers with its flyby levels. */
export function serverTheme(mod: string, url: string): MenuTheme | null {
    const main = MAIN_THEMES[mod];
    if (main === undefined) return null;
    return {
        key: main.key,
        async load() {
            const response = await fetch(url);
            if (!response.ok) return null;
            const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'application/octet-stream';
            return playable(await response.blob(), type);
        },
    };
}

async function playable(blob: Blob, type: string): Promise<Blob | null> {
    if (type !== 'audio/wav') return new Audio().canPlayType(type) === '' ? null : new Blob([blob], { type });
    const format = parseWav(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()));
    if (format === null) return null;
    if (format.format === 1) return new Blob([blob], { type });
    if (format.format !== 2) return null;
    const worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module', name: 'music' });
    try {
        const bytes = await blob.arrayBuffer();
        const wav = await new Promise<ArrayBuffer | null>((resolve) => {
            worker.onmessage = (event: MessageEvent<ArrayBuffer | null>) => resolve(event.data);
            worker.onerror = () => resolve(null);
            worker.postMessage(bytes, [bytes]);
        });
        return wav === null ? null : new Blob([wav], { type });
    } finally {
        worker.terminate();
    }
}
