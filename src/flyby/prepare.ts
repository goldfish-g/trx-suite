// Reads a level and plans the camera's routes through it, off the main
// thread when a worker is available, so the menu never stutters while a
// level loads.

import { buildScene, sceneTransferables, type LevelScene } from './build/geometry';
import { parseLevel } from './level/parse';
import { generateRoute, scriptedRoutes, type CameraRoute } from './route/route';

/** A route as plain numbers, which crosses to another thread intact. */
export interface RouteData {
    kind: CameraRoute['kind'];
    points: number[];
    targets: number[] | null;
    fov: number[] | null;
    roll: number[] | null;
    rooms: number[];
}

export interface PreparedLevel {
    scene: LevelScene;
    routes: RouteData[];
}

const GENERATED_ROUTES = 6;

function toData(route: CameraRoute): RouteData {
    return {
        kind: route.kind,
        points: route.points.flatMap((p) => [p.x, p.y, p.z]),
        targets: route.targets?.flatMap((p) => [p.x, p.y, p.z]) ?? null,
        fov: route.fov,
        roll: route.roll,
        rooms: route.rooms,
    };
}

/** A small seeded random generator (mulberry32), so a seed repeats the same routes. */
function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export async function prepareLevel(bytes: Uint8Array, fileName: string, seed?: number): Promise<PreparedLevel> {
    const level = await parseLevel(bytes, fileName);
    const random = seed === undefined ? Math.random : seeded(seed);
    const routes = scriptedRoutes(level).map(toData);
    for (let i = 0; i < GENERATED_ROUTES; i++) {
        const route = generateRoute(level, random);
        if (route !== null) routes.push(toData(route));
    }
    return { scene: buildScene(level), routes };
}

export function preparedTransferables(prepared: PreparedLevel): ArrayBuffer[] {
    return sceneTransferables(prepared.scene);
}
