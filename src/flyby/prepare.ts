// Reads a level and plans the camera's routes through it, off the main
// thread when a worker is available, so the menu never stutters while a
// level loads.

import { buildScene, sceneTransferables, type LevelScene } from './build/geometry';
import { parseLevel } from '../../shared/level/parse.ts';
import { tr4Horizon } from './build/horizons';
import { planRoutes } from './route/plan';
import type { CameraRoute } from './route/route';

/** A route as plain numbers, which crosses to another thread intact. */
export interface RouteData {
    kind: CameraRoute['kind'];
    points: number[];
    targets: number[] | null;
    fov: number[] | null;
    roll: number[] | null;
    speeds: number[] | null;
    holds: number[] | null;
    /** For made-up routes, how far to turn from the way ahead at each point, in radians (positive: left): toward the best view. */
    look?: number[] | null;
    rooms: number[];
}

export interface PreparedLevel {
    scene: LevelScene;
    routes: RouteData[];
}

/** Planning on the spot, for a level with no routes planned ahead: tours tried, and for how long at most, in milliseconds (twice that when it finds too few). */
const ATTEMPTS_ON_THE_SPOT = 400;
const BUDGET_ON_THE_SPOT = 3000;

/** A small seeded random generator (mulberry32), so a seed repeats the same routes. */
export function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Reads a level and its routes: the ones planned ahead for it when there
 * are some, else routes planned now.
 */
export async function prepareLevel(bytes: Uint8Array, fileName: string, seed?: number, planned?: RouteData[] | null, attempts = ATTEMPTS_ON_THE_SPOT): Promise<PreparedLevel> {
    const level = await parseLevel(bytes, fileName);
    // TR4 draws a sky only where its script says so.
    const horizon = level.engine === 4 ? tr4Horizon(fileName) : null;
    const sky = level.engine === 4 ? horizon !== null : undefined;
    const routes =
        planned !== undefined && planned !== null && planned.length > 0
            ? planned
            : planRoutes(level, { random: seed === undefined ? Math.random : seeded(seed), attempts, sky, budget: BUDGET_ON_THE_SPOT }).routes.map((r) => r.route);
    return { scene: buildScene(level, horizon), routes };
}

export function preparedTransferables(prepared: PreparedLevel): ArrayBuffer[] {
    return sceneTransferables(prepared.scene);
}
