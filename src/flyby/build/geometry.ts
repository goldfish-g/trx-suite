// Turns a parsed level into flat vertex arrays the GPU draws: one chunk per
// room, holding the room itself and the static meshes and objects standing
// in it, posed as they first appear. Everything is baked into world space,
// since nothing moves in the background.
//
// Coordinates change here from the files' (x east, y down, z north, 1024
// units to a square) to three.js's (y up), scaled so a square is one unit:
// (x, y, z) → (x, -y, -z) / 1024. That flip is a half turn about x, so it
// keeps the faces' winding.

import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Face, Level, Mesh, MoveableDef, ObjectTexture, Room, Shade } from '../level/types';
import { ROOM_WATER } from '../level/types';

export const UNIT = 1 / 1024;

/** One room's worth of geometry. */
export interface SceneChunk {
    room: number;
    positions: Float32Array;
    /** Texture coordinates within a tile, 0–1. */
    uvs: Float32Array;
    /** The tile each vertex samples. */
    layers: Float32Array;
    /** Light multiplier per vertex, where 1 shows the texture as it is. */
    shades: Float32Array;
    indices: Uint32Array;
    /** Indices from here on blend additively. */
    additiveStart: number;
    water: boolean;
}

export interface LevelScene {
    engine: number;
    tiles: Uint8Array;
    tileCount: number;
    chunks: SceneChunk[];
    /** A skybox to draw around the camera, for TR2 and TR3. */
    sky: SceneChunk | null;
    /** What the camera needs to tell which rooms it can see. */
    visibility: RoomVisibility[];
}

/**
 * A room's outline and doorways, in file units, for drawing only the rooms
 * the camera can see through doorways from the room it is in.
 */
export interface RoomVisibility {
    index: number;
    x: number;
    z: number;
    sectorsX: number;
    sectorsZ: number;
    yTop: number;
    yBottom: number;
    /** Floor and ceiling of each square, sectors[x * sectorsZ + z]; walls hold -32512. */
    floors: Int16Array;
    ceilings: Int16Array;
    portals: { toRoom: number; normal: [number, number, number]; corners: number[] }[];
}

const WATER_TINT: Shade = [0.55, 0.85, 1.0];
const LIGHT_DIRECTION = new Vector3(0.35, 0.85, 0.4).normalize();
const SKYBOX_IDS: Record<number, number> = { 2: 254, 3: 355 };
/** Objects that only exist to steer the game and draw nothing useful. */
const LARA = 0;

class ChunkBuilder {
    positions: number[] = [];
    uvs: number[] = [];
    layers: number[] = [];
    shades: number[] = [];
    opaque: number[] = [];
    additive: number[] = [];

    private readonly textures: readonly ObjectTexture[];
    private readonly tint: Shade | null;

    constructor(textures: readonly ObjectTexture[], tint: Shade | null) {
        this.textures = textures;
        this.tint = tint;
    }

    /**
     * Adds a face. `corner(i)` gives the i-th corner's world position (three.js
     * space) and shade. The files wind faces opposite to three.js, so corners
     * go in reverse.
     */
    face(face: Face, corner: (vertex: number) => { p: Vector3; shade: Shade }, blend: boolean): void {
        const texture = this.textures[face.texture];
        if (texture === undefined) return;
        const additive = blend || texture.attributes === 2;
        const count = face.vertices.length;
        const base = this.positions.length / 3;
        // Corners sit on texel edges; pulling them half a texel inwards keeps
        // smooth filtering from bleeding in the neighbouring texture.
        let centreU = 0;
        let centreV = 0;
        for (let i = 0; i < count; i++) {
            centreU += (texture.uv[i] ?? texture.uv[0]!).u / count;
            centreV += (texture.uv[i] ?? texture.uv[0]!).v / count;
        }
        for (let i = 0; i < count; i++) {
            const { p, shade } = corner(face.vertices[i]!);
            const uv = texture.uv[i] ?? texture.uv[0]!;
            const u = uv.u + Math.sign(centreU - uv.u) * Math.min(0.5, Math.abs(centreU - uv.u));
            const v = uv.v + Math.sign(centreV - uv.v) * Math.min(0.5, Math.abs(centreV - uv.v));
            this.positions.push(p.x, p.y, p.z);
            this.uvs.push(u / 256, v / 256);
            this.layers.push(texture.tile);
            const tint = this.tint;
            this.shades.push(
                shade[0] * (tint?.[0] ?? 1),
                shade[1] * (tint?.[1] ?? 1),
                shade[2] * (tint?.[2] ?? 1),
            );
        }
        const target = additive ? this.additive : this.opaque;
        const reversed = Array.from({ length: count }, (_, i) => base + count - 1 - i);
        const triangles = count === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
        for (const i of triangles) target.push(reversed[i]!);
        if (face.doubleSided) {
            for (let i = triangles.length - 1; i >= 0; i--) target.push(reversed[triangles[i]!]!);
        }
    }

