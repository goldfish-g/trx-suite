// Where Lara can go: the squares she can walk, climb, jump, swim or drop to
// from where the level starts her. The flyby keeps to the space over them,
// which is the space the level's makers built to be seen; past it are
// rooftops, the outsides of rooms and scenery meant only for a distance.

import type { Level, Room, Sector } from '../../../shared/level/types.ts';
import { ROOM_WATER, WALL } from '../../../shared/level/types.ts';
import { flippedRooms } from '../build/geometry';

const SQUARE = 1024;
const NO_ROOM = 255;
/** Clicks of slope across a square from which Lara slides. */
const STEEP = 3;
/** TR3's floor (not ceiling) split-square functions. */
const FLOOR_SPLITS = new Set([7, 8, 11, 12, 13, 14]);
/** The highest ledge Lara pulls herself onto: seven clicks. */
const CLIMB = 1792;
/** The deepest drop she walks off. */
const DROP = 6144;
/** How far above the water she climbs out. */
const OUT_OF_WATER = 1280;
/** How high a climbable wall may take her. */
const LADDER = 12288;
/** Objects that make a floor where there is none: bridges, trapdoors, drawbridges. */
const PLATFORMS: Record<number, readonly number[]> = {
    1: [41, 65, 66, 67, 68, 69, 70],
    2: [63, 114, 115, 116, 117, 118, 119],
    3: [93, 139, 140, 141, 142, 143, 144],
    4: [122, 123, 124, 125, 126, 336, 337, 338],
};

/**
 * Trigger types Lara sets off by being there: stepping on, pads, switches,
 * keys, pickups, antipads, combat, dummies, antitriggers, and TR3's monkey,
 * skeleton, tightrope, crawl and climb triggers. Not the ones for pushed
 * blocks (5, 10, 11).
 */
const LARA_TRIGGERS = new Set([0, 1, 2, 3, 4, 6, 7, 8, 9, 12, 13, 14, 15, 16]);

/** A square of a room. */
export interface Spot {
    room: number;
    i: number;
    j: number;
}

export function spotKey(room: number, i: number, j: number): number {
    return room * 65536 + i * 256 + j;
}

interface SquareInfo {
    /** The room a wall portal on the square leads to, or -1. */
    portal: number;
    /** Climbable walls beside the square: 1 +z, 2 +x, 4 −z, 8 −x. */
    climb: number;
    /** Lava or another deadly floor. */
    deadly: boolean;
    /** A floor too steep to stand on: Lara slides off it. */
    steep: boolean;
    /** What sets off the square's trigger (0 stepping on it, 2 a switch, 5 a pushed block...), or -1. */
    trigger: number;
}

/** Reads a square's floor data: its portal, climbable walls and whether it kills. */
export function squareInfo(level: Level, sector: Sector): SquareInfo {
    const info: SquareInfo = { portal: -1, climb: 0, deadly: false, steep: false, trigger: -1 };
    const data = level.floorData;
    let k = sector.floorData;
    if (k <= 0 || k >= data.length) return info;
    for (let guard = 0; guard < 64 && k < data.length; guard++) {
        const word = data[k++]!;
        const fn = word & 0x1f;
        if (fn === 1) info.portal = data[k++]! & 0x3ff;
        else if (fn === 2) {
            // Floor slant: clicks of rise across the square, along x and z.
            const slant = data[k++]!;
            const sx = ((slant & 0xff) << 24) >> 24;
            const sz = (slant << 16) >> 24;
            if (Math.max(Math.abs(sx), Math.abs(sz)) >= STEEP) info.steep = true;
        } else if (fn === 3) k++;
        else if (fn === 4) {
            info.trigger = (word >> 8) & 0x7f;
            k++; // trigger setup
            for (let actions = 0; actions < 64 && k < data.length; actions++) {
                const action = data[k++]!;
                const type = (action >> 10) & 0x1f;
                // Cameras (and TR4 flybys) take one more word, which carries the end bit.
                if (type === 1 || (level.engine === 4 && type === 12)) {
                    const extra = data[k++] ?? 0x8000;
                    if (extra & 0x8000) break;
                } else if (action & 0x8000) break;
            }
        } else if (fn === 5) info.deadly = true;
        else if (fn === 6 && level.engine >= 2) info.climb = (word >> 8) & 0x0f;
        else if (fn >= 7 && fn <= 18 && level.engine >= 3) {
            // TR3's split squares: four corner heights, in clicks.
            const corners = data[k++]!;
            if (FLOOR_SPLITS.has(fn)) {
                const heights = [corners & 15, (corners >> 4) & 15, (corners >> 8) & 15, (corners >> 12) & 15];
                if (Math.max(...heights) - Math.min(...heights) >= STEEP) info.steep = true;
            }
        }
        if (word & 0x8000) break;
    }
    return info;
}

