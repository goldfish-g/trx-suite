// Plans the camera's routes through a level so that they show it off:
// long, slow tours over the places Lara can go, at about the height her own
// camera keeps, never through anything solid, and only past what looks good
// from there.
//
// 1. Camera spots: one over each square Lara can reach, as high as her
//    camera would be, where nothing solid comes near.
// 2. Each spot is scored by what it sees: sight lines cast all round tell
//    how open, bright and varied the view is, and whether it shows holes
//    in the level or the void outside it.
// 3. Tours: shortest-path walks from spot to spot that favour well-scored
//    spots and room to spare, pulled taut and smoothed into a curve that
//    keeps its distance from everything solid.
// 4. Every tour is flown as the background flies it, and every half second
//    the view is checked: a wall filling the screen, darkness, the void or
//    a hole in the level ends the part of the tour worth showing. The best
//    long tours, each showing a different part of the level, are kept.
//
// TR4's own flyby paths are checked the same way.

import * as THREE from 'three';
import type { Level, Room } from '../../../shared/level/types.ts';
import type { RouteData } from '../prepare';
import { BASE_SPEED, CameraAim, createPlayer, panSpeed, turnAbout } from './player';
import { PlayArea, spotKey, type Spot } from './reach';
import { scriptedRoutes } from './route';
import { buildWorld, DETAIL, type RayHit, type World } from './world';
import { roomVisibility, type RoomVisibility } from '../build/geometry';
import { RoomCuller } from '../visibility';

const SQUARE = 1024;
const UNIT = 1 / SQUARE;
/** How high over the ground the camera likes to be: about where Lara's own camera is. */
const EYE = 950;
/** The lowest it goes over the ground, and how far it keeps under a ceiling. */
const EYE_LOW = 600;
/** A rise from one square to the next this big, both ways, makes ground a steep slope (about 25°). */
const STEEP_STEP = 480;
const CEILING_GAP = 300;
/** How far camera spots, the steps between them, and the smoothed path keep from anything solid. */
const SPOT_CLEARANCE = 340;
const STEP_CLEARANCE = 280;
const PULL_CLEARANCE = 760;
const SMOOTH_CLEARANCE = 480;
/** The least room the flown curve may have. */
const FLOWN_CLEARANCE = 260;
/** Closer than this to something solid for a second or more, the camera grazes it. */
const GRAZE = 380;
const FRAME_INTERVAL = 0.5;
/** The background fades routes in and out over this long; the checks skip the darkest part. */
const FADE_SKIP = 0.7;
/** The fastest a made-up route may turn the view, in radians a second (75°). */
const MAX_SWING = 1.3;
/** Degrees a second a scripted flyby may usually pan. */
const CALM_PAN = 90;

export interface PlanOptions {
    random?: () => number;
    /** How many tours to try. */
    attempts?: number;
    /** Stop trying tours after this long, in milliseconds, once some routes are found. */
    budget?: number;
    /** How many routes to keep. */
    keep?: number;
    /** Whether the background draws a sky where there is no geometry. */
    sky?: boolean;
}

export interface FrameCheck {
    time: number;
    /** 0–1, how good the view is. */
    score: number;
    /** Why the view is unfit to show, or null. */
    fault: 'wall' | 'void' | 'hole' | 'dark' | 'sky' | 'stall' | 'swing' | 'hidden' | 'dull' | null;
}

export interface PlannedRoute {
    route: RouteData;
    score: number;
    duration: number;
}

interface CameraSpot {
    x: number;
    y: number;
    z: number;
    room: number;
    cell: number;
    /** 0–1, how good the view from here is. */
    view: number;
    /** Distance to the nearest solid thing, up to 1500. */
    clear: number;
    edges: number[];
    lengths: number[];
    /** The ground the spot is over, and whether that ground is a steep slope (a pyramid's side, a hillside). */
    ground: number;
    steep: boolean;
    /** The group of spots joined to this one by steps, and how many spots it has. */
    group: number;
    groupSize: number;
}

function cellKey(x: number, z: number): number {
    return (Math.floor(x / SQUARE) + 4096) * 16384 + Math.floor(z / SQUARE) + 4096;
}

function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

// ---------------------------------------------------------------- spots

