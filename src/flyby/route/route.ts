// Plans where the background camera flies. TR4 levels carry flyby paths of
// their own, which it follows as the game's title screens do. Other levels
// get a path made up on the spot: a walk through rooms joined by doorways
// (portals), threading each room over open floor squares and staying
// between floor and ceiling, so the camera never passes through a wall.

import { CatmullRomCurve3, Vector3 } from 'three';
import { flippedRooms, UNIT } from '../build/geometry';
import type { Level, Portal, Room } from '../../../shared/level/types.ts';
import { ROOM_WATER, WALL } from '../../../shared/level/types.ts';

const SQUARE = 1024;
/** How far into a room the path reaches past a doorway, in file units. */
const DOORWAY_DEPTH = 700;
/** A square the camera may cross needs this much headroom. */
const MIN_HEADROOM = 768;
/** How far the camera keeps from walls, floors and ceilings. */
const CLEARANCE = 400;
const FLOOR_MARGIN = 250;
const CEILING_MARGIN = 220;
/** The spacing of the points the path is smoothed through. */
const SAMPLE_SPACING = 384;
/** More passes round off bigger bends: 60 irons out wiggles a few squares long. */
const SMOOTHING_PASSES = 60;
const HEIGHT_PASSES = 90;
/** How far into the floor and ceiling margins rounding a step may reach. */
const HEIGHT_SLACK = 130;
/** The steepest the camera climbs or dives, rise over run. */
const MAX_SLOPE = 1.1;
/** The last check on a route: how near walls, and floors or ceilings, the camera may come. */
const SAFE_SIDE = 260;
const SAFE_VERTICAL = 90;

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

