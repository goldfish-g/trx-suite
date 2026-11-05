// Decides where each imported file goes in the engine's file system. The
// engine finds a game's files by name anywhere under games/<mod>/, except
// that TR4 asks for its music as audio/<name>.wav.

import { LEVEL_EXTENSIONS, type EngineNumber } from '../games/catalog';
import type { ArchiveEntry } from '../lib/archive';
import type { GameDataLayout } from './types';

export interface PlannedFile {
    entry: ArchiveEntry;
    /** Where the engine reads it, relative to its root. */
    path: string;
}

export interface LayoutTarget {
    mod: string;
    engine: EngineNumber;
    layout: GameDataLayout;
}

/** A set of files that cannot become the game asked for. */
export class LayoutError extends Error {}

const LEVEL_FILE = /\.(phd|tub|tr2|tr4)$/;
const MUSIC = ['.flac', '.mp3', '.ogg', '.wav'];
const VIDEO = ['.rpl', '.bik', '.avi', '.mp4', '.ogv', '.webm', '.fmv'];

function normalize(path: string): string {
    return path.toLowerCase().replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
}

function basename(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

function endsWithAny(name: string, extensions: readonly string[]): boolean {
    return extensions.some((extension) => name.endsWith(extension));
}

/** Where a lone level file goes, for the engine to play it on its own. */
export function loneLevelPath(mod: string, name: string): string {
    return `custom-levels/${mod}/${name.toLowerCase()}`;
}

/** Where a file of a game goes, or null for files the engine has no use for. */
export function placeGameFile(path: string, mod: string, engine: EngineNumber): string | null {
    const normalized = normalize(path);
    // Archives already laid out as the engine expects keep their paths.
    const laidOut = /(?:^|\/)(games\/[^/]+\/.+)$/.exec(normalized);
    if (laidOut !== null) return laidOut[1]!;

    const name = basename(normalized);
    const base = `games/${mod}`;
    if (name === '') return null;
    if (endsWithAny(name, LEVEL_EXTENSIONS[engine])) return `${base}/levels/${name}`;
    if (name.endsWith('.sfx')) return `${base}/${name}`;
    if (name === 'cdaudio.wad') return `${base}/audio/${name}`;
    if (engine === 4 && name.endsWith('.wav')) return `${base}/audio/${name}`;
    if (endsWithAny(name, MUSIC)) return `${base}/music/${name}`;
    if (endsWithAny(name, VIDEO)) return `${base}/fmv/${name}`;
    return null;
}

/** The directory holding a custom level's gameflow.json5, nearest the top. */
function findCustomRoot(paths: readonly string[]): string | null {
    let root: string | null = null;
    for (const path of paths) {
        if (basename(path) !== 'gameflow.json5') continue;
        const directory = path.slice(0, path.length - 'gameflow.json5'.length);
        if (root === null || directory.length < root.length) root = directory;
    }
    return root;
}

/** Decides where each entry goes, leaving out the ones the engine never reads. */
export function planLayout(entries: readonly ArchiveEntry[], target: LayoutTarget): PlannedFile[] {
    // Lone levels stay out of games/, where the engine looks for mods.
    if (target.layout === 'level') {
        const planned = entries.flatMap((entry) => {
            const name = basename(normalize(entry.path));
            return LEVEL_FILE.test(name) ? [{ entry, path: loneLevelPath(target.mod, name) }] : [];
        });
        if (planned.length === 0) {
            throw new LayoutError('There are no level files among these files.');
        }
        return planned;
    }

    if (target.layout === 'game') {
        const planned = entries.flatMap((entry) => {
            const path = placeGameFile(entry.path, target.mod, target.engine);
            return path === null ? [] : [{ entry, path }];
        });
        if (!planned.some((file) => LEVEL_FILE.test(file.path))) {
            throw new LayoutError('These files hold no levels for this game.');
        }
        return planned;
    }

    const normalized = entries.map((entry) => ({ entry, path: normalize(entry.path) }));
    const root = findCustomRoot(normalized.map((file) => file.path));
    if (root === null) {
        throw new LayoutError('A custom level needs a gameflow.json5 among its files.');
    }
    return normalized
        .filter((file) => file.path.startsWith(root) && !file.path.endsWith('/'))
        .map((file) => ({ entry: file.entry, path: `games/${target.mod}/${file.path.slice(root.length)}` }));
}
