// Works out what a set of files is: one of the games, a TRX custom level,
// level files to play on their own, or a level made for the original games
// or an older engine, which the TRX Level Converter has to turn into a TRX
// package first. Nothing here trusts a file name for the engine: the level
// files say which engine they are for in their first bytes, and a custom
// level's gameflow says it too.

import type { ArchiveEntry } from '../lib/archive';
import { findGame, GAMES, type EngineNumber, type Game } from './catalog';
import { GAME_LEVELS } from './levels';

export type Detection =
    /** One of the games, with how many of its level files are there. */
    | { kind: 'game'; game: Game; found: number; expected: number }
    /** A custom level that brings its own gameflow.json5. */
    | { kind: 'custom'; engine: EngineNumber; name: string; extendsMod: string | null; root: string }
    /** Level files without a gameflow, which the engine plays one at a time. */
    | { kind: 'level'; engine: EngineNumber; levels: string[] }
    /** A level made for the original games or an older engine, which TRX needs converted. */
    | { kind: 'convert'; reason: string }
    | { kind: 'unknown'; reason: string };

const LEVEL_FILE = /\.(phd|tub|tr2|tr4)$/i;

function basename(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1).toLowerCase();
}

function depth(path: string): number {
    return path.split('/').length;
}

/** The engine a level file is for, from the version its first bytes give. */
export function engineFromHeader(bytes: Uint8Array): EngineNumber | undefined {
    if (bytes.length < 4) return undefined;
    const version = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
    if (version === 0x20) return 1;
    if (version === 0x2d) return 2;
    // TR3 levels read 0xFF080038, 0xFF180038 or 0xFF180034. Bitwise operators
    // give signed numbers, which >>> 0 turns back unsigned to compare.
    const tr3 = (version & 0xff00ffff) >>> 0;
    if (tr3 === 0xff000038 || tr3 === 0xff000034) return 3;
    // TR4 levels start with "TR4" and a fourth byte that varies.
    if ((version & 0x00ffffff) === 0x00345254) return 4;
    return undefined;
}

export interface ModMeta {
    engine?: number;
    extendsMod?: string;
    name?: string;
}

/**
 * Reads what a gameflow.json5 says about its mod. The top-level keys come
 * first in a gameflow, so the first of each that appears is the mod's own.
 */
export function readModMeta(text: string): ModMeta {
    const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
    const key = (name: string) => `["']?${name}["']?\\s*:\\s*`;
    const engine = new RegExp(`${key('engine')}(\\d+)`).exec(withoutComments)?.[1];
    const extendsMod = new RegExp(`${key('extends')}["']([^"']+)["']`).exec(withoutComments)?.[1];
    const name = new RegExp(`${key('name')}["']([^"']+)["']`).exec(withoutComments)?.[1];
    return { engine: engine === undefined ? undefined : Number(engine), extendsMod, name };
}

function isEngine(value: number | undefined): value is EngineNumber {
    return value === 1 || value === 2 || value === 3 || value === 4;
}

/** The official game a path is already laid out for, as in games/tr2/…. */
function laidOutGame(path: string): Game | undefined {
    const mod = /(?:^|\/)games\/([^/]+)\//i.exec(path)?.[1]?.toLowerCase();
    return mod === undefined ? undefined : findGame(mod);
}

async function readHead(entry: ArchiveEntry): Promise<Uint8Array> {
    const blob = await entry.read();
    return new Uint8Array(await blob.slice(0, 4).arrayBuffer());
}

/**
 * The game whose levels these are: the one with the most of its levels
 * here, and of those, the one with the largest share of its levels here. A
 * full game holds the demo's levels too, and a demo holds all of its own.
 * Title levels say nothing, as custom levels call theirs the same.
 */
