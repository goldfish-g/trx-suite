// Hands level files to the worker, or reads them here when workers fail.

import type { PreparedLevel, RouteData } from './prepare';
import type { WorkerRequest } from './worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve(prepared: PreparedLevel): void; reject(error: Error): void }>();

function getWorker(): Worker | null {
    if (worker !== null) return worker;
    try {
        worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
        return null;
    }
    worker.onmessage = (event: MessageEvent<{ id: number; prepared?: PreparedLevel; error?: string }>) => {
        const job = pending.get(event.data.id);
        if (job === undefined) return;
        pending.delete(event.data.id);
        if (event.data.prepared !== undefined) job.resolve(event.data.prepared);
        else job.reject(new Error(event.data.error ?? 'The level could not be read.'));
    };
    worker.onerror = (event) => {
        for (const job of pending.values()) job.reject(new Error(event.message || 'The level reader stopped.'));
        pending.clear();
        worker?.terminate();
        worker = null;
    };
    return worker;
}

export async function loadPreparedLevel(
    bytes: Uint8Array,
    fileName: string,
    seed?: number,
    planned?: RouteData[] | null,
    attempts?: number,
): Promise<PreparedLevel> {
    const target = getWorker();
    if (target === null) {
        const { prepareLevel } = await import('./prepare');
        return prepareLevel(bytes, fileName, seed, planned, attempts);
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const request: WorkerRequest = { id, bytes, fileName, seed, planned, attempts };
        target.postMessage(request, [bytes.buffer as ArrayBuffer]);
    });
}
