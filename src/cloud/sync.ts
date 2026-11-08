// Cloud saves: keeps this device's profiles, their saves and the custom
// levels added here in step with the cloud of the Steam account signed in.
//
// - Profiles go up when made (or at the first sync after signing in, for
//   ones made before), and come down onto a device once it has their game
//   or level. A profile is one set of saves on every device: deleting it
//   deletes it everywhere.
// - Saves are merged file by file against what this device and the cloud
//   last agreed on (merge.ts), when the menus open and when a game starts,
//   and sent up as the game saves.
// - Custom levels go up as entries saying where to get them, never their
//   files, so another device lists them to download again.
// - The look picked in the settings follows the player: the latest pick wins.
// - Taking a game or level out of the cloud deletes its profiles and saves
//   everywhere; the level files stay on the devices that have them.

import { create } from 'zustand';
import type { CustomLevelDetails, CustomLevelSummary } from '../../shared/api.ts';
import type { CloudFile, CloudIndex, CloudLevel, CloudLevelSource, CloudProfile, CloudProfileMeta, CloudSaves, PutLevelRequest } from '../../shared/cloud.ts';
import { refreshAccount, useAccount } from '../account/store';
import { loadEngineVersions } from '../engine/versions';
import { getGameData, listGameData, listLevelInfo } from '../gamedata/store';
import type { GameDataRecord } from '../gamedata/types';
import { onCloudSyncRequest } from '../lib/changes';
import { getDb } from '../lib/db';
import { deleteProfile, getProfile, listProfiles, noteStorageMod, profileStoragePath, putProfile, updateProfile } from '../profiles/store';
import type { ProfileRecord } from '../profiles/types';
import { adoptTheme, themePick } from '../ui/theme';
import {
    CloudError,
    CloudUnreachableError,
    deleteCloudProfile,
    deleteCloudTitle,
    fetchCloudFile,
    fetchCloudIndex,
    putCloudFile,
    putCloudLevel,
    putCloudProfile,
    putCloudSaves,
    putCloudSettings,
    SavesConflictError,
} from './api';
import { readSaveFiles, sha256Hex, writeSaveFiles, type SaveFileData } from './idbfs';
import { mergeSaves } from './merge';
import type { CloudSavesBase } from './types';

export type CloudStatus = 'off' | 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

interface CloudState {
    /** Whose cloud this is, as `steam:<id>`; null when signed out. */
    account: string | null;
    status: CloudStatus;
    /** What the cloud held at the last sync, kept for offline use. */
    index: CloudIndex | null;
    lastSyncAt: string | null;
    error: string | null;
}

const CACHE_KEY = 'trx-suite:cloud';
const DELETIONS_KEY = 'trx-suite:cloud-deletions';

function steamAccount(): string | null {
    const steam = useAccount.getState().me?.accounts.find((account) => account.provider === 'steam');
    return steam === undefined ? null : `steam:${steam.id}`;
}

function keyOf(index: CloudIndex): string {
    return `${index.account.provider}:${index.account.id}`;
}

function readJson<T>(key: string): T | null {
    try {
        const text = localStorage.getItem(key);
        return text === null ? null : (JSON.parse(text) as T);
    } catch {
        return null;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Forgotten offline; the next sync knows again.
    }
}

interface Cached {
    account: string;
    index: CloudIndex;
    lastSyncAt: string;
}

function initialState(): CloudState {
    const account = steamAccount();
    const cached = readJson<Cached>(CACHE_KEY);
    if (account === null) return { account: null, status: 'off', index: null, lastSyncAt: null, error: null };
    if (cached?.account !== account) return { account, status: 'idle', index: null, lastSyncAt: null, error: null };
    return { account, status: 'idle', index: cached.index, lastSyncAt: cached.lastSyncAt, error: null };
}

export const useCloud = create<CloudState>(initialState);

function synced(index: CloudIndex): void {
    const lastSyncAt = new Date().toISOString();
    writeJson(CACHE_KEY, { account: keyOf(index), index, lastSyncAt } satisfies Cached);
    useCloud.setState({ account: keyOf(index), status: 'synced', index, lastSyncAt, error: null });
}

