// Flies every route of every level under $TRX_LEVELS_DIR at 60 frames a
// second and measures how evenly the camera moves and turns: sudden changes
// of speed or of turning are what makes a flyby look jumpy.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { prepareLevel, type RouteData } from '../prepare';
import { CameraAim, createPlayer } from './player';

const LEVELS_DIR = process.env.TRX_LEVELS_DIR;
const FPS = 60;
const SPEED = 1.15;
const FADE = 1.4;

function findLevels(directory: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) out.push(...findLevels(path));
        else if (/\.(phd|tr2|tr4)$/i.test(name) && !/^(cut|vict|title)/i.test(name) && !/editor/i.test(path)) out.push(path);
    }
    return out.sort();
}

export interface Smoothness {
    /** Change of velocity, squares per second², per frame. */
    acceleration: number[];
    /** Change of turning speed, degrees per second², per frame. */
    turnAcceleration: number[];
    /** Turning speed, degrees per second. */
    turnSpeed: number[];
}

export function measure(route: RouteData): Smoothness {
    const player = createPlayer(route, SPEED);
    const aim = new CameraAim();
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const positions: THREE.Vector3[] = [];
    const forwards: THREE.Vector3[] = [];
    const dt = 1 / FPS;
    for (let time = 0; time <= player.duration; time += dt) {
        const { roll } = player.sample(time, position, target);
        const q = aim.update(dt, position, target, roll, player.turnRate);
        if (time < FADE || time > player.duration - FADE) continue;
        positions.push(position.clone());
        forwards.push(forward.set(0, 0, -1).applyQuaternion(q).clone());
    }
    const velocity: THREE.Vector3[] = [];
    for (let i = 1; i < positions.length; i++) velocity.push(positions[i]!.clone().sub(positions[i - 1]!).multiplyScalar(FPS));
    const acceleration: number[] = [];
    for (let i = 1; i < velocity.length; i++) acceleration.push(velocity[i]!.distanceTo(velocity[i - 1]!) * FPS);
    const turnSpeed: number[] = [];
    for (let i = 1; i < forwards.length; i++) turnSpeed.push(THREE.MathUtils.radToDeg(forwards[i]!.angleTo(forwards[i - 1]!)) * FPS);
    const turnAcceleration: number[] = [];
    for (let i = 1; i < turnSpeed.length; i++) turnAcceleration.push(Math.abs(turnSpeed[i]! - turnSpeed[i - 1]!) * FPS);
    return { acceleration, turnAcceleration, turnSpeed };
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

describe.skipIf(LEVELS_DIR === undefined)('flyby smoothness', () => {
    it('moves and turns evenly', async () => {
        const rows: string[] = [];
        const totals = { generated: [] as Smoothness[], scripted: [] as Smoothness[] };
        for (const path of findLevels(LEVELS_DIR!)) {
            const prepared = await prepareLevel(new Uint8Array(readFileSync(path)), basename(path), 1);
            for (const [index, route] of prepared.routes.entries()) {
                const m = measure(route);
                totals[route.kind].push(m);
                rows.push(
                    `${basename(path).padEnd(14)} ${String(index).padStart(2)} ${route.kind.padEnd(9)} ` +
                        `accel p95 ${percentile(m.acceleration, 0.95).toFixed(2).padStart(6)} max ${percentile(m.acceleration, 1).toFixed(2).padStart(7)}  ` +
                        `turn p95 ${percentile(m.turnSpeed, 0.95).toFixed(1).padStart(6)} deg/s  ` +
                        `turn-accel p95 ${percentile(m.turnAcceleration, 0.95).toFixed(1).padStart(6)} max ${percentile(m.turnAcceleration, 1).toFixed(1).padStart(7)}`,
                );
            }
        }
        if (process.env.FLYBY_REPORT) console.log(rows.join('\n'));
        const summary = (kind: 'generated' | 'scripted') => {
            const all = totals[kind];
            const accel = all.flatMap((m) => m.acceleration);
            const turnAccel = all.flatMap((m) => m.turnAcceleration);
            const turn = all.flatMap((m) => m.turnSpeed);
            const result = {
                accel99: percentile(accel, 0.99),
                accelMax: percentile(accel, 1),
                turnMax: percentile(turn, 1),
                turnAccel99: percentile(turnAccel, 0.99),
            };
            console.log(
                `${kind}: ${all.length} routes · accel p50 ${percentile(accel, 0.5).toFixed(2)} p95 ${percentile(accel, 0.95).toFixed(2)} p99 ${result.accel99.toFixed(2)} max ${result.accelMax.toFixed(1)}` +
                    ` · turn p95 ${percentile(turn, 0.95).toFixed(1)} max ${result.turnMax.toFixed(1)} deg/s` +
                    ` · turn-accel p95 ${percentile(turnAccel, 0.95).toFixed(1)} p99 ${result.turnAccel99.toFixed(1)} max ${percentile(turnAccel, 1).toFixed(1)}`,
            );
            return result;
        };
        // Measured over the GOG releases of TR1–4 (2026-11): generated
        // routes were at accel p99 1.2, max 6.6; turn max 69 deg/s; scripted
        // max accel 9.4, turn max 91. The first version of the routes was at
        // accel p99 21, max 190, turn max 363.
        const generated = summary('generated');
        expect(totals.generated.length).toBeGreaterThan(0);
        expect(generated.accel99).toBeLessThan(2);
        expect(generated.accelMax).toBeLessThan(12);
        expect(generated.turnMax).toBeLessThan(90);
        expect(generated.turnAccel99).toBeLessThan(25);
        if (totals.scripted.length > 0) {
            const scripted = summary('scripted');
            expect(scripted.accelMax).toBeLessThan(15);
            expect(scripted.turnMax).toBeLessThan(120);
        }
    }, 600_000);
});
