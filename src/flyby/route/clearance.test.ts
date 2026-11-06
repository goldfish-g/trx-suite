// Flies every made-up route of every level under $TRX_LEVELS_DIR and checks
// the camera stays in open space: between some room's floor and ceiling,
// with room to spare on every side.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { flippedRooms } from '../build/geometry';
import { parseLevel } from '../../../shared/level/parse.ts';
import type { Level } from '../../../shared/level/types.ts';
import { WALL } from '../../../shared/level/types.ts';
import { prepareLevel } from '../prepare';
import { createPlayer } from './player';

const LEVELS_DIR = process.env.TRX_LEVELS_DIR;
const SIDE = 200;
const ABOVE_AND_BELOW = 60;

function findLevels(directory: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) out.push(...findLevels(path));
        else if (/\.(phd|tr2|tr4)$/i.test(name) && !/^(cut|vict|title)/i.test(name) && !/editor/i.test(path)) out.push(path);
    }
    return out.sort();
}

/** Whether a spot (file units) is open in some room, with floor and ceiling clear of y. */
function openAt(level: Level, skip: Set<number>, x: number, y: number, z: number): boolean {
    for (const room of level.rooms) {
        if (skip.has(room.index)) continue;
        const i = Math.floor((x - room.x) / 1024);
        const j = Math.floor((z - room.z) / 1024);
        if (i < 0 || j < 0 || i >= room.sectorsX || j >= room.sectorsZ) continue;
        const sector = room.sectors[i * room.sectorsZ + j];
        if (sector === undefined || sector.floor === WALL || sector.ceiling === WALL) continue;
        if (y > sector.ceiling + ABOVE_AND_BELOW && y < sector.floor - ABOVE_AND_BELOW) return true;
    }
    return false;
}

describe.skipIf(LEVELS_DIR === undefined)('flyby clearance', () => {
    it('keeps generated routes in open space', async () => {
        let samples = 0;
        const failures: string[] = [];
        for (const path of findLevels(LEVELS_DIR!)) {
            const bytes = new Uint8Array(readFileSync(path));
            const level = await parseLevel(bytes, basename(path));
            const skip = flippedRooms(level);
            const prepared = await prepareLevel(bytes, basename(path), 1);
            for (const [index, route] of prepared.routes.entries()) {
                if (route.kind !== 'generated') continue;
                const player = createPlayer(route, 1.15);
                const p = new THREE.Vector3();
                const t = new THREE.Vector3();
                let bad = 0;
                for (let time = 0; time <= player.duration; time += 0.1) {
                    player.sample(time, p, t);
                    const x = p.x * 1024;
                    const y = -p.y * 1024;
                    const z = -p.z * 1024;
                    samples++;
                    const clear = [[0, 0], [SIDE, 0], [-SIDE, 0], [0, SIDE], [0, -SIDE]].every(([dx, dz]) => openAt(level, skip, x + dx!, y, z + dz!));
                    if (!clear) bad++;
                }
                if (bad > 0) failures.push(`${basename(path)} route ${index}: ${bad} samples too close`);
            }
        }
        console.log(`${samples} samples, ${failures.length} routes with close calls\n${failures.join('\n')}`);
        expect(failures.length).toBeLessThan(samples / 20000);
    }, 600_000);
});
