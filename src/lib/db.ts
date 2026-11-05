import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GameDataFile, GameDataRecord } from '../gamedata/types';
import type { ProfileRecord } from '../profiles/types';
import type { PartialDownload, PartialDownloadPart } from './download';

interface ShellDb extends DBSchema {
    profiles: {
        key: string;
        value: ProfileRecord;
    };
    gamedata: {
        key: string;
        value: GameDataRecord;
    };
    files: {
        key: [string, string];
        value: GameDataFile;
        indexes: { byGamedata: string };
    };
    partials: {
        key: string;
        value: PartialDownload;
    };
    partialParts: {
        key: [string, number];
        value: PartialDownloadPart;
    };
}

let dbPromise: Promise<IDBPDatabase<ShellDb>> | null = null;

export function getDb(): Promise<IDBPDatabase<ShellDb>> {
    dbPromise ??= openDB<ShellDb>('trx-shell-library', 1, {
        upgrade(db) {
            db.createObjectStore('profiles', { keyPath: 'id' });
            db.createObjectStore('gamedata', { keyPath: 'id' });
            const files = db.createObjectStore('files', {
                keyPath: ['gamedataId', 'path'],
            });
            files.createIndex('byGamedata', 'gamedataId');
            db.createObjectStore('partials', { keyPath: 'key' });
            db.createObjectStore('partialParts', { keyPath: ['key', 'index'] });
        },
    });
    return dbPromise;
}

export function newId(): string {
    return crypto.randomUUID();
}
