// Cloud saves for players signed in with Steam: their profiles and save
// files, and the custom levels they added, so another device can list them
// and download them again. The page does the syncing; these routes keep
// what it sends, and refuse changes built on saves that changed since.

import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CustomLevelSummary } from '../../shared/api.ts';
import {
    CLOUD_HASH,
    CLOUD_MOD,
    CLOUD_PROFILE_ID,
    CLOUD_SAVE_PATH,
    CLOUD_THEMES,
    type CloudFile,
    type CloudIndex,
    type CloudLevel,
    type CloudLevelSource,
    type CloudProfile,
    type CloudProfileMeta,
    type CloudSaves,
    type CloudSetting,
    type CloudSettings,
    type CloudTheme,
    type SavesConflict,
} from '../../shared/cloud.ts';
import type { EngineNumber } from '../../shared/games.ts';
import type { Context } from './app.ts';
import { CloudStore, type CloudAccount, type StoredIndex } from './cloud.ts';
import { HttpError, badRequest, notFound } from './errors.ts';
import { readAccounts } from './session.ts';

/** Profiles, levels and file lists are small; this leaves room for long ones. */
const JSON_LIMIT = 512 * 1024;

function signedOut(): HttpError {
    return new HttpError(401, 'signed_out', 'Sign in with Steam to keep saves in the cloud.');
}

/** The Steam account the cloud belongs to; signed-out players have none. */
function cloudAccount(request: FastifyRequest, context: Context): CloudAccount {
    const steam = readAccounts(request, context.config).find((account) => account.provider === 'steam');
    if (steam === undefined) throw signedOut();
    return { provider: 'steam', id: steam.id };
}

// --------------------------------------------------------------- checking

type Fields = Record<string, unknown>;

function object(value: unknown, what: string): Fields {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw badRequest(`${what} must be a JSON object.`);
    return value as Fields;
}

function text(value: unknown, what: string, max = 200): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) throw badRequest(`${what} must be text of up to ${max} characters.`);
    return value;
}

function optionalText(value: unknown, what: string, max = 200): string | undefined {
    return value === undefined ? undefined : text(value, what, max);
}

function date(value: unknown, what: string): string {
    const given = text(value, what, 40);
    if (Number.isNaN(Date.parse(given))) throw badRequest(`${what} must be a date.`);
    return new Date(given).toISOString();
}

function engine(value: unknown): EngineNumber {
    if (value === 1 || value === 2 || value === 3 || value === 4) return value;
    throw badRequest('engine must be 1, 2, 3 or 4.');
}

function count(value: unknown, what: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw badRequest(`${what} must be a whole number.`);
    return value;
}

function matching(value: unknown, pattern: RegExp, what: string): string {
    if (typeof value !== 'string' || !pattern.test(value)) throw badRequest(`${what} is not valid.`);
    return value;
}

function profileMeta(body: Fields, id: string): CloudProfileMeta {
    if (body.id !== undefined && body.id !== id) throw badRequest('The profile id in the body differs from the address.');
    return {
        id,
        name: text(body.name, 'name', 120),
        title: matching(body.title, CLOUD_MOD, 'title'),
        mod: matching(body.mod, CLOUD_MOD, 'mod'),
        engine: engine(body.engine),
        engineVersion: text(body.engineVersion, 'engineVersion', 40),
        createdAt: date(body.createdAt, 'createdAt'),
        lastPlayedAt: body.lastPlayedAt === null || body.lastPlayedAt === undefined ? null : date(body.lastPlayedAt, 'lastPlayedAt'),
        updatedAt: date(body.updatedAt, 'updatedAt'),
    };
}

