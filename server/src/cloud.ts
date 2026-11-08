// Where the cloud saves live: a directory per Steam account, holding an
// index (profiles, their saves' file lists, custom levels) and the save
// files themselves, named by their SHA-256. Changes to an account go one at
// a time, and the index is replaced whole, so a crash never leaves half of it.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CloudIndex, CloudLevel, CloudProfile, CloudSettings } from '../../shared/cloud.ts';
import { HttpError, badRequest } from './errors.ts';

export interface CloudLimits {
    /** What one account may keep, in bytes. */
    quotaBytes: number;
    fileBytes: number;
    profiles: number;
    levels: number;
    /** Files in one game's saves of a profile. */
    filesPerSaves: number;
    /** Games one profile keeps saves for. */
    savesPerProfile: number;
    /** Deletions remembered, so devices learn of them; the oldest go first. */
    removals: number;
}

export const DEFAULT_CLOUD_LIMITS: CloudLimits = {
    quotaBytes: 256 * 1024 * 1024,
    fileBytes: 16 * 1024 * 1024,
    profiles: 1000,
    levels: 5000,
    filesPerSaves: 400,
    savesPerProfile: 32,
    removals: 5000,
};

/** Files no save points to are kept this long, for a device between sending a file and the list that names it. */
const UNUSED_FILE_GRACE_MS = 15 * 60 * 1000;

/** The index as stored. */
export interface StoredIndex {
    version: 1;
    settings: CloudSettings;
    profiles: Record<string, CloudProfile>;
    levels: Record<string, CloudLevel>;
    removedProfiles: Record<string, string>;
    removedLevels: Record<string, string>;
}

export interface CloudAccount {
    provider: 'steam';
    id: string;
}

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

function emptyIndex(): StoredIndex {
    return { version: 1, settings: {}, profiles: {}, levels: {}, removedProfiles: {}, removedLevels: {} };
}

export function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Keeps the newest `limit` entries of a removal list. */
function pruneRemovals(removals: Record<string, string>, limit: number): Record<string, string> {
    const entries = Object.entries(removals);
    if (entries.length <= limit) return removals;
    entries.sort((a, b) => b[1].localeCompare(a[1]));
    return Object.fromEntries(entries.slice(0, limit));
}

/** The hashes the saves of every profile point to. */
function usedHashes(index: StoredIndex): Set<string> {
    const used = new Set<string>();
    for (const profile of Object.values(index.profiles)) {
        for (const saves of Object.values(profile.saves)) {
            for (const file of Object.values(saves.files)) used.add(file.hash);
        }
    }
    return used;
}

export class CloudStore {
    readonly limits: CloudLimits;
    private readonly root: string;
    private readonly now: () => number;
    /** The last change queued for each account; the next waits for it. */
    private readonly queues = new Map<string, Promise<unknown>>();
    /** Bytes of save files on disk, by account, once counted. */
    private readonly usage = new Map<string, number>();

    constructor(root: string, limits: Partial<CloudLimits> = {}, now: () => number = Date.now) {
        this.root = root;
        this.limits = { ...DEFAULT_CLOUD_LIMITS, ...limits };
        this.now = now;
    }

    private dir(account: CloudAccount): string {
        if (!ACCOUNT_ID.test(account.id)) throw badRequest('This account id cannot hold cloud saves.');
        return join(this.root, account.provider, account.id);
    }

    private key(account: CloudAccount): string {
        return `${account.provider}:${account.id}`;
    }

    /** Runs a task for an account once the ones before it are done. */
    private serial<T>(account: CloudAccount, task: () => Promise<T>): Promise<T> {
        const key = this.key(account);
        const previous = this.queues.get(key) ?? Promise.resolve();
        const run = previous.then(task, task);
        const settled = run.catch(() => {});
        this.queues.set(key, settled);
        void settled.then(() => {
            if (this.queues.get(key) === settled) this.queues.delete(key);
        });
        return run;
    }

