// The server's cloud routes (server/src/cloud-routes.ts).

import type { ApiError } from '../../shared/api.ts';
import type {
    CloudIndex,
    CloudLevel,
    CloudProfile,
    CloudSaves,
    CloudSettings,
    PutLevelRequest,
    PutProfileRequest,
    PutSavesRequest,
    SavesConflict,
} from '../../shared/cloud.ts';

export class CloudError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/** Someone changed the saves first; here is what they are now. */
export class SavesConflictError extends Error {
    readonly saves: CloudSaves;
    constructor(saves: CloudSaves) {
        super('The saves changed in the cloud.');
        this.saves = saves;
    }
}

/** The request never reached the server: offline, or the server is down. */
export class CloudUnreachableError extends Error {}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
        response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' });
    } catch (error) {
        if (init.signal?.aborted) throw error;
        throw new CloudUnreachableError('The server is out of reach.');
    }
    if (response.ok) return response;
    const body = (await response.json().catch(() => null)) as (ApiError & Partial<SavesConflict>) | null;
    if (response.status === 409 && body?.saves !== undefined) throw new SavesConflictError(body.saves);
    throw new CloudError(response.status, body?.error ?? 'failed', body?.message ?? `The server answered ${response.status}.`);
}

async function json<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await call(path, {
        method,
        signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await response.json()) as T;
}

export function putCloudSettings(settings: CloudSettings): Promise<CloudSettings> {
    return json('/api/cloud/settings', 'PUT', settings);
}

export function fetchCloudIndex(signal?: AbortSignal): Promise<CloudIndex> {
    return json('/api/cloud', 'GET', undefined, signal);
}

export function putCloudProfile(profile: PutProfileRequest, signal?: AbortSignal): Promise<CloudProfile> {
    return json(`/api/cloud/profiles/${encodeURIComponent(profile.id)}`, 'PUT', profile, signal);
}

export function deleteCloudProfile(id: string): Promise<CloudIndex> {
    return json(`/api/cloud/profiles/${encodeURIComponent(id)}`, 'DELETE');
}

export function putCloudLevel(level: PutLevelRequest): Promise<CloudLevel> {
    return json(`/api/cloud/levels/${encodeURIComponent(level.mod)}`, 'PUT', level);
}

export function deleteCloudTitle(title: string): Promise<CloudIndex> {
    return json(`/api/cloud/titles/${encodeURIComponent(title)}`, 'DELETE');
}

export function putCloudSaves(profileId: string, mod: string, request: PutSavesRequest, signal?: AbortSignal): Promise<CloudSaves> {
    return json(`/api/cloud/saves/${encodeURIComponent(profileId)}/${encodeURIComponent(mod)}`, 'PUT', request, signal);
}

export async function putCloudFile(hash: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    await call(`/api/cloud/files/${hash}`, {
        method: 'PUT',
        signal,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes as Uint8Array<ArrayBuffer>,
    });
}

export async function fetchCloudFile(hash: string, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await call(`/api/cloud/files/${hash}`, { signal });
    return new Uint8Array(await response.arrayBuffer());
}