function cameraSpots(area: PlayArea, world: World, rooms: readonly Room[]): CameraSpot[] {
    const spots: CameraSpot[] = [];
    const byCell = new Map<number, number[]>();
    const add = (x: number, z: number, ideal: number, top: number, bottom: number, room: number, ground: number) => {
        if (top > bottom) return;
        ideal = Math.min(Math.max(ideal, top), bottom);
        let found: Point | null = null;
        search: for (const [ox, oz] of [[0, 0], [300, 0], [-300, 0], [0, 300], [0, -300]] as const) {
            for (const dy of [0, -200, 200, -400, 400]) {
                const y = ideal + dy;
                if (y < top || y > bottom) continue;
                if (world.clearance(x + ox, y, z + oz, SPOT_CLEARANCE) >= SPOT_CLEARANCE) {
                    found = { x: x + ox, y, z: z + oz };
                    break search;
                }
            }
        }
        if (found === null) return;
        const cell = cellKey(found.x, found.z);
        const sameCell = byCell.get(cell) ?? [];
        if (sameCell.some((index) => Math.abs(spots[index]!.y - found.y) < 300)) return;
        sameCell.push(spots.length);
        byCell.set(cell, sameCell);
        spots.push({ ...found, room, cell, view: 0, clear: world.clearance(found.x, found.y, found.z, 1500), edges: [], lengths: [], group: -1, groupSize: 0, ground, steep: false });
    };

    // Over the ground Lara can reach, as high as her own camera would be.
    const grounds = new Map<number, number[]>();
    for (const key of area.reachable) {
        const spot: Spot = { room: Math.floor(key / 65536), i: (key >> 8) & 255, j: key & 255 };
        const ground = area.standHeight(spot);
        const centre = area.centre(spot);
        const cell = cellKey(centre.x, centre.z);
        grounds.set(cell, [...(grounds.get(cell) ?? []), ground]);
        add(centre.x, centre.z, ground - EYE, area.ceiling(spot) + CEILING_GAP, ground - EYE_LOW, spot.room, ground);
    }

    // Over drops beside it (pits, chasms, lava, slides), at the height of
    // the ground beside them, so the camera can sweep across.
    for (const room of rooms) {
        if (area.isWater(room.index)) continue;
        for (let i = 1; i < room.sectorsX - 1; i++) {
            for (let j = 1; j < room.sectorsZ - 1; j++) {
                const spot: Spot = { room: room.index, i, j };
                if (area.solid(spot) || !area.known(spot)) continue;
                const sector = area.sector(spot);
                const below = area.ground(spot);
                const own = area.reachable.has(spotKey(below.room, below.i, below.j)) ? area.standHeight(below) : Infinity;
                const centre = area.centre(spot);
                const cell = cellKey(centre.x, centre.z);
                const heights: number[] = [];
                for (let di = -2; di <= 2; di++) {
                    for (let dj = -2; dj <= 2; dj++) {
                        if (di === 0 && dj === 0) continue;
                        for (const height of grounds.get(cell + di * 16384 + dj) ?? []) {
                            // Only where the ground here is well below the ground beside.
                            if (own < height + 768) continue;
                            if (heights.some((h) => Math.abs(h - height) < 400)) continue;
                            heights.push(height);
                        }
                    }
                }
                for (const height of heights) {
                    add(centre.x, centre.z, height - EYE, area.ceiling(spot) + CEILING_GAP, Math.min(sector.floor - 200, height - EYE_LOW), room.index, height);
                }
            }
        }
    }

    // Spots over ground that climbs on one side and falls on the other,
    // steeply: the view from there is mostly the slope.
    const nearest = (cell: number, ground: number) => {
        let best: number | null = null;
        for (const h of grounds.get(cell) ?? []) if (Math.abs(h - ground) < 1600 && (best === null || Math.abs(h - ground) < Math.abs(best - ground))) best = h;
        return best;
    };
    for (const spot of spots) {
        for (const step of [16384, 1]) {
            const ahead = nearest(spot.cell + step, spot.ground);
            const behind = nearest(spot.cell - step, spot.ground);
            if (ahead === null || behind === null) continue;
            if ((spot.ground - ahead >= STEEP_STEP && behind - spot.ground >= STEEP_STEP) || (ahead - spot.ground >= STEEP_STEP && spot.ground - behind >= STEEP_STEP)) spot.steep = true;
        }
    }

    // Steps between neighbouring spots the camera fits along.
    for (const [index, a] of spots.entries()) {
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                if (di === 0 && dj === 0) continue;
                for (const other of byCell.get(a.cell + di * 16384 + dj) ?? []) {
                    if (other <= index) continue;
                    const b = spots[other]!;
                    const across = Math.hypot(b.x - a.x, b.z - a.z);
                    if (Math.abs(b.y - a.y) > across * 1.1) continue;
                    if (!segmentClear(world, a, b, STEP_CLEARANCE)) continue;
                    const length = Math.hypot(across, b.y - a.y);
                    a.edges.push(other);
                    a.lengths.push(length);
                    b.edges.push(index);
                    b.lengths.push(length);
                }
            }
        }
    }
    return spots;
}

interface Point {
    x: number;
    y: number;
    z: number;
}

function segmentClear(world: World, a: Point, b: Point, clearance: number): boolean {
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const steps = Math.max(2, Math.ceil(length / 200));
    for (let s = 1; s < steps; s++) {
        const t = s / steps;
        if (world.clearance(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, clearance) < clearance) return false;
    }
    return true;
}

// ---------------------------------------------------------------- views

const HIT: RayHit = { distance: 0, triangle: -1, leak: false, screen: Infinity };

export interface Fog {
    near: number;
    far: number;
}

function fogAt(fog: Fog, distance: number): number {
    const t = clamp01((distance - fog.near) / (fog.far - fog.near));
    return t * t * (3 - 2 * t);
}

/** How good the view from a spot is, all the way round. */
function spotView(world: World, spot: Point, fog: Fog, sky: boolean): number {
    let open = 0;
    let light = 0;
    let rays = 0;
    let bad = 0;
    const textures = new Set<number>();
    for (let k = 0; k < 16; k++) {
        const yaw = (k / 16) * Math.PI * 2;
        for (const pitch of [0, -0.25, -0.6]) {
            const dx = Math.cos(yaw) * Math.cos(pitch);
            const dz = Math.sin(yaw) * Math.cos(pitch);
            const dy = -Math.sin(pitch); // the files' y points down
            world.raycast(spot.x, spot.y, spot.z, dx, dy, dz, 64 * SQUARE, HIT);
            rays++;
            if (HIT.leak) bad++;
            if (HIT.triangle < 0) {
                // Level with the camera, sky (or night); below it, the edge of the level.
                if (pitch >= 0) {
                    open += sky ? 8 : 4;
                    light += sky ? 0.3 : 0;
                } else bad++;
                continue;
            }
            open += Math.min(HIT.distance, 16 * SQUARE) / SQUARE;
            light += world.brightness[HIT.triangle]! * (1 - fogAt(fog, HIT.distance / SQUARE));
            textures.add(world.textures[HIT.triangle]!);
        }
    }
    const score = 0.45 * clamp01(open / rays / 7) + 0.35 * clamp01(light / rays / 0.55) + 0.2 * clamp01(textures.size / 10);
    // Nothing at all below or around: the camera is over the edge of the level.
    return bad / rays > 0.06 ? -1 : score;
}

