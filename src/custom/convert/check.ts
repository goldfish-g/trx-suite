// Whether TRX can play a level's archive, as the page's converter finds: the
// server runs this as a child process (server/src/unplayable.ts) before it
// believes a player's report that TRX cannot play a level. It reads the
// archive as the page does (lib/archive) and converts it the same way
// (run.ts), then answers through the IPC channel, or prints, one of
//   { verdict: 'unplayable', reason }   the converter says TRX cannot play it
//   { verdict: 'playable' }             it converts
//   { verdict: 'error', message }       it fails some other way
//
//   node check.mjs <archive> <title> <modId>
//   node check.mjs --version      answers { version }: the converter it runs
//
// vite.checker.config.ts builds it, with everything it uses, into
// server-dist/checker/check.mjs, as the server's image has none of the
// page's packages. Type-checked by tsconfig.converter.json.

import { openAsBlob } from 'node:fs';
import unrarWasm from 'virtual:unrar-wasm';
import { readArchive } from '../../lib/archive';
import { setUnrarWasm } from '../../lib/archive/rar';
import type { ConvertFile } from './protocol.ts';
import { convertFiles, UnplayableLevelError } from './run.ts';

declare const __CONVERTER_VERSION__: string;

export type CheckAnswer =
    | { verdict: 'unplayable'; reason: string }
    | { verdict: 'playable' }
    | { verdict: 'error'; message: string }
    | { version: string };

async function check(archive: string, title: string, modId: string): Promise<CheckAnswer> {
    try {
        const entries = await readArchive(await openAsBlob(archive));
        const files: ConvertFile[] = [];
        for (const entry of entries) {
            if (entry.path.endsWith('/')) continue;
            files.push({ path: entry.path, data: new Uint8Array(await (await entry.read()).arrayBuffer()) });
        }
        await convertFiles({ title, modId, files });
        return { verdict: 'playable' };
    } catch (error) {
        if (error instanceof UnplayableLevelError) return { verdict: 'unplayable', reason: error.message };
        return { verdict: 'error', message: error instanceof Error ? error.message : String(error) };
    }
}

async function main(): Promise<void> {
    // The converter tells the console what it changes; the answer alone goes out.
    console.log = console.error;
    console.info = console.error;
    const args = process.argv.slice(2);
    let answer: CheckAnswer;
    if (args[0] === '--version') {
        answer = { version: __CONVERTER_VERSION__ };
    } else if (args.length === 3) {
        setUnrarWasm(Uint8Array.from(atob(unrarWasm), (c) => c.charCodeAt(0)).buffer);
        answer = await check(args[0], args[1], args[2]);
    } else {
        console.error('usage: node check.mjs <archive> <title> <modId> | --version');
        process.exit(2);
    }
    if (process.send !== undefined) {
        // Whatever the converter left running, the answer is all there is to wait for.
        process.send(answer, () => process.exit(0));
    } else {
        process.stdout.write(JSON.stringify(answer) + '\n', () => process.exit(0));
    }
}

void main();
