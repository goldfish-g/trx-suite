// Reads tar archives, plain or gzipped, from a stream. A tar has no
// directory, so it is read once, start to end, and each file is kept as a
// Blob for the browser to hold.

import { ArchiveError, type ArchiveEntry } from './entry';

const BLOCK = 512;
const TYPE_FILE = ['0', '\0', '7'];
const TYPE_GNU_LONG_NAME = 'L';
const TYPE_PAX_HEADER = 'x';

/** Reads exact byte counts from a stream of chunks of any size. */
class ByteReader {
    private chunks: Uint8Array[] = [];
    private buffered = 0;
    private done = false;
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

    constructor(stream: ReadableStream<Uint8Array>) {
        this.reader = stream.getReader();
    }

    private async fill(count: number): Promise<void> {
        while (this.buffered < count && !this.done) {
            const { done, value } = await this.reader.read();
            if (done) {
                this.done = true;
            } else {
                this.chunks.push(value);
                this.buffered += value.byteLength;
            }
        }
    }

    /** Takes count bytes as the chunks they arrived in, or fewer at the end. */
    async take(count: number): Promise<Uint8Array[]> {
        await this.fill(count);
        const taken: Uint8Array[] = [];
        let remaining = Math.min(count, this.buffered);
        this.buffered -= remaining;
        while (remaining > 0) {
            const chunk = this.chunks[0]!;
            if (chunk.byteLength <= remaining) {
                taken.push(chunk);
                this.chunks.shift();
                remaining -= chunk.byteLength;
            } else {
                taken.push(chunk.subarray(0, remaining));
                this.chunks[0] = chunk.subarray(remaining);
                remaining = 0;
            }
        }
        return taken;
    }

    /** Takes count bytes in one array, or null at the end of the stream. */
    async takeBytes(count: number): Promise<Uint8Array | null> {
        const taken = await this.take(count);
        const length = taken.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        if (length === 0) return null;
        if (length < count) throw new ArchiveError('The tar archive is cut short.');
        if (taken.length === 1) return taken[0]!;
        const bytes = new Uint8Array(length);
        let at = 0;
        for (const chunk of taken) {
            bytes.set(chunk, at);
            at += chunk.byteLength;
        }
        return bytes;
    }

    async cancel(): Promise<void> {
        await this.reader.cancel();
    }
}

const decoder = new TextDecoder();

function text(bytes: Uint8Array, start: number, length: number): string {
    const field = bytes.subarray(start, start + length);
    const end = field.indexOf(0);
    return decoder.decode(end < 0 ? field : field.subarray(0, end));
}

function number(bytes: Uint8Array, start: number, length: number): number {
    // Sizes past 8 GB are stored as big-endian binary, flagged by the top bit.
    if ((bytes[start]! & 0x80) !== 0) {
        let value = bytes[start]! & 0x7f;
        for (let i = 1; i < length; i++) value = value * 256 + bytes[start + i]!;
        return value;
    }
    return parseInt(text(bytes, start, length).trim() || '0', 8);
}

function paxPath(bytes: Uint8Array): string | null {
    // Records read "<length> <key>=<value>\n".
    for (const record of decoder.decode(bytes).split('\n')) {
        const match = /^\d+ path=(.*)$/s.exec(record);
        if (match !== null) return match[1]!;
    }
    return null;
}

export async function readTar(stream: ReadableStream<Uint8Array>): Promise<ArchiveEntry[]> {
    const reader = new ByteReader(stream);
    const entries: ArchiveEntry[] = [];
    let nextPath: string | null = null;
    try {
        for (;;) {
            const header = await reader.takeBytes(BLOCK);
            if (header === null || header.every((byte) => byte === 0)) break;

            const size = number(header, 124, 12);
            const padding = (BLOCK - (size % BLOCK)) % BLOCK;
            const type = String.fromCharCode(header[156]!);
            const isUstar = text(header, 257, 6).startsWith('ustar');
            const prefix = isUstar ? text(header, 345, 155) : '';
            const name = text(header, 0, 100);

            if (type === TYPE_GNU_LONG_NAME || type === TYPE_PAX_HEADER) {
                const body = (await reader.takeBytes(size)) ?? new Uint8Array();
                nextPath = type === TYPE_GNU_LONG_NAME ? text(body, 0, body.length) : (paxPath(body) ?? nextPath);
                await reader.take(padding);
                continue;
            }

            const data = await reader.take(size);
            await reader.take(padding);
            if (TYPE_FILE.includes(type)) {
                const path = nextPath ?? (prefix ? `${prefix}/${name}` : name);
                const blob = new Blob(data as BlobPart[]);
                entries.push({ path, size: blob.size, read: async () => blob });
            }
            nextPath = null;
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    return entries;
}
