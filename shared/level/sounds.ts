// The sound tables of a TR1–3 level, which shared/level/parse.ts leaves
// out: which sample each sound effect plays. TR1 keeps the samples in the
// level itself; TR2 and TR3 keep them all in MAIN.SFX, one WAV file after
// another, and the level only numbers them.

import { parseLevel } from './parse.ts';
import { Reader } from './reader.ts';

export interface LevelSounds {
    engine: 1 | 2 | 3;
    /** Sound effect id to its entry in `infos`, or -1. */
    map: Int16Array;
    /** Each entry: the first of its samples, and how many there are (flags bits 2–5). */
    infos: { sample: number; flags: number }[];
    /** TR1: byte offsets into `data`; TR2 and TR3: places in MAIN.SFX. */
    indices: Uint32Array;
    /** TR1's samples. */
    data: Uint8Array | null;
}

export async function readLevelSounds(bytes: Uint8Array, fileName = ''): Promise<LevelSounds> {
    const level = await parseLevel(bytes, fileName);
    if (level.engine === 4 || level.tailOffset === undefined) throw new Error(`${fileName || 'The level'} keeps its sounds elsewhere.`);
    const engine = level.engine;
    const r = new Reader(bytes);
    r.pos = level.tailOffset;
    if (engine !== 1) r.skip(8192); // the light map, which TR1 has before its palette
    r.skip(r.u16() * 16); // cinematic frames
    r.skip(r.u16()); // demo data
    const map = new Int16Array(engine === 1 ? 256 : 370);
    for (let i = 0; i < map.length; i++) map[i] = r.i16();
    const infos: LevelSounds['infos'] = [];
    const infoCount = r.u32();
    for (let i = 0; i < infoCount; i++) {
        const sample = r.u16();
        r.skip(4); // volume and chance, or TR3's volume, range, chance and pitch
        infos.push({ sample, flags: r.u16() });
    }
    const data = engine === 1 ? r.take(r.u32()) : null;
    const indices = new Uint32Array(r.u32());
    for (let i = 0; i < indices.length; i++) indices[i] = r.u32();
    return { engine, map, infos, indices, data };
}

/** The length of the WAV file at `offset`, from its RIFF header. */
function wavLength(bytes: Uint8Array, offset: number): number | null {
    if (offset + 8 > bytes.length || String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== 'RIFF') return null;
    return 8 + new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getUint32(4, true);
}

/** The WAV file a sound effect plays (its first sample), or null; TR2 and TR3 need MAIN.SFX. */
export function soundWav(sounds: LevelSounds, id: number, mainSfx?: Uint8Array): Uint8Array | null {
    const entry = sounds.map[id] ?? -1;
    const info = entry < 0 ? undefined : sounds.infos[entry];
    const index = info === undefined ? undefined : sounds.indices[info.sample];
    if (index === undefined) return null;
    if (sounds.data !== null) {
        const length = wavLength(sounds.data, index);
        return length === null ? null : sounds.data.slice(index, index + length);
    }
    if (mainSfx === undefined) return null;
    let offset = 0;
    for (let i = 0; i < index; i++) {
        const length = wavLength(mainSfx, offset);
        if (length === null) return null;
        offset += length;
    }
    const length = wavLength(mainSfx, offset);
    return length === null ? null : mainSfx.slice(offset, offset + length);
}
