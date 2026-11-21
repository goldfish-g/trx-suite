// What Lara did, read from the save files TRX writes: each save holds every
// level's statistics so far (kills, secrets, deaths, distance and so on), and
// a death goes into the save file at once. A session reports what grew while
// it ran, so saves another device made, or old ones, never count again.

import type { LaraCounts } from '../../shared/stats.ts';
import { readSaveFiles } from '../cloud/idbfs';

/** "TRXS", and the names of older TR1X and TR2X saves. */
const MAGICS = new Set(['TRXS', 'T1MB', 'T2XB']);
const HEADER_BYTES = 16;
/** The game's metres: its statistics screen divides by this. */
const UNITS_PER_METRE = 445;

type Bson = number | bigint | string | boolean | null | Uint8Array | Bson[] | { [key: string]: Bson };

/** Reads a BSON document: the types TRX writes, and the rest skipped over. */
export function readBson(bytes: Uint8Array): { [key: string]: Bson } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = new TextDecoder();

    function cstring(at: number): [string, number] {
        let end = at;
        while (bytes[end] !== 0) {
            if (end >= bytes.length) throw new Error('A name runs past the end.');
            end++;
        }
        return [text.decode(bytes.subarray(at, end)), end + 1];
    }

    function document(at: number, asArray: boolean): [{ [key: string]: Bson } | Bson[], number] {
        const size = view.getInt32(at, true);
        const end = at + size;
        if (size < 5 || end > bytes.length) throw new Error('A document runs past the end.');
        const out: { [key: string]: Bson } = {};
        const list: Bson[] = [];
        let pos = at + 4;
        while (pos < end - 1) {
            const type = bytes[pos++]!;
            const [name, afterName] = cstring(pos);
            pos = afterName;
            let value: Bson;
            switch (type) {
                case 0x01:
                    value = view.getFloat64(pos, true);
                    pos += 8;
                    break;
                case 0x02: {
                    const length = view.getInt32(pos, true);
                    value = text.decode(bytes.subarray(pos + 4, pos + 4 + length - 1));
                    pos += 4 + length;
                    break;
                }
                case 0x03:
                case 0x04: {
                    const [inner, next] = document(pos, type === 0x04);
                    value = inner;
                    pos = next;
                    break;
                }
                case 0x05: {
                    const length = view.getInt32(pos, true);
                    value = bytes.subarray(pos + 5, pos + 5 + length);
                    pos += 5 + length;
                    break;
                }
                case 0x07:
                    value = null;
                    pos += 12;
                    break;
                case 0x08:
                    value = bytes[pos] !== 0;
                    pos += 1;
                    break;
                case 0x09:
                case 0x11:
                case 0x12:
                    value = view.getBigInt64(pos, true);
                    pos += 8;
                    break;
                case 0x0a:
                    value = null;
                    break;
                case 0x10:
                    value = view.getInt32(pos, true);
                    pos += 4;
                    break;
                case 0x13:
                    value = null;
                    pos += 16;
                    break;
                default:
                    throw new Error(`A value of BSON type ${type} is not one TRX writes.`);
            }
            if (asArray) list.push(value);
            else out[name] = value;
        }
        return [asArray ? list : out, end];
    }

    return document(0, false)[0] as { [key: string]: Bson };
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One level's statistics in a save. */
export interface LevelCounts {
    completed: boolean;
    deaths: number;
    secrets: number;
    kills: number;
    pickups: number;
    distanceUnits: number;
    ammoUsed: number;
    ammoHits: number;
    medipacks: number;
}

function num(value: Bson | undefined): number {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
    if (typeof value === 'bigint') return value > 0n ? Number(value) : 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return 0;
}

function bits(value: number): number {
    let n = 0;
    for (let v = value >>> 0; v !== 0; v &= v - 1) n++;
    return n;
}

