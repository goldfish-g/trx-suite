// Which country an address is in, for the stats: the free country database
// of DB-IP (db-ip.com, CC BY 4.0), in the MaxMind DB format. The address is
// looked up the moment a visit arrives and never kept; only the country is.
// The server fetches a new database each month.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Fetch } from '../upstream.ts';

const METADATA_MARKER = Buffer.from('abcdef4d61784d696e642e636f6d', 'hex');

type Value = string | number | bigint | boolean | Buffer | Value[] | { [key: string]: Value } | null;

/** A MaxMind DB file, read into memory, as https://maxmind.github.io/MaxMind-DB/ describes it. */
export class MaxMindDb {
    private readonly nodeCount: number;
    private readonly recordSize: number;
    private readonly treeSize: number;
    private readonly ipv4Start: number;
    readonly buildEpoch: number;

    private readonly file: Buffer;

    constructor(file: Buffer) {
        this.file = file;
        const marker = file.lastIndexOf(METADATA_MARKER);
        if (marker === -1) throw new Error('This is not a MaxMind DB file.');
        const metadataStart = marker + METADATA_MARKER.length;
        const metadata = this.decode(metadataStart, metadataStart)[0];
        if (!isMap(metadata)) throw new Error('The database has no metadata.');
        const { node_count: nodeCount, record_size: recordSize, ip_version: ipVersion, build_epoch: buildEpoch } = metadata;
        if (typeof nodeCount !== 'number' || ![24, 28, 32].includes(recordSize as number)) {
            throw new Error('The database has a search tree this reader does not know.');
        }
        this.nodeCount = nodeCount;
        this.recordSize = recordSize as number;
        this.treeSize = ((this.recordSize * 2) / 8) * nodeCount;
        this.buildEpoch = typeof buildEpoch === 'number' || typeof buildEpoch === 'bigint' ? Number(buildEpoch) : 0;
        // IPv4 addresses live under ::/96 of an IPv6 tree.
        let node = 0;
        if (ipVersion === 6) {
            for (let bit = 0; bit < 96 && node < nodeCount; bit++) node = this.record(node, 0);
        }
        this.ipv4Start = node;
    }

    /** The record stored for an address, or null when the database has none. */
    lookup(address: string): Value {
        const version = isIP(address);
        let bytes: number[];
        let node: number;
        if (version === 4) {
            bytes = address.split('.').map(Number);
            node = this.ipv4Start;
        } else if (version === 6) {
            const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
            if (mapped) return this.lookup(mapped[1]!);
            bytes = ipv6Bytes(address);
            node = 0;
        } else {
            return null;
        }
        for (let bit = 0; bit < bytes.length * 8 && node < this.nodeCount; bit++) {
            node = this.record(node, (bytes[bit >> 3]! >> (7 - (bit & 7))) & 1);
        }
        if (node <= this.nodeCount) return null;
        // Records past the tree point into the data section, which starts 16 bytes after it.
        const offset = this.treeSize + (node - this.nodeCount);
        return this.decode(offset, this.treeSize + 16)[0];
    }

    private record(node: number, side: number): number {
        const file = this.file;
        switch (this.recordSize) {
            case 24: {
                const at = node * 6 + side * 3;
                return (file[at]! << 16) | (file[at + 1]! << 8) | file[at + 2]!;
            }
            case 28: {
                const at = node * 7;
                if (side === 0) return ((file[at + 3]! & 0xf0) << 20) | (file[at]! << 16) | (file[at + 1]! << 8) | file[at + 2]!;
                return ((file[at + 3]! & 0x0f) << 24) | (file[at + 4]! << 16) | (file[at + 5]! << 8) | file[at + 6]!;
            }
            default:
                return file.readUInt32BE(node * 8 + side * 4);
        }
    }

    /** Decodes the value at offset; pointers count from base. Returns it and where the next one starts. */
    private decode(offset: number, base: number): [Value, number] {
        const file = this.file;
        const control = file[offset++]!;
        let type = control >> 5;
        if (type === 1) {
            const size = (control >> 3) & 3;
            const low = control & 7;
            let pointer: number;
            if (size === 0) pointer = (low << 8) | file[offset]!;
            else if (size === 1) pointer = ((low << 16) | file.readUInt16BE(offset)) + 2048;
            else if (size === 2) pointer = ((low << 24) | file.readUIntBE(offset, 3)) + 526336;
            else pointer = file.readUInt32BE(offset);
            return [this.decode(base + pointer, base)[0], offset + size + 1];
        }
        if (type === 0) type = 7 + file[offset++]!;
        let size = control & 0x1f;
        if (size === 29) size = 29 + file[offset++]!;
        else if (size === 30) {
            size = 285 + file.readUInt16BE(offset);
            offset += 2;
        } else if (size === 31) {
            size = 65821 + file.readUIntBE(offset, 3);
            offset += 3;
        }
        switch (type) {
            case 2:
                return [file.toString('utf8', offset, offset + size), offset + size];
            case 3:
                return [file.readDoubleBE(offset), offset + 8];
            case 4:
                return [file.subarray(offset, offset + size), offset + size];
            case 5:
            case 6:
                return [size === 0 ? 0 : file.readUIntBE(offset, size), offset + size];
            case 7: {
                const map: { [key: string]: Value } = {};
                for (let i = 0; i < size; i++) {
                    const [key, afterKey] = this.decode(offset, base);
                    const [value, afterValue] = this.decode(afterKey, base);
                    map[String(key)] = value;
                    offset = afterValue;
                }
                return [map, offset];
            }
            case 8:
                return [size === 0 ? 0 : file.readIntBE(offset, size), offset + size];
            case 9:
            case 10: {
                let value = 0n;
                for (let i = 0; i < size; i++) value = (value << 8n) | BigInt(file[offset + i]!);
                return [value, offset + size];
            }
            case 11: {
                const array: Value[] = [];
                for (let i = 0; i < size; i++) {
                    const [value, next] = this.decode(offset, base);
                    array.push(value);
                    offset = next;
                }
                return [array, offset];
            }
            case 14:
                return [size !== 0, offset];
            case 15:
                return [file.readFloatBE(offset), offset + 4];
            default:
                throw new Error(`The database holds a value of a type this reader does not know (${type}).`);
        }
    }
}