export function describeCloudError(error: unknown): string {
    if (error instanceof CloudUnreachableError) return 'The server is out of reach. The cloud syncs once the connection is back.';
    return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------- the base

async function getBase(profileId: string, mod: string): Promise<CloudSavesBase | undefined> {
    return (await getDb()).get('cloudsaves', `${profileId}/${mod}`);
}

async function putBase(base: CloudSavesBase): Promise<void> {
    await (await getDb()).put('cloudsaves', base);
}

// -------------------------------------------------------------- saves

type SavesOutcome = 'synced' | 'deferred';

/**
 * Merges a profile's saves for one game with the cloud's. With writeLocal
 * off, as while the game runs, it only sends this device's changes, and
 * leaves anything the cloud changed for later.
 */
async function syncSaves(
    account: string,
    profile: ProfileRecord,
    mod: string,
    remote: CloudSaves | undefined,
    writeLocal: boolean,
    signal?: AbortSignal,
): Promise<SavesOutcome> {
    const root = profileStoragePath(profile.id, mod);
    const files = await readSaveFiles(root);
    const local: Record<string, CloudFile> = {};
    const bytes = new Map<string, Uint8Array>();
    for (const file of files) {
        local[file.path] = { hash: await sha256Hex(file.bytes), size: file.bytes.byteLength, mtime: file.mtime };
        bytes.set(file.path, file.bytes);
    }
    const stored = await getBase(profile.id, mod);
    const base = stored?.account === account ? stored.files : {};
    let theirs: CloudSaves = remote ?? { rev: 0, updatedAt: '', files: {} };

    for (let attempt = 0; attempt < 3; attempt++) {
        const merged = mergeSaves(local, theirs.files, base);
        const changesHere = merged.download.length > 0 || merged.removeLocal.length > 0;
        if (!writeLocal && changesHere) return 'deferred';

        let agreed = theirs;
        if (merged.upload) {
            const known = new Set(Object.values(theirs.files).map((file) => file.hash));
            for (const [path, file] of Object.entries(merged.result)) {
                const content = bytes.get(path);
                if (known.has(file.hash) || content === undefined) continue;
                await putCloudFile(file.hash, content, signal);
                known.add(file.hash);
            }
            try {
                agreed = await putCloudSaves(profile.id, mod, { baseRev: theirs.rev, files: merged.result }, signal);
            } catch (error) {
                if (!(error instanceof SavesConflictError)) throw error;
                if (!writeLocal) return 'deferred';
                theirs = error.saves;
                continue;
            }
        }

        if (changesHere) {
            const writes: SaveFileData[] = [];
            for (const path of merged.download) {
                const file = merged.result[path]!;
                writes.push({ path, bytes: await fetchCloudFile(file.hash, signal), mtime: file.mtime });
            }
            // Past here the device changes; a game about to read these saves waits for it.
            signal?.throwIfAborted();
            await writeSaveFiles(root, writes, merged.removeLocal);
            if (!profile.storageMods.includes(mod)) await noteStorageMod(profile.id, mod);
        }
        await putBase({ key: `${profile.id}/${mod}`, profileId: profile.id, mod, account, rev: agreed.rev, files: merged.result });
        return 'synced';
    }
    return 'deferred';
}

// ----------------------------------------------------------- profiles

function metaOf(profile: ProfileRecord, title: string): CloudProfileMeta {
    return {
        id: profile.id,
        name: profile.name,
        title,
        mod: profile.mod,
        engine: profile.engine,
        engineVersion: profile.engineVersion,
        createdAt: profile.createdAt,
        lastPlayedAt: profile.lastPlayedAt,
        updatedAt: profile.updatedAt ?? profile.createdAt,
    };
}

function isLater(a: string | null | undefined, b: string | null | undefined): boolean {
    return a !== null && a !== undefined && (b === null || b === undefined || a > b);
}

/** Whether the cloud lacks something this device knows of a profile. */
function behind(meta: CloudProfileMeta, there: CloudProfile): boolean {
    return isLater(meta.updatedAt, there.updatedAt) || isLater(meta.lastPlayedAt, there.lastPlayedAt);
}

/** Profiles deleted from the cloud go from this device too. */
async function applyRemovals(index: CloudIndex, account: string): Promise<void> {
    for (const profile of await listProfiles()) {
        if (profile.cloud?.account === account && index.removedProfiles[profile.id] !== undefined) await deleteProfile(profile.id);
    }
}

/** What the cloud lists for a custom level of the library, or null for official games. */
function levelOf(record: GameDataRecord, details: CustomLevelDetails | undefined): PutLevelRequest | null {
    if (record.layout === 'game') return null;
    let source: CloudLevelSource;
    switch (record.source.kind) {
        case 'trcustoms': {
            const { levelId, fileId, version } = record.source;
            source = { kind: 'trcustoms', levelId, fileId, version };
            if (details?.file?.id === fileId) source.sizeBytes = details.file.sizeBytes;
            break;
        }
        case 'link':
            source = { kind: 'link', url: record.source.url };
            break;
        case 'upload':
            source = { kind: 'upload', name: record.source.name.slice(0, 200) };
            break;
        default:
            return null;
    }
    let summary: CustomLevelSummary | undefined;
    if (details !== undefined) {
        // The card's fields; the description and screenshots come from TRCustoms when the level opens.
        const { id, name, game, engineName, authors, difficulty, duration, rating, genres, cover, releaseDate, downloads, reviews, file } = details;
        summary = { id, name, game, engineName, authors, difficulty, duration, rating, genres, cover, releaseDate, downloads, reviews, file };
    }
    return {
        mod: record.mod,
        name: record.name,
        engine: record.engine,
        layout: record.layout,
        source,
        ...(record.startLevel !== undefined ? { startLevel: record.startLevel } : {}),
        ...(summary !== undefined ? { summary } : {}),
    };
}

function levelBehind(there: CloudLevel, here: PutLevelRequest): boolean {
    if (there.summary === undefined && here.summary !== undefined) return true;
    return here.source.kind === 'trcustoms' && there.source.kind === 'trcustoms' && here.source.version > there.source.version;
}

/** Sends what the cloud lacks of this device's profiles, and takes newer names from it. */
async function sendProfiles(index: CloudIndex, account: string): Promise<boolean> {
    const gamedata = new Map((await listGameData()).map((record) => [record.id, record]));
    const info = new Map((await listLevelInfo()).map((entry) => [entry.gamedataId, entry.details]));
    const remote = new Map(index.profiles.map((profile) => [profile.id, profile]));
    const levels = new Set(index.levels.map((level) => level.mod));
    let changed = false;

    for (const profile of await listProfiles()) {
        if (profile.cloud !== undefined && profile.cloud.account !== account) continue;
        if (index.removedProfiles[profile.id] !== undefined) continue;
        const record = gamedata.get(profile.gamedataId);
        const title = profile.title ?? record?.mod;
        if (title === undefined) continue;
        const meta = metaOf(profile, title);
        let there = remote.get(profile.id);
        if (there === undefined || behind(meta, there)) {
            // A custom level played here is one to keep listing, even if it was taken out before.
            if (there === undefined && record !== undefined && !levels.has(title)) {
                const level = levelOf(record, info.get(record.id));
                if (level !== null) {
                    await putCloudLevel({ ...level, restore: true });
                    levels.add(title);
                }
            }
            try {
                there = await putCloudProfile(meta);
            } catch (error) {
                if (error instanceof CloudError && error.status === 410) continue;
                throw error;
            }
            changed = true;
        }
        const patch: Partial<ProfileRecord> = {};
        if (profile.cloud?.account !== account) patch.cloud = { account };
        if (profile.title === undefined) patch.title = title;
        if (isLater(there.updatedAt, profile.updatedAt ?? profile.createdAt) && there.name !== profile.name) {
            patch.name = there.name;
            patch.updatedAt = there.updatedAt;
        }
        if (isLater(there.lastPlayedAt, profile.lastPlayedAt)) patch.lastPlayedAt = there.lastPlayedAt;
        if (Object.keys(patch).length > 0) await updateProfile(profile.id, patch);
    }
    return changed;
}

/** Lists this device's custom levels in the cloud, unless taken out of it since they came. */
async function sendLevels(index: CloudIndex): Promise<boolean> {
    const info = new Map((await listLevelInfo()).map((entry) => [entry.gamedataId, entry.details]));
    const there = new Map(index.levels.map((level) => [level.mod, level]));
    let changed = false;
    for (const record of await listGameData()) {
        if (record.status !== 'ready') continue;
        const level = levelOf(record, info.get(record.id));
        if (level === null) continue;
        const existing = there.get(record.mod);
        const removedAt = index.removedLevels[record.mod];
        if (existing === undefined) {
            if (removedAt !== undefined && record.createdAt <= removedAt) continue;
            await putCloudLevel({ ...level, restore: removedAt !== undefined });
            changed = true;
        } else if (levelBehind(existing, level)) {
            await putCloudLevel(level);
            changed = true;
        }
    }
    return changed;
}

/** Makes the cloud's profiles on this device, for the games and levels it has. */
async function bringProfiles(index: CloudIndex, account: string): Promise<void> {
    const local = new Set((await listProfiles()).map((profile) => profile.id));
    const ready = (await listGameData()).filter((record) => record.status === 'ready');
    const versions = await loadEngineVersions().catch(() => [] as string[]);
    for (const remote of index.profiles) {
        if (local.has(remote.id)) continue;
        const record = ready.filter((candidate) => candidate.mod === remote.title).at(-1);
        if (record === undefined) continue;
        await putProfile({
            id: remote.id,
            name: remote.name,
            gamedataId: record.id,
            title: remote.title,
            mod: remote.mod,
            engine: remote.engine,
            // A build this server no longer offers would not load.
            engineVersion: versions.length === 0 || versions.includes(remote.engineVersion) ? remote.engineVersion : versions[0]!,
            storageMods: Object.keys(remote.saves),
            createdAt: remote.createdAt,
            lastPlayedAt: remote.lastPlayedAt,
            updatedAt: remote.updatedAt,
            cloud: { account },
        });
    }
}

async function syncEverySaves(index: CloudIndex, account: string): Promise<void> {
    const remote = new Map(index.profiles.map((profile) => [profile.id, profile]));
    for (const profile of await listProfiles()) {
        const there = remote.get(profile.id);
        if (profile.cloud?.account !== account || there === undefined) continue;
        for (const mod of new Set([...profile.storageMods, ...Object.keys(there.saves)])) {
            try {
                await syncSaves(account, profile, mod, there.saves[mod], true);
            } catch (error) {
                // One profile's trouble does not hold up the others'.
                if (error instanceof CloudUnreachableError || (error instanceof CloudError && error.status === 401)) throw error;
                console.warn(`[cloud] the saves of ${profile.name} (${mod}) did not sync:`, error);
            }
        }
    }
}

// ----------------------------------------------------------- settings

/**
 * The look the player picked: this device's pick goes up when it is newer
 * than the cloud's, the cloud's comes down when it is newer than this
 * device's, or when this device never had one picked. Returns whether the
 * cloud changed.
 */
async function syncSettings(index: CloudIndex): Promise<boolean> {
    const here = themePick();
    const there = index.settings.theme;
    if (here.pickedAt !== null && (there === undefined || here.pickedAt > there.updatedAt)) {
        if (there?.value !== here.theme) {
            await putCloudSettings({ theme: { value: here.theme, updatedAt: here.pickedAt } });
            return true;
        }
    } else if (there !== undefined && (here.pickedAt === null || there.updatedAt > here.pickedAt)) {
        adoptTheme(there.value, there.updatedAt);
    }
    return false;
}

// ---------------------------------------------------------- deletions

interface PendingDeletion {
    account: string;
    profileId: string;
}

function pendingDeletions(): PendingDeletion[] {
    return readJson<PendingDeletion[]>(DELETIONS_KEY) ?? [];
}

async function sendDeletions(account: string): Promise<void> {
    let left = pendingDeletions();
    for (const pending of left.filter((entry) => entry.account === account)) {
        try {
            await deleteCloudProfile(pending.profileId);
        } catch (error) {
            if (error instanceof CloudUnreachableError || (error instanceof CloudError && (error.status >= 500 || error.status === 401))) throw error;
        }
        left = left.filter((entry) => entry !== pending);
        writeJson(DELETIONS_KEY, left);
    }
}

/**
 * Deletes a profile with its saves: on this device, in the cloud, and so on
 * every device that syncs it. Offline, the cloud hears of it later.
 */
export async function deleteProfileEverywhere(profile: ProfileRecord): Promise<void> {
    await deleteProfile(profile.id);
    const account = profile.cloud?.account;
    if (account === undefined) return;
    if (account === useCloud.getState().account && navigator.onLine) {
        try {
            synced(await deleteCloudProfile(profile.id));
            return;
        } catch (error) {
            console.warn('[cloud] deleting the profile there failed; trying again later:', error);
        }
    }
    writeJson(DELETIONS_KEY, [...pendingDeletions(), { account, profileId: profile.id }]);
}

/**
 * Takes a game or custom level out of the cloud: deletes the profiles that
 * play it, with their saves, there and on every device that syncs them, and
 * the custom level's entry. Its files stay where they are.
 */
export async function deleteFromCloud(title: string): Promise<void> {
    const index = await deleteCloudTitle(title);
    await applyRemovals(index, keyOf(index));
    synced(index);
}

// --------------------------------------------------------------- sync

async function runSync(): Promise<void> {
    const account = steamAccount();
    if (account === null) {
        useCloud.setState({ account: null, status: 'off', index: null, error: null });
        return;
    }
    if (!navigator.onLine) {
        useCloud.setState({ status: 'offline' });
        return;
    }
    useCloud.setState((state) => ({ status: 'syncing', ...(state.account !== account ? { account, index: null, lastSyncAt: null } : {}) }));
    try {
        await sendDeletions(account);
        let index = await fetchCloudIndex();
        // The session says whose cloud this is, whatever the page remembered.
        const owner = keyOf(index);
        await applyRemovals(index, owner);
        const sentProfiles = await sendProfiles(index, owner);
        const sentLevels = await sendLevels(index);
        const sentSettings = await syncSettings(index);
        if (sentProfiles || sentLevels || sentSettings) index = await fetchCloudIndex();
        await bringProfiles(index, owner);
        await syncEverySaves(index, owner);
        synced(await fetchCloudIndex());
    } catch (error) {
        if (error instanceof CloudError && error.status === 401) {
            useCloud.setState({ status: 'off' });
            void refreshAccount();
            return;
        }
        if (error instanceof CloudUnreachableError) {
            useCloud.setState({ status: 'offline' });
            return;
        }
        console.warn('[cloud] syncing failed:', error);
        useCloud.setState({ status: 'error', error: describeCloudError(error) });
    }
}

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Syncs now, or once the sync under way is done. */
export function syncCloudNow(): Promise<void> {
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }
    if (running !== null) {
        again = true;
        return running;
    }
    running = (async () => {
        try {
            do {
                again = false;
                await runSync();
            } while (again);
        } finally {
            running = null;
        }
    })();
    return running;
}