    build(room: number, water: boolean): SceneChunk {
        return {
            room,
            positions: new Float32Array(this.positions),
            uvs: new Float32Array(this.uvs),
            layers: new Float32Array(this.layers),
            shades: new Float32Array(this.shades),
            indices: new Uint32Array([...this.opaque, ...this.additive]),
            additiveStart: this.opaque.length,
            water,
        };
    }

    get empty(): boolean {
        return this.opaque.length === 0 && this.additive.length === 0;
    }
}

function toThree(x: number, y: number, z: number, out = new Vector3()): Vector3 {
    return out.set(x * UNIT, -y * UNIT, -z * UNIT);
}

function darknessShade(darkness: number): Shade {
    const value = Math.max(0, Math.min(2, (8192 - (darkness & 0x1fff)) / 4096));
    return [value, value, value];
}

/** Adds a mesh placed by `matrix`, lit by its own shades or by `shade` and a fixed light. */
function addMesh(builder: ChunkBuilder, mesh: Mesh, matrix: Matrix4, shade: Shade, engine: number): void {
    if (mesh.empty) return;
    const normalMatrix = new Matrix4().extractRotation(matrix);
    const points = mesh.vertices.map((v) => toThree(v.x, v.y, v.z).applyMatrix4(matrix));
    const shades: Shade[] = mesh.vertices.map((_, i) => {
        const own = mesh.shades?.[i];
        if (own !== undefined) return darknessShade(own);
        const n = mesh.normals?.[i];
        if (n === undefined) return shade;
        const normal = toThree(n.x, n.y, n.z).applyMatrix4(normalMatrix).normalize();
        const light = 0.7 + 0.45 * Math.max(0, normal.dot(LIGHT_DIRECTION));
        return [shade[0] * light, shade[1] * light, shade[2] * light];
    });
    const corner = (vertex: number) => ({ p: points[vertex] ?? points[0]!, shade: shades[vertex] ?? shade });
    for (const face of [...mesh.quads, ...mesh.triangles]) {
        builder.face(face, corner, engine === 4 && (face.effects & 1) !== 0);
    }
}

const ANGLE = (Math.PI * 2) / 1024;

/** The rotation of each part of an object in a frame, three.js space. */
function frameRotations(level: Level, frame: number, parts: number): { offset: Vector3; rotations: Quaternion[] } {
    const words = level.frames;
    let p = frame;
    const at = (i: number) => (words[i] ?? 0) & 0xffff;
    const offset = toThree(words[p + 6] ?? 0, words[p + 7] ?? 0, words[p + 8] ?? 0);
    p += 9;
    if (level.engine === 1) p += 1; // TR1 counts its rotations here
    const rotations: Quaternion[] = [];
    const euler = new Euler();
    for (let part = 0; part < parts; part++) {
        let x = 0;
        let y = 0;
        let z = 0;
        let first = at(p++);
        const axis = first & 0xc000;
        if (level.engine !== 1 && axis !== 0) {
            const angle = (level.engine === 4 ? (first & 0x0fff) >> 2 : first & 0x03ff) * ANGLE;
            if (axis === 0x4000) x = angle;
            else if (axis === 0x8000) y = angle;
            else z = angle;
        } else {
            let second = at(p++);
            // TR1 stores the two words the other way round.
            if (level.engine === 1) [first, second] = [second, first];
            x = ((first >> 4) & 0x03ff) * ANGLE;
            y = (((first << 6) & 0x03c0) | ((second >> 10) & 0x003f)) * ANGLE;
            z = (second & 0x03ff) * ANGLE;
        }
        // The files turn about y, then x, then z. The coordinate flip keeps x
        // and reverses y and z.
        rotations.push(new Quaternion().setFromEuler(euler.set(x, -y, -z, 'YXZ')));
    }
    return { offset, rotations };
}

