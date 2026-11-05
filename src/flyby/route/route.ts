// Plans where the background camera flies. TR4 levels carry flyby paths of
// their own, which it follows as the game's title screens do. Other levels
// get a path made up on the spot: a walk through rooms joined by doorways
// (portals), threading each room over open floor squares and staying
// between floor and ceiling, so the camera never passes through a wall.

import { Vector3 } from 'three';
import { flippedRooms, UNIT } from '../build/geometry';
import type { Level, Portal, Room } from '../level/types';
import { ROOM_WATER, WALL } from '../level/types';

const SQUARE = 1024;
/** How far into a room the path reaches past a doorway, in file units. */
const DOORWAY_DEPTH = 700;
/** A square the camera may cross needs this much headroom. */
const MIN_HEADROOM = 768;

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
    /** The rooms the route passes, for the caption and for tests. */
    rooms: number[];
}

type Random = () => number;

interface Cell {
    i: number;
    j: number;
    /** World position of the square's centre, file units. */
    x: number;
    z: number;
    floor: number;
    ceiling: number;
}

/** The squares of a room the camera may fly over, keyed by i * sectorsZ + j. */
function openCells(room: Room): Map<number, Cell> {
    const cells = new Map<number, Cell>();
    for (let i = 1; i < room.sectorsX - 1; i++) {
        for (let j = 1; j < room.sectorsZ - 1; j++) {
            const sector = room.sectors[i * room.sectorsZ + j];
            if (sector === undefined) continue;
            const { floor, ceiling } = sector;
            if (floor === WALL || ceiling === WALL || floor - ceiling < MIN_HEADROOM) continue;
            cells.set(i * room.sectorsZ + j, {
                i,
                j,
                x: room.x + i * SQUARE + SQUARE / 2,
                z: room.z + j * SQUARE + SQUARE / 2,
                floor,
                ceiling,
            });
        }
    }
    return cells;
}

/** The height to fly at over a square: a little below the middle of the room. */
function flyingHeight(floor: number, ceiling: number): number {
    const headroom = floor - ceiling;
    const above = Math.min(Math.max(headroom * 0.45, 380), 1300);
    return Math.max(floor - above, ceiling + 220);
}

interface RoomInfo {
    room: Room;
    cells: Map<number, Cell>;
}

function cellAt(info: RoomInfo, x: number, z: number): Cell | undefined {
    const i = Math.floor((x - info.room.x) / SQUARE);
    const j = Math.floor((z - info.room.z) / SQUARE);
    return info.cells.get(i * info.room.sectorsZ + j);
}

function nearestCell(info: RoomInfo, x: number, z: number): Cell | undefined {
    let best: Cell | undefined;
    let bestDistance = Infinity;
    for (const cell of info.cells.values()) {
        const distance = Math.hypot(cell.x - x, cell.z - z);
        if (distance < bestDistance) {
            best = cell;
            bestDistance = distance;
        }
    }
    return best;
}

/** The open square farthest from the room's walls, to show the room off. */
function showcaseCell(info: RoomInfo): Cell | undefined {
    let best: Cell | undefined;
    let bestScore = -Infinity;
    const { sectorsZ } = info.room;
    for (const cell of info.cells.values()) {
        let open = 0;
        for (let di = -2; di <= 2; di++) {
            for (let dj = -2; dj <= 2; dj++) {
                if (info.cells.has((cell.i + di) * sectorsZ + cell.j + dj)) open++;
            }
        }
        const score = open + (cell.floor - cell.ceiling) / 2048;
        if (score > bestScore) {
            best = cell;
            bestScore = score;
        }
    }
    return best;
}

/** How many of the eight squares around one are open. */
function openNeighbours(info: RoomInfo, key: number): number {
    const { sectorsZ } = info.room;
    const i = Math.floor(key / sectorsZ);
    const j = key % sectorsZ;
    let open = 0;
    for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
            if ((di !== 0 || dj !== 0) && info.cells.has((i + di) * sectorsZ + j + dj)) open++;
        }
    }
    return open;
}

/** Shortest walk over open squares, eight ways, as a list of cells. */
function findPath(info: RoomInfo, from: Cell, to: Cell): Cell[] | null {
    const { sectorsZ } = info.room;
    const key = (cell: Cell) => cell.i * sectorsZ + cell.j;
    const start = key(from);
    const goal = key(to);
    const cost = new Map<number, number>([[start, 0]]);
    const previous = new Map<number, number>();
    const open = new Set<number>([start]);
    const estimate = (k: number) => {
        const cell = info.cells.get(k)!;
        return Math.hypot(cell.i - to.i, cell.j - to.j);
    };
    while (open.size > 0) {
        let current = -1;
        let currentScore = Infinity;
        for (const k of open) {
            const score = cost.get(k)! + estimate(k);
            if (score < currentScore) {
                current = k;
                currentScore = score;
            }
        }
        if (current === goal) {
            const path: Cell[] = [];
            for (let k: number | undefined = goal; k !== undefined; k = previous.get(k)) path.push(info.cells.get(k)!);
            return path.reverse();
        }
        open.delete(current);
        const cell = info.cells.get(current)!;
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                if (di === 0 && dj === 0) continue;
                const next = (cell.i + di) * sectorsZ + cell.j + dj;
                if (!info.cells.has(next)) continue;
                // No cutting corners past a wall.
                if (di !== 0 && dj !== 0) {
                    if (!info.cells.has((cell.i + di) * sectorsZ + cell.j) || !info.cells.has(cell.i * sectorsZ + cell.j + dj)) {
                        continue;
                    }
                }
                // Squares beside walls cost more, so the camera keeps to the middle.
                const step = cost.get(current)! + (di !== 0 && dj !== 0 ? Math.SQRT2 : 1) + (8 - openNeighbours(info, next)) * 0.4;
                if (step < (cost.get(next) ?? Infinity)) {
                    cost.set(next, step);
                    previous.set(next, current);
                    open.add(next);
                }
            }
        }
    }
    return null;
}

