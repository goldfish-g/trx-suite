// Fetches an engine build. Its files stay in the browser's storage, once per
// version the server reports, so a build downloads once and starts even when
// the network is down.

import { downloadStored, forgetStored, type DownloadProgress, type RetryNotice, type StoredDownload } from '../lib/download';
import { EnginePackage } from './package';
import type { CreateTrx } from './types';
import { loadEngineVersions } from './versions';

/** Where earlier versions of the app kept engine builds: Cache Storage, which Safari reads into memory whole. */
const LEGACY_CACHE = 'trx-engines';
const FILES = ['trx-adapter.js', 'trx-engine.js', 'TRX.wasm', 'TRX.data'] as const;

export interface LoadedEngine {
    createTRX: CreateTrx;
    jsUrl: string;
    wasmUrl: string;
    dataUrl: string;
    /** The engine's own files of each game, which the engine gets empty until the session fills them in. */
    package: EnginePackage;
    /**
     * Frees the files the engine only reads while it starts. The script stays,
     * as the engine starts its threads from it.
     */
    releaseStartupFiles(): void;
}

export interface LoadEngineOptions {
    signal?: AbortSignal;
    onProgress?: (progress: DownloadProgress) => void;
    onRetry?: (notice: RetryNotice) => void;
}

const TYPES: Record<(typeof FILES)[number], string> = {
    'trx-adapter.js': 'text/javascript',
    'trx-engine.js': 'text/javascript',
    'TRX.wasm': 'application/wasm',
    'TRX.data': 'application/octet-stream',
};

/**
 * Where the engine fetches its WebAssembly from: the address of the version,
 * whenever the browser can fetch it there, else nowhere (null), for the copy
 * kept in IndexedDB to play instead.
 *
 * Chrome keeps the machine code it compiles from a module, the optimized
 * code of its hottest functions included, but only for one fetched from an
 * http(s) address in its HTTP cache. Compiled afresh, the engine's largest
 * functions take gigabytes to optimize while it starts, enough for a phone
 * or a busy computer to give up the page ("Aw, Snap!"). With the code kept,
 * that happens once per engine version, not on every start.
 */
async function cachedAddress(file: StoredDownload): Promise<string | null> {
    if (file.reachable) return file.url;
    // Offline, the version's address works while the HTTP cache still has it.
    try {
        const response = await fetch(file.url, { cache: 'only-if-cached', mode: 'same-origin' });
        await response.body?.cancel();
        return response.ok ? file.url : null;
    } catch {
        return null;
    }
}

export async function loadEngine(version: string, options: LoadEngineOptions = {}): Promise<LoadedEngine> {
    const received = new Map<string, DownloadProgress>();
    const reportTotal = () => {
        let done = 0;
        let total: number | null = 0;
        for (const progress of received.values()) {
            done += progress.received;
            total = total === null || progress.total === null ? null : total + progress.total;
        }
        options.onProgress?.({ received: done, total: received.size === FILES.length ? total : null });
    };

    const files = await Promise.all(
        FILES.map((name) =>
            downloadStored(`/engines/${version}/${name}`, {
                legacyCache: LEGACY_CACHE,
                signal: options.signal,
                onRetry: options.onRetry,
                onProgress: (progress) => {
                    received.set(name, progress);
                    reportTotal();
                },
                httpCache: name === 'TRX.wasm',
            }),
        ),
    );
    const [adapter, script, wasm, data] = files as [StoredDownload, StoredDownload, StoredDownload, StoredDownload];
    // Every file is stored anew, so the copies an earlier version of the app kept can go.
    if (files.every((file) => file.reachable) && typeof caches !== 'undefined') await caches.delete(LEGACY_CACHE).catch(() => false);
    // Builds the server no longer offers only take up room, 385 MB each.
    if (files.every((file) => file.reachable)) void forgetOtherEngines(version).catch(() => {});
    const blobUrl = (blob: Blob, name: (typeof FILES)[number]) => URL.createObjectURL(new Blob([blob], { type: TYPES[name] }));
    const enginePackage = await EnginePackage.split(script.blob, data.blob);
    const adapterUrl = blobUrl(adapter.blob, 'trx-adapter.js');
    const jsUrl = blobUrl(enginePackage.script, 'trx-engine.js');
    const dataUrl = blobUrl(enginePackage.data, 'TRX.data');
    const wasmUrl = (await cachedAddress(wasm)) ?? blobUrl(wasm.blob, 'TRX.wasm');
    try {
        const module = (await import(/* @vite-ignore */ adapterUrl)) as { createTRX?: unknown };
        if (typeof module.createTRX !== 'function') {
            throw new Error(`Engine ${version} offers no createTRX.`);
        }
        return {
            createTRX: module.createTRX as CreateTrx,
            jsUrl,
            wasmUrl,
            dataUrl,
            package: enginePackage,
            releaseStartupFiles() {
                if (wasmUrl.startsWith('blob:')) URL.revokeObjectURL(wasmUrl);
                URL.revokeObjectURL(dataUrl);
            },
        };
    } finally {
        URL.revokeObjectURL(adapterUrl);
    }
}

/** Forgets the files of every engine build but this one and those the server offers. */
async function forgetOtherEngines(version: string): Promise<void> {
    const offered = await loadEngineVersions();
    const root = new URL('/engines/', location.href).href;
    const keep = [...offered, version].map((name) => new URL(`/engines/${name}/`, location.href).href);
    await forgetStored((url) => !url.startsWith(root) || keep.some((prefix) => url.startsWith(prefix)));
}
