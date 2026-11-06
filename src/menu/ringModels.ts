// Fetches the objects the server cut out of its games for the ring
// (server/src/ring.ts). The service worker keeps them, so they show offline
// too; when there are none, the ring falls back to its own artifacts.

import type { RingManifest, RingModelFile } from '../../shared/api.ts';

const TIMEOUT_MS = 8000;

async function json<T>(url: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return (await response.json()) as T;
}

/** The ring's models by ring entry; missing entries had none to fetch. */
export async function loadRingModels(): Promise<Map<string, RingModelFile>> {
    const models = new Map<string, RingModelFile>();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const manifest = await json<RingManifest>('/ring/manifest.json', controller.signal);
        await Promise.all(
            Object.entries(manifest.models).map(async ([item, { url }]) => {
                try {
                    models.set(item, await json<RingModelFile>(url, controller.signal));
                } catch (error) {
                    console.warn(`[ring] ${item}:`, error);
                }
            }),
        );
    } catch (error) {
        console.warn('[ring] no models from the server:', error);
    } finally {
        clearTimeout(timer);
    }
    return models;
}
