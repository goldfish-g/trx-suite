import { offeredEngine } from '../engine/versions';
import type { EngineNumber } from '../games/catalog';
import { announceLibraryChange, requestCloudSync } from '../lib/changes';
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
    /** The game data's mod, the same on every device. */
    title: string;
    mod: string;
    engine: EngineNumber;
    engineVersion: string;
}

export async function createProfile(fields: NewProfile): Promise<ProfileRecord> {
    const now = new Date().toISOString();
    const profile: ProfileRecord = {
        ...fields,
        id: newId(),
        storageMods: [],
        createdAt: now,
        updatedAt: now,
        lastPlayedAt: null,
    };
    const db = await getDb();
    await db.put('profiles', profile);
    announceLibraryChange();
    requestCloudSync();
    return profile;
}

/** Keeps a profile as given: one that came from the cloud. */
export async function putProfile(profile: ProfileRecord): Promise<void> {
    const db = await getDb();
    await db.put('profiles', profile);
    announceLibraryChange();
}

export async function updateProfile(id: string, patch: Partial<ProfileRecord>): Promise<void> {
    const db = await getDb();
    const profile = await db.get('profiles', id);
    if (profile === undefined) return;
    await db.put('profiles', { ...profile, ...patch });
    announceLibraryChange();
}

/**
 * The build a profile plays (versions.ts offeredEngine), kept with it once it
 * moves to another, so the cloud and the profile list name that one.
 */
export async function settleProfileEngine(profile: ProfileRecord): Promise<string> {
    const engineVersion = await offeredEngine(profile.engineVersion);
    if (engineVersion !== profile.engineVersion) {
        await updateProfile(profile.id, { engineVersion, updatedAt: new Date().toISOString() });
    }
    return engineVersion;
}

/** Moves every profile whose build the server no longer offers onto the newest it does. */
export async function settleProfileEngines(): Promise<void> {
    for (const profile of await listProfiles()) await settleProfileEngine(profile);
}

export async function renameProfile(id: string, name: string): Promise<void> {
    await updateProfile(id, { name, updatedAt: new Date().toISOString() });
    requestCloudSync();
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

/**
 * Deletes a profile on this device, along with its saves and settings. The
 * cloud keeps its copy: cloud/sync.ts deletes it there too.
 */
export async function deleteProfile(id: string): Promise<void> {
    const profile = await getProfile(id);
    if (profile === undefined) return;
    for (const mod of profile.storageMods) {
        await deleteDatabase(profileStoragePath(id, mod));
    }
    const db = await getDb();
    const tx = db.transaction(['profiles', 'cloudsaves'], 'readwrite');
    await tx.objectStore('profiles').delete(id);
    for (const mod of profile.storageMods) await tx.objectStore('cloudsaves').delete(`${id}/${mod}`);
    await tx.done;
    announceLibraryChange();
}