function levelSource(value: unknown): CloudLevelSource {
    const source = object(value, 'source');
    switch (source.kind) {
        case 'trcustoms': {
            const result: CloudLevelSource = {
                kind: 'trcustoms',
                levelId: count(source.levelId, 'source.levelId'),
                fileId: count(source.fileId, 'source.fileId'),
                version: count(source.version, 'source.version'),
            };
            if (source.sizeBytes !== undefined) result.sizeBytes = count(source.sizeBytes, 'source.sizeBytes');
            return result;
        }
        case 'link': {
            const url = text(source.url, 'source.url', 2000);
            if (!/^https?:\/\//i.test(url)) throw badRequest('source.url must be an http or https address.');
            return { kind: 'link', url };
        }
        case 'upload':
            return { kind: 'upload', name: text(source.name, 'source.name', 200) };
        default:
            throw badRequest('source.kind must be trcustoms, link or upload.');
    }
}

/** Images come through this server; anything else is dropped rather than shown. */
function localImage(value: unknown): string | null {
    return typeof value === 'string' && value.startsWith('/api/trcustoms/') && value.length < 500 ? value : null;
}

function strings(value: unknown, max: number): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 200).slice(0, max) : [];
}

function nullableText(value: unknown, max = 200): string | null {
    return typeof value === 'string' && value.length <= max ? value : null;
}

/** What TRCustoms said about a level, kept to the fields its card shows. */
function levelSummary(value: unknown): CustomLevelSummary | undefined {
    if (value === undefined) return undefined;
    const raw = object(value, 'summary');
    const game = raw.game === 1 || raw.game === 2 || raw.game === 3 ? raw.game : null;
    const rating = typeof raw.rating === 'object' && raw.rating !== null ? (raw.rating as Fields) : null;
    const file = typeof raw.file === 'object' && raw.file !== null ? (raw.file as Fields) : null;
    const fileId = file === null ? null : count(file.id, 'summary.file.id');
    return {
        id: count(raw.id, 'summary.id'),
        name: text(raw.name, 'summary.name', 200),
        game,
        engineName: nullableText(raw.engineName, 40) ?? '',
        authors: strings(raw.authors, 20),
        difficulty: nullableText(raw.difficulty, 40),
        duration: nullableText(raw.duration, 40),
        rating:
            rating !== null && typeof rating.name === 'string' && typeof rating.position === 'number'
                ? { name: rating.name.slice(0, 40), position: rating.position }
                : null,
        genres: strings(raw.genres, 20),
        cover: localImage(raw.cover),
        releaseDate: nullableText(raw.releaseDate, 40) ?? '',
        downloads: typeof raw.downloads === 'number' ? raw.downloads : 0,
        reviews: typeof raw.reviews === 'number' ? raw.reviews : 0,
        file:
            file === null || fileId === null
                ? null
                : {
                      id: fileId,
                      version: count(file.version, 'summary.file.version'),
                      sizeBytes: count(file.sizeBytes, 'summary.file.sizeBytes'),
                      url: `/api/trcustoms/files/${fileId}`,
                  },
    };
}

function later(a: string | null, b: string | null): string | null {
    if (a === null) return b;
    if (b === null) return a;
    return a > b ? a : b;
}

/** A profile as two devices told it: the newer name, the first creation, the last play. */
function mergeProfile(existing: CloudProfile, given: CloudProfileMeta): CloudProfile {
    const newer = given.updatedAt > existing.updatedAt;
    return {
        ...existing,
        ...(newer ? { name: given.name, engineVersion: given.engineVersion, updatedAt: given.updatedAt } : {}),
        createdAt: given.createdAt < existing.createdAt ? given.createdAt : existing.createdAt,
        lastPlayedAt: later(existing.lastPlayedAt, given.lastPlayedAt),
    };
}

function removeProfile(index: StoredIndex, id: string, at: string): void {
    delete index.profiles[id];
    index.removedProfiles[id] = at;
}

// ----------------------------------------------------------------- routes

