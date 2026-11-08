// Chooses the level the menu flies through: a different one on each visit,
// from the official games and expansions in the library. Players without
// any get the levels the server gives everyone (Croft Manor by default).

import type { FlybyLevel, FlybyManifest } from '../../shared/api.ts';
import { findOfficialGame, OFFICIAL_GAMES } from '../../shared/games.ts';
import { getGameDataFile, listGameData, listGameDataPaths } from '../gamedata/store';
import { LEVEL_TITLES } from '../games/levels';
import { isScenic } from './scenic';

export interface FlybyChoice {
    bytes: Uint8Array;
    fileName: string;
    /** The game it is from. */
    mod: string;
    /** "Lara's Home · Tomb Raider III", for the caption. */
    caption: string;
    key: string;
}

const LAST_KEY = 'trx-suite:last-flyby';
const OFFICIAL_MODS = new Set(OFFICIAL_GAMES.map((game) => game.mod));

function caption(mod: string, fileName: string): string {
    const game = findOfficialGame(mod);
    const title = LEVEL_TITLES[mod]?.[fileName] ?? (fileName.startsWith('title') ? 'Title' : fileName.replace(/\.[^.]+$/, ''));
    return game === undefined ? title : `${title} · ${game.title}`;
}

function shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
}

interface Candidate {
    key: string;
    load(): Promise<FlybyChoice | null>;
}

async function libraryCandidates(): Promise<Candidate[][]> {
    const records = (await listGameData()).filter(
        (record) => record.status === 'ready' && record.layout === 'game' && OFFICIAL_MODS.has(record.mod),
    );
    const perGame: Candidate[][] = [];
    for (const record of records) {
        const paths = (await listGameDataPaths(record.id)).filter((path) => {
            const name = path.slice(path.lastIndexOf('/') + 1);
            return path.includes('/levels/') && isScenic(name, record.mod);
        });
        perGame.push(
            paths.map((path) => {
                const fileName = path.slice(path.lastIndexOf('/') + 1);
                const key = `${record.mod}/${fileName}`;
                return {
                    key,
                    async load() {
                        const blob = await getGameDataFile(record.id, path);
                        if (blob === undefined) return null;
                        return { bytes: new Uint8Array(await blob.arrayBuffer()), fileName, mod: record.mod, caption: caption(record.mod, fileName), key };
                    },
                };
            }),
        );
    }
    return perGame.filter((list) => list.length > 0);
}

async function serverCandidates(): Promise<Candidate[]> {
    // The service worker keeps the manifest and its levels for offline use.
    const response = await fetch('/flyby/manifest.json');
    if (!response.ok) return [];
    const manifest = (await response.json()) as FlybyManifest;
    return manifest.levels.map((level: FlybyLevel) => ({
        key: `${level.mod}/${level.file}`,
        async load() {
            const file = await fetch(level.url);
            if (!file.ok) return null;
            return {
                bytes: new Uint8Array(await file.arrayBuffer()),
                fileName: level.file,
                mod: level.mod,
                caption: `${level.name} · ${findOfficialGame(level.mod)?.title ?? ''}`.replace(/ · $/, ''),
                key: `${level.mod}/${level.file}`,
            };
        },
    }));
}

/**
 * The levels to try, best first: a random game of the library, then a
 * random level of it, never the one shown last time unless it is the only one.
 */
export async function flybyCandidates(): Promise<Candidate[]> {
    let last: string | null = null;
    try {
        last = localStorage.getItem(LAST_KEY);
    } catch {
        // No storage: any level will do.
    }
    const games = shuffle(await libraryCandidates().catch(() => []));
    for (const levels of games) shuffle(levels);
    const total = games.reduce((sum, levels) => sum + levels.length, 0);
    // Interleave so the first tries come from different games.
    const interleaved: Candidate[] = [];
    for (let i = 0; interleaved.length < total; i++) {
        for (const levels of games) if (levels[i] !== undefined) interleaved.push(levels[i]!);
    }
    let candidates = interleaved;
    if (candidates.length === 0) candidates = shuffle(await serverCandidates().catch(() => []));
    if (candidates.length > 1) {
        candidates = [...candidates.filter((c) => c.key !== last), ...candidates.filter((c) => c.key === last)];
    }
    return candidates;
}

export function rememberFlyby(key: string): void {
    try {
        localStorage.setItem(LAST_KEY, key);
    } catch {
        // Fine: the next visit may repeat the level.
    }
}