    private async load(account: CloudAccount): Promise<StoredIndex> {
        let text: string;
        try {
            text = await readFile(join(this.dir(account), 'index.json'), 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyIndex();
            throw error;
        }
        const parsed = JSON.parse(text) as Partial<StoredIndex>;
        return { ...emptyIndex(), ...parsed, version: 1 };
    }

    private async save(account: CloudAccount, index: StoredIndex): Promise<void> {
        const dir = this.dir(account);
        await mkdir(dir, { recursive: true });
        const temp = join(dir, `index.json.${randomBytes(6).toString('hex')}.tmp`);
        await writeFile(temp, JSON.stringify(index));
        await rename(temp, join(dir, 'index.json'));
    }

    private async countUsage(account: CloudAccount): Promise<number> {
        const key = this.key(account);
        const known = this.usage.get(key);
        if (known !== undefined) return known;
        const filesDir = join(this.dir(account), 'files');
        let total = 0;
        for (const name of await readdir(filesDir).catch(() => [] as string[])) {
            const stats = await stat(join(filesDir, name)).catch(() => null);
            if (stats?.isFile()) total += stats.size;
        }
        this.usage.set(key, total);
        return total;
    }

    /** Deletes the files no save points to any more, once they are old enough not to be on their way into a list. */
    private async collect(account: CloudAccount, index: StoredIndex): Promise<void> {
        const filesDir = join(this.dir(account), 'files');
        const used = usedHashes(index);
        let total = 0;
        for (const name of await readdir(filesDir).catch(() => [] as string[])) {
            const path = join(filesDir, name);
            const stats = await stat(path).catch(() => null);
            if (stats === null || !stats.isFile()) continue;
            // Half-written files (.tmp) are never used, and go the same way.
            if (!used.has(name) && this.now() - stats.mtimeMs > UNUSED_FILE_GRACE_MS) {
                await rm(path, { force: true });
                continue;
            }
            total += stats.size;
        }
        this.usage.set(this.key(account), total);
    }

    /** Everything the cloud holds for an account, without the files' contents. */
    read(account: CloudAccount): Promise<CloudIndex> {
        return this.serial(account, async () => this.present(account, await this.load(account)));
    }

    async present(account: CloudAccount, index: StoredIndex): Promise<CloudIndex> {
        return {
            account: { provider: account.provider, id: account.id },
            settings: index.settings,
            profiles: Object.values(index.profiles),
            levels: Object.values(index.levels),
            removedProfiles: index.removedProfiles,
            removedLevels: index.removedLevels,
            usage: { bytes: await this.countUsage(account), limitBytes: this.limits.quotaBytes },
        };
    }

    /**
     * Changes an account's index. The change sees the index as stored and
     * edits it in place; it is written back once the change returns, and
     * files nothing points to any more are cleared away.
     */
    update<T>(account: CloudAccount, change: (index: StoredIndex) => T | Promise<T>): Promise<T> {
        return this.serial(account, async () => {
            const index = await this.load(account);
            const result = await change(index);
            index.removedProfiles = pruneRemovals(index.removedProfiles, this.limits.removals);
            index.removedLevels = pruneRemovals(index.removedLevels, this.limits.removals);
            await this.save(account, index);
            await this.collect(account, index);
            return result;
        });
    }

    /** The size of a stored save file, or null when the account has none by that hash. */
    async fileSize(account: CloudAccount, hash: string): Promise<number | null> {
        const stats = await stat(this.filePath(account, hash)).catch(() => null);
        return stats?.isFile() ? stats.size : null;
    }

    filePath(account: CloudAccount, hash: string): string {
        return join(this.dir(account), 'files', hash);
    }

    /** Keeps a save file, after checking it is what its hash says. */
    putFile(account: CloudAccount, hash: string, bytes: Uint8Array): Promise<void> {
        if (bytes.byteLength > this.limits.fileBytes) {
            return Promise.reject(new HttpError(413, 'too_large', 'This save file is larger than the cloud takes.'));
        }
        if (sha256(bytes) !== hash) {
            return Promise.reject(badRequest('The file does not match its hash; it may have been cut short on the way.', 'hash_mismatch'));
        }
        return this.serial(account, async () => {
            const path = this.filePath(account, hash);
            if ((await this.fileSize(account, hash)) !== null) return;
            const used = await this.countUsage(account);
            if (used + bytes.byteLength > this.limits.quotaBytes) {
                throw new HttpError(413, 'cloud_full', 'Your cloud is full. Delete the saves of a game or level you no longer play to make room.');
            }
            const filesDir = join(this.dir(account), 'files');
            await mkdir(filesDir, { recursive: true });
            const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
            await writeFile(temp, bytes);
            await rename(temp, path);
            this.usage.set(this.key(account), used + bytes.byteLength);
        });
    }

    /** When the store says it is, as ISO text. */
    stamp(): string {
        return new Date(this.now()).toISOString();
    }
}
