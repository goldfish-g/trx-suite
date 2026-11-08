// What the menus do: bring games into the library, start them, and add
// custom levels. The screens only call these.

import type { CatalogEntry } from '../../shared/api.ts';
import type { OfficialGame } from '../../shared/games.ts';
import { loadEngineVersions } from '../engine/versions';
import { importGameData } from '../gamedata/imports';
import { LayoutError, planLayout } from '../gamedata/layout';
import type { GameDataRecord } from '../gamedata/types';
import { ENGINE_NAMES } from '../games/catalog';
import { detectGame, type Detection } from '../games/detect';
import { ArchiveError, readArchive, readFolder, type ArchiveEntry } from '../lib/archive';
import { openGame } from '../play/pages';
import { createProfile, listProfiles } from '../profiles/store';
import type { ProfileRecord } from '../profiles/types';

export function describeError(error: unknown): string {
    if (error instanceof ArchiveError || error instanceof LayoutError) return error.message;
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        return 'The browser ran out of storage space for the files.';
    }
    return error instanceof Error ? error.message : String(error);
}

/** Downloads a game from the server into the library. */
export async function downloadGame(entry: CatalogEntry): Promise<GameDataRecord> {
    return importGameData(
        {
            name: entry.name,
            mod: entry.mod,
            engine: entry.engine,
            layout: 'game',
            source: { kind: 'server', entryId: entry.id, url: entry.url },
            sizeBytes: entry.sizeBytes,
        },
        { kind: 'download' },
    );
}

async function newestEngine(): Promise<string> {
    const versions = await loadEngineVersions();
    const newest = versions[0];
    if (newest === undefined) throw new Error('The server offers no engine build yet.');
    return newest;
}

/** The profiles that play a set of game data, most recently played first. */
export async function profilesOf(gamedataId: string): Promise<ProfileRecord[]> {
    return (await listProfiles()).filter((profile) => profile.gamedataId === gamedataId);
}

/** Starts the engine on a profile. Each session is a page of its own, for a fresh engine. */
export function playProfile(profile: ProfileRecord): void {
    openGame(`/play/${profile.id}`);
}

/** Makes a new set of saves for a game. */
export async function newGameProfile(record: GameDataRecord, name: string): Promise<ProfileRecord> {
    return createProfile({
        name,
        gamedataId: record.id,
        title: record.mod,
        mod: record.mod,
        engine: record.engine,
        engineVersion: await newestEngine(),
    });
}

/** Plays a game with the profile played last, making the first one if needed. */
export async function playGame(record: GameDataRecord, game: OfficialGame): Promise<void> {
    const [latest] = await profilesOf(record.id);
    playProfile(latest ?? (await newGameProfile(record, game.title)));
}

/** Reads what the player picked: archives, a folder's files, or lone level files. */
export async function readPicked(files: File[], fromFolder: boolean): Promise<ArchiveEntry[]> {
    if (fromFolder || files.length > 1) return readFolder(files);
    const file = files[0];
    if (file === undefined) throw new ArchiveError('No files were picked.');
    try {
        return await readArchive(file);
    } catch (error) {
        if (error instanceof ArchiveError && /\.(phd|tub|tr2|tr4)$/i.test(file.name)) return readFolder([file]);
        throw error;
    }
}

export interface PickedFiles {
    name: string;
    entries: ArchiveEntry[];
    detection: Detection;
}

export async function inspectPicked(files: File[], fromFolder: boolean): Promise<PickedFiles> {
    const entries = await readPicked(files, fromFolder);
    const first = files[0];
    const name = fromFolder ? (first?.webkitRelativePath.split('/')[0] ?? 'Folder') : (first?.name ?? 'Files');
    return { name, entries, detection: await detectGame(entries) };
}

export function describeDetection(detection: Detection): string {
    switch (detection.kind) {
        case 'game': {
            const { game, found, expected } = detection;
            return found === expected
                ? `${game.title}, with all ${expected} of its levels.`
                : `${game.title}, but only ${found} of its ${expected} levels are here. The game stops where a level is missing.`;
        }
        case 'custom':
            return `A custom level for ${ENGINE_NAMES[detection.engine]}: “${detection.name}”.`;
        case 'level':
            return detection.levels.length === 1
                ? `A level file for ${ENGINE_NAMES[detection.engine]}, played on its own.`
                : `${detection.levels.length} level files for ${ENGINE_NAMES[detection.engine]}, played one at a time.`;
        case 'convert':
            return `${detection.reason} The TRX Level Converter turns it into a package of the current TRX as it is added.`;
        case 'unknown':
            return detection.reason;
    }
}

/**
 * Adds the player's own copy of an official game, after checking the files
 * really are that game.
 */
export async function importOwnCopy(game: OfficialGame, picked: PickedFiles): Promise<GameDataRecord> {
    const { detection } = picked;
    if (detection.kind !== 'game') {
        throw new LayoutError(`These files are not ${game.title}. ${describeDetection(detection)}`);
    }
    if (detection.game.mod !== game.mod) {
        throw new LayoutError(`These files are ${detection.game.title}, not ${game.title}.`);
    }
    const target = { mod: game.mod, engine: game.engine, layout: 'game' as const };
    planLayout(picked.entries, target); // refuses files without levels before anything is stored
    return importGameData(
        { name: game.title, ...target, source: { kind: 'upload', name: picked.name } },
        { kind: 'files', entries: picked.entries },
    );
}
