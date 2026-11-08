// The level as the camera meets it: every triangle that is drawn (rooms,
// static meshes and objects), in the file's own units, sorted into a
// bounding volume hierarchy so the route planner can ask how far a spot is
// from anything solid and what a line of sight reaches.
//
// The camera may pass only what a player would accept passing: see-through
// faces (windows, grilles, foliage cut-outs, glows), doors and smashable
// windows. Everything else is solid.

import { Matrix4, Vector3 } from 'three';
import { poseMoveable } from '../../../shared/level/pose.ts';
import type { Face, Level, Mesh, Room } from '../../../shared/level/types.ts';
import { flippedRooms } from '../build/geometry';

/** The camera may not pass the triangle. */
export const SOLID = 1;
/** The triangle hides what is behind it. */
export const OPAQUE = 2;
/** The triangle shows from both sides. */
export const DOUBLE_SIDED = 4;
/** The triangle belongs to a static mesh or an object, not to a room. */
export const DETAIL = 8;

const LARA = 0;
/** Objects drawn around the camera instead of in the level. */
const SKYBOX: Record<number, number> = { 1: 184, 2: 254, 3: 355, 4: 459 };
/** Doors and smashable windows, which the camera may fly through. */
const PASSABLE: Record<number, readonly number[]> = {
    1: range(57, 64),
    2: [...range(106, 113), ...range(72, 75)],
    3: [...range(131, 138), ...range(101, 104)],
    4: [...range(322, 335), 340, 347, ...range(409, 412)],
};