const FRAME_YAWS = [-0.66, -0.44, -0.22, 0, 0.22, 0.44, 0.66];
const FRAME_PITCHES = [-0.62, -0.31, 0, 0.31, 0.62];

/** What one view shows, as shares of its sight lines. */
export interface ViewCheck {
    /** 0–1, how good the view is. */
    score: number;
    fault: FrameCheck['fault'];
    near: number;
    median: number;
    flat: number;
    empty: number;
    holes: number;
    brightness: number;
    skyward: number;
    screens: number;
    hidden: number;
    /** A triangle seen through a hole, for finding what makes it. */
    hole: number;
}

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const direction = new THREE.Vector3();
const depths: number[] = [];

/** Checks the view from a camera position (three.js units) turned by `q`. */
export function checkView(
    world: World,
    position: THREE.Vector3,
    q: THREE.Quaternion,
    fog: Fog,
    sky: boolean,
    visible: Set<number> | null = null,
): ViewCheck {
    forward.set(0, 0, -1).applyQuaternion(q);
    right.set(1, 0, 0).applyQuaternion(q);
    up.set(0, 1, 0).applyQuaternion(q);
    const ox = position.x * SQUARE;
    const oy = -position.y * SQUARE;
    const oz = -position.z * SQUARE;
    let near = 0;
    let close = 0;
    let closeObject = 0;
    let empty = 0;
    let holes = 0;
    let hole = -1;
    let light = 0;
    let detail = 0;
    let rays = 0;
    let skyward = 0;
    let night = 0;
    let screens = 0;
    let black = 0;
    let hidden = 0;
    depths.length = 0;
    const textures = new Set<number>();
    const uses = new Map<number, number>();
    for (const yaw of FRAME_YAWS) {
        for (const pitch of FRAME_PITCHES) {
            direction.copy(forward).addScaledVector(right, yaw * 1.25).addScaledVector(up, pitch).normalize();
            world.raycast(ox, oy, oz, direction.x, -direction.y, -direction.z, 64 * SQUARE, HIT);
            rays++;
            if (HIT.leak) {
                holes++;
                hole = world.lastBack;
            }
            if (HIT.screen < 0.6 * SQUARE) screens++;
            if (HIT.triangle < 0) {
                if (direction.y > -0.05) {
                    // Sky, or a night sky where the level draws none.
                    skyward++;
                    if (sky) light += 0.5;
                    else night++;
                    depths.push(64);
                } else {
                    // Nothing below the horizon: past the edge of the level.
                    empty++;
                    depths.push(0);
                }
                continue;
            }
            const distance = HIT.distance / SQUARE;
            depths.push(distance);
            if (distance < 0.85) near++;
            if (distance < 1.5) close++;
            if (distance < 1.6 && world.flags[HIT.triangle]! & DETAIL) closeObject++;
            light += world.brightness[HIT.triangle]! * (1 - fogAt(fog, distance));
            // Far enough for the fog to blacken it.
            if (distance > fog.far * 0.85) black++;
            // In a room the background would not draw from here.
            if (visible !== null && !visible.has(world.rooms[HIT.triangle]!)) hidden++;
            if (world.flags[HIT.triangle]! & DETAIL) detail++;
            textures.add(world.textures[HIT.triangle]!);
            uses.set(world.textures[HIT.triangle]!, (uses.get(world.textures[HIT.triangle]!) ?? 0) + 1);
        }
    }
    // The share of the view one texture covers: a pyramid's side, a rock face.
    let most = 0;
    for (const n of uses.values()) most = Math.max(most, n);
    const sameness = most / rays;
    depths.sort((a, b) => a - b);
    const median = depths[depths.length >> 1]!;
    // How much of the view is one surface at one distance: a wall faced.
    let level = 0;
    for (const depth of depths) if (Math.abs(depth - median) < median * 0.2) level++;
    const flat = level / rays;
    const brightness = light / rays;
    let fault: FrameCheck['fault'] = null;
    // A surface right in front, one filling much of the view from a square
    // or so away, or one plain face of wall at one distance.
    if (near / rays > 0.22 || close / rays > 0.4 || median < 1.8 || (flat > 0.65 && median < 4)) {
        fault = 'wall';
        count(near / rays > 0.22 ? 'wall:near' : close / rays > 0.4 ? 'wall:close' : median < 1.8 ? 'wall:median' : 'wall:flat');
    } else if (closeObject / rays > 0.25) {
        // A statue, pole or boat filling the view from close by.
        fault = 'wall';
        count('wall:object');
    }
    else if (empty / rays > 0.03 || (empty + black) / rays > 0.35) fault = 'void';
    else if (hidden / rays > 0.03) fault = 'hidden';
    else if (screens / rays > 0.25) {
        fault = 'wall';
        count('wall:screen');
    }
    else if (holes / rays > 0.08) fault = 'hole';
    else if (brightness < 0.22) fault = 'dark';
    else if (skyward / rays > 0.45 || night / rays > 0.3) fault = 'sky';
    const score =
        0.25 * clamp01((median - 1) / 5) +
        0.15 * clamp01((1 - flat) / 0.7) +
        0.25 * clamp01(brightness / 0.5) +
        0.2 * clamp01(textures.size / rays / 0.35) +
        0.15 * clamp01(detail / rays / 0.25) -
        (near / rays) * 0.5 -
        (close / rays) * 0.3 -
        (empty / rays) * 1.5 -
        (holes / rays) * 2 -
        Math.max(0, skyward / rays - 0.35) -
        (night / rays) * 0.8 -
        (screens / rays) * 0.6;
    // Nothing much to see, though nothing wrong either.
    if (fault === null && (score < 0.32 || sameness > 0.6)) fault = 'dull';
    return {
        score: Math.max(0, score),
        fault,
        near: near / rays,
        median,
        flat,
        empty: empty / rays,
        holes: holes / rays,
        brightness,
        skyward: skyward / rays,
        screens: screens / rays,
        hidden: hidden / rays,
        hole,
    };
}

