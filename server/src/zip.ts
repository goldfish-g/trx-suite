// Reads single files out of a zip on disk without loading the whole
// archive: the central directory from the end, then just the entry asked
// for. Enough for the game packages (stored or deflated, no zip64).

import { open, type FileHandle } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
    /** The path inside the archive, with forward slashes. */
    path: string;
    method: number;
    compressedSize: number;
    size: number;
    localHeader: number;
}

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
}

/** Lists a zip's files. */
export async function listZip(path: string): Promise<ZipEntry[]> {
    const file = await open(path, 'r');
    try {
        const { size } = await file.stat();
        const tailLength = Math.min(size, 65557);
        const tail = await readAt(file, size - tailLength, tailLength);
        let end = -1;
        for (let i = tail.length - 22; i >= 0; i--) {
            if (tail.readUInt32LE(i) === 0x06054b50) {
                end = i;
                break;
            }
        }
        if (end < 0) throw new Error(`${path} is not a zip archive.`);
        const count = tail.readUInt16LE(end + 10);
        const directorySize = tail.readUInt32LE(end + 12);
        const directoryOffset = tail.readUInt32LE(end + 16);
        const directory = await readAt(file, directoryOffset, directorySize);
        const entries: ZipEntry[] = [];
        let p = 0;
        for (let i = 0; i < count && p + 46 <= directory.length; i++) {
            if (directory.readUInt32LE(p) !== 0x02014b50) break;
            const nameLength = directory.readUInt16LE(p + 28);
            const extraLength = directory.readUInt16LE(p + 30);
            const commentLength = directory.readUInt16LE(p + 32);
            entries.push({
                path: directory.toString('utf8', p + 46, p + 46 + nameLength).replace(/\\/g, '/'),
                method: directory.readUInt16LE(p + 10),
                compressedSize: directory.readUInt32LE(p + 20),
                size: directory.readUInt32LE(p + 24),
                localHeader: directory.readUInt32LE(p + 42),
            });
            p += 46 + nameLength + extraLength + commentLength;
        }
        return entries;
    } finally {
        await file.close();
    }
}

/** One file's contents. */
export async function readZipEntry(path: string, entry: ZipEntry): Promise<Uint8Array> {
    const file = await open(path, 'r');
    try {
        const header = await readAt(file, entry.localHeader, 30);
        if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`${path}: damaged entry ${entry.path}.`);
        const start = entry.localHeader + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
        const data = await readAt(file, start, entry.compressedSize);
        if (entry.method === 0) return new Uint8Array(data);
        if (entry.method === 8) return new Uint8Array(inflateRawSync(data));
        throw new Error(`${path}: ${entry.path} uses a compression this server cannot read.`);
    } finally {
        await file.close();
    }
}