function bestGame(engine: EngineNumber, names: Set<string>): { game: Game; found: number; expected: number } | null {
    let best: { game: Game; found: number; expected: number } | null = null;
    for (const game of GAMES.filter((candidate) => candidate.engine === engine)) {
        const expected = (GAME_LEVELS[game.mod] ?? []).filter((name) => !name.startsWith('title.'));
        const found = expected.filter((name) => names.has(name)).length;
        if (found === 0) continue;
        const share = found / expected.length;
        const bestShare = best === null ? -1 : best.found / best.expected;
        if (best === null || found > best.found || (found === best.found && share > bestShare)) {
            best = { game, found, expected: expected.length };
        }
    }
    return best;
}

/** How many of a game's levels make files that game: five, or half and at least two. */
function isMostOf(found: number, expected: number): boolean {
    return found >= 5 || (found / expected >= 0.5 && found >= Math.min(2, expected));
}

/** Why files made for the original games or an older engine need converting, if they are. */
function conversionReason(paths: readonly string[]): string | null {
    const lower = paths.map((path) => path.toLowerCase());
    if (lower.some((path) => /(^|\/)(tr1x|tr2x|tomb1main)_gameflow[^/]*\.json5$|(^|\/)cfg\/tr[1-3][^/]*\/gameflow\.json5$/.test(path))) {
        return 'It was made for an older engine, TR1X, TR2X or Tomb1Main, whose game flow TRX reads differently.';
    }
    if (lower.some((path) => /(^|\/)(tombpc|script)\.dat$/.test(path))) {
        return 'It is a classic custom level, scripted for the original game in a TOMBPC.DAT file.';
    }
    return null;
}

export async function detectGame(entries: readonly ArchiveEntry[]): Promise<Detection> {
    const levels = entries.filter((entry) => LEVEL_FILE.test(entry.path));
    let reason: string | null = null;

    // A TRX custom level names its engine in its gameflow, and keeps its
    // levels in the folder beside it. It may keep what it was converted from
    // there too, which says nothing about what it is now.
    const gameflow = entries
        .filter((entry) => basename(entry.path) === 'gameflow.json5' && laidOutGame(entry.path) === undefined)
        .sort((a, b) => depth(a.path) - depth(b.path))[0];
    if (gameflow !== undefined) {
        const meta = readModMeta(await (await gameflow.read()).text());
        const root = gameflow.path.slice(0, gameflow.path.length - 'gameflow.json5'.length);
        if (!isEngine(meta.engine)) {
            reason = 'Its gameflow.json5 does not say which engine it is for, as gameflows of older engines did not.';
        } else if (!levels.every((entry) => entry.path.startsWith(root))) {
            reason = 'It keeps its levels outside the folder of its gameflow.json5, as installs of older engines did.';
        } else {
            const folder = root.split('/').filter(Boolean).pop();
            return {
                kind: 'custom',
                engine: meta.engine,
                name: meta.name ?? folder ?? 'Custom level',
                extendsMod: meta.extendsMod ?? null,
                root,
            };
        }
    }
    reason ??= conversionReason(entries.map((entry) => entry.path));

    if (levels.length === 0) {
        return reason !== null
            ? { kind: 'convert', reason }
            : { kind: 'unknown', reason: 'There are no level files among these files.' };
    }
    const names = new Set(levels.map((entry) => basename(entry.path)));

    const laidOut = laidOutGame(levels[0]!.path);
    if (laidOut !== undefined) {
        const expected = GAME_LEVELS[laidOut.mod] ?? [];
        const found = expected.filter((name) => names.has(name)).length;
        return { kind: 'game', game: laidOut, found, expected: expected.length };
    }

    const engine = engineFromHeader(await readHead(levels[0]!));
    if (engine === undefined) {
        return { kind: 'unknown', reason: `${basename(levels[0]!.path)} is not a level file the engine knows.` };
    }

    // The official games ship a TOMBPC.DAT too, so they come first.
    const best = bestGame(engine, names);
    if (best !== null && isMostOf(best.found, best.expected)) {
        return { kind: 'game', ...best };
    }
    if (reason !== null) return { kind: 'convert', reason };
    return { kind: 'level', engine, levels: levels.map((entry) => entry.path).sort() };
}