/** Whether the camera fits from one square to the next: the gap between the higher floor and the lower ceiling. */
function passable(a: Cell, b: Cell): boolean {
    return Math.min(a.floor, b.floor) - Math.max(a.ceiling, b.ceiling) >= FLOOR_MARGIN + CEILING_MARGIN + 128;
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
                const nextCell = info.cells.get(next);
                if (nextCell === undefined || !passable(cell, nextCell)) continue;
                // No cutting corners past a wall.
                if (di !== 0 && dj !== 0) {
                    const sideA = info.cells.get((cell.i + di) * sectorsZ + cell.j);
                    const sideB = info.cells.get(cell.i * sectorsZ + cell.j + dj);
                    if (sideA === undefined || sideB === undefined || !passable(cell, sideA) || !passable(cell, sideB)) continue;
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

/**
 * A doorway out of a room, as the room's own squares see it. The doorway
 * lies on the inner edge of the room's border squares; past it, inside the
 * opening, the squares are the next room's.
 */
interface Door {
    other: RoomInfo;
    /** The doorway's plane is x = plane or z = plane. */
    axis: 'x' | 'z';
    plane: number;
    /** +1 or -1: which way the room lies from the plane. */
    side: number;
    /** The opening, across the plane and up and down. */
    low: number;
    high: number;
    top: number;
    bottom: number;
}

function door(portal: Portal, other: RoomInfo): Door {
    const axis = Math.abs(portal.normal.x) > Math.abs(portal.normal.z) ? 'x' : 'z';
    const across = portal.corners.map((c) => (axis === 'x' ? c.z : c.x));
    const ys = portal.corners.map((c) => c.y);
    return {
        other,
        axis,
        plane: portal.corners[0]![axis],
        side: Math.sign(portal.normal[axis]),
        low: Math.min(...across),
        high: Math.max(...across),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
    };
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
        const route = tryRoute(rooms, candidates, random, maxRooms, level.rooms.filter((room) => !flipped.has(room.index)));
        if (route !== null) return route;
    }
    return null;
}

function tryRoute(
    rooms: Map<number, RoomInfo>,
    candidates: RoomInfo[],
    random: Random,
    maxRooms: number,
    allRooms: Room[],
): CameraRoute | null {
    const start = pick(candidates, (info) => Math.pow(info.cells.size, 0.8), random);
    if (start === undefined) return null;

    // The walk: rooms joined by the doorways taken between them. It never
    // turns back the way it came; a dead end ends it.
    const walk: { info: RoomInfo; entry: Portal | null }[] = [{ info: start, entry: null }];
    const visits = new Map<number, number>([[start.room.index, 1]]);
    while (walk.length < maxRooms) {
        const here = walk[walk.length - 1]!;
        const cameFrom = walk.length >= 2 ? walk[walk.length - 2]!.info.room.index : -1;
        const doorways = here.info.room.portals.filter((portal) => {
            const next = rooms.get(portal.toRoom);
            return next !== undefined && portal.toRoom !== cameFrom && isDoorway(portal) && next.cells.size >= 2;
        });
        const doorway = pick(
            doorways,
            (portal) => Math.sqrt(rooms.get(portal.toRoom)!.cells.size) * ((visits.get(portal.toRoom) ?? 0) === 0 ? 1 : 0.1),
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

    // The walk as a chain of points: the squares crossed in each room and
    // the middle of each doorway passed.
    const raw: PathPoint[] = [];
    for (let k = 0; k < walk.length; k++) {
        const { info, entry } = walk[k]!;
        const nextInfo = walk[k + 1]?.info;
        const exit = nextInfo === undefined ? undefined : info.room.portals.find((p) => p.toRoom === nextInfo.room.index && isDoorway(p));
        const showcase = showcaseCell(info);
        const from = entry === null ? showcase : insideDoorway(info, entry, DOORWAY_DEPTH);
        const to = exit === undefined ? showcase : insideDoorway(info, exit, DOORWAY_DEPTH);
        if (from === undefined || to === undefined) return null;
        const doors: Door[] = [];
        if (entry !== null) doors.push(door(entry, walk[k - 1]!.info));
        if (exit !== undefined) doors.push(door(exit, nextInfo!));

        // Big rooms get a pass over their middle, when that's on the way;
        // small ones are crossed.
        const detour =
            info.cells.size >= 16 && showcase !== undefined && showcase !== from && showcase !== to && turn(from, showcase, to) < 100;
        const legs = detour ? [[from, showcase], [showcase, to]] : [[from, to]];
        const cells: Cell[] = [];
        for (const [a, b] of legs) {
            const leg = findPath(info, a!, b!);
            if (leg === null) return null;
            cells.push(...(cells.length > 0 ? leg.slice(1) : leg));
        }
        for (const cell of cells) raw.push({ ...cellPoint(cell), room: info, doors, pinned: false });
        if (exit !== undefined) raw.push({ ...portalCentre(exit), room: info, doors, pinned: false });
    }
    raw[0]!.pinned = true;
    raw[raw.length - 1]!.pinned = true;

    const points = beforeHop(smoothPath(withoutReversal(subdivide(raw, SAMPLE_SPACING))));
    if (points === null) return null;
    const spaced: PathPoint[] = [];
    for (const point of points) {
        const last = spaced[spaced.length - 1];
        if (last === undefined || Math.hypot(point.x - last.x, point.y - last.y, point.z - last.z) > 120) spaced.push(point);
    }
    const flown = clearPart(spaced, allRooms);
    if (flown === null) return null;

    return {
        kind: 'generated',
        points: flown.map((p) => new Vector3(p.x * UNIT, -p.y * UNIT, -p.z * UNIT)),
        targets: null,
        fov: null,
        roll: null,
        speeds: null,
        holds: null,
        rooms: walk.map((step) => step.info.room.index),
    };
}

/**
 * The part of a path the camera can fly from its start, checked along the
 * curve it will actually follow against every room's floors, ceilings and
 * walls; null when that part is too short to show.
 */
function clearPart(points: Waypoint[], rooms: Room[]): Waypoint[] | null {
    if (points.length < 3 || pathLength(points) < 6 * SQUARE) return null;
    // The same curve the player flies, in file units.
    const curve = new CatmullRomCurve3(
        points.map((p) => new Vector3(p.x, p.y, p.z)),
        false,
        'centripetal',
    );
    curve.arcLengthDivisions = points.length * 12;
    const length = curve.getLength();
    const at = new Vector3();
    let blocked = -1;
    for (let d = 0; d <= length; d += 96) {
        curve.getPointAt(d / length, at);
        if (!roomy(rooms, at.x, at.y, at.z)) {
            blocked = d;
            break;
        }
    }
    if (blocked < 0) return points;
    // Keep the points well before the spot.
    const kept: Waypoint[] = [points[0]!];
    let travelled = 0;
    for (let i = 1; i < points.length; i++) {
        travelled += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y, points[i]!.z - points[i - 1]!.z);
        if (travelled > blocked - SQUARE / 2) break;
        kept.push(points[i]!);
    }
    return kept.length >= 3 && pathLength(kept) >= 6 * SQUARE ? clearPart(kept, rooms) : null;
}

/** Whether the camera fits at a spot: open floor in some room all round it, between floor and ceiling. */
function roomy(rooms: Room[], x: number, y: number, z: number): boolean {
    for (const [dx, dz] of [[0, 0], [SAFE_SIDE, 0], [-SAFE_SIDE, 0], [0, SAFE_SIDE], [0, -SAFE_SIDE]] as const) {
        if (!openSpot(rooms, x + dx, y, z + dz)) return false;
    }
    return true;
}

function openSpot(rooms: Room[], x: number, y: number, z: number): boolean {
    for (const room of rooms) {
        const i = Math.floor((x - room.x) / SQUARE);
        const j = Math.floor((z - room.z) / SQUARE);
        if (i < 0 || j < 0 || i >= room.sectorsX || j >= room.sectorsZ) continue;
        const sector = room.sectors[i * room.sectorsZ + j];
        if (sector === undefined || sector.floor === WALL || sector.ceiling === WALL) continue;
        if (y > sector.ceiling + SAFE_VERTICAL && y < sector.floor - SAFE_VERTICAL) return true;
    }
    return false;
}

/** The turn at b, going from a through b to c, in degrees. */
function turn(a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }): number {
    const ux = b.x - a.x;
    const uz = b.z - a.z;
    const vx = c.x - b.x;
    const vz = c.z - b.z;
    const lengths = Math.hypot(ux, uz) * Math.hypot(vx, vz);
    if (lengths === 0) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / lengths))) * 180) / Math.PI;
}