/** The fog a level is drawn with: indoors it closes in sooner. */
export function fogFor(sky: boolean): Fog {
    return sky ? { near: 12, far: 42 } : { near: 7, far: 26 };
}

/**
 * Flies a route as the background does and checks the view every half
 * second: what share of it is a wall up close, the void or a hole in the
 * level, how dark it is, and how open and varied.
 */
export function checkFrames(route: RouteData, world: World, fog: Fog, sky: boolean, rooms: readonly RoomVisibility[] | null = null): FrameCheck[] {
    const player = createPlayer(route, BASE_SPEED);
    const aim = new CameraAim();
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    // The rooms the background draws, from a camera that sees at least
    // what the sight lines cover.
    const culler = rooms === null ? null : new RoomCuller(rooms);
    const camera = new THREE.PerspectiveCamera(66, 1.27, 0.03, 80);
    const dt = 1 / 15;
    const frames: FrameCheck[] = [];
    const last = new THREE.Vector3();
    let lastTime = -1;
    let grazing = 0;
    let next = FADE_SKIP;
    const facing = new THREE.Vector3();
    const facingBefore = new THREE.Vector3();
    let swing = 0;
    for (let time = 0; time <= player.duration; time += dt) {
        const { roll } = player.sample(time, position, target);
        const q = aim.update(dt, position, target, roll, player.turnRate);
        // How fast the view turns, the fastest since the last check.
        facing.set(0, 0, -1).applyQuaternion(q);
        if (time > 0) swing = Math.max(swing, facing.angleTo(facingBefore) / dt);
        facingBefore.copy(facing);
        if (time < next || time > player.duration - FADE_SKIP) continue;
        next += FRAME_INTERVAL;
        let visible: Set<number> | null = null;
        if (culler !== null) {
            camera.position.copy(position);
            camera.quaternion.copy(q);
            camera.updateMatrixWorld();
            visible = culler.visibleRooms(camera);
        }
        const view = checkView(world, position, q, fog, sky, visible);
        // A view that whips round is hard to watch.
        if (view.fault === null && swing > MAX_SWING) view.fault = 'swing';
        swing = 0;
        // A camera that all but stops makes the background look stuck.
        if (view.fault === null && lastTime >= 0 && position.distanceTo(last) / (time - lastTime) < 0.2) view.fault = 'stall';
        // Brushing past a door frame is fine; running along a wall is not.
        const tight = world.clearance(position.x * SQUARE, -position.y * SQUARE, -position.z * SQUARE, GRAZE) < GRAZE;
        grazing = tight ? grazing + 1 : 0;
        if (grazing >= 2) {
            if (view.fault === null) {
                view.fault = 'wall';
                count('wall:graze');
            }
            const previous = frames[frames.length - 1];
            if (previous !== undefined && previous.fault === null) previous.fault = 'wall';
        }
        last.copy(position);
        lastTime = time;
        count(`frame:${view.fault ?? 'ok'}`);
        frames.push({ time, score: view.score, fault: view.fault });
    }
    return frames;
}

// ---------------------------------------------------------------- tours

class Heap {
    private readonly items: number[] = [];
    private readonly keys: number[] = [];

    get size(): number {
        return this.items.length;
    }

    push(item: number, key: number): void {
        const items = this.items;
        const keys = this.keys;
        let i = items.length;
        items.push(item);
        keys.push(key);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (keys[parent]! <= key) break;
            items[i] = items[parent]!;
            keys[i] = keys[parent]!;
            i = parent;
        }
        items[i] = item;
        keys[i] = key;
    }

    pop(): number {
        const items = this.items;
        const keys = this.keys;
        const top = items[0]!;
        const lastItem = items.pop()!;
        const lastKey = keys.pop()!;
        if (items.length > 0) {
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                if (l >= items.length) break;
                const r = l + 1;
                const c = r < items.length && keys[r]! < keys[l]! ? r : l;
                if (keys[c]! >= lastKey) break;
                items[i] = items[c]!;
                keys[i] = keys[c]!;
                i = c;
            }
            items[i] = lastItem;
            keys[i] = lastKey;
        }
        return top;
    }
}

/** The cheapest way between two spots, preferring good views and room to spare, avoiding spots already used. */
function findWay(spots: CameraSpot[], from: number, to: number, used: Set<number>): number[] | null {
    const goal = spots[to]!;
    const cost = new Map<number, number>([[from, 0]]);
    const previous = new Map<number, number>();
    const open = new Heap();
    open.push(from, 0);
    const closed = new Set<number>();
    let expanded = 0;
    while (open.size > 0 && expanded < 6000) {
        const current = open.pop();
        if (current === to) {
            const way = [to];
            for (let k = previous.get(to); k !== undefined; k = previous.get(k)) way.push(k);
            return way.reverse();
        }
        if (closed.has(current)) continue;
        closed.add(current);
        expanded++;
        const here = spots[current]!;
        const base = cost.get(current)!;
        for (let e = 0; e < here.edges.length; e++) {
            const next = here.edges[e]!;
            if (closed.has(next)) continue;
            const spot = spots[next]!;
            // Spots over the edge of the level are not on the way anywhere.
            if (spot.view < 0) continue;
            const length = here.lengths[e]!;
            const step = length * (1 + 3 * Math.max(0, 1 - spot.clear / 1200) + 4 * (1 - spot.view) + (used.has(next) ? 8 : 0));
            const total = base + step;
            if (total < (cost.get(next) ?? Infinity)) {
                cost.set(next, total);
                previous.set(next, current);
                open.push(next, total + Math.hypot(goal.x - spot.x, goal.y - spot.y, goal.z - spot.z));
            }
        }
    }
    return null;
}

