// The games and flyby levels on disk, as data/catalog.json lists them. The
// file is re-read when it changes, so games can be added without a restart.

import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { CatalogEntry, FlybyManifest, LinkedAccount } from '../../shared/api.ts';
import { OFFICIAL_GAMES, findOfficialGame, isUnlocked, type OfficialGame } from '../../shared/games.ts';
import { statFile } from './files.ts';
import { findServerTheme, themeUrl } from './themes.ts';
import { ownershipOf } from './session.ts';

export interface FlybySource {
    /** Absolute path on disk. */
    path: string;
    /** The level's file name, which is also its address under /flyby/<mod>/. */
    file: string;
    name: string;
    mod: string;
}

export interface Catalog {
    /** Official game id to the archive's absolute path. */
    games: Map<string, string>;
    flyby: FlybySource[];
}

const EMPTY: Catalog = { games: new Map(), flyby: [] };

export function parseCatalog(text: string, dataDir: string, warn: (message: string) => void): Catalog {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        warn(`catalog.json is not valid JSON (${(error as Error).message}); offering no games.`);
        return EMPTY;
    }
    if (typeof raw !== 'object' || raw === null) {
        warn('catalog.json must hold an object; offering no games.');
        return EMPTY;
    }
    const { games: rawGames, flyby: rawFlyby } = raw as { games?: unknown; flyby?: unknown };

    const games = new Map<string, string>();
    if (typeof rawGames === 'object' && rawGames !== null) {
        for (const [id, file] of Object.entries(rawGames)) {
            if (!findOfficialGame(id)) warn(`catalog.json lists "${id}", which is not an official game; skipped.`);
            else if (typeof file !== 'string' || file === '') warn(`catalog.json gives "${id}" no file; skipped.`);
            else games.set(id, resolve(dataDir, file));
        }
    } else if (rawGames !== undefined) {
        warn('catalog.json "games" must map game ids to archive paths.');
    }

    const flyby: FlybySource[] = [];
    if (Array.isArray(rawFlyby)) {
        for (const item of rawFlyby as unknown[]) {
            const { file, name, mod } = (item ?? {}) as Record<string, unknown>;
            if (typeof file !== 'string' || typeof name !== 'string' || typeof mod !== 'string' || !file) {
                warn(`catalog.json has a flyby entry without file, name and mod: ${JSON.stringify(item)}`);
                continue;
            }
            if (!findOfficialGame(mod)) {
                warn(`catalog.json has a flyby level from "${mod}", which is not an official game; skipped.`);
                continue;
            }
            const level: FlybySource = { path: resolve(dataDir, file), file: basename(file), name, mod };
            // The address is /flyby/<mod>/<file name>, so it must be unique.
            if (flyby.some((other) => other.mod === level.mod && other.file === level.file)) {
                warn(`catalog.json lists ${mod}/${level.file} twice; the first one wins.`);
                continue;
            }
            flyby.push(level);
        }
    } else if (rawFlyby !== undefined) {
        warn('catalog.json "flyby" must be a list.');
    }
    return { games, flyby };
}

/** Loads catalog.json, reusing the parsed copy while the file is unchanged. */
export function createCatalogStore(dataDir: string, log: FastifyBaseLogger) {
    const path = join(dataDir, 'catalog.json');
    let cached: { key: string; catalog: Catalog } | null = null;

    return async function loadCatalog(): Promise<Catalog> {
        let key: string;
        try {
            const stats = await stat(path);
            key = `${stats.mtimeMs}:${stats.size}`;
        } catch {
            if (cached?.key !== 'missing') log.warn(`No catalog at ${path}; offering no games or flyby levels.`);
            cached = { key: 'missing', catalog: EMPTY };
            return EMPTY;
        }
        if (cached?.key === key) return cached.catalog;
        const catalog = parseCatalog(await readFile(path, 'utf8'), dataDir, (message) => log.warn(message));
        cached = { key, catalog };
        return catalog;
    };
}

export type LoadCatalog = ReturnType<typeof createCatalogStore>;

/** The official games whose archives are on disk, in OFFICIAL_GAMES order. */
export async function catalogEntries(catalog: Catalog, accounts: readonly LinkedAccount[]): Promise<CatalogEntry[]> {
    const ownership = ownershipOf(accounts);
    const entries = await Promise.all(
        OFFICIAL_GAMES.map(async (game): Promise<CatalogEntry | null> => {
            const path = catalog.games.get(game.mod);
            const stats = path === undefined ? null : await statFile(path);
            if (!stats) return null;
            return {
                id: game.mod,
                mod: game.mod,
                engine: game.engine,
                name: game.title,
                url: `/api/gamedata/${game.mod}`,
                sizeBytes: stats.size,
                access: game.access.kind,
                unlocked: isUnlocked(game, ownership),
            };
        }),
    );
    return entries.filter((entry) => entry !== null);
}

export function findArchive(catalog: Catalog, id: string): { game: OfficialGame; path: string } | null {
    const game = findOfficialGame(id);
    const path = catalog.games.get(id);
    return game && path ? { game, path } : null;
}

export function flybyUrl(level: FlybySource): string {
    return `/flyby/${encodeURIComponent(level.mod)}/${encodeURIComponent(level.file)}`;
}

/** The listed flyby levels whose files are on disk. */
export async function flybyManifest(catalog: Catalog): Promise<FlybyManifest> {
    const present = await Promise.all(catalog.flyby.map(async (level) => ((await statFile(level.path)) ? level : null)));
    const levels = present.filter((level) => level !== null);
    return {
        levels: await Promise.all(
            levels.map(async (level) => {
                const theme = await findServerTheme(catalog, level.mod).catch(() => null);
                return { url: flybyUrl(level), file: level.file, name: level.name, mod: level.mod, ...(theme === null ? {} : { music: themeUrl(level.mod, theme) }) };
            }),
        ),
    };
}

export function findFlyby(catalog: Catalog, mod: string, file: string): FlybySource | undefined {
    return catalog.flyby.find((level) => level.mod === mod && level.file === file);
}
