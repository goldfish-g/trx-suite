// RAR archives (RAR 4 and RAR 5), which some levels on TRCustoms come in,
// read with UnRAR compiled to WebAssembly (node-unrar-js). Its licence lets
// any program extract RAR archives with it; it may not be used to make
// them.
//
// A RAR archive is often solid, one compressed stream for all its files, so
// it is unpacked whole and at once rather than a file at a time, and it is
// read into memory to do so, as the converter reads a level's files anyway.

import { createExtractorFromData, UnrarError } from 'node-unrar-js';
import { ArchiveError, DamagedArchiveError, type ArchiveEntry } from './entry';

let wasm: Promise<ArrayBuffer> | null = null;

/** UnRAR's WebAssembly, fetched once; tests outside a browser hand it in. */
export function setUnrarWasm(binary: ArrayBuffer): void {
    wasm = Promise.resolve(binary);
}

function unrarWasm(): Promise<ArrayBuffer> {
    wasm ??= import('node-unrar-js/esm/js/unrar.wasm?url').then(async ({ default: url }) => {
        const response = await fetch(url);
        if (!response.ok) throw new ArchiveError('The RAR reader could not be loaded. Try again when you are online.');
        return response.arrayBuffer();
    });
    return wasm;
}

/** Whether these first bytes are a RAR archive's: "Rar!" then 1A 07. */
export function isRar(head: Uint8Array): boolean {
    return head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21 && head[4] === 0x1a && head[5] === 0x07;
}

/** Lists, and unpacks, the files of a RAR archive. */
export async function readRar(blob: Blob): Promise<ArchiveEntry[]> {
    const wasmBinary = await unrarWasm();
    const data = await blob.arrayBuffer();
    try {
        const extractor = await createExtractorFromData({ wasmBinary, data });
        const entries: ArchiveEntry[] = [];
        for (const { fileHeader, extraction } of extractor.extract().files) {
            if (fileHeader.flags.directory) continue;
            if (fileHeader.flags.encrypted) throw new ArchiveError('This RAR archive is protected by a password.');
            const bytes = extraction ?? new Uint8Array();
            entries.push({
                path: fileHeader.name.replace(/\\/g, '/'),
                size: bytes.byteLength,
                read: async () => new Blob([bytes as Uint8Array<ArrayBuffer>]),
            });
        }
        return entries;
    } catch (error) {
        if (error instanceof ArchiveError) throw error;
        if (error instanceof UnrarError) {
            if (error.reason === 'ERAR_MISSING_PASSWORD' || error.reason === 'ERAR_BAD_PASSWORD') {
                throw new ArchiveError('This RAR archive is protected by a password.');
            }
            if (error.reason === 'ERAR_EOPEN') {
                throw new ArchiveError('This RAR archive is split into volumes, which can only be read together.');
            }
            throw new DamagedArchiveError(`This RAR archive is damaged (${error.reason}).`);
        }
        throw error;
    }
}
