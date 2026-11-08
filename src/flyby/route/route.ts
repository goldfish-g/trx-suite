// The routes the background camera flies. TR4 levels carry flyby paths of
// their own, which it can follow as the game's title screens do; the
// others are planned (plan.ts).

import { Vector3 } from 'three';
import { UNIT } from '../build/geometry';
import type { Level } from '../../../shared/level/types.ts';

export interface CameraRoute {
    kind: 'generated' | 'scripted';
    /** Camera positions, in three.js space. */
    points: Vector3[];
    /** For scripted routes, where the camera looks at each point. */
    targets: Vector3[] | null;
    /** Horizontal field of view at each point, in degrees. */
    fov: number[] | null;
    /** Camera roll at each point, in radians. */
    roll: number[] | null;
    /** For scripted routes, the game's speed at each point: 65536ths of a leg per frame at 30 frames a second. */
    speeds: number[] | null;
    /** For scripted routes, how long the camera rests at each point, in seconds. */
    holds: number[] | null;
    /** The rooms the route passes, for diagnostics and tests. */
    rooms: number[];
}

// Flyby camera flags, as TRX reads them.
const FLYBY_TARGET_ITEM = 0x0002;
const FLYBY_TRACK_PATH = 0x0008;
const FLYBY_FOCUS_LARA = 0x0010;
const FLYBY_TARGET_LARA = 0x0020;
const FLYBY_JUMP_TO_CAMERA = 0x0080;
const FLYBY_HOLD = 0x0100;
const LARA = 0;

/**
 * The flyby paths a TR4 level carries. A sequence that cuts from one camera
 * to another is split there, since a cut is not a path to fly; one that
 * follows Lara around is left out.
 */
export function scriptedRoutes(level: Level): CameraRoute[] {
    const sequences = new Map<number, typeof level.flybyCameras>();
    for (const camera of level.flybyCameras) {
        const list = sequences.get(camera.sequence) ?? [];
        list.push(camera);
        sequences.set(camera.sequence, list);
    }
    const lara = level.items.find((item) => item.objectId === LARA);
    const routes: CameraRoute[] = [];
    for (const cameras of sequences.values()) {
        cameras.sort((a, b) => a.index - b.index);
        const first = cameras[0]!;
        if (first.flags & FLYBY_TRACK_PATH) continue;
        const targetOf = (camera: (typeof cameras)[number]) => {
            if ((first.flags & FLYBY_TARGET_LARA || camera.flags & FLYBY_FOCUS_LARA) && lara !== undefined) return lara;
            const item = camera.flags & FLYBY_TARGET_ITEM ? level.items[camera.timer] : undefined;
            return item ?? { x: camera.targetX, y: camera.targetY, z: camera.targetZ };
        };

        const runs: (typeof cameras)[] = [[]];
        for (const camera of cameras) {
            runs[runs.length - 1]!.push(camera);
            if (camera.flags & FLYBY_JUMP_TO_CAMERA) runs.push([]);
        }
        for (const run of runs) {
            if (run.length < 3) continue;
            const points = run.map((c) => new Vector3(c.x * UNIT, -c.y * UNIT, -c.z * UNIT));
            const travel = points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(points[i]!), 0);
            if (travel < 4) continue; // a camera that barely moves makes a dull background
            routes.push({
                kind: 'scripted',
                points,
                targets: run.map((c) => {
                    const target = targetOf(c);
                    return new Vector3(target.x * UNIT, -target.y * UNIT, -target.z * UNIT);
                }),
                // Field of view and roll come in 65536ths of a turn.
                fov: run.map((c) => {
                    const degrees = (c.fov / 65536) * 360;
                    return degrees >= 20 && degrees <= 120 ? degrees : 80;
                }),
                roll: run.map((c) => (c.roll / 65536) * Math.PI * 2),
                speeds: run.map((c) => (c.speed > 0 ? c.speed : 655)),
                // The game rests timer / 16 frames, at 30 a second, on cameras that hold.
                holds: run.map((c, i) => (i > 0 && c.flags & FLYBY_HOLD ? (c.timer >> 4) / 30 : 0)),
                rooms: [...new Set(run.map((c) => c.room))],
            });
        }
    }
    return routes;
}
