// Cuts one object out of a level: its meshes, posed as the game first shows
// it, and only the bits of texture it uses, packed into a small atlas. The
// result is plain arrays, ready for three.js or for sending as JSON.

import { identity, poseMoveable, toThree, transformDirection, transformPoint, type Matrix } from '../level/pose.ts';
import type { Face, Level, Mesh, ObjectTexture } from '../level/types.ts';

/** Which object: a moveable (an item, an inventory model) or a static mesh, by its id in the level. */
export interface ObjectRef {
    kind: 'moveable' | 'static';
    id: number;
}

export interface ObjectModel {
    /** Three.js space: y up, a floor square one unit wide. */
    positions: Float32Array;
    normals: Float32Array;
    /** Into the atlas, 0–1, v downwards as the atlas's rows go. */
    uvs: Float32Array;
    indices: Uint32Array;
    /** Indices from here on blend additively (glows, flames). */
    blendStart: number;
    /** RGBA texels; alpha 0 marks see-through texels. */
    atlas: { width: number; height: number; pixels: Uint8Array };
}

interface Part {
    mesh: Mesh;
    matrix: Matrix;
}

function partsOf(level: Level, ref: ObjectRef): Part[] {
    if (ref.kind === 'static') {
        const def = level.statics.get(ref.id);
        const mesh = def === undefined ? undefined : level.meshes[def.mesh];
        return mesh === undefined || mesh.empty ? [] : [{ mesh, matrix: identity() }];
    }
    const def = level.moveables.get(ref.id);
    if (def === undefined || def.meshCount === 0) return [];
    const matrices = poseMoveable(level, def, identity());
    const parts: Part[] = [];
    for (let i = 0; i < def.meshCount; i++) {
        const mesh = level.meshes[def.firstMesh + i];
        if (mesh !== undefined && !mesh.empty) parts.push({ mesh, matrix: matrices[i]! });
    }
    return parts;
}

/** The ids of every object in a level that has something to show. */
export function objectsIn(level: Level): ObjectRef[] {
    const out: ObjectRef[] = [];
    for (const id of [...level.moveables.keys()].sort((a, b) => a - b)) {
        if (partsOf(level, { kind: 'moveable', id }).length > 0) out.push({ kind: 'moveable', id });
    }
    for (const id of [...level.statics.keys()].sort((a, b) => a - b)) {
        if (partsOf(level, { kind: 'static', id }).length > 0) out.push({ kind: 'static', id });
    }
    return out;
}

/** A texture's area of its tile, in whole texels. */
interface Area {
    tile: number;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Where it lands in the atlas, inside a one-texel border. */
    atX: number;
    atY: number;
}

const BORDER = 1;

function areaOf(texture: ObjectTexture): Omit<Area, 'atX' | 'atY'> {
    const us = texture.uv.map((c) => c.u);
    const vs = texture.uv.map((c) => c.v);
    const x = Math.max(0, Math.floor(Math.min(...us)));
    const y = Math.max(0, Math.floor(Math.min(...vs)));
    const right = Math.min(256, Math.max(x + 1, Math.ceil(Math.max(...us))));
    const bottom = Math.min(256, Math.max(y + 1, Math.ceil(Math.max(...vs))));
    return { tile: texture.tile, x, y, width: right - x, height: bottom - y };
}

/** Packs areas into rows, tallest first; returns the atlas size. */
function pack(areas: Area[]): { width: number; height: number } {
    const total = areas.reduce((sum, a) => sum + (a.width + 2 * BORDER) * (a.height + 2 * BORDER), 0);
    const widest = Math.max(1, ...areas.map((a) => a.width + 2 * BORDER));
    let width = 16;
    while (width < widest || width * width < total * 1.25) width *= 2;
    let x = 0;
    let y = 0;
    let row = 0;
    for (const area of [...areas].sort((a, b) => b.height - a.height || b.width - a.width)) {
        const w = area.width + 2 * BORDER;
        const h = area.height + 2 * BORDER;
        if (x + w > width) {
            x = 0;
            y += row;
            row = 0;
        }
        area.atX = x + BORDER;
        area.atY = y + BORDER;
        x += w;
        row = Math.max(row, h);
    }
    return { width, height: Math.max(4, Math.ceil((y + row) / 4) * 4) };
}