function range(from: number, to: number): number[] {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export interface RayHit {
    /** Distance to what the ray shows, or Infinity when it shows nothing (sky or void). */
    distance: number;
    /** The triangle hit, or -1. */
    triangle: number;
    /** Whether the ray passed the back of an opaque face first: a hole in the level. */
    leak: boolean;
    /** Distance to the nearest see-through face (grille, window, leaves) before that, or Infinity. */
    screen: number;
}

export class World {
    /** Three corners per triangle, nine numbers, file units. */
    readonly corners: Float32Array;
    /** Unit normal of each triangle's visible side. */
    readonly normals: Float32Array;
    readonly flags: Uint8Array;
    /** How bright each triangle looks: light times its texture's brightness, 0–2. */
    readonly brightness: Float32Array;
    /** The texture of each triangle, to tell plain walls from varied ones. */
    readonly textures: Int32Array;
    readonly count: number;
    /** Whether the level draws a sky where nothing else is. */
    readonly hasSky: boolean;
    /** What each triangle belongs to: a room's index, or 100000 + a static's id, or 200000 + an object's id. */
    readonly owners: Int32Array;
    /** The room each triangle is drawn with: the background draws only rooms seen through doorways. */
    readonly rooms: Int32Array;
    /** The back face the last ray met before what it shows, or -1: for finding holes. */
    lastBack = -1;

    private readonly nodeMin: Float32Array;
    private readonly nodeMax: Float32Array;
    /** Leaves: first index into `order`, negated minus one; inner nodes: the right child (the left is next). */
    private readonly nodeData: Int32Array;
    private readonly nodeCount: Int32Array;
    private readonly order: Int32Array;

    constructor(triangles: TriangleList, hasSky: boolean) {
        this.count = triangles.flags.length;
        this.corners = Float32Array.from(triangles.corners);
        this.flags = Uint8Array.from(triangles.flags);
        this.brightness = Float32Array.from(triangles.brightness);
        this.textures = Int32Array.from(triangles.textures);
        this.owners = Int32Array.from(triangles.owners);
        this.rooms = Int32Array.from(triangles.rooms);
        this.hasSky = hasSky;
        this.normals = new Float32Array(this.count * 3);
        const c = this.corners;
        for (let t = 0; t < this.count; t++) {
            const o = t * 9;
            const ux = c[o + 3]! - c[o]!;
            const uy = c[o + 4]! - c[o + 1]!;
            const uz = c[o + 5]! - c[o + 2]!;
            const vx = c[o + 6]! - c[o]!;
            const vy = c[o + 7]! - c[o + 1]!;
            const vz = c[o + 8]! - c[o + 2]!;
            // The files wind visible faces the other way round from the
            // cross product's sense, so the visible side is its opposite.
            let nx = -(uy * vz - uz * vy);
            let ny = -(uz * vx - ux * vz);
            let nz = -(ux * vy - uy * vx);
            const length = Math.hypot(nx, ny, nz) || 1;
            nx /= length;
            ny /= length;
            nz /= length;
            this.normals[t * 3] = nx;
            this.normals[t * 3 + 1] = ny;
            this.normals[t * 3 + 2] = nz;
        }
        const built = buildBvh(this.corners, this.count);
        this.nodeMin = built.min;
        this.nodeMax = built.max;
        this.nodeData = built.data;
        this.nodeCount = built.count;
        this.order = built.order;
    }

    /**
     * How far a spot is from the nearest triangle with any of `mask`'s flags,
     * looking no further than `limit`.
     */
    clearance(x: number, y: number, z: number, limit: number, mask = SOLID): number {
        let best = limit * limit;
        const stack = STACK;
        let top = 0;
        stack[top++] = 0;
        const min = this.nodeMin;
        const max = this.nodeMax;
        while (top > 0) {
            const node = stack[--top]!;
            const o = node * 3;
            const dx = Math.max(min[o]! - x, 0, x - max[o]!);
            const dy = Math.max(min[o + 1]! - y, 0, y - max[o + 1]!);
            const dz = Math.max(min[o + 2]! - z, 0, z - max[o + 2]!);
            if (dx * dx + dy * dy + dz * dz >= best) continue;
            const data = this.nodeData[node]!;
            if (data < 0) {
                const first = -data - 1;
                const end = first + this.nodeCount[node]!;
                for (let k = first; k < end; k++) {
                    const t = this.order[k]!;
                    if ((this.flags[t]! & mask) === 0) continue;
                    const d = pointTriangleDistanceSq(this.corners, t * 9, x, y, z);
                    if (d < best) best = d;
                }
            } else {
                stack[top++] = node + 1;
                stack[top++] = data;
            }
        }
        return Math.sqrt(best);
    }

    /**
     * What a line of sight from a spot shows: the nearest opaque face it
     * meets from the front, passing see-through faces. `direction` must be
     * a unit vector.
     */
    raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, limit: number, out: RayHit): RayHit {
        let bestT = limit;
        let bestTri = -1;
        let backT = Infinity;
        let screenT = Infinity;
        let backTri = -1;
        const ix = 1 / dx;
        const iy = 1 / dy;
        const iz = 1 / dz;
        const stack = STACK;
        let top = 0;
        stack[top++] = 0;
        const min = this.nodeMin;
        const max = this.nodeMax;
        const c = this.corners;
        while (top > 0) {
            const node = stack[--top]!;
            const o = node * 3;
            // Slab test against the node's box.
            let t0 = (min[o]! - ox) * ix;
            let t1 = (max[o]! - ox) * ix;
            let near = Math.min(t0, t1);
            let far = Math.max(t0, t1);
            t0 = (min[o + 1]! - oy) * iy;
            t1 = (max[o + 1]! - oy) * iy;
            near = Math.max(near, Math.min(t0, t1));
            far = Math.min(far, Math.max(t0, t1));
            t0 = (min[o + 2]! - oz) * iz;
            t1 = (max[o + 2]! - oz) * iz;
            near = Math.max(near, Math.min(t0, t1));
            far = Math.min(far, Math.max(t0, t1));
            if (!(far >= Math.max(near, 0)) || near > bestT) continue;
            const data = this.nodeData[node]!;
            if (data < 0) {
                const first = -data - 1;
                const end = first + this.nodeCount[node]!;
                for (let k = first; k < end; k++) {
                    const t = this.order[k]!;
                    const flags = this.flags[t]!;
                    const hit = rayTriangle(c, t * 9, ox, oy, oz, dx, dy, dz);
                    if (hit <= 0 || hit >= bestT) continue;
                    if ((flags & OPAQUE) === 0) {
                        if (hit < screenT) screenT = hit;
                        continue;
                    }
                    const facing = dx * this.normals[t * 3]! + dy * this.normals[t * 3 + 1]! + dz * this.normals[t * 3 + 2]!;
                    if (facing < 0 || (flags & DOUBLE_SIDED) !== 0) {
                        bestT = hit;
                        bestTri = t;
                    } else if (hit < backT && (flags & DETAIL) === 0) {
                        // Only a room seen from outside is a hole: objects' backs are hidden in the games too.
                        backT = hit;
                        backTri = t;
                    }
                }
            } else {
                stack[top++] = node + 1;
                stack[top++] = data;
            }
        }
        out.distance = bestTri < 0 ? Infinity : bestT;
        out.triangle = bestTri;
        out.leak = backT < bestT;
        this.lastBack = out.leak ? backTri : -1;
        out.screen = screenT < bestT ? screenT : Infinity;
        return out;
    }
}

