// What the custom levels screen does: bring levels in from TRCustoms or from
// files, play them, and remove them. Each level gets a package of the
// current TRX from the TRX Level Converter as it comes in.

import type { CustomLevelDetails, CustomLevelFile, CustomLevelSummary } from '../../shared/api.ts';
import type { CloudLevel } from '../../shared/cloud.ts';
import { adoptCloudProfiles, cloudLevelFor } from '../cloud/sync';
import { importGameData, redownloadGameData, removeGameData } from '../gamedata/imports';
import { LayoutError, loneLevelPath } from '../gamedata/layout';
import { putLevelInfo } from '../gamedata/store';
import type { GameDataRecord } from '../gamedata/types';
import { customMod, type EngineNumber } from '../games/catalog';
import { engineFromHeader } from '../games/detect';
import { loadEngineVersions } from '../engine/versions';
import { createProfile, deleteProfile, listProfiles } from '../profiles/store';
import type { ProfileRecord } from '../profiles/types';
import { describeDetection, playProfile, type PickedFiles } from '../menu/actions';
import { fetchLevelDetails } from './api';
import { levelNameFromArchive } from './labels';

async function newestEngine(): Promise<string> {
    const newest = (await loadEngineVersions())[0];
    if (newest === undefined) throw new Error('The server offers no engine build yet.');
    return newest;
}

/** A directory for a level from TRCustoms: its name, and its id so two levels of one name never meet. */
function trcustomsMod(level: CustomLevelSummary): string {
    return `${customMod(level.name).slice(0, 40)}-${level.id}`;
}

/** Keeps what TRCustoms says about a level, and its cover, with it in the library. */
async function keepLevelInfo(gamedataId: string, level: CustomLevelSummary | CustomLevelDetails): Promise<void> {
    const details = 'description' in level ? level : await fetchLevelDetails(level.id).catch(() => null);
    if (details === null) return;
    let cover: Blob | null = null;
    if (details.cover !== null) {
        cover = await fetch(details.cover)
            .then((response) => (response.ok ? response.blob() : null))
            .catch(() => null);
    }
    await putLevelInfo({ gamedataId, details, cover });
}

/**
 * Downloads a level's newest archive from TRCustoms, to convert and keep. A
 * level the player added before, on this device or another, comes back as
 * the cloud lists it, as the version its saves were made in and in the same
 * place, so its saves find it.
 */
export async function installFromTrcustoms(level: CustomLevelSummary | CustomLevelDetails): Promise<GameDataRecord> {
    if (level.game === null) throw new Error(`This level is for ${level.engineName}, which TRX does not play.`);
    const listed = cloudLevelFor(level.id);
    const source = listed?.source.kind === 'trcustoms' ? listed.source : null;
    const file: CustomLevelFile | null =
        source !== null
            ? {
                  id: source.fileId,
                  version: source.version,
                  sizeBytes: level.file?.id === source.fileId ? level.file.sizeBytes : (source.sizeBytes ?? 0),
                  url: trcustomsFileUrl(source.fileId),
              }
            : level.file;
    if (file === null) throw new Error('TRCustoms has no archive for this level.');
    const record = await importGameData(
        {
            name: listed?.name ?? level.name,
            mod: listed?.mod ?? trcustomsMod(level),
            engine: level.game,
            layout: 'custom',
            convert: true,
            source: { kind: 'trcustoms', levelId: level.id, fileId: file.id, version: file.version, url: file.url },
            sizeBytes: file.sizeBytes,
        },
        { kind: 'download' },
    );
    void keepLevelInfo(record.id, level).catch((error: unknown) => console.warn('[custom] keeping the level’s details failed:', error));
    return record;
}

function trcustomsFileUrl(fileId: number): string {
    return `/api/trcustoms/files/${fileId}`;
}

/** Downloads a level the cloud lists, added on another device, back into the library. */
export async function installFromCloud(level: CloudLevel): Promise<GameDataRecord> {
    const { source } = level;
    if (source.kind === 'upload') {
        throw new Error(`It was added from files (${source.name}) on another device. Add the same files here to play it.`);
    }
    if (source.kind === 'trcustoms') {
        const summary: CustomLevelSummary = level.summary ?? {
            id: source.levelId,
            name: level.name,
            game: level.engine === 4 ? null : level.engine,
            engineName: `TR${level.engine}`,
            authors: [],
            difficulty: null,
            duration: null,
            rating: null,
            genres: [],
            cover: null,
            releaseDate: '',
            downloads: 0,
            reviews: 0,
            file: null,
        };
        return installFromTrcustoms(summary);
    }
    return importGameData(
        {
            name: level.name,
            mod: level.mod,
            engine: level.engine,
            layout: level.layout,
            convert: level.layout === 'custom',
            startLevel: level.startLevel,
            source: { kind: 'link', url: source.url },
        },
        { kind: 'download' },
    );
}

