// How planned routes are stored: compact, in the level's own units.

import type { RouteData } from './prepare';

/** A made-up route: its points in the level's own units, x y z after one another. */
interface StoredTour {
    p: number[];
    /** How far the camera turns from the way ahead at each point, in thousandths of a radian. */
    l?: number[];
    /** The rooms it passes, for diagnostics. */
    r?: number[];
}

/** One of TR4's own flyby paths, as the background plays it. */
interface StoredScripted {
    s: RouteData;
}

export type StoredRoute = StoredTour | StoredScripted;

export interface StoredLevel {
    /** The size of the file the routes were planned for. */
    size: number;
    routes: StoredRoute[];
}

/** src/flyby/planned/<game>.json */
export interface StoredGame {
    version: 1;
    /** By the level's file name, in lower case. */
    levels: Record<string, StoredLevel>;
}

export function storeRoute(route: RouteData): StoredRoute {
    if (route.kind === 'scripted') {
        const round = (values: number[] | null) => values?.map((v) => Math.round(v * 10000) / 10000) ?? null;
        return {
            s: {
                ...route,
                points: round(route.points)!,
                targets: round(route.targets),
                fov: round(route.fov),
                roll: round(route.roll),
                holds: round(route.holds),
            },
        };
    }
    const p: number[] = [];
    for (let i = 0; i + 2 < route.points.length; i += 3) {
        p.push(Math.round(route.points[i]! * 1024), Math.round(-route.points[i + 1]! * 1024), Math.round(-route.points[i + 2]! * 1024));
    }
    return { p, r: route.rooms, ...(route.look ? { l: route.look.map((turn) => Math.round(turn * 1000)) } : {}) };
}

export function loadRoute(stored: StoredRoute): RouteData {
    if ('s' in stored) return stored.s;
    const points: number[] = [];
    for (let i = 0; i + 2 < stored.p.length; i += 3) points.push(stored.p[i]! / 1024, -stored.p[i + 1]! / 1024, -stored.p[i + 2]! / 1024);
    return {
        kind: 'generated',
        points,
        targets: null,
        fov: null,
        roll: null,
        speeds: null,
        holds: null,
        look: stored.l?.map((turn) => turn / 1000) ?? null,
        rooms: stored.r ?? [],
    };
}