const STACK = new Int32Array(256);

interface TriangleList {
    corners: number[];
    flags: number[];
    brightness: number[];
    textures: number[];
    owners: number[];
    rooms: number[];
}

function buildBvh(corners: Float32Array, count: number) {
    const centre = new Float32Array(count * 3);
    const boxMin = new Float32Array(count * 3);
    const boxMax = new Float32Array(count * 3);
    for (let t = 0; t < count; t++) {
        for (let a = 0; a < 3; a++) {
            const p = corners[t * 9 + a]!;
            const q = corners[t * 9 + 3 + a]!;
            const r = corners[t * 9 + 6 + a]!;
            boxMin[t * 3 + a] = Math.min(p, q, r);
            boxMax[t * 3 + a] = Math.max(p, q, r);
            centre[t * 3 + a] = (p + q + r) / 3;
        }
    }
    const order = new Int32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    const capacity = Math.max(1, count * 2);
    const min = new Float32Array(capacity * 3);
    const max = new Float32Array(capacity * 3);
    const data = new Int32Array(capacity);
    const nodeCount = new Int32Array(capacity);
    let nodes = 0;
    const LEAF = 4;

    const build = (first: number, end: number): number => {
        const node = nodes++;
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
        for (let k = first; k < end; k++) {
            const t = order[k]! * 3;
            x0 = Math.min(x0, boxMin[t]!);
            y0 = Math.min(y0, boxMin[t + 1]!);
            z0 = Math.min(z0, boxMin[t + 2]!);
            x1 = Math.max(x1, boxMax[t]!);
            y1 = Math.max(y1, boxMax[t + 1]!);
            z1 = Math.max(z1, boxMax[t + 2]!);
            cx0 = Math.min(cx0, centre[t]!);
            cy0 = Math.min(cy0, centre[t + 1]!);
            cz0 = Math.min(cz0, centre[t + 2]!);
            cx1 = Math.max(cx1, centre[t]!);
            cy1 = Math.max(cy1, centre[t + 1]!);
            cz1 = Math.max(cz1, centre[t + 2]!);
        }
        min[node * 3] = x0;
        min[node * 3 + 1] = y0;
        min[node * 3 + 2] = z0;
        max[node * 3] = x1;
        max[node * 3 + 1] = y1;
        max[node * 3 + 2] = z1;
        const spanX = cx1 - cx0;
        const spanY = cy1 - cy0;
        const spanZ = cz1 - cz0;
        const span = Math.max(spanX, spanY, spanZ);
        if (end - first <= LEAF || span <= 0) {
            data[node] = -first - 1;
            nodeCount[node] = end - first;
            return node;
        }
        const axis = span === spanX ? 0 : span === spanY ? 1 : 2;
        const split = (axis === 0 ? cx0 : axis === 1 ? cy0 : cz0) + span / 2;
        // Partition about the middle of the centres.
        let i = first;
        let j = end - 1;
        while (i <= j) {
            if (centre[order[i]! * 3 + axis]! < split) i++;
            else {
                const swap = order[i]!;
                order[i] = order[j]!;
                order[j] = swap;
                j--;
            }
        }
        let middle = i;
        if (middle === first || middle === end) middle = (first + end) >> 1;
        build(first, middle);
        data[node] = build(middle, end);
        return node;
    };
    if (count > 0) build(0, count);
    else {
        data[nodes] = -1;
        nodeCount[nodes] = 0;
        nodes++;
    }
    return { min, max, data, count: nodeCount, order };
}

