import { describe, expect, it } from 'vitest';
import { ArchiveError, DamagedArchiveError, readArchive } from '.';
import { crc32 } from './crc32';

const encoder = new TextEncoder();

async function compress(bytes: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface ZipFile {
    name: string;
    data: string;
    deflate?: boolean;
    /** Flips a byte of the stored data after its checksum is taken, as a broken download might. */
    damage?: boolean;
}

/** Builds a zip archive. */
async function makeZip(files: ZipFile[]): Promise<Blob> {
    const parts: Uint8Array[] = [];
    const directory: Uint8Array[] = [];
    let offset = 0;
    for (const file of files) {
        const name = encoder.encode(file.name);
        const raw = encoder.encode(file.data);
        const body = file.deflate ? await compress(raw, 'deflate-raw') : raw.slice();
        const crc = crc32(raw);
        if (file.damage) body[Math.floor(body.length / 2)]! ^= 0xff;
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(6, 0x0800, true);
        local.setUint16(8, file.deflate ? 8 : 0, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, body.length, true);
        local.setUint32(22, raw.length, true);
        local.setUint16(26, name.length, true);
        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint16(10, file.deflate ? 8 : 0, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, body.length, true);
        entry.setUint32(24, raw.length, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);
        parts.push(new Uint8Array(local.buffer), name, body);
        directory.push(new Uint8Array(entry.buffer), name);
        offset += 30 + name.length + body.length;
    }
    const size = directory.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, new Uint8Array(end.buffer)] as BlobPart[]);
}

function tarHeader(name: string, size: number, type: string): Uint8Array {
    const header = new Uint8Array(512);
    header.set(encoder.encode(name.slice(0, 99)), 0);
    header.set(encoder.encode(size.toString(8).padStart(11, '0')), 124);
    header[156] = type.charCodeAt(0);
    header.set(encoder.encode('ustar\x0000'), 257);
    return header;
}

function padded(data: Uint8Array): Uint8Array {
    const out = new Uint8Array(Math.ceil(data.length / 512) * 512);
    out.set(data);
    return out;
}

/** Builds a tar archive, with a GNU long name record for long paths. */
function makeTar(files: { name: string; data: string }[]): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const file of files) {
        if (file.name.length > 99) {
            const longName = encoder.encode(`${file.name}\0`);
            parts.push(tarHeader('././@LongLink', longName.length, 'L'), padded(longName));
        }
        const data = encoder.encode(file.data);
        parts.push(tarHeader(file.name, data.length, '0'), padded(data));
    }
    parts.push(new Uint8Array(1024));
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

async function contents(blob: Blob): Promise<Record<string, string>> {
    const entries = await readArchive(blob);
    const result: Record<string, string> = {};
    for (const entry of entries) result[entry.path] = await (await entry.read()).text();
    return result;
}

describe('readArchive', () => {
    it('reads stored and deflated zip entries, and skips directories', async () => {
        const zip = await makeZip([
            { name: 'data/', data: '' },
            { name: 'data/level1.phd', data: 'stored level' },
            { name: 'music/track02.flac', data: 'deflated music '.repeat(50), deflate: true },
            { name: 'Ünïcode.txt', data: 'named in UTF-8' },
        ]);
        expect(await contents(zip)).toEqual({
            'data/level1.phd': 'stored level',
            'music/track02.flac': 'deflated music '.repeat(50),
            'Ünïcode.txt': 'named in UTF-8',
        });
    });

    it('reports sizes before reading', async () => {
        const zip = await makeZip([{ name: 'a.bin', data: 'x'.repeat(1000), deflate: true }]);
        const [entry] = await readArchive(zip);
        expect(entry?.size).toBe(1000);
    });

    it('reads tar archives, plain and gzipped, with long names', async () => {
        const longPath = `games/tr1/${'deep/'.repeat(25)}level.phd`;
        const tar = makeTar([
            { name: 'games/tr1/main.sfx', data: 'sound' },
            { name: longPath, data: 'level' },
        ]);
        const expected = { 'games/tr1/main.sfx': 'sound', [longPath]: 'level' };
        expect(await contents(new Blob([tar as BlobPart]))).toEqual(expected);
        expect(await contents(new Blob([(await compress(tar, 'gzip')) as BlobPart]))).toEqual(expected);
    });

    it('refuses files that are no archive', async () => {
        await expect(readArchive(new Blob(['just text']))).rejects.toBeInstanceOf(ArchiveError);
    });

    it('lists files it cannot read, and refuses only when one is read', async () => {
        const zip = await makeZip([{ name: 'ok.txt', data: 'fine' }, { name: 'odd.bin', data: 'x' }]);
        // Mark the second entry as compressed with bzip2 (method 12).
        const bytes = new Uint8Array(await zip.arrayBuffer());
        const view = new DataView(bytes.buffer);
        for (let at = bytes.length - 22; at >= 0; at--) {
            if (view.getUint32(at, true) === 0x02014b50 && new TextDecoder().decode(bytes.subarray(at + 46, at + 53)) === 'odd.bin') {
                view.setUint16(at + 10, 12, true);
            }
        }
        const entries = await readArchive(new Blob([bytes]));
        expect(entries.map((entry) => entry.path)).toEqual(['ok.txt', 'odd.bin']);
        expect(await (await entries[0]!.read()).text()).toBe('fine');
        await expect(entries[1]!.read()).rejects.toThrow(/zip method 12/);
    });

    it('refuses a file whose bytes do not match its checksum, as damaged', async () => {
        const zip = await makeZip([
            { name: 'ok.phd', data: 'a level, intact' },
            { name: 'title.phd', data: 'a level, damaged on the way', damage: true },
            { name: 'track.flac', data: 'music, damaged on the way '.repeat(20), deflate: true, damage: true },
        ]);
        const [ok, title, track] = await readArchive(zip);
        expect(await (await ok!.read()).text()).toBe('a level, intact');
        await expect(title!.read()).rejects.toBeInstanceOf(DamagedArchiveError);
        await expect(title!.read()).rejects.toThrow(/title.phd does not match its checksum/);
        await expect(track!.read()).rejects.toBeInstanceOf(DamagedArchiveError);
    });

    it('refuses a zip whose directory is missing', async () => {
        const broken = new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0])]);
        await expect(readArchive(broken)).rejects.toBeInstanceOf(DamagedArchiveError);
    });
});