/** Syncs soon, so that a burst of changes makes one sync. */
export function scheduleCloudSync(delayMs = 1500): void {
    if (!started) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void syncCloudNow(), delayMs);
}

/**
 * Keeps the cloud in step from now on, as the menus do: syncs now, when
 * something changes, on signing in, and when the connection comes back.
 * The play page does not, so a sync never writes saves under a running game.
 */
export function startCloudSync(): void {
    if (started) {
        scheduleCloudSync(0);
        return;
    }
    started = true;
    onCloudSyncRequest(() => scheduleCloudSync());
    window.addEventListener('online', () => scheduleCloudSync(0));
    useAccount.subscribe((state, previous) => {
        const id = (me: typeof state.me) => me?.accounts.find((account) => account.provider === 'steam')?.id ?? null;
        if (id(state.me) !== id(previous.me)) {
            useCloud.setState(initialState());
            scheduleCloudSync(0);
        }
    });
    scheduleCloudSync(0);
}

// --------------------------------------------------------- the session

/**
 * Before the engine reads a profile's saves for a game: brings in what the
 * cloud has, making the profile there first if it is new. Gives up after a
 * few seconds of waiting on the network, and never while writing the saves.
 */
export async function pullSavesForSession(profileId: string, mod: string, timeoutMs = 6000): Promise<void> {
    const account = steamAccount();
    if (account === null || !navigator.onLine) return;
    const profile = await getProfile(profileId);
    if (profile === undefined || (profile.cloud !== undefined && profile.cloud.account !== account)) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('The cloud took too long.', 'TimeoutError')), timeoutMs);
    try {
        const index = await fetchCloudIndex(controller.signal);
        const owner = keyOf(index);
        if (index.removedProfiles[profile.id] !== undefined) return;
        let there = index.profiles.find((candidate) => candidate.id === profile.id);
        if (there === undefined) {
            const title = profile.title ?? (await getGameData(profile.gamedataId))?.mod;
            if (title === undefined) return;
            there = await putCloudProfile(metaOf(profile, title), controller.signal);
            await updateProfile(profile.id, { cloud: { account: owner }, title });
        }
        await syncSaves(owner, { ...profile, cloud: { account: owner } }, mod, there.saves[mod], true, controller.signal);
    } catch (error) {
        console.warn('[cloud] the saves were not brought in; playing with the ones here:', error);
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Sends a running game's new saves to the cloud. Saves the cloud changed
 * meanwhile wait for the next sync from the menus, which merges them.
 */
export async function pushSavesForSession(profileId: string, mods: readonly string[]): Promise<void> {
    const account = steamAccount();
    if (account === null || !navigator.onLine) return;
    const profile = await getProfile(profileId);
    if (profile?.cloud?.account !== account) return;
    for (const mod of mods) {
        const base = await getBase(profile.id, mod);
        if (base?.account !== account) continue;
        try {
            await syncSaves(account, profile, mod, { rev: base.rev, updatedAt: '', files: base.files }, false);
        } catch (error) {
            console.warn('[cloud] sending the saves failed; the menus try again:', error);
        }
    }
}

// ---------------------------------------------------- what the menus show

/** The cloud's entry for a TRCustoms level, if the player added it before. */
export function cloudLevelFor(levelId: number): CloudLevel | undefined {
    return useCloud.getState().index?.levels.find((level) => level.source.kind === 'trcustoms' && level.source.levelId === levelId);
}