interface Waypoint {
    x: number;
    y: number;
    z: number;
}

function cellPoint(cell: Cell): Waypoint {
    return { x: cell.x, y: flyingHeight(cell.floor, cell.ceiling), z: cell.z };
}

/** Whether a straight flight between two points stays over open squares, clear of floor and ceiling. */
function clearLine(info: RoomInfo, a: Waypoint, b: Waypoint): boolean {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(length / (SQUARE / 4));
    // A sideways step from the line, to keep some room either side of it.
    const sideX = length === 0 ? 0 : ((a.z - b.z) / length) * SQUARE * 0.4;
    const sideZ = length === 0 ? 0 : ((b.x - a.x) / length) * SQUARE * 0.4;
    for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const y = a.y + (b.y - a.y) * t;
        const cell = cellAt(info, x, z);
        if (cell === undefined) return false;
        if (y > cell.floor - 200 || y < cell.ceiling + 150) return false;
        if (cellAt(info, x + sideX, z + sideZ) === undefined || cellAt(info, x - sideX, z - sideZ) === undefined) return false;
    }
    return true;
}

/** Drops the waypoints a straight line can skip. */
function simplify(info: RoomInfo, points: Waypoint[]): Waypoint[] {
    if (points.length <= 2) return points;
    const out = [points[0]!];
    let anchor = 0;
    for (let i = 2; i < points.length; i++) {
        if (!clearLine(info, points[anchor]!, points[i]!)) {
            out.push(points[i - 1]!);
            anchor = i - 1;
        }
    }
    out.push(points[points.length - 1]!);
    return out;
}

function portalCentre(portal: Portal): Waypoint & { top: number; bottom: number } {
    const xs = portal.corners.map((c) => c.x);
    const ys = portal.corners.map((c) => c.y);
    const zs = portal.corners.map((c) => c.z);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const height = bottom - top;
    return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: bottom - Math.min(Math.max(height * 0.5, 256), 1100),
        z: (Math.min(...zs) + Math.max(...zs)) / 2,
        top,
        bottom,
    };
}

function isDoorway(portal: Portal): boolean {
    if (portal.normal.y !== 0) return false;
    const ys = portal.corners.map((c) => c.y);
    const xs = portal.corners.map((c) => c.x);
    const zs = portal.corners.map((c) => c.z);
    const width = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    return Math.max(...ys) - Math.min(...ys) >= MIN_HEADROOM && width >= SQUARE;
}