/** Copies each area from its tile into the atlas, repeating its edge texels into the border. */
function paint(level: Level, areas: Area[], width: number, height: number): Uint8Array {
    const pixels = new Uint8Array(width * height * 4);
    for (const area of areas) {
        const tileBase = area.tile * 256 * 256 * 4;
        for (let dy = -BORDER; dy < area.height + BORDER; dy++) {
            const sy = area.y + Math.min(Math.max(dy, 0), area.height - 1);
            for (let dx = -BORDER; dx < area.width + BORDER; dx++) {
                const sx = area.x + Math.min(Math.max(dx, 0), area.width - 1);
                const from = tileBase + (sy * 256 + sx) * 4;
                const to = ((area.atY + dy) * width + area.atX + dx) * 4;
                pixels[to] = level.tiles[from] ?? 0;
                pixels[to + 1] = level.tiles[from + 1] ?? 0;
                pixels[to + 2] = level.tiles[from + 2] ?? 0;
                pixels[to + 3] = level.tiles[from + 3] ?? 0;
            }
        }
    }
    bleed(pixels, width, height);
    return pixels;
}

/**
 * Gives see-through texels the colour of the solid ones beside them. The
 * files fill them with a key colour, which smooth filtering would otherwise
 * smear round the edges of cut-out shapes.
 */
function bleed(pixels: Uint8Array, width: number, height: number): void {
    for (let pass = 0; pass < 3; pass++) {
        const solid = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) solid[i] = pixels[i * 4 + 3]! > 0 || pixels[i * 4 + 3] === 1 ? 1 : 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                if (solid[i]) continue;
                let r = 0;
                let g = 0;
                let b = 0;
                let n = 0;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    const j = ny * width + nx;
                    if (!solid[j]) continue;
                    r += pixels[j * 4]!;
                    g += pixels[j * 4 + 1]!;
                    b += pixels[j * 4 + 2]!;
                    n++;
                }
                if (n === 0) continue;
                pixels[i * 4] = r / n;
                pixels[i * 4 + 1] = g / n;
                pixels[i * 4 + 2] = b / n;
                // Still see-through, but now counted as coloured for the next pass.
                pixels[i * 4 + 3] = 1;
            }
        }
    }
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 1) pixels[i] = 0;
}

type Vector = [number, number, number];

function unit([x, y, z]: Vector): Vector {
    const length = Math.hypot(x, y, z);
    return length === 0 ? [0, 1, 0] : [x / length, y / length, z / length];
}

