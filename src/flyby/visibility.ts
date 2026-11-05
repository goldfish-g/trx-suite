// Draws only the rooms the camera can see, as the original engines do: from
// the room the camera is in, through each doorway (portal) that faces it and
// shows on screen, narrowing the visible window at every doorway. Rooms
// behind walls never reach the GPU, which matters most on phones, where
// covering the same pixels many times is what costs.

import * as THREE from 'three';
import type { RoomVisibility } from './build/geometry';
import { WALL } from './level/types';

interface Rect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

const FULL: Rect = { x0: -1, y0: -1, x1: 1, y1: 1 };
const SQUARE = 1024;
const MAX_STEPS = 600;
/** Closer than this to a doorway's plane, in file units, the camera may be on either side of it. */
const NEAR_DOORWAY = 160;

function intersect(a: Rect, b: Rect): Rect | null {
    const rect = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
    return rect.x0 < rect.x1 && rect.y0 < rect.y1 ? rect : null;
}

function covers(outer: Rect, inner: Rect): boolean {
    return outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1;
}

function union(a: Rect, b: Rect): Rect {
    return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export class RoomCuller {
    private readonly rooms = new Map<number, RoomVisibility>();
    private current: number | null = null;
    private readonly clip = new THREE.Vector4();
    private readonly viewProjection = new THREE.Matrix4();

    constructor(rooms: readonly RoomVisibility[]) {
        for (const room of rooms) this.rooms.set(room.index, room);
    }

    private contains(room: RoomVisibility, x: number, y: number, z: number): boolean {
        const i = Math.floor((x - room.x) / SQUARE);
        const j = Math.floor((z - room.z) / SQUARE);
        // A room's outer ring of squares is its neighbours' ground (or wall), so
        // only the inner squares say the camera is in this room.
        if (i < 1 || j < 1 || i >= room.sectorsX - 1 || j >= room.sectorsZ - 1) return false;
        const k = i * room.sectorsZ + j;
        const floor = room.floors[k]!;
        const ceiling = room.ceilings[k]!;
        if (floor === WALL) return false;
        return y >= ceiling - 64 && y <= floor + 64;
    }

    /** The room holding a point in file units, sticking with the last one while it still does. */
    roomAt(x: number, y: number, z: number): number | null {
        const last = this.current === null ? undefined : this.rooms.get(this.current);
        if (last !== undefined && this.contains(last, x, y, z)) return this.current;
        for (const room of this.rooms.values()) {
            if (this.contains(room, x, y, z)) {
                this.current = room.index;
                return room.index;
            }
        }
        return this.current;
    }

    /** The screen rectangle a doorway covers, or null when it is off screen. */
    private project(corners: number[]): Rect | null {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        let behind = 0;
        for (let i = 0; i < corners.length; i += 3) {
            this.clip.set(corners[i]! / SQUARE, -corners[i + 1]! / SQUARE, -corners[i + 2]! / SQUARE, 1).applyMatrix4(this.viewProjection);
            if (this.clip.w <= 1e-3) {
                behind++;
                continue;
            }
            const x = this.clip.x / this.clip.w;
            const y = this.clip.y / this.clip.w;
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
        }
        if (behind === 4) return null;
        // A doorway the camera stands in or beside: assume it shows everything.
        if (behind > 0) return FULL;
        return intersect({ x0, y0, x1, y1 }, FULL);
    }

    /** The rooms to draw, or null to draw them all when the camera is in none. */
    visibleRooms(camera: THREE.PerspectiveCamera): Set<number> | null {
        const x = camera.position.x * SQUARE;
        const y = -camera.position.y * SQUARE;
        const z = -camera.position.z * SQUARE;
        const start = this.roomAt(x, y, z);
        if (start === null) return null;
        this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

        const windows = new Map<number, Rect>([[start, FULL]]);
        const queue = [start];
        for (let steps = 0; queue.length > 0 && steps < MAX_STEPS; steps++) {
            const index = queue.shift()!;
            const room = this.rooms.get(index);
            const window = windows.get(index);
            if (room === undefined || window === undefined) continue;
            for (const portal of room.portals) {
                const [nx, ny, nz] = portal.normal;
                const c = portal.corners;
                // The doorway faces into this room; seen from behind, it hides its room.
                // The normal is a unit axis in the files, so this is a distance.
                const side = ((x - c[0]!) * nx + (y - c[1]!) * ny + (z - c[2]!) * nz) / (Math.hypot(nx, ny, nz) || 1);
                if (side < -NEAR_DOORWAY) continue;
                // Passing through a doorway: the room beyond fills the view.
                const projected = side < NEAR_DOORWAY ? FULL : this.project(c);
                if (projected === null) continue;
                const seen = intersect(window, projected);
                if (seen === null) continue;
                const known = windows.get(portal.toRoom);
                if (known !== undefined && covers(known, seen)) continue;
                windows.set(portal.toRoom, known === undefined ? seen : union(known, seen));
                queue.push(portal.toRoom);
            }
        }
        return new Set(windows.keys());
    }
}
