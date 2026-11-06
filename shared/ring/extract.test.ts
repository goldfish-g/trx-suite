// Cuts the ring's objects out of the real levels under $TRX_LEVELS_DIR (the
// games are not part of the repository) and checks what comes out.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLevel } from '../level/parse.ts';
import { extractObject } from './extract.ts';
import { RING_SOURCES } from './sources.ts';

const LEVELS_DIR = process.env.TRX_LEVELS_DIR;

function findLevels(directory: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) {
            for (const [k, v] of findLevels(path)) if (!out.has(k)) out.set(k, v);
        } else if (/\.(phd|tub|tr2|tr4)$/i.test(name) && !/editor/i.test(path)) out.set(name.toLowerCase(), path);
    }
    return out;
}

describe.skipIf(LEVELS_DIR === undefined)('ring objects from the real levels', () => {
    const levels = LEVELS_DIR === undefined ? new Map<string, string>() : findLevels(LEVELS_DIR);
    const sources = Object.entries(RING_SOURCES).flatMap(([item, list]) => list.map((source) => ({ item, source })));
    for (const { item, source } of sources) {
        const path = levels.get(source.level);
        it.skipIf(path === undefined)(`${item}: ${source.name} from ${source.level}`, async () => {
            const level = await parseLevel(new Uint8Array(readFileSync(path!)), basename(path!));
            const model = extractObject(level, source.object);
            expect(model).not.toBeNull();
            const { positions, normals, uvs, indices, atlas } = model!;
            expect(indices.length).toBeGreaterThan(30);
            expect(normals.length).toBe(positions.length);
            expect(uvs.length / 2).toBe(positions.length / 3);
            for (let i = 0; i < normals.length; i += 3) {
                expect(Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!)).toBeCloseTo(1, 3);
            }
            for (const uv of uvs) expect(uv >= 0 && uv <= 1).toBe(true);
            for (const index of indices) expect(index).toBeLessThan(positions.length / 3);
            expect(atlas.width * atlas.height * 4).toBe(atlas.pixels.length);
            // Small enough to send to every player.
            expect(atlas.width * atlas.height).toBeLessThanOrEqual(512 * 512);
        });
    }
});
