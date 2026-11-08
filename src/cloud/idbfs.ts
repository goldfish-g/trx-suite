// A profile's saves where the engine keeps them: Emscripten's IDBFS, one
// IndexedDB database per storage, named after its mount point
// (/profiles/<id>/<mod>), with a FILE_DATA store keyed by absolute path. The
// engine reads it in when a game starts and writes it out as the game saves,
// going by each entry's timestamp, so files written here with their own time
// come into the game next time it starts.

import { CLOUD_SAVE_PATH } from '../../shared/cloud.ts';

const DB_VERSION = 21;
const STORE = 'FILE_DATA';
/** A regular file, read and write for all, as Emscripten makes them. */
const FILE_MODE = 0o100666;
const DIR_MODE = 0o40777;

interface IdbfsEntry {
    timestamp: Date;
    mode: number;
    contents?: Uint8Array;
}

export interface SaveFileData {
    /** Within the storage, such as saves/save_tr1_00.dat. */
    path: string;
    bytes: Uint8Array;
    /** ms since 1970. */
    mtime: number;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('The browser storage refused the change.'));
    });
}

/** Opens a storage as IDBFS does, making it as IDBFS would when it is new. */
function open(root: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(root, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            const store = db.objectStoreNames.contains(STORE) ? req.transaction!.objectStore(STORE) : db.createObjectStore(STORE);
            if (!store.indexNames.contains('timestamp')) store.createIndex('timestamp', 'timestamp', { unique: false });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        // Another page with an older version would hold it; IDBFS never changes its version.
        req.onblocked = () => reject(new Error('The saves are open elsewhere.'));
    });
}

function savesRange(root: string): IDBKeyRange {
    return IDBKeyRange.bound(`${root}/saves/`, `${root}/saves/￿`);
}

/** The save files of a storage: the files in its saves/ directory, where TRX keeps a directory per game. */
export async function readSaveFiles(root: string): Promise<SaveFileData[]> {
    const db = await open(root);
    try {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const [keys, values] = await Promise.all([
            request(store.getAllKeys(savesRange(root))),
            request(store.getAll(savesRange(root)) as IDBRequest<IdbfsEntry[]>),
        ]);
        const files: SaveFileData[] = [];
        keys.forEach((key, index) => {
            const entry = values[index];
            if (typeof key !== 'string' || entry?.contents === undefined) return;
            const path = key.slice(root.length + 1);
            if (!CLOUD_SAVE_PATH.test(path)) return;
            const bytes = entry.contents instanceof Uint8Array ? entry.contents : new Uint8Array(entry.contents);
            files.push({ path, bytes, mtime: entry.timestamp instanceof Date ? entry.timestamp.getTime() : Number(entry.timestamp) });
        });
        return files;
    } finally {
        db.close();
    }
}

/** Writes and deletes save files of a storage, for the engine to read in next time. */
export async function writeSaveFiles(root: string, writes: readonly SaveFileData[], deletes: readonly string[]): Promise<void> {
    if (writes.length === 0 && deletes.length === 0) return;
    const db = await open(root);
    try {
        const tx = db.transaction(STORE, 'readwrite');
        const finished = done(tx);
        const store = tx.objectStore(STORE);
        // The engine reads a file in only once its directory is there: saves/, and the game's own in it.
        const dirs = new Set<string>();
        for (const file of writes) {
            const parts = file.path.split('/').slice(0, -1);
            parts.forEach((_, index) => dirs.add(`${root}/${parts.slice(0, index + 1).join('/')}`));
        }
        for (const dir of [...dirs].sort()) {
            if ((await request(store.get(dir))) === undefined) store.put({ timestamp: new Date(), mode: DIR_MODE } satisfies IdbfsEntry, dir);
        }
        for (const file of writes) {
            store.put({ timestamp: new Date(file.mtime), mode: FILE_MODE, contents: file.bytes } satisfies IdbfsEntry, `${root}/${file.path}`);
        }
        for (const path of deletes) store.delete(`${root}/${path}`);
        await finished;
    } finally {
        db.close();
    }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