function pathLength(points: Waypoint[]): number {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    return length;
}

function cellPoint(cell: Cell): Waypoint {
    return { x: cell.x, y: flyingHeight(cell.floor, cell.ceiling), z: cell.z };
}

interface PathPoint extends Waypoint {
    /** The room whose open squares the point keeps over... */
    room: RoomInfo;
    /** ...or the next room's, through these doorways. */
    doors: Door[];
    /** Pinned points stay where they are: the two ends, and points that start hemmed in. */
    pinned: boolean;
}

/** Splits every leg of a chain into steps no longer than `spacing`. */
function subdivide(points: PathPoint[], spacing: number): PathPoint[] {
    const out: PathPoint[] = [];
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        out.push(a);
        const b = points[i + 1];
        if (b === undefined) break;
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / spacing);
        for (let s = 1; s < steps; s++) {
            const t = s / steps;
            out.push({
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
                z: a.z + (b.z - a.z) * t,
                room: a.room,
                doors: a.room === b.room ? a.doors : [...a.doors, ...b.doors],
                pinned: false,
            });
        }
    }
    return out;
}

/**
 * Cuts the chain short where it doubles back on itself (into a corner of a
 * room and out again): the camera would stop dead and reverse.
 */
function withoutReversal(points: PathPoint[]): PathPoint[] | null {
    const reach = Math.ceil(SQUARE * 1.5 / SAMPLE_SPACING);
    for (let i = reach; i + reach < points.length; i++) {
        if (turn(points[i - reach]!, points[i]!, points[i + reach]!) > 120) {
            const kept = points.slice(0, i + 1);
            if (pathLength(kept) < 6 * SQUARE) return null;
            kept[kept.length - 1]!.pinned = true;
            return kept;
        }
    }
    return points;
}

/**
 * Cuts the path short before a hop: where floor and ceiling step so tightly
 * (narrow stairs) that the camera cannot keep its distance from both and
 * would jump up or down between two points.
 */
function beforeHop(points: PathPoint[] | null): PathPoint[] | null {
    if (points === null) return null;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        if (Math.abs(b.y - a.y) > Math.hypot(b.x - a.x, b.z - a.z) * MAX_SLOPE + 48) {
            const kept = points.slice(0, i);
            return kept.length >= 3 && pathLength(kept) >= 6 * SQUARE ? kept : null;
        }
    }
    return points;
}

