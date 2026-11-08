// A level builder's own lettering: the converter rebuilds TRX's font with the
// sprites the builder drew, and the accented characters TRX makes of them, so
// a converted game keeps its lettering and still has TRX's characters and
// icons (the touch controls' among them).
import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { rebuildFonts } from '../../../converter/client/src/converter/font.ts';
import type { MappedFile } from '../../../converter/client/src/converter/types.ts';
import { BASE_FONTS } from '../../../converter/client/src/templates/base/fonts.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ALPHABET = 190;
// TRX's font draws À from A and the grave accent.
const A = 0;
const B = 1;
const A_GRAVE = 155;
const TOUCH_JUMP = 782;

type Shape = string[];
// A capital the builder drew, 5 by 7, on the baseline.
const BLOCK_A: Shape = ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'];
const BLOCK_B: Shape = ['####.', '#...#', '####.', '#...#', '#...#', '#...#', '####.'];

/**
 * A TR1 level file with only what the converter reads of its font: one
 * texture page, an alphabet of 110 sprites (empty where no shape is given),
 * and a palette whose entry 1 is white.
 */
function tr1Level(shapes: Map<number, Shape>): Uint8Array {
    const page = new Uint8Array(256 * 256);
    const sprites: number[][] = [];
    let x = 0;
    for (let i = 0; i < 110; i++) {
        const shape = shapes.get(i);
        if (!shape) {
            // A transparent pixel in the corner.
            sprites.push([0, 255 | (255 << 8), 255, 255, 0, -1, 1, 0]);
            continue;
        }
        const w = shape[0].length;
        const h = shape.length;
        shape.forEach((row, y) => [...row].forEach((c, column) => {
            if (c === '#') page[y * 256 + x + column] = 1;
        }));
        sprites.push([0, x, w * 256 - 1, h * 256 - 1, 0, -h, w, 0]);
        x += w + 1;
    }
    const parts: number[] = [];
    const u32 = (v: number) => parts.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
    const u16 = (v: number) => parts.push(v & 255, (v >> 8) & 255);
    u32(0x20);
    u32(1);
    const head = Uint8Array.from(parts);
    parts.length = 0;
    u32(0); // unused
    u16(0); // rooms
    for (let i = 0; i < 11; i++) u32(0); // floor data … static objects
    u32(0); // object textures
    u32(sprites.length);
    for (const sprite of sprites) sprite.forEach(u16);
    u32(1);
    u32(ALPHABET);
    u16(-110 & 0xffff);
    u16(0);
    for (let i = 0; i < 5; i++) u32(0); // cameras, sound sources, boxes, overlaps, animated textures
    u32(0); // items
    const tail = Uint8Array.from(parts);
    const palette = new Uint8Array(768);
    palette.set([63, 63, 63], 3);
    const out = new Uint8Array(head.length + page.length + tail.length + 8192 + 768);
    out.set(head);
    out.set(page, head.length);
    out.set(tail, head.length + page.length);
    out.set(palette, out.length - 768);
    return out;
}