/** Squared distance from a point to a triangle (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTriangleDistanceSq(c: Float32Array, o: number, px: number, py: number, pz: number): number {
    const ax = c[o]!, ay = c[o + 1]!, az = c[o + 2]!;
    const bx = c[o + 3]!, by = c[o + 4]!, bz = c[o + 5]!;
    const cx = c[o + 6]!, cy = c[o + 7]!, cz = c[o + 8]!;
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    let qx: number, qy: number, qz: number;
    if (d1 <= 0 && d2 <= 0) {
        qx = ax; qy = ay; qz = az;
    } else {
        const bpx = px - bx, bpy = py - by, bpz = pz - bz;
        const d3 = abx * bpx + aby * bpy + abz * bpz;
        const d4 = acx * bpx + acy * bpy + acz * bpz;
        if (d3 >= 0 && d4 <= d3) {
            qx = bx; qy = by; qz = bz;
        } else {
            const vc = d1 * d4 - d3 * d2;
            if (vc <= 0 && d1 >= 0 && d3 <= 0) {
                const v = d1 / (d1 - d3);
                qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v;
            } else {
                const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
                const d5 = abx * cpx + aby * cpy + abz * cpz;
                const d6 = acx * cpx + acy * cpy + acz * cpz;
                if (d6 >= 0 && d5 <= d6) {
                    qx = cx; qy = cy; qz = cz;
                } else {
                    const vb = d5 * d2 - d1 * d6;
                    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
                        const w = d2 / (d2 - d6);
                        qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w;
                    } else {
                        const va = d3 * d6 - d5 * d4;
                        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                            const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
                            qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w;
                        } else {
                            const denom = 1 / (va + vb + vc);
                            const v = vb * denom;
                            const w = vc * denom;
                            qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
                        }
                    }
                }
            }
        }
    }
    const ex = px - qx, ey = py - qy, ez = pz - qz;
    return ex * ex + ey * ey + ez * ez;
}

/** Where a ray meets a triangle, as a distance along it, or -1 (Möller–Trumbore, both sides). */
function rayTriangle(c: Float32Array, o: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const ax = c[o]!, ay = c[o + 1]!, az = c[o + 2]!;
    const e1x = c[o + 3]! - ax, e1y = c[o + 4]! - ay, e1z = c[o + 5]! - az;
    const e2x = c[o + 6]! - ax, e2y = c[o + 7]! - ay, e2z = c[o + 8]! - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-9 && det < 1e-9) return -1;
    const inv = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

// ---------------------------------------------------------------- building

interface TextureLook {
    /** Shows what is behind it in places: cut-outs or blending. */
    seeThrough: boolean;
    /** Average brightness of its texels, 0–1. */
    luminance: number;
}

