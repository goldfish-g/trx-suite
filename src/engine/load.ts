// Fetches an engine build. Its files stay in the browser's cache, once per
// version the server reports, so a build downloads once and starts even when
// the network is down.

import { downloadCached, type CachedFile, type DownloadProgress, type RetryNotice } from '../lib/download';
import type { CreateTrx } from './types';

const CACHE_NAME = 'trx-engines';
const FILES = ['trx-adapter.js', 'trx-engine.js', 'TRX.wasm', 'TRX.data'] as const;

export interface LoadedEngine {
    createTRX: CreateTrx;
    jsUrl: string;
    wasmUrl: string;
    dataUrl: string;
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
 * in Cache Storage to play instead.
 *
 * Chrome keeps the machine code it compiles from a module, the optimized
 * code of its hottest functions included, but only for one fetched from an
 * http(s) address in its HTTP cache. Compiled afresh, the engine's largest
 * functions take gigabytes to optimize while it starts, enough for a phone
 * or a busy computer to give up the page ("Aw, Snap!"). With the code kept,
 * that happens once per engine version, not on every start.
 */
async function cachedAddress(file: CachedFile): Promise<string | null> {
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
            downloadCached(`/engines/${version}/${name}`, {
                cacheName: CACHE_NAME,
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
    const [adapter, script, wasm, data] = files as [CachedFile, CachedFile, CachedFile, CachedFile];
    const blobUrl = (file: CachedFile, name: (typeof FILES)[number]) => URL.createObjectURL(new Blob([file.blob], { type: TYPES[name] }));
    const adapterUrl = blobUrl(adapter, 'trx-adapter.js');
    const jsUrl = blobUrl(script, 'trx-engine.js');
    const dataUrl = blobUrl(data, 'TRX.data');
    const wasmUrl = (await cachedAddress(wasm)) ?? blobUrl(wasm, 'TRX.wasm');
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
            releaseStartupFiles() {
                if (wasmUrl.startsWith('blob:')) URL.revokeObjectURL(wasmUrl);
                URL.revokeObjectURL(dataUrl);
            },
        };
    } finally {
        URL.revokeObjectURL(adapterUrl);
    }
}