/** The statistics of every level in a save file, in the game's level order, or null for a file that is no save. */
export async function readSaveStats(file: Uint8Array): Promise<LevelCounts[] | null> {
    if (file.length < HEADER_BYTES) return null;
    const magic = String.fromCharCode(...file.subarray(0, 4));
    if (!MAGICS.has(magic)) return null;
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const compressed = view.getInt32(8, true);
    if (compressed <= 0 || HEADER_BYTES + compressed > file.length) return null;
    const root = readBson(await inflate(file.subarray(HEADER_BYTES, HEADER_BYTES + compressed)));
    const levels = root.resume_info;
    if (!Array.isArray(levels)) return null;
    return levels.map((entry) => {
        const level = typeof entry === 'object' && entry !== null && !Array.isArray(entry) && !(entry instanceof Uint8Array) ? entry : {};
        return {
            completed: level.level_completed === true || num(level.level_completed) > 0,
            deaths: num(level.death_count),
            secrets: bits(num(level.secrets)),
            kills: num(level.kills),
            pickups: num(level.pickups),
            distanceUnits: num(level.distance_travelled),
            ammoUsed: num(level.ammo_used),
            ammoHits: num(level.ammo_hits),
            medipacks: num(level.medipacks_used),
        };
    });
}

const COUNT_FIELDS = ['deaths', 'secrets', 'kills', 'pickups', 'distanceUnits', 'ammoUsed', 'ammoHits', 'medipacks'] as const;

/** Each level's highest numbers over several saves, which may be several points of one game. */
export function highest(saves: readonly LevelCounts[][], into: LevelCounts[] = []): LevelCounts[] {
    for (const save of saves) {
        save.forEach((level, index) => {
            const kept = into[index];
            if (kept === undefined) {
                into[index] = { ...level };
                return;
            }
            kept.completed ||= level.completed;
            for (const field of COUNT_FIELDS) kept[field] = Math.max(kept[field], level[field]);
        });
    }
    return into;
}

/** How far the levels went past the marks, as the stats count it. */
export function gains(marks: readonly LevelCounts[], now: readonly LevelCounts[]): LaraCounts & { distanceUnits: number } {
    const sum = { deaths: 0, secrets: 0, kills: 0, pickups: 0, distanceUnits: 0, ammoUsed: 0, ammoHits: 0, medipacks: 0, levels: 0 };
    now.forEach((level, index) => {
        const mark = marks[index];
        for (const field of COUNT_FIELDS) sum[field] += Math.max(0, level[field] - (mark?.[field] ?? 0));
        if (level.completed && mark?.completed !== true) sum.levels++;
    });
    // More hits than shots can only come from saves of different games.
    sum.ammoHits = Math.min(sum.ammoHits, sum.ammoUsed);
    return { ...sum, distance: 0 };
}

async function readStorage(root: string): Promise<LevelCounts[]> {
    const saves: LevelCounts[][] = [];
    for (const file of await readSaveFiles(root)) {
        try {
            const stats = await readSaveStats(file.bytes);
            if (stats !== null) saves.push(stats);
        } catch {
            // Not a save this can read; the others still count.
        }
    }
    return highest(saves);
}

/**
 * Follows the saves of one session's storages: marks what they hold when
 * each is opened, and on check() tells what grew since.
 */
export function createLaraTracker(report: (counts: LaraCounts) => Promise<void> | void) {
    const marks = new Map<string, LevelCounts[]>();
    /** Distance short of a whole metre, kept for the next report. */
    let spareUnits = 0;
    let checking: Promise<void> = Promise.resolve();

    return {
        /** Notes what a storage's saves hold before the game reads them. */
        async mark(root: string): Promise<void> {
            try {
                if (!marks.has(root)) marks.set(root, await readStorage(root));
            } catch (error) {
                console.warn('[stats] the saves could not be read:', error);
            }
        },
        /** Reports what grew since the marks, and moves them up. */
        check(): Promise<void> {
            checking = checking.then(async () => {
                const total = { deaths: 0, secrets: 0, kills: 0, pickups: 0, distance: 0, ammoUsed: 0, ammoHits: 0, medipacks: 0, levels: 0 };
                let units = spareUnits;
                for (const [root, mark] of marks) {
                    try {
                        const now = await readStorage(root);
                        const grown = gains(mark, now);
                        for (const field of ['deaths', 'secrets', 'kills', 'pickups', 'ammoUsed', 'ammoHits', 'medipacks', 'levels'] as const) {
                            total[field] += grown[field];
                        }
                        units += grown.distanceUnits;
                        marks.set(root, highest([now], mark));
                    } catch (error) {
                        console.warn('[stats] the saves could not be read:', error);
                    }
                }
                total.distance = Math.floor(units / UNITS_PER_METRE);
                spareUnits = units - total.distance * UNITS_PER_METRE;
                if (Object.values(total).some((n) => n > 0)) await report(total);
            });
            return checking;
        },
    };
}