function weightedPick<T>(items: readonly T[], weight: (item: T) => number, random: () => number): T | undefined {
    let total = 0;
    for (const item of items) total += weight(item);
    if (total <= 0) return undefined;
    let roll = random() * total;
    for (const item of items) {
        roll -= weight(item);
        if (roll <= 0) return item;
    }
    return items[items.length - 1];
}

/** A walk from spot to spot through several good places, as a list of spots. */
function tour(spots: CameraSpot[], good: number[], covered: Set<number>, random: () => number): number[] | null {
    // Start where a long tour can go, in a big group of spots, and away
    // from the ground the tours kept so far cover.
    const fresh = (i: number) => (covered.has(spots[i]!.cell) ? 0.4 : 1);
    const start = weightedPick(good, (i) => spots[i]!.view ** 3 * fresh(i) * (spots[i]!.edges.length >= 2 ? Math.min(1, spots[i]!.groupSize / 150) : 0), random);
    if (start === undefined) return null;
    const wanted = (26 + random() * 18) * SQUARE;
    const way = [start];
    const used = new Set<number>([start]);
    const blocked = new Set<number>();
    const block = (cell: number) => {
        for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) blocked.add(cell + di * 16384 + dj);
    };
    block(spots[start]!.cell);
    let length = 0;
    for (let leg = 0; leg < 6 && length < wanted; leg++) {
        const end = spots[way[way.length - 1]!]!;
        const back = spots[way[Math.max(0, way.length - 4)]!]!;
        const span = Math.hypot(end.x - back.x, end.z - back.z);
        const heading = span > 0 ? { x: (end.x - back.x) / span, z: (end.z - back.z) / span } : null;
        const goals = good.filter((i) => {
            const spot = spots[i]!;
            if (spot.group !== end.group) return false;
            const distance = Math.hypot(spot.x - end.x, spot.z - end.z);
            // Onwards: never back the way the tour came.
            if (heading !== null && ((spot.x - end.x) * heading.x + (spot.z - end.z) * heading.z) / distance < -0.3) return false;
            if (distance < 6 * SQUARE || distance > 22 * SQUARE) return false;
            // Somewhere new: no spot of the walk within a few squares.
            return !blocked.has(spot.cell);
        });
        let added = false;
        for (let tries = 0; tries < 4 && !added; tries++) {
            const goal = weightedPick(goals, (i) => spots[i]!.view ** 2 * (covered.has(spots[i]!.cell) ? 0.6 : 1), random);
            if (goal === undefined) break;
            const part = findWay(spots, way[way.length - 1]!, goal, used);
            if (part === null) {
                goals.splice(goals.indexOf(goal), 1);
                continue;
            }
            for (const index of part.slice(1)) {
                const a = spots[way[way.length - 1]!]!;
                const b = spots[index]!;
                length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
                way.push(index);
                used.add(index);
                block(b.cell);
            }
            added = true;
        }
        if (!added) break;
    }
    return way.length >= 8 ? way : null;
}

/** Pulls a walk taut: straight across wherever the camera fits with room to spare. */
function pullTaut(world: World, points: Point[]): Point[] {
    const out = [points[0]!];
    let i = 0;
    while (i < points.length - 1) {
        let j = Math.min(points.length - 1, i + 10);
        while (j > i + 1 && !segmentClear(world, points[i]!, points[j]!, PULL_CLEARANCE)) j--;
        out.push(points[j]!);
        i = j;
    }
    return out;
}

function subdivide(points: Point[], spacing: number): Point[] {
    const out: Point[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / spacing));
        for (let s = 0; s < steps; s++) {
            const t = s / steps;
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
        }
    }
    out.push({ ...points[points.length - 1]! });
    return out;
}

/** Rounds the path off, moving a point only where it keeps its distance from everything solid. */
function smooth(world: World, points: Point[], passes: number): Point[] {
    const out = points.map((p) => ({ ...p }));
    for (let pass = 0; pass < passes; pass++) {
        for (let i = 1; i < out.length - 1; i++) {
            const p = out[i]!;
            const a = out[i - 1]!;
            const b = out[i + 1]!;
            const x = p.x + ((a.x + b.x) / 2 - p.x) * 0.5;
            const y = p.y + ((a.y + b.y) / 2 - p.y) * 0.5;
            const z = p.z + ((a.z + b.z) / 2 - p.z) * 0.5;
            if (world.clearance(x, y, z, SMOOTH_CLEARANCE) >= SMOOTH_CLEARANCE) {
                p.x = x;
                p.y = y;
                p.z = z;
            }
        }
    }
    return out;
}

/** Drops points closer together than `spacing`, keeping both ends. */
function thin(points: Point[], spacing: number): Point[] {
    const out = [points[0]!];
    for (let i = 1; i < points.length - 1; i++) {
        const last = out[out.length - 1]!;
        if (Math.hypot(points[i]!.x - last.x, points[i]!.y - last.y, points[i]!.z - last.z) >= spacing) out.push(points[i]!);
    }
    out.push(points[points.length - 1]!);
    return out;
}

/** Directions the camera may turn to from the way ahead, in radians: up to 50° either side. */
const TURNS = [-0.87, -0.44, 0, 0.44, 0.87];
/** How far along the path a turn of the camera is spread, in the level's units, either side. */
const TURN_SPREAD = 2600;