/** How each object texture looks, from its texels. */
function textureLooks(level: Level): TextureLook[] {
    return level.objectTextures.map((texture) => {
        if (texture.attributes === 2) return { seeThrough: true, luminance: 0.5 };
        const base = texture.tile * 256 * 256 * 4;
        if (base >= level.tiles.length) return { seeThrough: false, luminance: 0.5 };
        // TR1–3 mark a triangle's texture with an empty fourth corner.
        const corners = texture.uv.length === 3 || (texture.uv[3]?.u === 0 && texture.uv[3]?.v === 0) ? texture.uv.slice(0, 3) : texture.uv;
        const triangles = corners.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
        let clear = 0;
        let total = 0;
        let light = 0;
        // Texels inside the texture's own shape, a little in from its edges:
        // the tile around it may be clear without the texture being so.
        const N = 10;
        for (const [a, b, c] of triangles) {
            const p = corners[a!]!;
            const q = corners[b!]!;
            const r = corners[c!]!;
            const cu = (p.u + q.u + r.u) / 3;
            const cv = (p.v + q.v + r.v) / 3;
            for (let i = 0; i <= N; i++) {
                for (let j = 0; j <= N - i; j++) {
                    const k = N - i - j;
                    const u = cu + ((i * p.u + j * q.u + k * r.u) / N - cu) * 0.85;
                    const v = cv + ((i * p.v + j * q.v + k * r.v) / N - cv) * 0.85;
                    const x = Math.min(255, Math.max(0, Math.floor(u)));
                    const y = Math.min(255, Math.max(0, Math.floor(v)));
                    const at = base + (y * 256 + x) * 4;
                    total++;
                    if (level.tiles[at + 3]! < 128) clear++;
                    else light += (0.3 * level.tiles[at]! + 0.59 * level.tiles[at + 1]! + 0.11 * level.tiles[at + 2]!) / 255;
                }
            }
        }
        const opaque = total - clear;
        // A face with see-through texels is a window, grille or leaf: rays
        // and the camera may pass.
        return { seeThrough: total > 0 && clear / total > 0.05, luminance: opaque > 0 ? light / opaque : 0.5 };
    });
}

function toFile(v: Vector3): [number, number, number] {
    return [v.x * 1024, -v.y * 1024, -v.z * 1024];
}

function yawMatrix(x: number, y: number, z: number, angle: number): Matrix4 {
    const rotation = new Matrix4().makeRotationY(-(angle / 65536) * Math.PI * 2);
    return new Matrix4().setPosition(x / 1024, -y / 1024, -z / 1024).multiply(rotation);
}

class Collector implements TriangleList {
    corners: number[] = [];
    flags: number[] = [];
    brightness: number[] = [];
    textures: number[] = [];
    owners: number[] = [];
    rooms: number[] = [];
    owner = 0;
    room = 0;

    private readonly looks: TextureLook[];

    constructor(looks: TextureLook[]) {
        this.looks = looks;
    }

    face(face: Face, point: (vertex: number) => readonly [number, number, number], light: (vertex: number) => number, extra: number, blend: boolean): void {
        const look = this.looks[face.texture];
        if (look === undefined) return;
        const seeThrough = blend || look.seeThrough;
        let flags = extra | (seeThrough ? 0 : SOLID | OPAQUE);
        if (face.doubleSided) flags |= DOUBLE_SIDED;
        if (extra & PASS) flags &= ~SOLID;
        flags &= ~PASS;
        const v = face.vertices;
        const triangles = v.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
        for (const [a, b, c] of triangles) {
            for (const corner of [a!, b!, c!]) this.corners.push(...point(v[corner]!));
            this.flags.push(flags);
            this.brightness.push(((light(v[a!]!) + light(v[b!]!) + light(v[c!]!)) / 3) * look.luminance * 2);
            this.textures.push(face.texture);
            this.owners.push(this.owner);
            this.rooms.push(this.room);
        }
    }
}

/** Marks an object the camera may pass, before face flags are worked out. */
const PASS = 128;

function shadeValue(shade: readonly number[]): number {
    return (shade[0]! + shade[1]! + shade[2]!) / 3;
}