/**
 * Downloads a level again and converts it anew, into the same place in the
 * library, so its saves stay: after a fix to the converter, or, given a
 * newer file of a TRCustoms level, to update it. What TRCustoms says about
 * the level is refreshed too.
 */
export async function redownloadCustomLevel(record: GameDataRecord, file?: CustomLevelFile, details?: CustomLevelDetails): Promise<void> {
    const { source } = record;
    if (source.kind !== 'trcustoms') {
        await redownloadGameData(record.id);
        return;
    }
    const next = file ?? null;
    await redownloadGameData(record.id, {
        source: next === null ? source : { kind: 'trcustoms', levelId: source.levelId, fileId: next.id, version: next.version, url: next.url },
        sizeBytes: next?.sizeBytes ?? 0,
    });
    const level = details ?? (await fetchLevelDetails(source.levelId).catch(() => null));
    if (level !== null) void keepLevelInfo(record.id, level).catch(() => {});
}

/** The game level files were made for, from the first one that says. */
async function engineOf(picked: PickedFiles): Promise<EngineNumber> {
    for (const entry of picked.entries) {
        if (!/\.(phd|tub|tr2|tr4)$/i.test(entry.path)) continue;
        const head = new Uint8Array(await (await entry.read()).slice(0, 4).arrayBuffer());
        const engine = engineFromHeader(head);
        if (engine !== undefined) return engine;
    }
    return 1;
}

/**
 * Adds a custom level from files on the device. TRX packages and levels for
 * the original games or older engines go through the converter; lone level
 * files play on their own.
 */
export async function addLevelFromFiles(picked: PickedFiles, level?: string): Promise<GameDataRecord> {
    const { detection } = picked;
    const source = { kind: 'upload' as const, name: picked.name };
    const input = { kind: 'files' as const, entries: picked.entries };
    if (detection.kind === 'custom' || detection.kind === 'convert') {
        const name = detection.kind === 'custom' ? detection.name : levelNameFromArchive(picked.name);
        const engine = detection.kind === 'custom' ? detection.engine : await engineOf(picked);
        return importGameData({ name, mod: customMod(name), engine, layout: 'custom', convert: true, source }, input);
    }
    if (detection.kind === 'level') {
        const chosen = level ?? detection.levels[0]!;
        const fileName = chosen.slice(chosen.lastIndexOf('/') + 1).toLowerCase();
        const name = fileName.replace(/\.[^.]+$/, '');
        const mod = customMod(name);
        return importGameData(
            { name, mod, engine: detection.engine, layout: 'level', startLevel: loneLevelPath(mod, fileName), source },
            input,
        );
    }
    throw new LayoutError(describeDetection(detection));
}

/** Makes a new set of saves for a custom level. */
export async function newCustomProfile(record: GameDataRecord, name = record.name): Promise<ProfileRecord> {
    return createProfile({
        name,
        gamedataId: record.id,
        title: record.mod,
        // A lone level plays through the engine's own trN-level.
        mod: record.layout === 'level' ? `tr${record.engine}-level` : record.mod,
        engine: record.engine,
        engineVersion: await newestEngine(),
    });
}

const profilesOfLevel = async (record: GameDataRecord) => (await listProfiles()).filter((profile) => profile.gamedataId === record.id);

/**
 * Plays a custom level with the profile played last. A first profile on
 * this device is the cloud's, when it keeps one; else a new one.
 */
export async function playCustomLevel(record: GameDataRecord): Promise<void> {
    let [latest] = await profilesOfLevel(record);
    if (latest === undefined) {
        await adoptCloudProfiles();
        [latest] = await profilesOfLevel(record);
    }
    playProfile(latest ?? (await newCustomProfile(record)));
}

/**
 * Removes a custom level from this device with its saves here. The cloud
 * keeps what it has of it, to download it and its saves again.
 */
export async function removeCustomLevel(record: GameDataRecord): Promise<void> {
    for (const profile of await listProfiles()) {
        if (profile.gamedataId === record.id) await deleteProfile(profile.id);
    }
    await removeGameData(record.id);
}
