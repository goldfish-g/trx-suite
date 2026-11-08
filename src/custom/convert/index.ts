// Turns a custom level's files into a package of the current TRX with the
// TRX Level Converter, which runs in a worker of its own (worker.ts).

import type { EngineNumber } from '../../games/catalog';
import { readModMeta } from '../../games/detect';
import type { ArchiveEntry } from '../../lib/archive';
import type { ConvertFile, ConvertReply, ConvertRequest } from './protocol';

/**
 * The converter this build runs, by a hash of its source (vite.config.ts).
 * A level converted by another may be missing fixes made since.
 */
export const CONVERTER_VERSION: string = __CONVERTER_VERSION__;

export interface Converted {
    /** The package's files, at games/<modId>/…. */
    entries: ArchiveEntry[];
    engine: EngineNumber;
    /** The official game the package builds on, from its game flow. */
    extendsMod: string | null;
    /** What the converter changed, for the console. */
    notes: string[];
}

export interface ConvertOptions {
    title: string;
    modId: string;
    signal?: AbortSignal;
    onStep?: (label: string) => void;
    /** Reading the files in, by bytes. */
    onRead?: (done: number, total: number) => void;
}

/** The files of an archive or a folder, read into memory for the converter. */
async function readAll(entries: readonly ArchiveEntry[], options: ConvertOptions): Promise<ConvertFile[]> {
    const wanted = entries.filter((entry) => !entry.path.endsWith('/'));
    const total = wanted.reduce((sum, entry) => sum + entry.size, 0);
    let done = 0;
    const files: ConvertFile[] = [];
    for (const entry of wanted) {
        options.signal?.throwIfAborted();
        files.push({ path: entry.path, data: new Uint8Array(await (await entry.read()).arrayBuffer()) });
        done += entry.size;
        options.onRead?.(done, total);
    }
    return files;
}

function asEntry(file: ConvertFile): ArchiveEntry {
    return { path: file.path, size: file.data.byteLength, read: async () => new Blob([file.data as Uint8Array<ArrayBuffer>]) };
}

export async function convertLevel(entries: readonly ArchiveEntry[], options: ConvertOptions): Promise<Converted> {
    const files = await readAll(entries, options);
    const request: ConvertRequest = { title: options.title, modId: options.modId, files };

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'converter' });
    try {
        const done = await new Promise<Extract<ConvertReply, { kind: 'done' }>>((resolve, reject) => {
            const stop = () => reject(options.signal?.reason ?? new DOMException('Stopped.', 'AbortError'));
            options.signal?.addEventListener('abort', stop, { once: true });
            worker.onmessage = (event: MessageEvent<ConvertReply>) => {
                const message = event.data;
                if (message.kind === 'step') options.onStep?.(message.label);
                else if (message.kind === 'error') reject(new Error(`The level could not be converted: ${message.message}`));
                else resolve(message);
            };
            worker.onerror = (event) => {
                event.preventDefault();
                reject(new Error(`The converter stopped: ${event.message || 'it ran out of memory, or failed to load'}.`));
            };
            const buffers = new Set<ArrayBuffer>();
            for (const file of files) if (file.data.buffer instanceof ArrayBuffer) buffers.add(file.data.buffer);
            worker.postMessage(request, [...buffers]);
        });

        const gameflowPath = `games/${options.modId}/gameflow.json5`;
        const gameflow = done.files.find((file) => file.path === gameflowPath);
        if (gameflow === undefined) throw new Error('The converter made no game flow for this level.');
        const meta = readModMeta(new TextDecoder().decode(gameflow.data));
        const engine = meta.engine === 1 || meta.engine === 2 || meta.engine === 3 || meta.engine === 4 ? meta.engine : done.gameVersion;
        return { entries: done.files.map(asEntry), engine, extendsMod: meta.extendsMod ?? null, notes: done.notes };
    } finally {
        worker.terminate();
    }
}
