// @vitest-environment node
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gains, highest, readBson, readSaveStats, type LevelCounts } from './lara';

type Value = number | boolean | string | Value[] | { [key: string]: Value };

/** BSON as TRX writes it: int32s, doubles, booleans, strings, documents and arrays. */
function bson(document: { [key: string]: Value } | Value[]): Buffer {
    const parts: Buffer[] = [];
    const entries: [string, Value][] = Array.isArray(document) ? document.map((value, index) => [String(index), value]) : Object.entries(document);
    for (const [name, value] of entries) {
        const key = Buffer.from(`${name}\0`);
        if (typeof value === 'boolean') parts.push(Buffer.from([0x08]), key, Buffer.from([value ? 1 : 0]));
        else if (typeof value === 'number' && Number.isInteger(value)) {
            const int = Buffer.alloc(4);
            int.writeInt32LE(value);
            parts.push(Buffer.from([0x10]), key, int);
        } else if (typeof value === 'number') {
            const double = Buffer.alloc(8);
            double.writeDoubleLE(value);
            parts.push(Buffer.from([0x01]), key, double);
        } else if (typeof value === 'string') {
            const text = Buffer.from(`${value}\0`);
            const length = Buffer.alloc(4);
            length.writeInt32LE(text.length);
            parts.push(Buffer.from([0x02]), key, length, text);
        } else parts.push(Buffer.from([Array.isArray(value) ? 0x04 : 0x03]), key, bson(value));
    }
    const body = Buffer.concat([...parts, Buffer.from([0])]);
    const size = Buffer.alloc(4);
    size.writeInt32LE(body.length + 4);
    return Buffer.concat([size, body]);
}

function level(stats: Partial<Record<string, Value>> = {}): { [key: string]: Value } {
    return {
        available: true,
        level_completed: false,
        timer: 0,
        kills: 0,
        secrets: 0,
        crystals: 0,
        pickups: 0,
        ammo_hits: 0,
        ammo_used: 0,
        distance_travelled: 0,
        medipacks_used: 0,
        death_count: 0,
        ...stats,
    } as { [key: string]: Value };
}

/** A save file as TRX writes it: header, zlib-packed BSON, trailer. */
function saveFile(levels: { [key: string]: Value }[], magic = 'TRXS'): Uint8Array {
    const body = bson({ level_num: 1, level_title: 'Caves', save_counter: 3, resume_info: levels, misc: { death_count: 0 } });
    const packed = deflateSync(body);
    const header = Buffer.alloc(16);
    header.write(magic, 0, 'latin1');
    header.writeInt16LE(23, 4);
    header.writeUInt16LE(23, 6);
    header.writeInt32LE(packed.length, 8);
    header.writeInt32LE(body.length, 12);
    return new Uint8Array(Buffer.concat([header, packed, Buffer.from('trailer')]));
}

describe('save files', () => {
    it('reads each level of a save', async () => {
        const file = saveFile([
            level({ level_completed: true, kills: 12, secrets: 0b101, pickups: 9, distance_travelled: 44_500, ammo_used: 30, ammo_hits: 21, medipacks_used: 1.5, death_count: 4 }),
            level({ kills: 2, death_count: 1 }),
        ]);
        expect(await readSaveStats(file)).toEqual([
            { completed: true, deaths: 4, secrets: 2, kills: 12, pickups: 9, distanceUnits: 44_500, ammoUsed: 30, ammoHits: 21, medipacks: 1.5 },
            { completed: false, deaths: 1, secrets: 0, kills: 2, pickups: 0, distanceUnits: 0, ammoUsed: 0, ammoHits: 0, medipacks: 0 },
        ]);
        // Saves of the older TR1X and TR2X are read the same way.
        expect(await readSaveStats(saveFile([level({ kills: 1 })], 'T2XB'))).toHaveLength(1);
    });

    it('passes over what is no save', async () => {
        expect(await readSaveStats(new Uint8Array(8))).toBeNull();
        expect(await readSaveStats(new TextEncoder().encode('SAVEGAME FROM THE ORIGINAL GAME!!'))).toBeNull();
    });

    it('reads the BSON types TRX writes', () => {
        expect(readBson(bson({ a: 1, b: 2.5, c: 'text', d: [true, false], e: { f: -3 } }))).toEqual({ a: 1, b: 2.5, c: 'text', d: [true, false], e: { f: -3 } });
    });
});

const counts = (stats: Partial<LevelCounts>): LevelCounts => ({
    completed: false,
    deaths: 0,
    secrets: 0,
    kills: 0,
    pickups: 0,
    distanceUnits: 0,
    ammoUsed: 0,
    ammoHits: 0,
    medipacks: 0,
    ...stats,
});

describe('what grew in a session', () => {
    it('counts only what went past the highest mark of any save', () => {
        // Two slots of one game: the later one holds the earlier one's levels too.
        const marks = highest([
            [counts({ completed: true, kills: 10, deaths: 2 }), counts({ kills: 3 })],
            [counts({ completed: true, kills: 10, deaths: 2 })],
        ]);
        const now = highest([[counts({ completed: true, kills: 10, deaths: 3 }), counts({ completed: true, kills: 8, distanceUnits: 900 }), counts({ deaths: 1 })]]);
        expect(gains(marks, now)).toMatchObject({ deaths: 2, kills: 5, levels: 1, distanceUnits: 900 });
    });

    it('counts nothing for an older save loaded again, or a new game', () => {
        const marks = highest([[counts({ completed: true, kills: 10, deaths: 2 }), counts({ kills: 3 })]]);
        const newGame = highest([[counts({ kills: 4 })]]);
        expect(gains(marks, newGame)).toMatchObject({ deaths: 0, kills: 0, levels: 0 });
    });

    it('never counts more hits than shots', () => {
        expect(gains([], [counts({ ammoUsed: 5, ammoHits: 9 })])).toMatchObject({ ammoUsed: 5, ammoHits: 5 });
    });
});