export class PlayArea {
    /** Squares Lara can stand on or swim in, by spotKey. */
    readonly reachable = new Set<number>();
    /** How each square was reached, for debugging: the square before and the move. */
    readonly parents = new Map<number, [number, string]>();
    private readonly rooms: Room[];
    private readonly flipped: Set<number>;
    private readonly infos = new Map<Sector, SquareInfo>();
    /** Heights of bridges and trapdoors on squares, by spotKey. */
    private readonly platforms = new Map<number, number>();

    private readonly level: Level;

    constructor(level: Level) {
        this.level = level;
        this.rooms = level.rooms;
        this.flipped = flippedRooms(level);
        const platformIds = new Set(PLATFORMS[level.engine] ?? []);
        for (const item of level.items) {
            if (!platformIds.has(item.objectId)) continue;
            const spot = this.resolve(item.room, item.x, item.z);
            if (spot === null) continue;
            const key = spotKey(spot.room, spot.i, spot.j);
            this.platforms.set(key, Math.min(this.platforms.get(key) ?? Infinity, item.y));
        }
        this.flood();
    }

    info(sector: Sector): SquareInfo {
        let info = this.infos.get(sector);
        if (info === undefined) {
            info = squareInfo(this.level, sector);
            this.infos.set(sector, info);
        }
        return info;
    }

    sector(spot: Spot): Sector {
        const room = this.rooms[spot.room]!;
        return room.sectors[spot.i * room.sectorsZ + spot.j]!;
    }

    isWater(room: number): boolean {
        return ((this.rooms[room]?.flags ?? 0) & ROOM_WATER) !== 0;
    }

    /** The square at a spot, starting from a room and passing wall portals as the games do. */
    resolve(start: number, x: number, z: number): Spot | null {
        let room = start;
        for (let hops = 0; hops < 6; hops++) {
            const r = this.rooms[room];
            if (r === undefined || this.flipped.has(room)) return null;
            const i = Math.floor((x - r.x) / SQUARE);
            const j = Math.floor((z - r.z) / SQUARE);
            if (i < 0 || j < 0 || i >= r.sectorsX || j >= r.sectorsZ) return null;
            const sector = r.sectors[i * r.sectorsZ + j]!;
            const portal = this.info(sector).portal;
            if (portal >= 0 && portal !== room && portal < this.rooms.length) {
                room = portal;
                continue;
            }
            return { room, i, j };
        }
        return null;
    }

    /** The square at the same spot in the room above or below, through a floor or ceiling portal. */
    private vertical(spot: Spot, up: boolean): Spot | null {
        const next = up ? this.sector(spot).roomAbove : this.sector(spot).roomBelow;
        if (next === NO_ROOM || next >= this.rooms.length) return null;
        const { x, z } = this.centre(spot);
        return this.resolve(next, x, z);
    }

    centre(spot: Spot): { x: number; z: number } {
        const room = this.rooms[spot.room]!;
        return { x: room.x + spot.i * SQUARE + SQUARE / 2, z: room.z + spot.j * SQUARE + SQUARE / 2 };
    }

    /** Where someone at a square ends up standing (or swimming): down through every floor portal. */
    ground(spot: Spot): Spot {
        let here = spot;
        for (let hops = 0; hops < 16; hops++) {
            if (this.isWater(here.room)) return here;
            const below = this.vertical(here, false);
            if (below === null) return here;
            here = below;
        }
        return here;
    }

    /**
     * The height a square stands at: its floor or the bridge on it; for
     * water, the surface.
     */
    standHeight(spot: Spot): number {
        if (this.isWater(spot.room)) {
            // The surface is the top of the water's room stack.
            let here = spot;
            for (let hops = 0; hops < 16; hops++) {
                const above = this.vertical(here, true);
                if (above === null || !this.isWater(above.room)) return this.rooms[here.room]!.yTop;
                here = above;
            }
            return this.rooms[here.room]!.yTop;
        }
        const floor = this.sector(spot).floor;
        const platform = this.platforms.get(spotKey(spot.room, spot.i, spot.j));
        return platform !== undefined && platform < floor ? platform : floor;
    }

    /** The real ceiling over a square: up through every ceiling portal. */
    ceiling(spot: Spot): number {
        let here = spot;
        for (let hops = 0; hops < 16; hops++) {
            const above = this.vertical(here, true);
            if (above === null) return this.sector(here).ceiling;
            here = above;
        }
        return this.sector(here).ceiling;
    }

    /** Whether a square is part of the level as it starts: not in a room that only shows once the level flips. */
    known(spot: Spot): boolean {
        return !this.flipped.has(spot.room);
    }

    /** Whether a square is solid rock: a wall all the way up. */
    solid(spot: Spot): boolean {
        const sector = this.sector(spot);
        return sector.floor === WALL || sector.ceiling === WALL;
    }

    /** Whether Lara can stand on a square: not a wall, a deadly floor or a slope she slides off. */
    open(spot: Spot): boolean {
        if (this.solid(spot)) return false;
        const info = this.info(this.sector(spot));
        return !info.deadly && !info.steep;
    }