/** The world matrix of each mesh of an object, as its first frame poses it. */
function poseMoveable(level: Level, def: MoveableDef, placement: Matrix4): Matrix4[] {
    const { offset, rotations } = frameRotations(level, def.frame, def.meshCount);
    const matrices: Matrix4[] = [];
    const one = new Vector3(1, 1, 1);
    matrices.push(placement.clone().multiply(new Matrix4().compose(offset, rotations[0] ?? new Quaternion(), one)));
    const stack: number[] = [];
    let parent = 0;
    for (let part = 1; part < def.meshCount; part++) {
        const t = def.meshTree + (part - 1) * 4;
        const flags = level.meshTree[t] ?? 0;
        const local = toThree(level.meshTree[t + 1] ?? 0, level.meshTree[t + 2] ?? 0, level.meshTree[t + 3] ?? 0);
        if (flags & 1) parent = stack.pop() ?? 0;
        if (flags & 2) stack.push(parent);
        const parentMatrix = matrices[parent] ?? matrices[0]!;
        matrices.push(
            parentMatrix.clone().multiply(new Matrix4().compose(local, rotations[part] ?? new Quaternion(), one)),
        );
        parent = part;
    }
    return matrices;
}

function yawMatrix(x: number, y: number, z: number, angle: number): Matrix4 {
    const rotation = new Matrix4().makeRotationY(-(angle / 65536) * Math.PI * 2);
    return new Matrix4().setPosition(toThree(x, y, z)).multiply(rotation);
}

function addRoom(level: Level, room: Room, builder: ChunkBuilder): void {
    const points = room.vertices.map((v) => toThree(v.x, v.y, v.z));
    const corner = (vertex: number) => {
        const v = room.vertices[vertex] ?? room.vertices[0]!;
        return { p: points[vertex] ?? points[0]!, shade: v.shade };
    };
    for (const face of [...room.quads, ...room.triangles]) builder.face(face, corner, false);

    for (const placed of room.statics) {
        const def = level.statics.get(placed.objectId);
        const mesh = def === undefined ? undefined : level.meshes[def.mesh];
        if (mesh === undefined) continue;
        addMesh(builder, mesh, yawMatrix(placed.x, placed.y, placed.z, placed.rotation), placed.shade, level.engine);
    }
}

function isDrawnItem(level: Level, objectId: number, flags: number): boolean {
    if (objectId === LARA) return false;
    if (level.engine !== 4 && flags & 0x0100) return false; // starts invisible
    if (SKYBOX_IDS[level.engine] === objectId) return false;
    return true;
}

/**
 * How lit a spot is, from the room's own vertex lighting around it. The
 * original games light objects from room lights and ambient values whose
 * meaning differs per game; the baked vertex light is what the player sees
 * around the object, which is what matters for the background.
 */
function localShade(room: Room, x: number, y: number, z: number): Shade {
    let weight = 0;
    const sum = [0, 0, 0];
    for (const vertex of room.vertices) {
        const distance = Math.hypot(vertex.x - x, vertex.y - y, vertex.z - z);
        if (distance > 3072) continue;
        const w = 1 / (1 + distance / 512);
        sum[0]! += vertex.shade[0] * w;
        sum[1]! += vertex.shade[1] * w;
        sum[2]! += vertex.shade[2] * w;
        weight += w;
    }
    if (weight === 0) return room.ambient;
    return [sum[0]! / weight, sum[1]! / weight, sum[2]! / weight];
}