/** The floor and ceiling at a spot of a point's room, or through one of its doorways. */
function squareAt(point: PathPoint, x: number, z: number): { floor: number; ceiling: number } | undefined {
    const own = cellAt(point.room, x, z);
    if (own !== undefined) return own;
    for (const d of point.doors) {
        const along = d.axis === 'x' ? x : z;
        const across = d.axis === 'x' ? z : x;
        if ((along - d.plane) * d.side > 0 || across <= d.low || across >= d.high) continue;
        const cell = cellAt(d.other, x, z);
        if (cell !== undefined) return { floor: Math.min(cell.floor, d.bottom), ceiling: Math.max(cell.ceiling, d.top) };
    }
    return undefined;
}

/** The heights a point may fly between at a spot, clear of walls by `CLEARANCE` all round, or null. */
function band(point: PathPoint, x: number, z: number): { top: number; bottom: number } | null {
    let top = -Infinity;
    let bottom = Infinity;
    for (const [dx, dz] of AROUND) {
        const square = squareAt(point, x + dx! * CLEARANCE, z + dz! * CLEARANCE);
        if (square === undefined) return null;
        top = Math.max(top, square.ceiling + CEILING_MARGIN);
        bottom = Math.min(bottom, square.floor - FLOOR_MARGIN);
    }
    return top <= bottom ? { top, bottom } : null;
}

const AROUND = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7],
];

/**
 * Pulls the chain taut and round, like a string, while every point keeps
 * clear of the walls and passes doorways inside their frames, then eases its
 * heights the same way between floor and ceiling. The camera then sweeps
 * through rooms instead of zigzagging from square to square.
 */
function smoothPath(points: PathPoint[] | null): PathPoint[] | null {
    if (points === null || points.length < 3) return null;
    const out = points.map((p) => ({ ...p }));
    // Points that start hemmed in stay put.
    for (const p of out) {
        if (band(p, p.x, p.z) === null) p.pinned = true;
    }
    for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
        for (let i = 1; i < out.length - 1; i++) {
            const p = out[i]!;
            if (p.pinned) continue;
            const a = out[i - 1]!;
            const b = out[i + 1]!;
            const x = p.x + ((a.x + b.x) / 2 - p.x) * 0.5;
            const z = p.z + ((a.z + b.z) / 2 - p.z) * 0.5;
            if (band(p, x, z) !== null) {
                p.x = x;
                p.z = z;
            }
        }
    }

    // Heights, of every point, pinned or not: start at a comfortable height
    // over each, then smooth, keeping each between its floor and ceiling.
    const limits = out.map((p) => heightLimits(p));
    for (const [i, p] of out.entries()) {
        const square = squareAt(p, p.x, p.z);
        if (square !== undefined) p.y = flyingHeight(square.floor, square.ceiling);
        p.y = Math.min(Math.max(p.y, limits[i]!.top), limits[i]!.bottom);
    }
    const smoothHeights = (passes: number, slack: number) => {
        for (let pass = 0; pass < passes; pass++) {
            for (let i = 0; i < out.length; i++) {
                const p = out[i]!;
                const around = ((out[i - 1] ?? out[i + 1])!.y + (out[i + 1] ?? out[i - 1])!.y) / 2;
                const y = p.y + (around - p.y) * 0.5;
                p.y = Math.min(Math.max(y, limits[i]!.top - slack), limits[i]!.bottom + slack);
            }
        }
    };
    smoothHeights(HEIGHT_PASSES, 0);
    // Stairs leave corners where the camera meets each step; rounding them
    // takes a little of the margin kept from floors and ceilings.
    smoothHeights(HEIGHT_PASSES / 3, HEIGHT_SLACK);
    return out;
}

/** How high and low a point may fly: clear all round if it can be, else over its own square. */
function heightLimits(p: PathPoint): { top: number; bottom: number } {
    const clear = band(p, p.x, p.z);
    if (clear !== null) return clear;
    const square = squareAt(p, p.x, p.z);
    if (square !== undefined) {
        const top = square.ceiling + CEILING_MARGIN;
        const bottom = square.floor - FLOOR_MARGIN;
        if (top <= bottom) return { top, bottom };
    }
    return { top: p.y, bottom: p.y };
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
