// Checks the routes the app ships (src/flyby/planned/*.json) against the
// levels they were planned for, read from the game archives that
// data/catalog.json names (skipped where those are not on this machine):
//
// - every route is long enough to be worth fading in for;
// - the camera never comes near anything solid, anywhere along the way;
// - no view along a made-up route shows a wall up close, the void, a hole
//   in the level, darkness or nothing but sky;
// - the camera moves and turns evenly: sudden changes of speed or of
//   turning are what makes a flyby look jumpy.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseLevel } from '../../../shared/level/parse.ts';
import { listZip, readZipEntry } from '../../../server/src/zip.ts';
import { tr4Horizon } from '../build/horizons';
import type { RouteData } from '../prepare';
import { loadRoute, type StoredGame } from '../stored';
import { checkFrames, fogFor } from './plan';
import { BASE_SPEED, CameraAim, createPlayer } from './player';
import { buildWorld, type World } from './world';
import { roomVisibility } from '../build/geometry';

const ROOT = resolve(__dirname, '../../..');
const PLANNED = join(ROOT, 'src/flyby/planned');
const FPS = 60;
const FADE = 1.4;

function catalogGames(): Record<string, string> {
    try {
        const catalog = JSON.parse(readFileSync(join(ROOT, 'data/catalog.json'), 'utf8')) as { games?: Record<string, string> };
        return Object.fromEntries(Object.entries(catalog.games ?? {}).map(([mod, path]) => [mod, resolve(ROOT, 'data', path)]));
    } catch {
        return {};
    }
}

const GAMES = catalogGames();
const PLANNED_GAMES = existsSync(PLANNED) ? readdirSync(PLANNED).filter((name) => name.endsWith('.json')) : [];
const AVAILABLE = PLANNED_GAMES.filter((name) => {
    const zip = GAMES[name.replace(/\.json$/, '')];
    return zip !== undefined && existsSync(zip);
});

export interface Smoothness {
    /** Change of velocity, squares per second², per frame. */
    acceleration: number[];
    /** Turning speed, degrees per second. */
    turnSpeed: number[];
    /** Change of turning speed, degrees per second², per frame. */
    turnAcceleration: number[];
}

/** Flies a route at 60 frames a second as the background does, and measures how evenly it moves and turns. */
export function measure(route: RouteData): Smoothness {
    const player = createPlayer(route, BASE_SPEED);
    const aim = new CameraAim();
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    const positions: THREE.Vector3[] = [];
    const forwards: THREE.Vector3[] = [];
    const dt = 1 / FPS;
    for (let time = 0; time <= player.duration; time += dt) {
        const { roll } = player.sample(time, position, target);
        const q = aim.update(dt, position, target, roll, player.turnRate);
        if (time < FADE || time > player.duration - FADE) continue;
        positions.push(position.clone());
        forwards.push(new THREE.Vector3(0, 0, -1).applyQuaternion(q));
    }
    const velocity = positions.slice(1).map((p, i) => p.clone().sub(positions[i]!).multiplyScalar(FPS));
    const acceleration = velocity.slice(1).map((v, i) => v.distanceTo(velocity[i]!) * FPS);
    const turnSpeed = forwards.slice(1).map((f, i) => THREE.MathUtils.radToDeg(f.angleTo(forwards[i]!)) * FPS);
    const turnAcceleration = turnSpeed.slice(1).map((s, i) => Math.abs(s - turnSpeed[i]!) * FPS);
    return { acceleration, turnSpeed, turnAcceleration };
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

/** The least room the camera has anywhere along a route, in the level's units. */
function tightest(route: RouteData, world: World): number {
    const player = createPlayer(route, BASE_SPEED);
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    let least = Infinity;
    for (let time = 0; time <= player.duration; time += 1 / 15) {
        player.sample(time, position, target);
        least = Math.min(least, world.clearance(position.x * 1024, -position.y * 1024, -position.z * 1024, 400));
    }
    return least;
}

describe.skipIf(AVAILABLE.length === 0)('planned flyby routes', () => {
    it('are long, roomy, show nothing wrong and fly smoothly', async () => {
        const problems: string[] = [];
        const generated: Smoothness[] = [];
        const scripted: Smoothness[] = [];
        let routes = 0;
        for (const name of AVAILABLE) {
            const mod = name.replace(/\.json$/, '');
            const zip = GAMES[mod]!;
            const game = JSON.parse(readFileSync(join(PLANNED, name), 'utf8')) as StoredGame;
            const entries = await listZip(zip);
            for (const [file, stored] of Object.entries(game.levels)) {
                const entry = entries.find((e) => e.path.toLowerCase().endsWith(`/levels/${file}`));
                if (entry === undefined) {
                    problems.push(`${mod}/${file}: not in ${zip}`);
                    continue;
                }
                if (entry.size !== stored.size) problems.push(`${mod}/${file}: planned for ${stored.size} bytes, the archive has ${entry.size}`);
                if (stored.routes.length === 0) continue;
                const level = await parseLevel(await readZipEntry(zip, entry), file);
                const world = buildWorld(level, level.engine === 4 ? tr4Horizon(file) !== null : undefined);
                for (const [index, route] of stored.routes.map(loadRoute).entries()) {
                    routes++;
                    const where = `${mod}/${file} #${index} (${route.kind})`;
                    const duration = createPlayer(route, BASE_SPEED).duration;
                    if (duration < 15) problems.push(`${where}: only ${duration.toFixed(1)} s`);
                    const room = tightest(route, world);
                    if (room < (route.kind === 'generated' ? 200 : 110)) problems.push(`${where}: comes within ${room.toFixed(0)} units of something solid`);
                    if (route.kind === 'generated') {
                        const faults = checkFrames(route, world, fogFor(world.hasSky), world.hasSky, roomVisibility(level)).filter((f) => f.fault !== null);
                        if (faults.length > 0) problems.push(`${where}: ${faults.map((f) => `${f.fault} at ${f.time.toFixed(1)} s`).join(', ')}`);
                    }
                    (route.kind === 'generated' ? generated : scripted).push(measure(route));
                }
            }
        }
        const summary = (kind: string, all: Smoothness[]) => {
            const accel = all.flatMap((m) => m.acceleration);
            const turn = all.flatMap((m) => m.turnSpeed);
            const turnAccel = all.flatMap((m) => m.turnAcceleration);
            console.log(
                `${kind}: ${all.length} routes · accel p99 ${percentile(accel, 0.99).toFixed(2)} max ${percentile(accel, 1).toFixed(1)}` +
                    ` · turn max ${percentile(turn, 1).toFixed(1)} deg/s · turn-accel p99 ${percentile(turnAccel, 0.99).toFixed(1)}`,
            );
            return { accel99: percentile(accel, 0.99), accelMax: percentile(accel, 1), turnMax: percentile(turn, 1), turnAccel99: percentile(turnAccel, 0.99) };
        };
        console.log(`${routes} routes checked\n${problems.join('\n')}`);
        expect(problems).toEqual([]);
        // The first made-up routes were at accel p99 21, max 190, turn max 363.
        const smooth = summary('generated', generated);
        expect(smooth.accel99).toBeLessThan(2);
        expect(smooth.accelMax).toBeLessThan(12);
        expect(smooth.turnMax).toBeLessThan(90);
        expect(smooth.turnAccel99).toBeLessThan(25);
        if (scripted.length > 0) {
            const game = summary('scripted', scripted);
            expect(game.accelMax).toBeLessThan(15);
            expect(game.turnMax).toBeLessThan(120);
        }
    }, 1_800_000);
});
