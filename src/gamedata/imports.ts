// Brings game data into the library: downloads it when it comes from the
// server or a link, reads the archive, and stores each file where the engine
// expects it. Imports run in the background and survive a reload of the
// page: a download carries on from where it stopped.

import { create } from 'zustand';
import type { EngineNumber } from '../games/catalog';
import { DamagedArchiveError, readArchive, type ArchiveEntry } from '../lib/archive';
import { newId } from '../lib/db';
import { discardPartial, download } from '../lib/download';
import { planLayout } from './layout';
import {
    deleteGameData,
    deleteGameDataFiles,
    getGameData,
    listGameData,
    putGameData,
    putGameDataFile,
    updateGameData,
} from './store';
import type { GameDataLayout, GameDataRecord, GameDataSource } from './types';

export type ImportPhase = 'downloading' | 'unpacking';

export interface ImportProgress {
    phase: ImportPhase;
    done: number;
    total: number | null;
    /** Why the download is waiting, while it retries. */
    notice: string | null;
}

interface ImportsState {
    progress: Record<string, ImportProgress>;
}

/** The progress of every import running in this page. */
export const useImports = create<ImportsState>(() => ({ progress: {} }));

function report(id: string, progress: ImportProgress | null): void {
    useImports.setState((state) => {
        const next = { ...state.progress };
        if (progress === null) delete next[id];
        else next[id] = progress;
        return { progress: next };
    });
}

export interface NewGameData {
    name: string;
    mod: string;
    engine: EngineNumber;
    layout: GameDataLayout;
    source: GameDataSource;
    /** The size the server gives for a download, to show progress early. */
    sizeBytes?: number;
    /** For the level layout, the level the engine starts. */
    startLevel?: string;
}

/** What to import from: files at hand, or the source's address. */
export type ImportInput =
    | { kind: 'archive'; blob: Blob }
    | { kind: 'files'; entries: ArchiveEntry[] }
    | { kind: 'download' };

const running = new Map<string, AbortController>();

function resumeKey(id: string): string {
    return `gamedata:${id}`;
}

function describe(error: unknown): string {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        return 'The browser ran out of storage space for the files.';
    }
    return error instanceof Error ? error.message : String(error);
}

async function requestPersistentStorage(): Promise<void> {
    try {
        await navigator.storage?.persist?.();
    } catch {
        // The browser keeps the files anyway; it only may clear them under pressure.
    }
}

/** Fetches and reads the files, and stores them, which makes the record ready. */
async function bringIn(record: GameDataRecord, input: ImportInput, signal: AbortSignal): Promise<void> {
    const { id, source } = record;
    let entries: ArchiveEntry[];
    if (input.kind === 'files') {
        entries = input.entries;
    } else {
        let blob: Blob;
        if (input.kind === 'archive') {
            blob = input.blob;
        } else {
            if (source.kind === 'upload') {
                throw new Error('The upload was interrupted. Choose the files again.');
            }
            blob = await download(source.url, {
                resumeKey: resumeKey(id),
                expectedSize: record.sizeBytes || undefined,
                signal,
                onProgress: ({ received, total }) =>
                    report(id, { phase: 'downloading', done: received, total, notice: null }),
                onRetry: ({ waitMs, reason }) =>
                    report(id, {
                        ...(useImports.getState().progress[id] ?? {
                            phase: 'downloading',
                            done: 0,
                            total: null,
                        }),
                        notice: `Connection lost (${reason}). Trying again in ${Math.ceil(waitMs / 1000)} s…`,
                    }),
            });
        }
        report(id, { phase: 'unpacking', done: 0, total: null, notice: null });
        entries = await readArchive(blob);
    }

    const planned = planLayout(entries, record);
    const total = planned.reduce((sum, file) => sum + file.entry.size, 0);
    let done = 0;
    await deleteGameDataFiles(id);
    report(id, { phase: 'unpacking', done, total, notice: null });
    for (const file of planned) {
        signal.throwIfAborted();
        const blob = await file.entry.read();
        await putGameDataFile({ gamedataId: id, path: file.path, blob });
        done += file.entry.size;
        report(id, { phase: 'unpacking', done, total, notice: null });
    }

    await updateGameData(id, {
        status: 'ready',
        error: undefined,
        sizeBytes: total,
        fileCount: planned.length,
    });
}