/** A font injection's pages and its alphabet's sprites, as TRX reads them. */
function readFont(data: Uint8Array) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const payload = unzlibSync(data.subarray(20, 20 + view.getInt32(16, true)));
    const p = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let at = 0;
    const s32 = () => {
        at += 4;
        return p.getInt32(at - 4, true);
    };
    const tests = s32();
    for (let i = 0; i < tests; i++) {
        at += 8;
        const size = s32();
        at += size;
    }
    const blocks = new Map<number, { count: number; data: Uint8Array }>();
    const chunks = s32();
    for (let i = 0; i < chunks; i++) {
        s32();
        s32();
        const count = s32();
        s32();
        for (let j = 0; j < count; j++) {
            const type = s32();
            const records = s32();
            const size = s32();
            blocks.set(type, { count: records, data: payload.subarray(at, at + size) });
            at += size;
        }
    }
    const pages = blocks.get(1)!;
    const sprites = blocks.get(3)!;
    const sequences = new DataView(blocks.get(4)!.data.buffer, blocks.get(4)!.data.byteOffset);
    let first = -1;
    for (let i = 0; i < blocks.get(4)!.count; i++) {
        if (sequences.getInt32(i * 12 + 4, true) === ALPHABET) first = sequences.getInt16(i * 12 + 10, true);
    }
    const sprite = (index: number) => {
        const s = new DataView(sprites.data.buffer, sprites.data.byteOffset + (first + index) * 16, 16);
        return {
            page: s.getUint16(0, true), x: s.getUint8(2), y: s.getUint8(3),
            width: (s.getUint16(4, true) + 1) >> 8, height: (s.getUint16(6, true) + 1) >> 8,
            x0: s.getInt16(8, true), y0: s.getInt16(10, true), x1: s.getInt16(12, true), y1: s.getInt16(14, true),
        };
    };
    /** The sprite's opaque pixels as the shape strings above. */
    const shape = (index: number): Shape => {
        const { page, x, y, width, height } = sprite(index);
        return Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, column) =>
            pages.data[((page * 256 * 256) + (y + row) * 256 + x + column) * 4 + 3] ? '#' : '.').join(''));
    };
    return { pageCount: pages.count, sprite, shape };
}

const stock = readFont(Uint8Array.from(atob(BASE_FONTS.tr1), (c) => c.charCodeAt(0)));

function game(mod: string, levels: Record<string, Uint8Array>, flow: Record<string, unknown>): MappedFile[] {
    return [
        { path: `games/${mod}/gameflow.json5`, data: encoder.encode(JSON.stringify(flow)) },
        ...Object.entries(levels).map(([name, data]) => ({ path: `games/${mod}/levels/${name}`, data })),
    ];
}

const file = (files: MappedFile[], path: string) => files.find((f) => f.path === path);
const flowOf = (files: MappedFile[], mod: string) => JSON.parse(decoder.decode(file(files, `games/${mod}/gameflow.json5`)!.data));

