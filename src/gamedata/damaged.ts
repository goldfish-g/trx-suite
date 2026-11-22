// Games an earlier version of the app stored in Safari, whose files read back
// damaged (see putGameDataFile in store.ts). They are found once per page,
// and marked failed with the reason, so the menu neither flies through their
// levels nor plays their music, and the library offers to bring them in again
// (Try again downloads them anew into the same record, so profiles and saves
// stay).

import { getDb } from '../lib/db';
import { listGameData, updateGameData } from './store';
import type { GameDataRecord } from './types';

let checked: Promise<void> | null = null;

/** Marks failed every installed game whose files read back damaged. Once per page; safe to await again. */
export function findDamagedGameData(): Promise<void> {
    checked ??= (async () => {
        for (const record of await listGameData()) {
            if (record.status !== 'ready' || (await readsWhole(record.id))) continue;
            console.warn(`[gamedata] ${record.name}: its files read back damaged from this browser's storage.`);
            await updateGameData(record.id, { status: 'failed', error: damagedMessage(record) });
        }
    })().catch((error: unknown) => console.warn('[gamedata] checking the stored games failed:', error));
    return checked;
}

function damagedMessage(record: GameDataRecord): string {
    const what = "Its files came back damaged from this browser's storage, where an earlier version of Tombs Nexus put them.";
    return record.source.kind === 'upload'
        ? `${what} Remove them and add them again; profiles and saves stay.`
        : `${what} Try again to download them anew; profiles and saves stay.`;
}

/**
 * Whether a game's smallest file reads back at its own size. Every file of a
 * stored zip archive was a slice, so one tells for all; the session checks
 * each file it reads anyway. Read as a stream, which stops as soon as more
 * arrives than the file holds: a damaged one can read back as the whole
 * archive.
 */
async function readsWhole(gamedataId: string): Promise<boolean> {
    const db = await getDb();
    let smallest: Blob | null = null;
    for await (const cursor of db.transaction('files').store.index('byGamedata').iterate(gamedataId)) {
        const { blob } = cursor.value;
        if (smallest === null || blob.size < smallest.size) smallest = blob;
    }
    if (smallest === null) return true;
    const reader = smallest.stream().getReader();
    let read = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return read === smallest.size;
            read += value.byteLength;
            if (read > smallest.size) return false;
        }
    } finally {
        void reader.cancel().catch(() => {});
    }
}