function pick<T>(items: readonly T[], weight: (item: T) => number, random: Random): T | undefined {
    const weights = items.map(weight);
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return undefined;
    let roll = random() * total;
    for (let i = 0; i < items.length; i++) {
        roll -= weights[i]!;
        if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
}

/** A point just inside a room, past a doorway of it. */
function insideDoorway(info: RoomInfo, portal: Portal, depth: number): Cell | undefined {
    const centre = portalCentre(portal);
    const length = Math.hypot(portal.normal.x, portal.normal.z) || 1;
    const x = centre.x + (portal.normal.x / length) * depth;
    const z = centre.z + (portal.normal.z / length) * depth;
    return cellAt(info, x, z) ?? nearestCell(info, x, z);
}

/** A route through the rooms of a level, or null when it has nowhere to fly. */
export function generateRoute(level: Level, random: Random = Math.random, maxRooms = 9): CameraRoute | null {
    const flipped = flippedRooms(level);
    const rooms = new Map<number, RoomInfo>();
    for (const room of level.rooms) {
        if (flipped.has(room.index) || room.flags & ROOM_WATER) continue;
        const cells = openCells(room);
        if (cells.size > 0) rooms.set(room.index, { room, cells });
    }
    const candidates = [...rooms.values()].filter((info) => info.cells.size >= 6);
    if (candidates.length === 0) return null;

    for (let attempt = 0; attempt < 8; attempt++) {
        const route = tryRoute(rooms, candidates, random, maxRooms);
        if (route !== null) return route;
    }
    return null;
}

function tryRoute(
    rooms: Map<number, RoomInfo>,
    candidates: RoomInfo[],
    random: Random,
    maxRooms: number,
): CameraRoute | null {
    const start = pick(candidates, (info) => Math.pow(info.cells.size, 0.8), random);
    if (start === undefined) return null;

    // The walk: rooms joined by the doorways taken between them.
    const walk: { info: RoomInfo; entry: Portal | null }[] = [{ info: start, entry: null }];
    const visits = new Map<number, number>([[start.room.index, 1]]);
    while (walk.length < maxRooms) {
        const here = walk[walk.length - 1]!;
        const doorways = here.info.room.portals.filter((portal) => {
            const next = rooms.get(portal.toRoom);
            return next !== undefined && isDoorway(portal) && next.cells.size >= 2;
        });
        const cameFrom = walk.length >= 2 ? walk[walk.length - 2]!.info.room.index : -1;
        const doorway = pick(
            doorways,
            (portal) => {
                const next = rooms.get(portal.toRoom)!;
                const seen = visits.get(portal.toRoom) ?? 0;
                const back = portal.toRoom === cameFrom ? 0.05 : 1;
                return Math.sqrt(next.cells.size) * (seen === 0 ? 1 : 0.1) * back;
            },
            random,
        );
        if (doorway === undefined) break;
        // Going round in circles shows nothing new: stop once every way out was seen.
        if (walk.length >= 3 && (visits.get(doorway.toRoom) ?? 0) > 0) break;
        const next = rooms.get(doorway.toRoom)!;
        // The doorway as the next room lists it, whose normal points into it.
        const entry = next.room.portals.find((portal) => portal.toRoom === here.info.room.index && isDoorway(portal));
        if (entry === undefined) break;
        walk.push({ info: next, entry });
        visits.set(next.room.index, (visits.get(next.room.index) ?? 0) + 1);
    }

    const points: Waypoint[] = [];
    for (let k = 0; k < walk.length; k++) {
        const { info, entry } = walk[k]!;
        const exitRoom = walk[k + 1]?.info.room.index;
        const exit = exitRoom === undefined ? undefined : info.room.portals.find((p) => p.toRoom === exitRoom && isDoorway(p));
        const showcase = showcaseCell(info);
        const from = entry === null ? showcase : insideDoorway(info, entry, DOORWAY_DEPTH);
        const to = exit === undefined ? showcase : insideDoorway(info, exit, DOORWAY_DEPTH);
        if (from === undefined || to === undefined) return null;

        // Big rooms get a pass over their middle; small ones are crossed.
        const via = info.cells.size >= 16 && showcase !== undefined && showcase !== from && showcase !== to ? showcase : null;
        const legs = via === null ? [[from, to]] : [[from, via], [via, to]];
        const cells: Cell[] = [];
        for (const [a, b] of legs) {
            const leg = findPath(info, a!, b!);
            if (leg === null) return null;
            cells.push(...(cells.length > 0 ? leg.slice(1) : leg));
        }
        points.push(...simplify(info, cells.map(cellPoint)));
        if (exit !== undefined) {
            const centre = portalCentre(exit);
            points.push({ x: centre.x, y: centre.y, z: centre.z });
        }
    }

    // Drop points too close together; they make the curve kink.
    const spaced: Waypoint[] = [];
    for (const point of points) {
        const last = spaced[spaced.length - 1];
        if (last === undefined || Math.hypot(point.x - last.x, point.y - last.y, point.z - last.z) > 400) spaced.push(point);
    }
    const length = spaced.slice(1).reduce((sum, p, i) => {
        const q = spaced[i]!;
        return sum + Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    }, 0);
    if (spaced.length < 3 || length < 6 * SQUARE) return null;

    return {
        kind: 'generated',
        points: spaced.map((p) => new Vector3(p.x * UNIT, -p.y * UNIT, -p.z * UNIT)),
        targets: null,
        fov: null,
        roll: null,
        rooms: walk.map((step) => step.info.room.index),
    };
}

/** The flyby paths a TR4 level carries, each in order. */
export function scriptedRoutes(level: Level): CameraRoute[] {
    const sequences = new Map<number, typeof level.flybyCameras>();
    for (const camera of level.flybyCameras) {
        const list = sequences.get(camera.sequence) ?? [];
        list.push(camera);
        sequences.set(camera.sequence, list);
    }
    const routes: CameraRoute[] = [];
    for (const cameras of sequences.values()) {
        if (cameras.length < 3) continue;
        cameras.sort((a, b) => a.index - b.index);
        const points = cameras.map((c) => new Vector3(c.x * UNIT, -c.y * UNIT, -c.z * UNIT));
        const travel = points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(points[i]!), 0);
        if (travel < 4) continue; // a camera that barely moves makes a dull background
        routes.push({
            kind: 'scripted',
            points,
            targets: cameras.map((c) => new Vector3(c.targetX * UNIT, -c.targetY * UNIT, -c.targetZ * UNIT)),
            // Field of view and roll come in 65536ths of a turn.
            fov: cameras.map((c) => {
                const degrees = (c.fov / 65536) * 360;
                return degrees >= 20 && degrees <= 120 ? degrees : 80;
            }),
            roll: cameras.map((c) => (c.roll / 65536) * Math.PI * 2),
            rooms: [...new Set(cameras.map((c) => c.room))],
        });
    }
    return routes;
}
