import { describe, expect, it } from 'vitest';
import { readArchive } from '.';

// A zip that Python's zipfile wrote with ZIP_LZMA, as 7-Zip writes them:
// repeating text, random bytes, a byte ramp and an empty file.
const FIXTURE = [
    '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',
].join('');

const EXPECTED: Record<string, string> = {
    'text.txt': 'dffee67402b09b10c6d9a81a1e273637c2cccccf1bad6ddeec927887e197866f',
    'data/level.bin': '42ac173d6fd261951353c498c0b179eccfe667504237381488767e7fe5c7d4bd',
    'empty.txt': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

async function sha256(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('LZMA in zip archives', () => {
    it('decodes every entry to the bytes that were compressed', async () => {
        const bytes = Uint8Array.from(atob(FIXTURE), (char) => char.charCodeAt(0));
        const entries = await readArchive(new Blob([bytes]));
        const hashes: Record<string, string> = {};
        for (const entry of entries) hashes[entry.path] = await sha256(await entry.read());
        expect(hashes).toEqual(EXPECTED);
    });
});