function addItems(level: Level, builders: Map<number, ChunkBuilder>): void {
    for (const item of level.items) {
        if (!isDrawnItem(level, item.objectId, item.flags)) continue;
        const def = level.moveables.get(item.objectId);
        const builder = builders.get(item.room);
        if (def === undefined || builder === undefined || def.meshCount === 0) continue;
        const meshes = Array.from({ length: def.meshCount }, (_, i) => level.meshes[def.firstMesh + i]);
        if (meshes.every((mesh) => mesh === undefined || mesh.empty)) continue;
        const room = level.rooms[item.room];
        const shade = room === undefined ? [1, 1, 1] as const : localShade(room, item.x, item.y, item.z);
        const matrices = poseMoveable(level, def, yawMatrix(item.x, item.y, item.z, item.angle));
        meshes.forEach((mesh, i) => {
            if (mesh !== undefined) addMesh(builder, mesh, matrices[i]!, shade, level.engine);
        });
    }
}

function buildSky(level: Level): SceneChunk | null {
    const id = SKYBOX_IDS[level.engine];
    const def = id === undefined ? undefined : level.moveables.get(id);
    if (def === undefined) return null;
    const builder = new ChunkBuilder(level.objectTextures, null);
    const matrices = poseMoveable(level, def, new Matrix4());
    for (let i = 0; i < def.meshCount; i++) {
        const mesh = level.meshes[def.firstMesh + i];
        if (mesh !== undefined) addMesh(builder, mesh, matrices[i]!, [1, 1, 1], level.engine);
    }
    return builder.empty ? null : builder.build(-1, false);
}

/** Rooms that only show after the level flips; the background never flips. */
export function flippedRooms(level: Level): Set<number> {
    const flipped = new Set<number>();
    for (const room of level.rooms) {
        if (room.alternateRoom >= 0 && room.alternateRoom < level.rooms.length) flipped.add(room.alternateRoom);
    }
    return flipped;
}

export function buildScene(level: Level): LevelScene {
    const flipped = flippedRooms(level);
    const builders = new Map<number, ChunkBuilder>();
    for (const room of level.rooms) {
        if (flipped.has(room.index)) continue;
        const water = (room.flags & ROOM_WATER) !== 0;
        const builder = new ChunkBuilder(level.objectTextures, water ? WATER_TINT : null);
        addRoom(level, room, builder);
        builders.set(room.index, builder);
    }
    addItems(level, builders);
    const chunks: SceneChunk[] = [];
    for (const [index, builder] of builders) {
        if (builder.empty) continue;
        const room = level.rooms[index]!;
        chunks.push(builder.build(index, (room.flags & ROOM_WATER) !== 0));
    }
    return {
        engine: level.engine,
        tiles: level.tiles,
        tileCount: level.tileCount,
        chunks,
        sky: buildSky(level),
        // Flipped rooms share their space with the rooms they replace; the
        // camera must never think it is in one.
        visibility: level.rooms.filter((room) => !flipped.has(room.index)).map((room) => ({
            index: room.index,
            x: room.x,
            z: room.z,
            sectorsX: room.sectorsX,
            sectorsZ: room.sectorsZ,
            yTop: room.yTop,
            yBottom: room.yBottom,
            floors: Int16Array.from(room.sectors, (sector) => sector.floor),
            ceilings: Int16Array.from(room.sectors, (sector) => sector.ceiling),
            portals: room.portals.map((portal) => ({
                toRoom: portal.toRoom,
                normal: [portal.normal.x, portal.normal.y, portal.normal.z],
                corners: portal.corners.flatMap((c) => [c.x, c.y, c.z]),
            })),
        })),
    };
}

/** The buffers of a scene, to hand to another thread without copying. */
export function sceneTransferables(scene: LevelScene): ArrayBuffer[] {
    const buffers: ArrayBuffer[] = [scene.tiles.buffer as ArrayBuffer];
    for (const chunk of scene.sky === null ? scene.chunks : [...scene.chunks, scene.sky]) {
        buffers.push(
            chunk.positions.buffer as ArrayBuffer,
            chunk.uvs.buffer as ArrayBuffer,
            chunk.layers.buffer as ArrayBuffer,
            chunk.shades.buffer as ArrayBuffer,
            chunk.indices.buffer as ArrayBuffer,
        );
    }
    return [...new Set(buffers)];
}
