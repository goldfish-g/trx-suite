// Fetches an engine build. Its files stay in the browser's cache, once per
// version the server reports, so a build downloads once and starts even when
// the network is down.

import { downloadCached, type DownloadProgress, type RetryNotice } from '../lib/download';
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

    const blobs = await Promise.all(
        FILES.map(async (name) => {
            const blob = await downloadCached(`/engines/${version}/${name}`, {
                cacheName: CACHE_NAME,
                signal: options.signal,
                onRetry: options.onRetry,
                onProgress: (progress) => {
                    received.set(name, progress);
                    reportTotal();
                },
            });
            return new Blob([blob], { type: TYPES[name] });
        }),
    );

    const [adapterUrl, jsUrl, wasmUrl, dataUrl] = blobs.map((blob) => URL.createObjectURL(blob)) as [
        string,
        string,
        string,
        string,
    ];
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
                URL.revokeObjectURL(wasmUrl);
                URL.revokeObjectURL(dataUrl);
            },
        };
    } finally {
        URL.revokeObjectURL(adapterUrl);
    }
}
