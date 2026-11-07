// Runs the TRX Level Converter (the converter submodule, trx-update-tool) on
// a custom level's files, as its own page does, off the page's thread: the
// files are mapped into a TRX package, the game flow is written from the
// level's script, and whatever was made for an older TRX is brought up to
// date. It takes classic levels and TRX packages alike.
//
// This file is type-checked by tsconfig.converter.json, with the converter's
// own settings, not the app's.

import { detectGameVersion, filterByLanguage, processFiles } from '../../../converter/client/src/converter/gamedata.ts';
import { setupCustomGameflow } from '../../../converter/client/src/converter/gameflow.ts';
import { migrateToCurrentTRX } from '../../../converter/client/src/converter/migrate.ts';
import type { ConvertFile, ConvertReply, ConvertRequest } from './protocol.ts';

function reply(message: ConvertReply, transfer: Transferable[] = []): void {
    (self as unknown as Worker).postMessage(message, transfer);
}

async function convert({ title, modId, files }: ConvertRequest): Promise<void> {
    reply({ kind: 'step', label: 'Reading the level' });
    const version = detectGameVersion(files);
    let { mapped, languages } = processFiles(files, modId);
    // Remastered releases bring their speech in several languages; the
    // package keeps one, English where it is offered.
    if (languages.length > 1) {
        const language = languages.find((candidate) => candidate.code === 'en') ?? languages[0];
        mapped = processFiles(filterByLanguage(files, language.code), modId).mapped;
    }
    if (mapped.length === 0) {
        throw new Error('There are no Tomb Raider game files among these files.');
    }

    reply({ kind: 'step', label: 'Writing its game flow' });
    const withGameflow = setupCustomGameflow(mapped, modId, Number(version), false, title);

    reply({ kind: 'step', label: 'Bringing it up to date' });
    const { files: out, notes } = await migrateToCurrentTRX(withGameflow, {
        modDir: modId,
        gameVersion: Number(version),
        upload: files,
    });

    const result: ConvertFile[] = out.map((file) => ({ path: file.path, data: file.data }));
    const buffers = new Set<ArrayBuffer>();
    for (const file of result) {
        if (file.data.buffer instanceof ArrayBuffer) buffers.add(file.data.buffer);
    }
    reply({ kind: 'done', gameVersion: Number(version) as 1 | 2 | 3, files: result, notes }, [...buffers]);
}

self.onmessage = (event: MessageEvent<ConvertRequest>) => {
    convert(event.data).catch((error: unknown) => {
        reply({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    });
};
