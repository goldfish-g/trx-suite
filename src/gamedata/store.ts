import { announceLibraryChange } from '../lib/changes';
import { getDb } from '../lib/db';
import type { GameDataFile, GameDataRecord, LevelInfoRecord } from './types';

export async function listGameData(): Promise<GameDataRecord[]> {
    const db = await getDb();
    const all = await db.getAll('gamedata');
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getGameData(id: string): Promise<GameDataRecord | undefined> {
    const db = await getDb();
    return db.get('gamedata', id);
}

export async function putGameData(record: GameDataRecord): Promise<void> {
    const db = await getDb();
    await db.put('gamedata', record);
    announceLibraryChange();
}

export async function updateGameData(id: string, patch: Partial<GameDataRecord>): Promise<void> {
    const db = await getDb();
    const record = await db.get('gamedata', id);
    if (record === undefined) return;
    await db.put('gamedata', { ...record, ...patch });
    announceLibraryChange();
}

/**
 * Stores a file of a game's data: a copy of its bytes, never the Blob as it
 * is. Each file of a stored zip archive is a slice of the downloaded
 * archive, and Safari's IndexedDB keeps a slice as the whole stretch of the
 * download it lies in, which it reads back from the wrong place and at many
 * times the size.
 */
export async function putGameDataFile(file: GameDataFile): Promise<void> {
    const blob = new Blob([await file.blob.arrayBuffer()], { type: file.blob.type });
    const db = await getDb();
    await db.put('files', { ...file, blob });
}

/** A stored file that reads back as other than it was stored (see putGameDataFile). */
export class DamagedGameDataError extends Error {
    readonly gamedataId: string;

    constructor(file: GameDataFile, read: number) {
        super(`${file.path} reads back as ${read} bytes from this browser's storage, not the ${file.blob.size} it holds.`);
        this.name = 'DamagedGameDataError';
        this.gamedataId = file.gamedataId;
    }
}

/**
 * A stored file's bytes, checked against its size: the files an earlier
 * version of the app stored in Safari read back as more than they are.
 */
export async function readGameDataFile(file: GameDataFile): Promise<Uint8Array> {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    if (bytes.byteLength !== file.blob.size) throw new DamagedGameDataError(file, bytes.byteLength);
    return bytes;
}

export async function listGameDataFiles(gamedataId: string): Promise<GameDataFile[]> {
    const db = await getDb();
    return db.getAllFromIndex('files', 'byGamedata', gamedataId);
}

export async function deleteGameDataFiles(gamedataId: string): Promise<void> {
    const db = await getDb();
    const tx = db.transaction('files', 'readwrite');
    for await (const cursor of tx.store.index('byGamedata').iterate(gamedataId)) {
        await cursor.delete();
    }
    await tx.done;
}

export async function deleteGameData(id: string): Promise<void> {
    await deleteGameDataFiles(id);
    const db = await getDb();
    await db.delete('gamedata', id);
    await db.delete('levelinfo', id);
    announceLibraryChange();
}

/** The paths of a set of game data's files, without reading the files. */
export async function listGameDataPaths(gamedataId: string): Promise<string[]> {
    const db = await getDb();
    const keys = await db.getAllKeysFromIndex('files', 'byGamedata', gamedataId);
    return keys.map(([, path]) => path);
}

export async function getGameDataFile(gamedataId: string, path: string): Promise<Blob | undefined> {
    const db = await getDb();
    return (await db.get('files', [gamedataId, path]))?.blob;
}

/** What TRCustoms said about each custom level in the library. */
export async function listLevelInfo(): Promise<LevelInfoRecord[]> {
    const db = await getDb();
    return db.getAll('levelinfo');
}

export async function putLevelInfo(info: LevelInfoRecord): Promise<void> {
    const db = await getDb();
    await db.put('levelinfo', info);
    announceLibraryChange();
}