function dot(a: Vector, b: Vector): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** A face's outward normal, scaled by its area (Newell's method). */
function faceNormal(points: Vector[], face: Face): Vector {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const count = face.vertices.length;
    for (let i = 0; i < count; i++) {
        const a = points[face.vertices[i]!] ?? [0, 0, 0];
        const b = points[face.vertices[(i + 1) % count]!] ?? [0, 0, 0];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    // The files wind faces clockwise seen from outside.
    return [-nx, -ny, -nz];
}

/** Smooth across gentle bends, sharp across hard edges. */
const CREASE = Math.cos((50 * Math.PI) / 180);

/**
 * The normal at each corner of each face. The files' own normals are used
 * where they agree with the face; some objects carry them pointing inwards,
 * and others carry light values instead, so the rest come from the faces
 * around each vertex, keeping hard edges hard.
 */
function cornerNormals(points: Vector[], faces: readonly Face[], fileNormals: Vector[] | null): Vector[][] {
    const smooth = points.map((): Vector => [0, 0, 0]);
    const flat = faces.map((face) => faceNormal(points, face));
    faces.forEach((face, f) => {
        for (const i of face.vertices) {
            const sum = smooth[i];
            if (sum === undefined) continue;
            sum[0] += flat[f]![0];
            sum[1] += flat[f]![1];
            sum[2] += flat[f]![2];
        }
    });
    const smoothUnit = smooth.map(unit);
    return faces.map((face, f) => {
        const own = unit(flat[f]!);
        return face.vertices.map((i) => {
            const file = fileNormals?.[i];
            if (file !== undefined && dot(file, own) > 0.2) return file;
            const shared = smoothUnit[i];
            return shared !== undefined && dot(shared, own) > CREASE ? shared : own;
        });
    });
}

/** The object's meshes and textures, or null when the level has nothing to show for it. */
export function extractObject(level: Level, ref: ObjectRef): ObjectModel | null {
    const parts = partsOf(level, ref);
    if (parts.length === 0) return null;

    const areas = new Map<string, Area>();
    const areaKey = (texture: ObjectTexture) => {
        const a = areaOf(texture);
        const key = `${a.tile}:${a.x},${a.y},${a.width},${a.height}`;
        if (!areas.has(key)) areas.set(key, { ...a, atX: 0, atY: 0 });
        return key;
    };

    interface Corner {
        p: [number, number, number];
        n: [number, number, number];
        u: number;
        v: number;
        area: string;
        x0: number;
        y0: number;
    }
    const opaque: Corner[][] = [];
    const blended: Corner[][] = [];
    const doubled = new Set<Corner[]>();

    for (const { mesh, matrix } of parts) {
        const points = mesh.vertices.map((v) => {
            const [x, y, z] = toThree(v.x, v.y, v.z);
            return transformPoint(matrix, x, y, z);
        });
        const faces = [...mesh.quads, ...mesh.triangles];
        const fileNormals =
            mesh.normals !== null && mesh.normals.length === mesh.vertices.length
                ? mesh.normals.map((n) => transformDirection(matrix, n.x, -n.y, -n.z))
                : null;
        const normalsByFace = cornerNormals(points, faces, fileNormals);
        for (const [faceIndex, face] of faces.entries()) {
            const normals = normalsByFace[faceIndex]!;
            const texture = level.objectTextures[face.texture];
            if (texture === undefined) continue;
            const key = areaKey(texture);
            const area = areas.get(key)!;
            const count = face.vertices.length;
            let centreU = 0;
            let centreV = 0;
            for (let i = 0; i < count; i++) {
                centreU += (texture.uv[i] ?? texture.uv[0]!).u / count;
                centreV += (texture.uv[i] ?? texture.uv[0]!).v / count;
            }
            const corners: Corner[] = [];
            for (let i = 0; i < count; i++) {
                const p = points[face.vertices[i]!];
                if (p === undefined) break;
                const uv = texture.uv[i] ?? texture.uv[0]!;
                // Corners sit on texel edges; half a texel inwards keeps
                // filtering from reaching the neighbouring texture.
                const u = uv.u + Math.sign(centreU - uv.u) * Math.min(0.5, Math.abs(centreU - uv.u));
                const v = uv.v + Math.sign(centreV - uv.v) * Math.min(0.5, Math.abs(centreV - uv.v));
                corners.push({ p, n: normals[i] ?? [0, 1, 0], u, v, area: key, x0: area.x, y0: area.y });
            }
            if (corners.length !== count) continue;
            const blend = texture.attributes === 2 || (level.engine === 4 && (face.effects & 1) !== 0);
            (blend ? blended : opaque).push(corners);
            if (face.doubleSided) doubled.add(corners);
        }
    }
    if (opaque.length + blended.length === 0) return null;

    const list = [...areas.values()];
    const { width, height } = pack(list);
    const pixels = paint(level, list, width, height);

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const emit = (corners: Corner[]) => {
        const base = positions.length / 3;
        for (const c of corners) {
            const area = areas.get(c.area)!;
            positions.push(...c.p);
            normals.push(...c.n);
            uvs.push((area.atX + c.u - c.x0) / width, (area.atY + c.v - c.y0) / height);
        }
        // The files wind faces opposite to three.js: corners go in reverse.
        const count = corners.length;
        const reversed = Array.from({ length: count }, (_, i) => base + count - 1 - i);
        const triangles = count === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
        for (const i of triangles) indices.push(reversed[i]!);
        if (doubled.has(corners)) {
            for (let i = triangles.length - 1; i >= 0; i--) indices.push(reversed[triangles[i]!]!);
        }
    };
    opaque.forEach(emit);
    const blendStart = indices.length;
    blended.forEach(emit);

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: new Uint32Array(indices),
        blendStart,
        atlas: { width, height, pixels },
    };
}
