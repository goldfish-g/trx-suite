import type { EngineNumber } from '../games/catalog';
import { announceLibraryChange } from '../lib/changes';
import { getDb, newId } from '../lib/db';
import type { ProfileRecord } from './types';

/**
 * Where a profile keeps a mod's saves and settings. Each place is a database
 * of its own, named after it, so profiles of the same game never share saves.
 */
export function profileStoragePath(profileId: string, mod: string): string {
    return `/profiles/${profileId}/${mod}`;
}

export async function listProfiles(): Promise<ProfileRecord[]> {
    const db = await getDb();
    const all = await db.getAll('profiles');
    return all.sort((a, b) =>
        (b.lastPlayedAt ?? b.createdAt).localeCompare(a.lastPlayedAt ?? a.createdAt),
    );
}

export async function getProfile(id: string): Promise<ProfileRecord | undefined> {
    const db = await getDb();
    return db.get('profiles', id);
}

export interface NewProfile {
    name: string;
    gamedataId: string;
    mod: string;
    engine: EngineNumber;
    engineVersion: string;
}

export async function createProfile(fields: NewProfile): Promise<ProfileRecord> {
    const profile: ProfileRecord = {
        ...fields,
        id: newId(),
        storageMods: [],
        createdAt: new Date().toISOString(),
        lastPlayedAt: null,
    };
    const db = await getDb();
    await db.put('profiles', profile);
    announceLibraryChange();
    return profile;
}

async function updateProfile(id: string, patch: Partial<ProfileRecord>): Promise<void> {
    const db = await getDb();
    const profile = await db.get('profiles', id);
    if (profile === undefined) return;
    await db.put('profiles', { ...profile, ...patch });
    announceLibraryChange();
}

export function renameProfile(id: string, name: string): Promise<void> {
    return updateProfile(id, { name });
}

export function markProfilePlayed(id: string): Promise<void> {
    return updateProfile(id, { lastPlayedAt: new Date().toISOString() });
}

/** Notes that a profile keeps saves for a mod, so deleting it clears them. */
export async function noteStorageMod(id: string, mod: string): Promise<void> {
    const profile = await getProfile(id);
    if (profile === undefined || profile.storageMods.includes(mod)) return;
    await updateProfile(id, { storageMods: [...profile.storageMods, mod] });
}

function deleteDatabase(name: string): Promise<void> {
    return new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
}

/** Deletes a profile along with its saves and settings. */
export async function deleteProfile(id: string): Promise<void> {
    const profile = await getProfile(id);
    if (profile === undefined) return;
    for (const mod of profile.storageMods) {
        await deleteDatabase(profileStoragePath(id, mod));
    }
    const db = await getDb();
    await db.delete('profiles', id);
    announceLibraryChange();
}
