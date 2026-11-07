// Reads zip archives straight from a Blob. Only the directory is read up
// front; each file is sliced out and inflated when it is asked for, so an
// archive of any size never has to fit in memory. Each file is checked
// against the checksum the archive records for it as it is read.

import { crc32OfBlob } from './crc32';
import { ArchiveError, DamagedArchiveError, type ArchiveEntry } from './entry';
import { decodeLzma } from './lzma';

const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END_OF_DIRECTORY = 0x06064b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const ZIP64_EXTRA = 0x0001;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const METHOD_LZMA = 14;
const MAX_COMMENT = 0xffff;

async function viewOf(blob: Blob, start: number, end: number): Promise<DataView> {
    return new DataView(await blob.slice(start, end).arrayBuffer());
}

const utf8 = new TextDecoder('utf-8');
const latin1 = new TextDecoder('latin1');

interface Directory {
    count: number;
    offset: number;
    size: number;
}

async function findDirectory(blob: Blob): Promise<Directory> {
    const tailStart = Math.max(0, blob.size - 22 - MAX_COMMENT);
    const tail = await viewOf(blob, tailStart, blob.size);
    let end = -1;
    for (let at = tail.byteLength - 22; at >= 0; at--) {
        if (tail.getUint32(at, true) === END_OF_DIRECTORY) {
            end = at;
            break;
        }
    }
    if (end < 0) throw new DamagedArchiveError('The zip archive is damaged: its directory is missing.');

    const directory = {
        count: tail.getUint16(end + 10, true),
        size: tail.getUint32(end + 12, true),
        offset: tail.getUint32(end + 16, true),
    };
    const locator = end - 20;
    if (locator >= 0 && tail.getUint32(locator, true) === ZIP64_LOCATOR) {
        const at = Number(tail.getBigUint64(locator + 8, true));
        const zip64 = await viewOf(blob, at, at + 56);
        if (zip64.getUint32(0, true) !== ZIP64_END_OF_DIRECTORY) {
            throw new DamagedArchiveError('The zip archive is damaged: its large-file directory is missing.');
        }
        directory.count = Number(zip64.getBigUint64(32, true));
        directory.size = Number(zip64.getBigUint64(40, true));
        directory.offset = Number(zip64.getBigUint64(48, true));
    }
    return directory;
}

interface Located {
    path: string;
    localOffset: number;
    compressedSize: number;
    size: number;
    method: number;
    crc: number;
}

async function unpack(blob: Blob, { localOffset, compressedSize, size, method }: Located): Promise<Blob> {
    const header = await viewOf(blob, localOffset, localOffset + 30);
    if (header.getUint32(0, true) !== LOCAL_HEADER) {
        throw new DamagedArchiveError('The zip archive is damaged: a file header is missing.');
    }
    const start = localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const data = blob.slice(start, start + compressedSize);
    if (method === METHOD_STORED) return data;
    if (method === METHOD_LZMA) {
        // A version, the length of the properties, then the properties.
        const bytes = new Uint8Array(await data.arrayBuffer());
        const propsSize = bytes[2]! | (bytes[3]! << 8);
        const props = bytes.subarray(4, 4 + propsSize);
        return new Blob([decodeLzma(props, bytes, 4 + propsSize, size) as BlobPart]);
    }
    const inflated = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(inflated).blob();
}

async function readEntry(blob: Blob, entry: Located): Promise<Blob> {
    let data: Blob;
    try {
        data = await unpack(blob, entry);
    } catch (error) {
        // Bytes that do not inflate, or decode as LZMA, are damaged ones.
        if (error instanceof DamagedArchiveError) throw error;
        throw new DamagedArchiveError(`The zip archive is damaged: ${entry.path} cannot be unpacked.`);
    }
    if (data.size !== entry.size || (await crc32OfBlob(data)) !== entry.crc) {
        throw new DamagedArchiveError(`The zip archive is damaged: ${entry.path} does not match its checksum.`);
    }
    return data;
}

/** Why an entry cannot be read, or null when it can. */
function unreadable(path: string, flags: number, method: number): string | null {
    if ((flags & FLAG_ENCRYPTED) !== 0) return `${path} is encrypted, which is not supported.`;
    if (![METHOD_STORED, METHOD_DEFLATED, METHOD_LZMA].includes(method)) {
        return `${path} is compressed in a way that is not supported (zip method ${method}).`;
    }
    return null;
}

export async function readZip(blob: Blob): Promise<ArchiveEntry[]> {
    const directory = await findDirectory(blob);
    const view = await viewOf(blob, directory.offset, directory.offset + directory.size);
    const entries: ArchiveEntry[] = [];
    let at = 0;
    for (let i = 0; i < directory.count; i++) {
        if (at + 46 > view.byteLength || view.getUint32(at, true) !== DIRECTORY_ENTRY) {
            throw new DamagedArchiveError('The zip archive is damaged: its directory is cut short.');
        }
        const flags = view.getUint16(at + 8, true);
        const method = view.getUint16(at + 10, true);
        const crc = view.getUint32(at + 16, true);
        let compressedSize = view.getUint32(at + 20, true);
        let size = view.getUint32(at + 24, true);
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        let localOffset = view.getUint32(at + 42, true);
        const nameBytes = new Uint8Array(view.buffer, view.byteOffset + at + 46, nameLength);
        const path = ((flags & FLAG_UTF8) !== 0 ? utf8 : latin1).decode(nameBytes).replace(/\\/g, '/');

        // Sizes and offsets past 4 GB live in the ZIP64 extra field.
        let extra = at + 46 + nameLength;
        const extraEnd = extra + extraLength;
        while (extra + 4 <= extraEnd) {
            const id = view.getUint16(extra, true);
            const length = view.getUint16(extra + 2, true);
            if (id === ZIP64_EXTRA) {
                let field = extra + 4;
                const next = () => {
                    const value = Number(view.getBigUint64(field, true));
                    field += 8;
                    return value;
                };
                if (size === 0xffffffff) size = next();
                if (compressedSize === 0xffffffff) compressedSize = next();
                if (localOffset === 0xffffffff) localOffset = next();
            }
            extra += 4 + length;
        }
        at = extraEnd + commentLength;

        if (path.endsWith('/')) continue;
        // A file the shell cannot read only matters if it is needed.
        const problem = unreadable(path, flags, method);
        entries.push({
            path,
            size,
            read: () =>
                problem !== null
                    ? Promise.reject(new ArchiveError(problem))
                    : readEntry(blob, { path, localOffset, compressedSize, size, method, crc }),
        });
    }
    return entries;
}
