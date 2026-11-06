// Reads every level file under $TRX_LEVELS_DIR (the games are not part of
// the repository). Without it, only the synthetic checks run.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { levelEngine, parseLevel } from './parse.ts';
import { LevelFormatError } from './reader.ts';

const LEVELS_DIR = process.env.TRX_LEVELS_DIR;

function findLevels(directory: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) out.push(...findLevels(path));
        else if (/\.(phd|tub|tr2|tr4)$/i.test(name)) out.push(path);
    }
    return out.sort();
}

describe('levelEngine', () => {
    it('tells the engines apart by their version', () => {
        const bytes = (value: number) => new Uint8Array(new Uint32Array([value]).buffer);
        expect(levelEngine(bytes(0x20))).toBe(1);
        expect(levelEngine(bytes(0x2d))).toBe(2);
        expect(levelEngine(bytes(0xff180038))).toBe(3);
        expect(levelEngine(bytes(0xff080038))).toBe(3);
        expect(levelEngine(bytes(0x00345254))).toBe(4);
        expect(levelEngine(bytes(0x12345678))).toBeUndefined();
    });

    it('refuses a truncated level', async () => {
        const bytes = new Uint8Array(64);
        bytes[0] = 0x2d;
        await expect(parseLevel(bytes, 'broken.tr2')).rejects.toThrow();
        await expect(parseLevel(new Uint8Array([1, 2, 3, 4]), 'x.tr2')).rejects.toThrow(LevelFormatError);
    });
});

describe.skipIf(LEVELS_DIR === undefined)('real levels', () => {
    // TR3 keeps its victory picture in vict.tr2, which is not a level.
    const files = LEVELS_DIR === undefined ? [] : findLevels(LEVELS_DIR).filter((path) => !/(^|\/)vict\.tr2$/i.test(path));

    it('finds some', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)('reads %s', async (path) => {
        const bytes = new Uint8Array(readFileSync(path));
        const level = await parseLevel(bytes, path);
        expect(level.rooms.length).toBeGreaterThan(0);
        expect(level.tiles.length).toBe(level.tileCount * 256 * 256 * 4);
        for (const room of level.rooms) {
            for (const face of [...room.quads, ...room.triangles]) {
                expect(face.texture).toBeLessThan(level.objectTextures.length);
                for (const vertex of face.vertices) expect(vertex).toBeLessThan(room.vertices.length);
            }
            for (const portal of room.portals) expect(portal.toRoom).toBeLessThan(level.rooms.length);
            expect(room.sectors.length).toBe(room.sectorsX * room.sectorsZ);
        }
        for (const mesh of level.meshes) {
            for (const face of [...mesh.quads, ...mesh.triangles]) {
                expect(face.texture).toBeGreaterThanOrEqual(0);
                expect(face.texture).toBeLessThan(level.objectTextures.length);
            }
        }
        for (const texture of level.objectTextures) expect(texture.tile).toBeLessThan(level.tileCount);
        const summary = `${level.rooms.length} rooms, ${level.meshes.length} meshes, ${level.items.length} items, ${level.tileCount} tiles, ${level.flybyCameras.length} flyby cameras`;
        console.log(`${path.slice(LEVELS_DIR!.length)}: ${summary}`);
    });
});