/**
 * Where the camera should look along a path: at each point, how far to
 * turn from the way ahead toward the most open, bright and varied view,
 * with a little preference for looking where it goes, smoothed along the
 * path so the camera turns slowly. Positive turns left.
 */
function lookOffsets(world: World, points: Point[], fog: Fog): number[] {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x * UNIT, -p.y * UNIT, -p.z * UNIT)), false, 'centripetal');
    const last = points.length - 1;
    const tangent = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const ray = new THREE.Vector3();
    const best: number[] = [];
    for (let i = 0; i <= last; i++) {
        // Every other point is plenty; the rest are filled in between.
        if (i % 2 === 1 && i !== last) {
            best.push(NaN);
            continue;
        }
        curve.getTangent(last === 0 ? 0 : i / last, tangent);
        tangent.y = 0;
        if (tangent.lengthSq() === 0) tangent.set(0, 0, -1);
        tangent.normalize();
        const p = points[i]!;
        let bestScore = -Infinity;
        let bestTurn = 0;
        for (const turn of TURNS) {
            direction.copy(tangent);
            turnAbout(direction, turn);
            let score = 0;
            let blocked = false;
            for (const [yaw, pitch] of [[0, -0.12], [0.3, -0.12], [-0.3, -0.12], [0, 0.1]] as const) {
                ray.copy(direction);
                turnAbout(ray, yaw);
                ray.y = pitch;
                ray.normalize();
                world.raycast(p.x, p.y, p.z, ray.x, -ray.y, -ray.z, 24 * SQUARE, HIT);
                if (HIT.triangle < 0) {
                    score += 0.3;
                    continue;
                }
                const depth = HIT.distance / SQUARE;
                if (depth < 1.2) blocked = true;
                score += 0.6 * Math.min(depth / 8, 1) + 0.4 * Math.min(world.brightness[HIT.triangle]! * (1 - fogAt(fog, depth)) / 0.5, 1);
            }
            score = score / 4 - (blocked ? 0.4 : 0) - 0.08 * Math.abs(turn);
            if (score > bestScore) {
                bestScore = score;
                bestTurn = turn;
            }
        }
        best.push(bestTurn);
    }
    for (let i = 1; i < last; i++) if (Number.isNaN(best[i])) best[i] = (best[i - 1]! + best[i + 1]!) / 2;
    // Spread each turn over a few squares either side, twice, for a slow, even swing.
    const spacing = pathLength(points) / Math.max(last, 1);
    const reach = Math.max(1, Math.round(TURN_SPREAD / Math.max(spacing, 1)));
    let smooth = best;
    for (let pass = 0; pass < 2; pass++) {
        smooth = smooth.map((_, i) => {
            let sum = 0;
            let n = 0;
            for (let k = Math.max(0, i - reach); k <= Math.min(last, i + reach); k++) {
                sum += smooth[k]!;
                n++;
            }
            return sum / n;
        });
    }
    return smooth.map((turn) => Math.round(turn * 1000) / 1000);
}

/** A path as a route, in whole units of the level as it is stored (stored.ts), so what is checked is what ships. */
function toRoute(points: Point[], rooms: number[], look: number[] | null = null): RouteData {
    return {
        kind: 'generated',
        look,
        points: points.flatMap((p) => [Math.round(p.x) * UNIT, -Math.round(p.y) * UNIT, -Math.round(p.z) * UNIT]),
        targets: null,
        fov: null,
        roll: null,
        speeds: null,
        holds: null,
        rooms,
    };
}

/** The flown curve, sampled: its stretches with room all round at least `least` long, as distances along it, and its length. */
function roomyStretches(world: World, points: Point[], least: number): { from: number; to: number; length: number }[] {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)), false, 'centripetal');
    curve.arcLengthDivisions = points.length * 12;
    const length = curve.getLength();
    const at = new THREE.Vector3();
    const step = 96;
    const stretches: { from: number; to: number; length: number }[] = [];
    let runStart = 0;
    for (let d = 0; d <= length; d += step) {
        curve.getPointAt(d / length, at);
        if (world.clearance(at.x, at.y, at.z, FLOWN_CLEARANCE) >= FLOWN_CLEARANCE) continue;
        if (d - step - runStart >= least) stretches.push({ from: runStart, to: d - step, length });
        runStart = d + step;
    }
    if (length - runStart >= least) stretches.push({ from: runStart, to: length, length });
    return stretches;
}

/** The part of a path between two distances along it. */
function cut(points: Point[], from: number, to: number): Point[] {
    const out: Point[] = [];
    let travelled = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const leg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const lerp = (d: number) => {
            const t = leg > 0 ? (d - travelled) / leg : 0;
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
        };
        if (travelled + leg >= from && travelled <= to) {
            if (out.length === 0) out.push(lerp(Math.max(from, travelled)));
            if (travelled + leg <= to) out.push({ ...b });
            else {
                out.push(lerp(to));
                break;
            }
        }
        travelled += leg;
    }
    return out;
}

function pathLength(points: Point[]): number {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y, points[i]!.z - points[i - 1]!.z);
    return length;
}

/**
 * The runs of frames with nothing wrong that keep at least `least` frames,
 * as indices, each less the dull views at its ends, so a route starts and
 * ends on something worth seeing.
 */
