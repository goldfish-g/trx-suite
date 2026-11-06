// Reads a level and plans the camera's routes through it, off the main
// thread when a worker is available, so the menu never stutters while a
// level loads.

import { buildScene, sceneTransferables, type LevelScene } from './build/geometry';
import { parseLevel } from '../../shared/level/parse.ts';
import { panSpeed } from './route/player';
import { generateRoute, scriptedRoutes, type CameraRoute } from './route/route';

/** A route as plain numbers, which crosses to another thread intact. */
export interface RouteData {
    kind: CameraRoute['kind'];
    points: number[];
    targets: number[] | null;
    fov: number[] | null;
    roll: number[] | null;
    speeds: number[] | null;
    holds: number[] | null;
    rooms: number[];
}

export interface PreparedLevel {
    scene: LevelScene;
    routes: RouteData[];
}

const GENERATED_ROUTES = 6;
/** Degrees a second a scripted flyby may usually pan. */
const CALM_PAN = 90;

function toData(route: CameraRoute): RouteData {
    return {
        kind: route.kind,
        points: route.points.flatMap((p) => [p.x, p.y, p.z]),
        targets: route.targets?.flatMap((p) => [p.x, p.y, p.z]) ?? null,
        fov: route.fov,
        roll: route.roll,
        speeds: route.speeds,
        holds: route.holds,
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
    // Some flyby sequences are cut-scenes that whip the camera round; a
    // background keeps to the calm ones.
    const routes = scriptedRoutes(level)
        .map(toData)
        .filter((route) => {
            const pan = panSpeed(route);
            return pan.typical <= CALM_PAN && pan.most <= CALM_PAN * 2.2;
        });
    const seen = new Set<string>();
    for (let i = 0; i < GENERATED_ROUTES; i++) {
        const route = generateRoute(level, random);
        if (route === null) continue;
        const data = toData(route);
        const key = data.points.slice(0, 3).concat(data.points.slice(-3)).map((v) => v.toFixed(2)).join();
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push(data);
    }
    return { scene: buildScene(level), routes };
}

export function preparedTransferables(prepared: PreparedLevel): ArrayBuffer[] {
    return sceneTransferables(prepared.scene);
}
