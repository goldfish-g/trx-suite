// What the custom levels screen does: bring levels in from TRCustoms or from
// files, play them, and remove them. Each level gets a package of the
// current TRX from the TRX Level Converter as it comes in.

import type { CustomLevelDetails, CustomLevelSummary } from '../../shared/api.ts';
import { importGameData, removeGameData } from '../gamedata/imports';
import { LayoutError, loneLevelPath } from '../gamedata/layout';
import { putLevelInfo } from '../gamedata/store';
import type { GameDataRecord } from '../gamedata/types';
import { customMod, type EngineNumber } from '../games/catalog';
import { engineFromHeader } from '../games/detect';
import { loadEngineVersions } from '../engine/versions';
import { createProfile, deleteProfile, listProfiles } from '../profiles/store';
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

/** Downloads a level's newest archive from TRCustoms, to convert and keep. */
export async function installFromTrcustoms(level: CustomLevelSummary | CustomLevelDetails): Promise<GameDataRecord> {
    if (level.file === null) throw new Error('TRCustoms has no archive for this level.');
    if (level.game === null) throw new Error(`This level is for ${level.engineName}, which TRX does not play.`);
    const record = await importGameData(
        {
            name: level.name,
            mod: trcustomsMod(level),
            engine: level.game,
            layout: 'custom',
            convert: true,
            source: { kind: 'trcustoms', levelId: level.id, fileId: level.file.id, version: level.file.version, url: level.file.url },
            sizeBytes: level.file.sizeBytes,
        },
        { kind: 'download' },
    );
    void keepLevelInfo(record.id, level).catch((error: unknown) => console.warn('[custom] keeping the level’s details failed:', error));
    return record;
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

/** Plays a custom level with the saves played last, making them the first time. */
export async function playCustomLevel(record: GameDataRecord): Promise<void> {
    const [latest] = (await listProfiles()).filter((profile) => profile.gamedataId === record.id);
    if (latest !== undefined) {
        playProfile(latest);
        return;
    }
    const profile = await createProfile({
        name: record.name,
        gamedataId: record.id,
        // A lone level plays through the engine's own trN-level.
        mod: record.layout === 'level' ? `tr${record.engine}-level` : record.mod,
        engine: record.engine,
        engineVersion: await newestEngine(),
    });
    playProfile(profile);
}

/** Removes a custom level with its saves. */
export async function removeCustomLevel(record: GameDataRecord): Promise<void> {
    for (const profile of await listProfiles()) {
        if (profile.gamedataId === record.id) await deleteProfile(profile.id);
    }
    await removeGameData(record.id);
}