async function run(record: GameDataRecord, input: ImportInput, signal: AbortSignal): Promise<void> {
    const { id } = record;
    try {
        try {
            await bringIn(record, input, signal);
        } catch (error) {
            // A download can arrive damaged, and resuming it again would keep
            // the bad bytes. So it starts over, once.
            if (!(error instanceof DamagedArchiveError) || input.kind !== 'download' || signal.aborted) throw error;
            console.warn(`[imports] ${record.name}: ${error.message} Downloading it again.`);
            await discardPartial(resumeKey(id));
            await bringIn(record, input, signal);
        }
        await discardPartial(resumeKey(id));
        await requestPersistentStorage();
    } catch (error) {
        if (signal.aborted) return;
        console.error(`[imports] ${record.name}:`, error);
        await deleteGameDataFiles(id).catch(() => {});
        // Damaged bytes are no use to a retry, which then downloads afresh.
        if (error instanceof DamagedArchiveError) await discardPartial(resumeKey(id)).catch(() => {});
        await updateGameData(id, { status: 'failed', error: describe(error) });
    } finally {
        running.delete(id);
        report(id, null);
    }
}

function start(record: GameDataRecord, input: ImportInput): void {
    const controller = new AbortController();
    running.set(record.id, controller);
    report(record.id, {
        phase: input.kind === 'download' ? 'downloading' : 'unpacking',
        done: 0,
        total: input.kind === 'download' ? record.sizeBytes || null : null,
        notice: null,
    });
    void run(record, input, controller.signal);
}

/** Adds game data to the library and starts bringing in its files. */
export async function importGameData(meta: NewGameData, input: ImportInput): Promise<GameDataRecord> {
    const record: GameDataRecord = {
        id: newId(),
        name: meta.name,
        mod: meta.mod,
        engine: meta.engine,
        layout: meta.layout,
        source: meta.source,
        status: 'importing',
        sizeBytes: meta.sizeBytes ?? 0,
        fileCount: 0,
        startLevel: meta.startLevel,
        createdAt: new Date().toISOString(),
    };
    await putGameData(record);
    start(record, input);
    return record;
}

/** Tries a failed or stalled download again, from where it stopped. */
export async function retryImport(id: string): Promise<void> {
    if (running.has(id)) return;
    const record = await getGameData(id);
    if (record === undefined || record.source.kind === 'upload') return;
    await updateGameData(id, { status: 'importing', error: undefined });
    start({ ...record, status: 'importing' }, { kind: 'download' });
}

/** Removes game data, stopping its import first if one is running. */
export async function removeGameData(id: string): Promise<void> {
    running.get(id)?.abort(new DOMException('The import was cancelled.', 'AbortError'));
    running.delete(id);
    report(id, null);
    await discardPartial(resumeKey(id));
    await deleteGameData(id);
}

export function isImportRunning(id: string): boolean {
    return running.has(id);
}

/**
 * Picks up the imports a reload of the page cut short. Downloads carry on;
 * uploads cannot, as the page no longer has the files.
 */
export async function resumeInterruptedImports(): Promise<void> {
    for (const record of await listGameData()) {
        if (record.status !== 'importing' || running.has(record.id)) continue;
        if (record.source.kind === 'upload') {
            await updateGameData(record.id, {
                status: 'failed',
                error: 'The upload was interrupted. Choose the files again.',
            });
        } else {
            start(record, { kind: 'download' });
        }
    }
}