function goodRuns(frames: FrameCheck[], least: number): [number, number][] {
    const runs: [number, number][] = [];
    let start = -1;
    for (let i = 0; i <= frames.length; i++) {
        const ok = i < frames.length && frames[i]!.fault === null;
        if (ok && start < 0) start = i;
        if (!ok && start >= 0) {
            if (i - start >= least) runs.push([start, i - 1]);
            start = -1;
        }
    }
    for (const run of runs) {
        let mean = 0;
        for (let i = run[0]; i <= run[1]; i++) mean += frames[i]!.score / (run[1] - run[0] + 1);
        const dull = mean * 0.8;
        while (run[1] - run[0] + 1 > least) {
            if (frames[run[0]]!.score < dull && frames[run[0]]!.score <= frames[run[1]]!.score) run[0]++;
            else if (frames[run[1]]!.score < dull) run[1]--;
            else break;
        }
    }
    return runs;
}

/** Counts kept while planning a level, for tuning. */
let STATS: Record<string, number> = {};
function count(what: string, by = 1): void {
    STATS[what] = (STATS[what] ?? 0) + by;
}

const MIN_SECONDS = 24;
const SHORT_SECONDS = 18;

/**
 * Flies a candidate path and cuts it down to its stretches that are roomy
 * and show nothing wrong, each long enough to keep. Returns those routes
 * with their scores.
 */
function finish(
    world: World,
    path: Point[],
    rooms: number[],
    fog: Fog,
    sky: boolean,
    shortest: number,
    visibility: readonly RoomVisibility[],
    depth = 0,
): PlannedRoute[] {
    const points = path;
    const least = shortest * BASE_SPEED * SQUARE * 0.8;
    if (depth > 4 || points.length < 3 || pathLength(points) < least) {
        count(`finish:short${Math.min(depth, 4)}`);
        return [];
    }
    const stretches = roomyStretches(world, points, least);
    if (stretches.length === 0) {
        count('finish:cramped');
        return [];
    }
    const whole = stretches[0]!;
    if (stretches.length > 1 || whole.from > 0 || whole.to < whole.length) {
        const scale = pathLength(points) / whole.length;
        return stretches.flatMap((s) => finish(world, thin(cut(points, s.from * scale, s.to * scale), 160), rooms, fog, sky, shortest, visibility, depth + 1));
    }
    const route = toRoute(points, rooms, lookOffsets(world, points, fog));
    const frames = checkFrames(route, world, fog, sky, visibility);
    const player = createPlayer(route, BASE_SPEED);
    const duration = player.duration;
    const runs = goodRuns(frames, Math.ceil(shortest / FRAME_INTERVAL));
    if (runs.length === 0) {
        count('finish:faults');
        return [];
    }
    if (runs.length === 1 && runs[0]![0] === 0 && runs[0]![1] === frames.length - 1) {
        if (duration < shortest) return [];
        const mean = frames.reduce((sum, f) => sum + f.score, 0) / Math.max(frames.length, 1);
        return [{ route, score: mean * (0.85 + 0.15 * Math.min(duration / 45, 1)), duration }];
    }
    // Keep each good stretch: from just before its first good view to just
    // after its last.
    const scale = pathLength(points) / player.length!;
    return runs.flatMap(([first, last]) => {
        const t0 = first === 0 ? 0 : frames[first]!.time - FRAME_INTERVAL / 2;
        const t1 = last === frames.length - 1 ? duration : frames[last]!.time + FRAME_INTERVAL / 2;
        if (t1 - t0 < shortest) return [];
        const part = thin(cut(points, player.distanceAt!(t0) * scale, player.distanceAt!(t1) * scale), 160);
        return finish(world, part, rooms, fog, sky, shortest, visibility, depth + 1);
    });
}

/** How much of one route's ground another covers, 0–1. */
function overlap(a: Set<number>, b: Set<number>): number {
    let shared = 0;
    for (const cell of a) if (b.has(cell)) shared++;
    return shared / Math.max(1, Math.min(a.size, b.size));
}

function cellsOf(route: RouteData): Set<number> {
    const cells = new Set<number>();
    for (let i = 0; i + 2 < route.points.length; i += 3) {
        cells.add(cellKey(route.points[i]! * SQUARE, -route.points[i + 2]! * SQUARE));
    }
    return cells;
}

export interface LevelPlan {
    routes: PlannedRoute[];
    /** Some of the tours turned down, untrimmed, for looking into why. */
    rejected: RouteData[];
    /** What went into the plan and what was turned down, for tuning. */
    stats: Record<string, number>;
    /** How long planning took, in milliseconds, by step. */
    timing: Record<string, number>;
}