function isMap(value: Value | undefined): value is { [key: string]: Value } {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function ipv6Bytes(address: string): number[] {
    const [head = '', tail] = address.split('::');
    const groups = (part: string) => (part === '' ? [] : part.split(':'));
    const front = groups(head);
    const back = tail === undefined ? [] : groups(tail);
    // An IPv4 address written into the last 32 bits.
    const words = [...front, ...back].flatMap((group) =>
        group.includes('.') ? (() => {
            const [a = 0, b = 0, c = 0, d = 0] = group.split('.').map(Number);
            return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
        })() : [group],
    );
    const frontWords = front.flatMap((group) => (group.includes('.') ? [group, group] : [group])).length;
    const missing = 8 - words.length;
    const all = tail === undefined ? words : [...words.slice(0, frontWords), ...Array<string>(missing).fill('0'), ...words.slice(frontWords)];
    return all.flatMap((word) => {
        const value = parseInt(word, 16);
        return [value >> 8, value & 0xff];
    });
}

/** The country code (ISO 3166-1 alpha-2) a database record names, if any. */
export function countryOf(record: Value): string | null {
    if (!isMap(record)) return null;
    const country = record.country;
    if (!isMap(country)) return null;
    const code = country.iso_code;
    return typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? code : null;
}

export interface GeoOptions {
    /** Where the database is kept between restarts. */
    path: string;
    /** The address of a month's database: {YYYY} and {MM} are filled in. */
    url: string;
    fetch: Fetch;
    now: () => number;
    log: { info(message: string): void; warn(message: string): void };
}

/** How long a database serves before the next month's is fetched. */
const MAX_AGE_MS = 32 * 24 * 60 * 60 * 1000;
/** Between tries to fetch one, when that fails. */
const RETRY_MS = 6 * 60 * 60 * 1000;

function monthUrl(template: string, date: Date): string {
    return template
        .replaceAll('{YYYY}', String(date.getUTCFullYear()))
        .replaceAll('{MM}', String(date.getUTCMonth() + 1).padStart(2, '0'));
}

/**
 * Looks addresses up in the kept database, and fetches a new one when it is
 * older than a month or missing. Until one is there, every country is unknown.
 */
export function createGeo(options: GeoOptions) {
    let db: MaxMindDb | null = null;
    let loadedAt = 0;
    let lastTry = -Infinity;
    let busy: Promise<void> | null = null;

    async function fetchMonth(date: Date): Promise<Buffer | null> {
        const response = await options.fetch(monthUrl(options.url, date), { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) {
            await response.body?.cancel();
            return null;
        }
        const body = Buffer.from(await response.arrayBuffer());
        return body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body) : body;
    }

    async function refresh(): Promise<void> {
        lastTry = options.now();
        try {
            const kept = await stat(options.path).catch(() => null);
            if (db === null && kept !== null) {
                db = new MaxMindDb(await readFile(options.path));
                loadedAt = kept.mtimeMs;
            }
            if (db !== null && options.now() - loadedAt < MAX_AGE_MS) return;
            // A month's file appears a little after the month starts.
            const now = new Date(options.now());
            const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
            const file = (await fetchMonth(now)) ?? (await fetchMonth(previous));
            if (file === null) throw new Error('DB-IP offers no country database for this month or the last.');
            const fresh = new MaxMindDb(file);
            await mkdir(dirname(options.path), { recursive: true });
            await writeFile(`${options.path}.part`, file);
            await rename(`${options.path}.part`, options.path);
            db = fresh;
            loadedAt = options.now();
            options.log.info(`stats: country database of ${new Date(fresh.buildEpoch * 1000).toISOString().slice(0, 10)} in use`);
        } catch (error) {
            options.log.warn(`stats: the country database could not be brought up to date: ${(error as Error).message}`);
        }
    }

    function maybeRefresh(): void {
        if (busy !== null) return;
        const stale = db === null || options.now() - loadedAt >= MAX_AGE_MS;
        if (!stale || options.now() - lastTry < RETRY_MS) return;
        busy = refresh().finally(() => {
            busy = null;
        });
    }

    return {
        /** Loads or fetches the database; lookups before it is done say "unknown". */
        start(): Promise<void> {
            maybeRefresh();
            return busy ?? Promise.resolve();
        },
        country(address: string): string | null {
            maybeRefresh();
            if (db === null) return null;
            try {
                return countryOf(db.lookup(address));
            } catch {
                return null;
            }
        },
    };
}

export type Geo = ReturnType<typeof createGeo>;
