// What the flyby needs from a level file, in the file's own coordinates:
// x east, y down, z north, 1024 units to a floor square ("sector").

export type LevelEngine = 1 | 2 | 3 | 4;

/** A light multiplier per channel, where 1 leaves a texture as it is. */
export type Shade = readonly [number, number, number];

export interface RoomVertex {
    /** World position. */
    x: number;
    y: number;
    z: number;
    shade: Shade;
    /** TR2+ vertex attributes; bit 0x8000 keeps water from moving the vertex. */
    attributes: number;
}

export interface Face {
    /** Three or four vertex indices, in the file's order. */
    vertices: readonly number[];
    /** Index into Level.objectTextures. */
    texture: number;
    doubleSided: boolean;
    /** TR4 mesh faces: bit 0 blends the face. */
    effects: number;
}

export interface Portal {
    toRoom: number;
    /** Points into the room that lists the portal. */
    normal: { x: number; y: number; z: number };
    /** World positions of its four corners. */
    corners: { x: number; y: number; z: number }[];
}

export interface Sector {
    floorData: number;
    box: number;
    roomBelow: number;
    roomAbove: number;
    /** Heights in world units (y down); WALL for solid squares. */
    floor: number;
    ceiling: number;
}

/** The height the files give a solid square: -127 clicks. */
export const WALL = -127 * 256;

export interface RoomStatic {
    x: number;
    y: number;
    z: number;
    /** 0..65535 for a full turn about the vertical axis. */
    rotation: number;
    shade: Shade;
    objectId: number;
}

export interface Room {
    index: number;
    /** World position of the room's corner. */
    x: number;
    z: number;
    yTop: number;
    yBottom: number;
    vertices: RoomVertex[];
    quads: Face[];
    triangles: Face[];
    portals: Portal[];
    /** Squares along x, then z: sectors[x * sectorsZ + z]. */
    sectorsX: number;
    sectorsZ: number;
    sectors: Sector[];
    ambient: Shade;
    statics: RoomStatic[];
    /** The room this one turns into when the level flips, or -1. */
    alternateRoom: number;
    flags: number;
}

export const ROOM_WATER = 0x1;

export interface MeshVertex {
    x: number;
    y: number;
    z: number;
}

export interface Mesh {
    vertices: MeshVertex[];
    /** Unit normals, when the mesh is lit by the scene. */
    normals: MeshVertex[] | null;
    /** Per-vertex shade, when the mesh carries its own lighting. */
    shades: number[] | null;
    quads: Face[];
    triangles: Face[];
    /** Whether the mesh pointer was empty (a placeholder). */
    empty: boolean;
}

export interface ObjectTexture {
    /** 0 opaque or cut out, 1 cut out, 2 additive. */
    attributes: number;
    tile: number;
    /** Pixel coordinates of each corner within the tile. */
    uv: { u: number; v: number }[];
}

export interface StaticDef {
    mesh: number;
    flags: number;
}

export interface MoveableDef {
    objectId: number;
    meshCount: number;
    firstMesh: number;
    /** Index into Level.meshTree. */
    meshTree: number;
    /** Index into Level.frames of the first frame of its first animation. */
    frame: number;
    animation: number;
}

export interface Item {
    objectId: number;
    room: number;
    x: number;
    y: number;
    z: number;
    angle: number;
    shade: Shade | null;
    flags: number;
}

/** A TR4 flyby camera: one point of a scripted camera path. */
export interface FlybyCamera {
    x: number;
    y: number;
    z: number;
    /** Where it looks. */
    targetX: number;
    targetY: number;
    targetZ: number;
    sequence: number;
    index: number;
    fov: number;
    roll: number;
    timer: number;
    speed: number;
    flags: number;
    room: number;
}

export interface Level {
    engine: LevelEngine;
    /** RGBA texels of every 256×256 tile, one after another. */
    tiles: Uint8Array;
    tileCount: number;
    rooms: Room[];
    /** Meshes in mesh-pointer order. */
    meshes: Mesh[];
    meshTree: Int32Array;
    frames: Int16Array;
    moveables: Map<number, MoveableDef>;
    statics: Map<number, StaticDef>;
    objectTextures: ObjectTexture[];
    items: Item[];
    flybyCameras: FlybyCamera[];
    /** Floor data: what each square does (slopes, portals, triggers, climbable walls), indexed by Sector.floorData. */
    floorData: Uint16Array;
    /**
     * TR1–3: where in the file what this reader leaves out begins, the
     * sound tables among it (shared/level/sounds.ts). TR4 keeps them elsewhere.
     */
    tailOffset?: number;
}