export function planRoutes(level: Level, options: PlanOptions = {}): LevelPlan {
    const random = options.random ?? Math.random;
    const attempts = options.attempts ?? 60;
    const keep = options.keep ?? 6;
    const timing: Record<string, number> = {};
    let clock = performance.now();
    const lap = (name: string) => {
        const now = performance.now();
        timing[name] = Math.round(now - clock);
        clock = now;
    };

    STATS = {};
    const world = buildWorld(level, options.sky);
    const sky = world.hasSky;
    const fog = fogFor(sky);
    const visibility = roomVisibility(level);
    lap('world');
    const area = new PlayArea(level);
    lap('reach');
    const spots = cameraSpots(area, world, level.rooms);
    lap('spots');
    for (const spot of spots) {
        spot.view = spotView(world, spot, fog, sky);
        // Over a steep slope the view is mostly the slope: pass, but don't linger.
        if (spot.steep && spot.view > 0) spot.view *= 0.35;
    }
    count('spots:steep', spots.filter((s) => s.steep).length);
    lap('views');

    const connected = spots.map((_, i) => i).filter((i) => spots[i]!.edges.length > 0 && spots[i]!.view >= 0);
    count('spots', spots.length);
    count('spots:connected', connected.length);
    // Groups of spots joined by steps: a tour stays within one.
    const sizes: number[] = [];
    for (const [s, first] of spots.entries()) {
        if (first.group !== -1 || first.view < 0) continue;
        const members = [s];
        first.group = sizes.length;
        for (let k = 0; k < members.length; k++) {
            for (const e of spots[members[k]!]!.edges) {
                const next = spots[e]!;
                if (next.group !== -1 || next.view < 0) continue;
                next.group = sizes.length;
                members.push(e);
            }
        }
        sizes.push(members.length);
    }
    for (const spot of spots) spot.groupSize = spot.group < 0 ? 0 : sizes[spot.group]!;
    count('groups', sizes.length);
    [...sizes].sort((a, b) => b - a).slice(0, 4).forEach((size, i) => count(`group${i}`, size));
    const views = connected.map((i) => spots[i]!.view).sort((a, b) => a - b);
    const cutoff = views[Math.floor(views.length * 0.7)] ?? 0;
    const good = connected.filter((i) => spots[i]!.view >= cutoff);

    const rejected: RouteData[] = [];
    const candidates: PlannedRoute[] = [];
    const covered = new Set<number>();
    const toursStarted = performance.now();
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (options.budget !== undefined && performance.now() - toursStarted > options.budget && candidates.length >= keep) break;
        if (options.budget !== undefined && performance.now() - toursStarted > options.budget * 2) break;
        const way = tour(spots, good, covered, random);
        if (way === null) {
            count('tour:none');
            continue;
        }
        const points = way.map((i) => ({ x: spots[i]!.x, y: spots[i]!.y, z: spots[i]!.z }));
        const path = thin(smooth(world, subdivide(pullTaut(world, points), 320), 30), 160);
        const rooms = [...new Set(way.map((i) => spots[i]!.room))];
        const planned = finish(world, path, rooms, fog, sky, SHORT_SECONDS, visibility);
        if (planned.length === 0 && rejected.length < 8) rejected.push(toRoute(path, rooms));
        for (const route of planned) {
            candidates.push(route);
            for (const cell of cellsOf(route.route)) covered.add(cell);
        }
        count(planned.length === 0 ? 'tour:rejected' : 'tour:kept');
    }
    lap('tours');

    // TR4's own paths, where they hold up.
    for (const scripted of scriptedRoutes(level)) {
        const route: RouteData = {
            kind: 'scripted',
            points: scripted.points.flatMap((p) => [p.x, p.y, p.z]),
            targets: scripted.targets?.flatMap((p) => [p.x, p.y, p.z]) ?? null,
            fov: scripted.fov,
            roll: scripted.roll,
            speeds: scripted.speeds,
            holds: scripted.holds,
            rooms: scripted.rooms,
        };
        const player = createPlayer(route, BASE_SPEED);
        if (player.duration < 10) {
            count('scripted:short');
            continue;
        }
        // Some sequences are cut-scenes that whip the camera round; a
        // background keeps to the calm ones.
        const pan = panSpeed(route);
        if (pan.typical > CALM_PAN || pan.most > CALM_PAN * 2.2) {
            count('scripted:whip');
            continue;
        }
        const frames = checkFrames(route, world, fog, sky, visibility);
        const faults = frames.filter((f) => f.fault !== null).length;
        if (faults > frames.length * 0.04) {
            count('scripted:faults');
            continue;
        }
        // The camera itself must not pass through anything solid.
        const position = new THREE.Vector3();
        const target = new THREE.Vector3();
        let tight = false;
        for (let time = 0; time <= player.duration && !tight; time += 1 / 15) {
            player.sample(time, position, target);
            tight = world.clearance(position.x * SQUARE, -position.y * SQUARE, -position.z * SQUARE, 120) < 120;
        }
        if (tight) {
            count('scripted:tight');
            continue;
        }
        const mean = frames.reduce((sum, f) => sum + f.score, 0) / Math.max(frames.length, 1);
        // The game's own paths were made to show the level: they rank a little higher.
        count('scripted:kept');
        candidates.push({ route, score: mean * 1.1, duration: player.duration });
    }
    lap('scripted');

    // The best routes, each showing a different part of the level: picked
    // one at a time, each candidate's score discounted by how much of it the
    // routes picked so far already show. Long ones first when there are
    // enough of them.
    candidates.sort((a, b) => b.score - a.score);
    // Only routes nearly as good as the level's best: levels differ in how
    // much they have to show, so the bar is the level's own.
    const bar = (candidates[0]?.score ?? 0) * 0.8;
    const chosen: PlannedRoute[] = [];
    const shown: { cells: Set<number>; rooms: Set<number> }[] = [];
    for (const minimum of [MIN_SECONDS, SHORT_SECONDS]) {
        const pool = candidates
            .filter((c) => c.duration >= minimum && c.score >= bar && !chosen.includes(c))
            .map((c) => ({ c, cells: cellsOf(c.route), rooms: new Set(c.route.rooms) }));
        while (chosen.length < keep) {
            let best: (typeof pool)[number] | null = null;
            let bestValue = -Infinity;
            for (const entry of pool) {
                let cells = 0;
                let rooms = 0;
                for (const other of shown) {
                    cells = Math.max(cells, overlap(entry.cells, other.cells));
                    rooms = Math.max(rooms, overlap(entry.rooms, other.rooms));
                }
                if (cells > 0.4 || rooms > 0.6) continue;
                const value = entry.c.score * (1 - 0.6 * Math.max(cells, rooms));
                if (value > bestValue) {
                    best = entry;
                    bestValue = value;
                }
            }
            if (best === null) break;
            chosen.push(best.c);
            shown.push({ cells: best.cells, rooms: best.rooms });
            pool.splice(pool.indexOf(best), 1);
        }
        if (chosen.length >= Math.min(keep, 3)) break;
    }
    lap('choose');
    return Object.assign({ routes: chosen, timing, stats: STATS, rejected }, (options as { debugSpots?: boolean }).debugSpots ? { spots, candidates } : {});
}