function addMesh(collector: Collector, level: Level, mesh: Mesh, matrix: Matrix4, light: number, extra: number): void {
    if (mesh.empty) return;
    const scratch = new Vector3();
    const points = mesh.vertices.map((v) => toFile(scratch.set(v.x / 1024, -v.y / 1024, -v.z / 1024).applyMatrix4(matrix)));
    const point = (i: number) => points[i] ?? points[0]!;
    // Lit as the background draws it (build/geometry.ts): by the mesh's own
    // shades where it has them, else by the light around it and a fixed lamp.
    const normalMatrix = new Matrix4().extractRotation(matrix);
    const normal = new Vector3();
    const lights = mesh.vertices.map((_, i) => {
        const own = mesh.shades?.[i];
        if (own !== undefined) return Math.max(0, Math.min(2, (8192 - (own & 0x1fff)) / 4096));
        const n = mesh.normals?.[i];
        if (n === undefined) return light;
        normal.set(n.x, -n.y, -n.z).applyMatrix4(normalMatrix).normalize();
        return light * (0.7 + 0.45 * Math.max(0, normal.dot(LAMP)));
    });
    const lightOf = (i: number) => lights[i] ?? light;
    for (const face of [...mesh.quads, ...mesh.triangles]) {
        collector.face(face, point, lightOf, extra, level.engine === 4 && (face.effects & 1) !== 0);
    }
}

/** The fixed lamp the background lights objects with, as in build/geometry.ts. */
const LAMP = new Vector3(0.35, 0.85, 0.4).normalize();

function roomLightAt(room: Room | undefined, x: number, y: number, z: number): number {
    if (room === undefined) return 1;
    let weight = 0;
    let sum = 0;
    for (const vertex of room.vertices) {
        const distance = Math.hypot(vertex.x - x, vertex.y - y, vertex.z - z);
        if (distance > 3072) continue;
        const w = 1 / (1 + distance / 512);
        sum += shadeValue(vertex.shade) * w;
        weight += w;
    }
    return weight === 0 ? shadeValue(room.ambient) : sum / weight;
}

export function buildWorld(level: Level, sky?: boolean): World {
    const looks = textureLooks(level);
    const collector = new Collector(looks);
    const flipped = flippedRooms(level);
    for (const room of level.rooms) {
        if (flipped.has(room.index)) continue;
        const point = (i: number) => {
            const v = room.vertices[i] ?? room.vertices[0]!;
            return [v.x, v.y, v.z] as const;
        };
        const light = (i: number) => shadeValue((room.vertices[i] ?? room.vertices[0]!).shade);
        collector.owner = room.index;
        collector.room = room.index;
        for (const face of [...room.quads, ...room.triangles]) collector.face(face, point, light, 0, false);
        for (const placed of room.statics) {
            const def = level.statics.get(placed.objectId);
            const mesh = def === undefined ? undefined : level.meshes[def.mesh];
            if (mesh === undefined) continue;
            collector.owner = 100000 + placed.objectId;
            addMesh(collector, level, mesh, yawMatrix(placed.x, placed.y, placed.z, placed.rotation), shadeValue(placed.shade), DETAIL);
        }
    }
    const passable = new Set(PASSABLE[level.engine] ?? []);
    for (const item of level.items) {
        if (item.objectId === LARA || item.objectId === SKYBOX[level.engine]) continue;
        if (level.engine !== 4 && item.flags & 0x0100) continue; // starts invisible
        if (flipped.has(item.room)) continue;
        const def = level.moveables.get(item.objectId);
        if (def === undefined || def.meshCount === 0) continue;
        const matrices = poseMoveable(level, def, Float64Array.from(yawMatrix(item.x, item.y, item.z, item.angle).elements));
        const light = roomLightAt(level.rooms[item.room], item.x, item.y, item.z);
        const extra = DETAIL | (passable.has(item.objectId) ? PASS : 0);
        collector.owner = 200000 + item.objectId;
        collector.room = item.room;
        for (let i = 0; i < def.meshCount; i++) {
            const mesh = level.meshes[def.firstMesh + i];
            if (mesh !== undefined) addMesh(collector, level, mesh, new Matrix4().fromArray(matrices[i]!), light, extra);
        }
    }
    const skybox = SKYBOX[level.engine];
    return new World(collector, sky ?? ((level.engine === 2 || level.engine === 3) && skybox !== undefined && level.moveables.has(skybox)));
}
