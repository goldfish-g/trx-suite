// CRC-32 as zip archives record it for each file. Eight bytes a step, through
// eight tables (slicing-by-8), as game archives run to hundreds of megabytes.

const TABLES = (() => {
    const tables = new Uint32Array(8 * 256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        tables[n] = c >>> 0;
    }
    for (let n = 0; n < 256; n++) {
        for (let t = 1; t < 8; t++) {
            const previous = tables[(t - 1) * 256 + n]!;
            tables[t * 256 + n] = (previous >>> 8) ^ tables[previous & 0xff]!;
        }
    }
    return tables;
})();

function update(crc: number, bytes: Uint8Array): number {
    const t = TABLES;
    let c = crc;
    let i = 0;
    for (const end = bytes.length - 7; i < end; i += 8) {
        c ^= bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24);
        c =
            t[1792 + (c & 0xff)]! ^
            t[1536 + ((c >>> 8) & 0xff)]! ^
            t[1280 + ((c >>> 16) & 0xff)]! ^
            t[1024 + (c >>> 24)]! ^
            t[768 + bytes[i + 4]!]! ^
            t[512 + bytes[i + 5]!]! ^
            t[256 + bytes[i + 6]!]! ^
            t[bytes[i + 7]!]!;
    }
    for (; i < bytes.length; i++) c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
    return c;
}

export function crc32(bytes: Uint8Array): number {
    return (update(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

/** Reads a Blob through once, a piece at a time, so a large file never sits in memory whole. */
export async function crc32OfBlob(blob: Blob): Promise<number> {
    let c = 0xffffffff;
    const reader = blob.stream().getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        c = update(c, value);
    }
    return (c ^ 0xffffffff) >>> 0;
}
