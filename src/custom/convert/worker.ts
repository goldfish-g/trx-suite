// Runs the TRX Level Converter on a custom level's files (run.ts) off the
// page's thread. It takes classic levels and TRX packages alike.
//
// This file is type-checked by tsconfig.converter.json, with the converter's
// own settings, not the app's.

import type { ConvertReply, ConvertRequest } from './protocol.ts';
import { convertFiles, UnplayableLevelError } from './run.ts';

function reply(message: ConvertReply, transfer: Transferable[] = []): void {
    (self as unknown as Worker).postMessage(message, transfer);
}

async function convert(request: ConvertRequest): Promise<void> {
    const { gameVersion, files, notes, needs } = await convertFiles(request, (label) => reply({ kind: 'step', label }));
    const buffers = new Set<ArrayBuffer>();
    for (const file of files) {
        if (file.data.buffer instanceof ArrayBuffer) buffers.add(file.data.buffer);
    }
    reply({ kind: 'done', gameVersion, files, notes, needs }, [...buffers]);
}

self.onmessage = (event: MessageEvent<ConvertRequest>) => {
    convert(event.data).catch((error: unknown) => {
        reply({ kind: 'error', message: error instanceof Error ? error.message : String(error), unplayable: error instanceof UnplayableLevelError });
    });
};