    /** The ground beside a square, a few squares along one way, or null past a wall. */
    private beside(from: Spot, dx: number, dz: number, distance: number): Spot | null {
        const { x, z } = this.centre(from);
        const spot = this.resolve(from.room, x + dx * SQUARE * distance, z + dz * SQUARE * distance);
        if (spot === null) return null;
        if (!this.solid(spot)) return this.ground(spot);
        // A wall here may be a ledge whose top is in the room above.
        let above: Spot | null = from;
        for (let hops = 0; hops < 3 && above !== null; hops++) {
            above = this.vertical(above, true);
            if (above === null) break;
            const c = this.centre(above);
            const spotAbove = this.resolve(above.room, c.x + dx * SQUARE * distance, c.z + dz * SQUARE * distance);
            if (spotAbove !== null && !this.solid(spotAbove)) return this.ground(spotAbove);
        }
        return null;
    }

    /**
     * Where the flood starts: Lara, and every square with a trigger she sets
     * off herself, since the level's makers put those where she goes. A
     * flood from Lara alone stops at every pushed block, rope, pole and
     * vehicle the rules here don't know.
     */
    private seeds(): Spot[] {
        const seeds: Spot[] = [];
        const lara = this.level.items.find((item) => item.objectId === 0);
        const start = lara === undefined ? null : this.resolve(lara.room, lara.x, lara.z);
        if (start !== null) seeds.push(this.ground(start));
        for (const room of this.rooms) {
            if (this.flipped.has(room.index)) continue;
            for (let i = 1; i < room.sectorsX - 1; i++) {
                for (let j = 1; j < room.sectorsZ - 1; j++) {
                    const spot = { room: room.index, i, j };
                    const sector = this.sector(spot);
                    if (sector.roomBelow !== NO_ROOM || !this.open(spot)) continue;
                    if (LARA_TRIGGERS.has(this.info(sector).trigger)) seeds.push(spot);
                }
            }
        }
        return seeds;
    }

    private flood(): void {
        const queue: Spot[] = [];
        let from = -1;
        let how = 'seed';
        const visit = (spot: Spot) => {
            const key = spotKey(spot.room, spot.i, spot.j);
            if (this.reachable.has(key)) return;
            this.reachable.add(key);
            this.parents.set(key, [from, how]);
            queue.push(spot);
        };
        for (const seed of this.seeds()) visit(seed);
        const DIRECTIONS = [
            [0, 1, 1],
            [1, 0, 2],
            [0, -1, 4],
            [-1, 0, 8],
        ] as const;
        while (queue.length > 0) {
            const here = queue.pop()!;
            from = spotKey(here.room, here.i, here.j);
            if (!this.open(here) && !this.isWater(here.room)) continue;
            const swimming = this.isWater(here.room);
            const height = this.standHeight(here);
            const climb = swimming ? 0 : this.info(this.sector(here)).climb;
            for (const [dx, dz, wall] of DIRECTIONS) {
                const next = this.beside(here, dx, dz, 1);
                if (next !== null && (this.open(next) || this.isWater(next.room))) {
                    const nextWater = this.isWater(next.room);
                    const rise = height - this.standHeight(next);
                    let ok: boolean;
                    if (nextWater) ok = swimming || rise <= CLIMB;
                    else if (swimming) ok = rise <= OUT_OF_WATER;
                    else ok = (rise <= CLIMB && -rise <= DROP) || ((climb & wall) !== 0 && rise <= LADDER);
                    how = 'step';
                    if (ok) visit(next);
                }
                // Running jumps over gaps two or three squares wide.
                if (swimming) continue;
                for (let distance = 2; distance <= 3; distance++) {
                    const gap = this.beside(here, dx, dz, distance - 1);
                    if (gap === null) break;
                    const gapLower = this.isWater(gap.room) || !this.open(gap) || this.standHeight(gap) > height + 256;
                    if (!gapLower) break;
                    const landing = this.beside(here, dx, dz, distance);
                    if (landing === null || !this.open(landing) || this.isWater(landing.room)) continue;
                    const rise = height - this.standHeight(landing);
                    how = 'jump';
                    if (rise <= 512 && -rise <= 2048) visit(landing);
                }
            }
            // Ladders up through a ceiling opening.
            if (climb !== 0) {
                let above: Spot | null = here;
                for (let hops = 0; hops < 3; hops++) {
                    above = above === null ? null : this.vertical(above, true);
                    if (above === null) break;
                    for (const [dx, dz, wall] of DIRECTIONS) {
                        if ((climb & wall) === 0) continue;
                        const c = this.centre(above);
                        const ledge = this.resolve(above.room, c.x + dx * SQUARE, c.z + dz * SQUARE);
                        how = 'ladder';
                        if (ledge !== null && this.open(ledge)) visit(this.ground(ledge));
                    }
                }
            }
        }
    }
}