export function registerCloudRoutes(app: FastifyInstance, context: Context, store: CloudStore): void {
    const account = (request: FastifyRequest) => cloudAccount(request, context);
    const present = (who: CloudAccount, index: StoredIndex): Promise<CloudIndex> => store.present(who, index);

    app.get('/api/cloud', async (request): Promise<CloudIndex> => store.read(account(request)));

    // --- settings ---------------------------------------------------------

    /** Takes the settings a device changed; each keeps the latest change of it. */
    app.put('/api/cloud/settings', async (request): Promise<CloudSettings> => {
        const who = account(request);
        const body = object(request.body, 'The settings');
        let theme: CloudSetting<CloudTheme> | undefined;
        if (body.theme !== undefined) {
            const given = object(body.theme, 'theme');
            const value = CLOUD_THEMES.find((candidate) => candidate === given.value);
            if (value === undefined) throw badRequest(`theme must be one of ${CLOUD_THEMES.join(', ')}.`);
            theme = { value, updatedAt: date(given.updatedAt, 'theme.updatedAt') };
        }
        return store.update(who, (index) => {
            if (theme !== undefined && (index.settings.theme === undefined || theme.updatedAt > index.settings.theme.updatedAt)) {
                index.settings.theme = theme;
            }
            return index.settings;
        });
    });

    // --- profiles ---------------------------------------------------------

    app.put<{ Params: { id: string } }>('/api/cloud/profiles/:id', { bodyLimit: JSON_LIMIT }, async (request): Promise<CloudProfile> => {
        const who = account(request);
        const id = matching(request.params.id, CLOUD_PROFILE_ID, 'The profile id');
        const body = object(request.body, 'The profile');
        const meta = profileMeta(body, id);
        const restore = body.restore === true;
        return store.update(who, (index) => {
            const existing = index.profiles[id];
            if (existing === undefined) {
                if (index.removedProfiles[id] !== undefined && !restore) {
                    throw new HttpError(410, 'removed', 'This profile was deleted from the cloud.');
                }
                if (Object.keys(index.profiles).length >= store.limits.profiles) {
                    throw new HttpError(413, 'cloud_full', 'Your cloud holds as many profiles as it can.');
                }
                delete index.removedProfiles[id];
                const created: CloudProfile = { ...meta, saves: {} };
                index.profiles[id] = created;
                return created;
            }
            const merged = mergeProfile(existing, meta);
            index.profiles[id] = merged;
            return merged;
        });
    });

    app.delete<{ Params: { id: string } }>('/api/cloud/profiles/:id', async (request): Promise<CloudIndex> => {
        const who = account(request);
        const id = matching(request.params.id, CLOUD_PROFILE_ID, 'The profile id');
        return store.update(who, (index) => {
            if (index.profiles[id] !== undefined || index.removedProfiles[id] === undefined) removeProfile(index, id, store.stamp());
            return present(who, index);
        });
    });

    // --- saves ------------------------------------------------------------

    app.put<{ Params: { id: string; mod: string } }>(
        '/api/cloud/saves/:id/:mod',
        { bodyLimit: JSON_LIMIT },
        async (request, reply): Promise<CloudSaves | SavesConflict> => {
            const who = account(request);
            const id = matching(request.params.id, CLOUD_PROFILE_ID, 'The profile id');
            const mod = matching(request.params.mod, CLOUD_MOD, 'The game');
            const body = object(request.body, 'The saves');
            const baseRev = count(body.baseRev, 'baseRev');
            const given = object(body.files, 'files');
            const entries = Object.entries(given);
            if (entries.length > store.limits.filesPerSaves) throw badRequest('That is more save files than the cloud keeps for one game.');
            const files: Record<string, CloudFile> = {};
            for (const [path, value] of entries) {
                if (!CLOUD_SAVE_PATH.test(path)) throw badRequest(`"${path}" is not a save file's path.`);
                const file = object(value, path);
                const hash = matching(file.hash, CLOUD_HASH, `The hash of ${path}`);
                // The stored file says how large it is, whatever the list claims.
                const size = await store.fileSize(who, hash);
                if (size === null) throw badRequest(`The cloud has no file for ${path}; send it first.`, 'missing_file');
                files[path] = { hash, size, mtime: count(file.mtime, `The time of ${path}`) };
            }

            return store.update(who, (index) => {
                const profile = index.profiles[id];
                if (profile === undefined) {
                    if (index.removedProfiles[id] !== undefined) throw new HttpError(410, 'removed', 'This profile was deleted from the cloud.');
                    throw notFound('The cloud has no such profile; send the profile first.');
                }
                const current = profile.saves[mod] ?? { rev: 0, updatedAt: profile.createdAt, files: {} };
                if (baseRev !== current.rev) {
                    void reply.code(409);
                    return { error: 'conflict', message: 'These saves changed in the cloud since; merge with them first.', saves: current } satisfies SavesConflict;
                }
                if (profile.saves[mod] === undefined && Object.keys(profile.saves).length >= store.limits.savesPerProfile) {
                    throw badRequest('This profile keeps saves for as many games as it can.');
                }
                const next: CloudSaves = { rev: current.rev + 1, updatedAt: store.stamp(), files };
                profile.saves[mod] = next;
                return next;
            });
        },
    );

    // --- save files -------------------------------------------------------

    app.register(async (scope) => {
        scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: store.limits.fileBytes }, (_request, body, done) =>
            done(null, body),
        );

        scope.put<{ Params: { hash: string } }>('/api/cloud/files/:hash', { bodyLimit: store.limits.fileBytes }, async (request, reply) => {
            const who = account(request);
            const hash = matching(request.params.hash, CLOUD_HASH, 'The hash');
            if (!Buffer.isBuffer(request.body)) throw new HttpError(415, 'unsupported_media_type', 'Send the file as application/octet-stream.');
            await store.putFile(who, hash, request.body);
            return reply.code(204).send();
        });
    });

    app.get<{ Params: { hash: string } }>('/api/cloud/files/:hash', async (request, reply) => {
        const who = account(request);
        const hash = matching(request.params.hash, CLOUD_HASH, 'The hash');
        const size = await store.fileSize(who, hash);
        if (size === null) throw notFound('The cloud has no such file.');
        return reply
            .type('application/octet-stream')
            .header('content-length', size)
            // Named by its contents, so it never changes; only its owner may read it.
            .header('cache-control', 'private, max-age=31536000, immutable')
            .send(createReadStream(store.filePath(who, hash)));
    });

    // --- custom levels ----------------------------------------------------

    app.put<{ Params: { mod: string } }>('/api/cloud/levels/:mod', { bodyLimit: JSON_LIMIT }, async (request): Promise<CloudLevel> => {
        const who = account(request);
        const mod = matching(request.params.mod, CLOUD_MOD, 'The level');
        const body = object(request.body, 'The level');
        if (body.mod !== undefined && body.mod !== mod) throw badRequest('The level in the body differs from the address.');
        if (body.layout !== 'custom' && body.layout !== 'level') throw badRequest('layout must be custom or level.');
        const given = {
            mod,
            name: text(body.name, 'name', 200),
            engine: engine(body.engine),
            layout: body.layout as CloudLevel['layout'],
            source: levelSource(body.source),
            startLevel: optionalText(body.startLevel, 'startLevel', 300),
            summary: levelSummary(body.summary),
        };
        const restore = body.restore === true;
        return store.update(who, (index) => {
            const existing = index.levels[mod];
            if (existing === undefined) {
                if (index.removedLevels[mod] !== undefined && !restore) {
                    throw new HttpError(410, 'removed', 'This level was taken out of the cloud.');
                }
                if (Object.keys(index.levels).length >= store.limits.levels) {
                    throw new HttpError(413, 'cloud_full', 'Your cloud lists as many levels as it can.');
                }
            }
            delete index.removedLevels[mod];
            const stamp = store.stamp();
            const level: CloudLevel = { ...given, addedAt: existing?.addedAt ?? stamp, updatedAt: stamp };
            if (level.startLevel === undefined) delete level.startLevel;
            if (level.summary === undefined) delete level.summary;
            index.levels[mod] = level;
            return level;
        });
    });

    // --- a game or level, all at once ----------------------------------------

    /**
     * Takes a game or custom level out of the cloud: every profile that plays
     * it, with their saves, and, for a custom level, the level itself.
     */
    app.delete<{ Params: { title: string } }>('/api/cloud/titles/:title', async (request): Promise<CloudIndex> => {
        const who = account(request);
        const title = matching(request.params.title, CLOUD_MOD, 'The game');
        return store.update(who, (index) => {
            const stamp = store.stamp();
            for (const profile of Object.values(index.profiles)) {
                if (profile.title === title) removeProfile(index, profile.id, stamp);
            }
            if (index.levels[title] !== undefined) {
                delete index.levels[title];
                index.removedLevels[title] = stamp;
            }
            return present(who, index);
        });
    });
}