describe('a level builder\'s lettering', () => {
    it('takes the place of TRX\'s sprites in a font.bin of the game\'s own', async () => {
        const mod = 'custom-lettering';
        const files = game(mod, { 'title.phd': tr1Level(new Map([[A, BLOCK_A]])), 'level1.phd': tr1Level(new Map([[A, BLOCK_A]])) }, {
            injections: ['font.bin', 'lara_guns.bin'],
            title: { path: 'title.phd', inherit_injections: false, injections: ['font.bin'] },
            levels: [{ path: 'level1.phd' }],
        });
        const before = file(files, `games/${mod}/gameflow.json5`)!.data;
        const notes = await rebuildFonts(files, mod, 1);
        expect(notes.join('\n')).toMatch(/Rebuilt TRX's font with the 1 sprite the builder drew for title\.phd, level1\.phd/);
        // One font for every level: TRX's name, and the game flow as it was.
        expect(file(files, `games/${mod}/gameflow.json5`)!.data).toBe(before);
        const font = readFont(file(files, `games/${mod}/injections/font.bin`)!.data);
        expect(font.pageCount).toBe(stock.pageCount + 1);

        // The builder's A, cut to what shows, drawn from the cursor on the baseline.
        expect(font.sprite(A)).toMatchObject({ page: stock.pageCount, width: 5, height: 7, x0: 0, y0: -7, x1: 5, y1: 0 });
        expect(font.shape(A)).toEqual(BLOCK_A);
        // À, made again of the builder's A and TRX's grave accent, above it.
        const grave = font.sprite(A_GRAVE);
        const graveShape = font.shape(A_GRAVE);
        expect(grave.page).toBe(stock.pageCount);
        expect(grave.y1).toBe(0);
        expect(graveShape.slice(-7).map((row) => row.slice(-grave.x0, -grave.x0 + 5))).toEqual(BLOCK_A);
        expect(graveShape.slice(0, -7).some((row) => row.includes('#'))).toBe(true);
        // The rest is TRX's: B, and the touch controls' icons.
        expect(font.sprite(B)).toEqual(stock.sprite(B));
        expect(font.sprite(TOUCH_JUMP)).toEqual(stock.sprite(TOUCH_JUMP));
    });

    it('leaves TRX\'s font to levels that bring none of their own', async () => {
        const mod = 'custom-plain';
        const files = game(mod, { 'level1.phd': tr1Level(new Map()) }, { injections: ['font.bin'], levels: [{ path: 'level1.phd' }] });
        expect(await rebuildFonts(files, mod, 1)).toEqual([]);
        expect(files.some((f) => f.path.includes('/injections/'))).toBe(false);
    });

    it('gives levels with lettering of their own each a font, and the others TRX\'s', async () => {
        const mod = 'custom-mixed';
        const files = game(mod, {
            'one.phd': tr1Level(new Map([[A, BLOCK_A]])),
            'two.phd': tr1Level(new Map([[A, BLOCK_B]])),
            'plain.phd': tr1Level(new Map()),
        }, {
            injections: ['font.bin'],
            levels: [{ path: 'one.phd' }, { path: 'two.phd', inherit_injections: false, injections: ['font.bin', 'braid.bin'] }, { path: 'plain.phd' }],
        });
        await rebuildFonts(files, mod, 1);
        const levels = flowOf(files, mod).levels;
        // Injected after TRX's, which it inherits: the last font injected is drawn.
        expect(levels[0].injections).toEqual(['font_one.bin']);
        expect(levels[1].injections).toEqual(['font_two.bin', 'braid.bin']);
        expect(levels[2].injections).toBeUndefined();
        expect(readFont(file(files, `games/${mod}/injections/font_one.bin`)!.data).shape(A)).toEqual(BLOCK_A);
        expect(readFont(file(files, `games/${mod}/injections/font_two.bin`)!.data).shape(A)).toEqual(BLOCK_B);
        expect(file(files, `games/${mod}/injections/font.bin`)).toBeUndefined();
    });

    it('gives a game made before TRX had a font TRX\'s, for its characters and icons', async () => {
        const mod = 'custom-old';
        const files = game(mod, { 'title.phd': tr1Level(new Map()), 'level1.phd': tr1Level(new Map()) }, {
            injections: ['lara_guns.bin'],
            title: { path: 'title.phd', inherit_injections: false },
            levels: [{ path: 'level1.phd' }],
        });
        const notes = await rebuildFonts(files, mod, 1);
        expect(notes.join('\n')).toMatch(/Gave the game TRX's font/);
        const flow = flowOf(files, mod);
        expect(flow.injections).toEqual(['lara_guns.bin', 'font.bin']);
        expect(flow.title.injections).toEqual(['font.bin']);
        expect(flow.levels[0].injections).toBeUndefined();
    });

    it('keeps a font.bin of the game\'s own that TRX reads, and leaves out one it cannot', async () => {
        const mod = 'custom-own-font';
        const files = game(mod, { 'level1.phd': tr1Level(new Map([[A, BLOCK_A]])) }, { injections: ['font.bin'], levels: [{ path: 'level1.phd' }] });
        const own = encoder.encode('TRXJ the builder\'s');
        files.push({ path: `games/${mod}/injections/font.bin`, data: own });
        expect(await rebuildFonts(files, mod, 1)).toEqual([]);
        expect(file(files, `games/${mod}/injections/font.bin`)!.data).toBe(own);

        const legacy = game(mod, { 'level1.phd': tr1Level(new Map([[A, BLOCK_A]])) }, { injections: ['font.bin'], levels: [{ path: 'level1.phd' }] });
        legacy.push({ path: `games/${mod}/injections/font.bin`, data: encoder.encode('T1MJ the builder\'s') });
        const notes = await rebuildFonts(legacy, mod, 1);
        expect(notes[0]).toMatch(/Left out the game's font\.bin/);
        expect(readFont(file(legacy, `games/${mod}/injections/font.bin`)!.data).shape(A)).toEqual(BLOCK_A);
    });
});
