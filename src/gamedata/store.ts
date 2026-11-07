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

export async function putGameDataFile(file: GameDataFile): Promise<void> {
    const db = await getDb();
    await db.put('files', file);
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
