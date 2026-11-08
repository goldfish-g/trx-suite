// Reads the level files of Tomb Raider I–IV (.phd, .tub, .tr2, .tr4) into
// the parts the flyby draws: rooms, meshes, textures, items and, for TR4,
// the scripted flyby cameras. Sounds, animations beyond the first frame and
// AI data are skipped over.
//
// The layouts follow the community's documentation of the formats (the
// TRosettaStone) and Evgeny Popov's TRN viewer, which reads the same files in
// the browser.

import { LevelFormatError, Reader } from './reader.ts';
import type {
    Face,
    FlybyCamera,
    Item,
    Level,
    LevelEngine,
    Mesh,
    MeshVertex,
    MoveableDef,
    ObjectTexture,
    Portal,
    Room,
    RoomStatic,
    Sector,
    Shade,
    StaticDef,
} from './types.ts';

const TILE_TEXELS = 256 * 256;
const TILE_BYTES = TILE_TEXELS * 4;

/** The engine a level file is for, from its first four bytes. */
export function levelEngine(bytes: Uint8Array): LevelEngine | undefined {
    if (bytes.length < 4) return undefined;
    const version = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
    if (version === 0x20) return 1;
    if (version === 0x2d) return 2;
    const tr3 = (version & 0xff00ffff) >>> 0;
    if (tr3 === 0xff000038 || tr3 === 0xff000034) return 3;
    if ((version & 0x00ffffff) === 0x00345254) return 4;
    return undefined;
}

// ---------------------------------------------------------------- shading

/**
 * TR1 and TR2 store darkness: 0 is twice as bright as the texture, 4096
 * leaves it as it is, 8191 is black.
 */
function shadeFromDarkness(darkness: number): Shade {
    const value = Math.max(0, Math.min(2, (8192 - (darkness & 0x1fff)) / 4096));
    return [value, value, value];
}

/**
 * TR3 and TR4 store 15-bit colours. TR3 uses them as they are; TR4 doubles
 * them, so that 16 of 31 leaves a texture as it is (as TRX reads them).
 */
function shadeFromColour15(colour: number, engine: LevelEngine): Shade {
    const neutral = engine === 4 ? 16 : 31;
    return [((colour >> 10) & 0x1f) / neutral, ((colour >> 5) & 0x1f) / neutral, (colour & 0x1f) / neutral];
}

// ---------------------------------------------------------------- textures

function tilesFrom8Bit(texels: Uint8Array, count: number, palette: Uint8Array): Uint8Array {
    const out = new Uint8Array(count * TILE_BYTES);
    for (let i = 0; i < count * TILE_TEXELS; i++) {
        const index = texels[i]!;
        const o = i * 4;
        // Palettes hold 6-bit values; index 0 is see-through.
        out[o] = palette[index * 3]! * 4;
        out[o + 1] = palette[index * 3 + 1]! * 4;
        out[o + 2] = palette[index * 3 + 2]! * 4;
        out[o + 3] = index === 0 ? 0 : 255;
    }
    return out;
}

function tilesFrom16Bit(texels: Uint8Array, count: number): Uint8Array {
    const out = new Uint8Array(count * TILE_BYTES);
    const view = new DataView(texels.buffer, texels.byteOffset, texels.byteLength);
    for (let i = 0; i < count * TILE_TEXELS; i++) {
        const pixel = view.getUint16(i * 2, true);
        const o = i * 4;
        out[o] = ((pixel >> 10) & 0x1f) << 3;
        out[o + 1] = ((pixel >> 5) & 0x1f) << 3;
        out[o + 2] = (pixel & 0x1f) << 3;
        out[o + 3] = pixel & 0x8000 ? 255 : 0;
    }
    return out;
}

/** TR4 stores 0xAARRGGBB words, so bytes come blue first. */
function tilesFrom32Bit(texels: Uint8Array, count: number): Uint8Array {
    const out = new Uint8Array(count * TILE_BYTES);
    for (let i = 0; i < count * TILE_TEXELS; i++) {
        const o = i * 4;
        out[o] = texels[o + 2]!;
        out[o + 1] = texels[o + 1]!;
        out[o + 2] = texels[o]!;
        out[o + 3] = texels[o + 3]!;
    }
    return out;
}

/**
 * TR1–3 meshes have flat-coloured faces that name a palette entry instead of
 * a texture. They become textured faces on one extra tile holding the
 * palette as a 16×16 grid of swatches.
 */
function paletteTile(colours: (index: number) => [number, number, number]): Uint8Array {
    const out = new Uint8Array(TILE_BYTES);
    for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
            const [r, g, b] = colours((y >> 4) * 16 + (x >> 4));
            const o = (y * 256 + x) * 4;
            out[o] = r;
            out[o + 1] = g;
            out[o + 2] = b;
            out[o + 3] = 255;
        }
    }
    return out;
}

function swatchTexture(tile: number, index: number): ObjectTexture {
    const u = (index % 16) * 16 + 8;
    const v = Math.floor(index / 16) * 16 + 8;
    return {
        attributes: 0,
        tile,
        uv: [
            { u: u - 2, v: v - 2 },
            { u: u + 2, v: v - 2 },
            { u: u + 2, v: v + 2 },
            { u: u - 2, v: v + 2 },
        ],
    };
}

function readObjectTexture(r: Reader, engine: LevelEngine): ObjectTexture {
    const attributes = r.u16();
    const tile = r.u16() & 0x7fff;
    if (engine === 4) r.skip(2); // flags
    const uv: { u: number; v: number }[] = [];
    for (let i = 0; i < 4; i++) {
        // Each coordinate is a 16-bit fixed-point number: pixel and fraction.
        const uFraction = r.u8();
        const uPixel = r.u8();
        const vFraction = r.u8();
        const vPixel = r.u8();
        uv.push({ u: uPixel + uFraction / 256, v: vPixel + vFraction / 256 });
    }
    if (engine === 4) r.skip(16); // original position and size
    return { attributes, tile, uv };
}

// ---------------------------------------------------------------- rooms

function readRoom(r: Reader, engine: LevelEngine, index: number): Room {
    const x = r.i32();
    const z = r.i32();
    const yBottom = r.i32();
    const yTop = r.i32();

    // The geometry block says how long it is; trusting that keeps a quirk in
    // one room from throwing off the rest of the file.
    const dataWords = r.u32();
    const dataEnd = r.pos + dataWords * 2;
    if (dataEnd > r.length) throw new LevelFormatError(`Room ${index} runs past the end of the file.`);

    const vertexCount = r.u16();
    const vertices = [];
    for (let i = 0; i < vertexCount; i++) {
        const vx = r.i16();
        const vy = r.i16();
        const vz = r.i16();
        const light1 = r.u16();
        let attributes = 0;
        let shade: Shade;
        if (engine === 1) {
            shade = shadeFromDarkness(light1);
        } else {
            attributes = r.u16();
            const light2 = r.u16();
            shade = engine === 2 ? shadeFromDarkness(light1) : shadeFromColour15(light2, engine);
        }
        vertices.push({ x: x + vx, y: vy, z: z + vz, shade, attributes });
    }
    const readFaces = (corners: number): Face[] => {
        const count = r.u16();
        const faces: Face[] = [];
        for (let i = 0; i < count; i++) {
            const list: number[] = [];
            for (let c = 0; c < corners; c++) list.push(r.u16());
            const texture = r.u16();
            faces.push({ vertices: list, texture: texture & 0x7fff, doubleSided: (texture & 0x8000) !== 0, effects: 0 });
        }
        return faces;
    };
    const quads = readFaces(4);
    const triangles = readFaces(3);
    r.pos = dataEnd;

    const portalCount = r.count16(32, 'portals');
    const portals: Portal[] = [];
    for (let i = 0; i < portalCount; i++) {
        const toRoom = r.u16();
        const normal = { x: r.i16(), y: r.i16(), z: r.i16() };
        const corners = [];
        for (let c = 0; c < 4; c++) corners.push({ x: x + r.i16(), y: r.i16(), z: z + r.i16() });
        portals.push({ toRoom, normal, corners });
    }

    const sectorsZ = r.u16();
    const sectorsX = r.u16();
    const sectors: Sector[] = [];
    if (sectorsX * sectorsZ * 8 > r.remaining) throw new LevelFormatError(`Room ${index} has too many squares.`);
    for (let i = 0; i < sectorsX * sectorsZ; i++) {
        const floorData = r.u16();
        const box = r.u16();
        const roomBelow = r.u8();
        const floor = r.i8() * 256;
        const roomAbove = r.u8();
        const ceiling = r.i8() * 256;
        sectors.push({ floorData, box, roomBelow, roomAbove, floor, ceiling });
    }

    let ambient: Shade;
    if (engine === 1) {
        ambient = shadeFromDarkness(r.i16());
    } else if (engine === 2) {
        ambient = shadeFromDarkness(r.i16());
        r.skip(4); // second ambient, light mode
    } else if (engine === 3) {
        ambient = shadeFromDarkness(r.i16());
        r.skip(2);
    } else {
        const colour = r.u32();
        ambient = [((colour >> 16) & 0xff) / 128, ((colour >> 8) & 0xff) / 128, (colour & 0xff) / 128];
    }

    const lightBytes = { 1: 18, 2: 24, 3: 24, 4: 46 }[engine];
    r.skip(r.count16(lightBytes, 'lights') * lightBytes);

    const staticCount = r.count16(engine === 1 ? 18 : 20, 'static meshes');
    const statics: RoomStatic[] = [];
    for (let i = 0; i < staticCount; i++) {
        const sx = r.i32();
        const sy = r.i32();
        const sz = r.i32();
        const rotation = r.u16();
        const intensity = r.u16();
        if (engine !== 1) r.skip(2);
        const objectId = r.u16();
        const shade = engine >= 3 ? shadeFromColour15(intensity, engine) : shadeFromDarkness(intensity);
        statics.push({ x: sx, y: sy, z: sz, rotation, shade, objectId });
    }

    const alternateRoom = r.i16();
    const flags = r.u16();
    if (engine >= 3) r.skip(3); // water scheme, reverb, alternate group

    return {
        index,
        x,
        z,
        yTop,
        yBottom,
        vertices,
        quads,
        triangles,
        portals,
        sectorsX,
        sectorsZ,
        sectors,
        ambient,
        statics,
        alternateRoom,
        flags,
    };
}

// ---------------------------------------------------------------- meshes

function readMesh(r: Reader, engine: LevelEngine): Mesh {
    r.skip(6 + 4); // centre, collision radius
    const vertexCount = r.i16();
    if (vertexCount < 0) throw new LevelFormatError('A mesh has a negative vertex count.');
    const vertices: MeshVertex[] = [];
    for (let i = 0; i < vertexCount; i++) vertices.push({ x: r.i16(), y: r.i16(), z: r.i16() });

    const normalCount = r.i16();
    let normals: MeshVertex[] | null = null;
    let shades: number[] | null = null;
    if (normalCount > 0) {
        normals = [];
        for (let i = 0; i < normalCount; i++) {
            const nx = r.i16();
            const ny = r.i16();
            const nz = r.i16();
            const length = Math.hypot(nx, ny, nz) || 1;
            normals.push({ x: nx / length, y: ny / length, z: nz / length });
        }
    } else {
        shades = [];
        for (let i = 0; i < -normalCount; i++) shades.push(r.i16());
    }

    const readFaces = (corners: number): Face[] => {
        const count = r.i16();
        const faces: Face[] = [];
        for (let i = 0; i < count; i++) {
            const list: number[] = [];
            for (let c = 0; c < corners; c++) list.push(r.u16());
            const texture = r.u16();
            const effects = engine === 4 ? r.u16() : 0;
            faces.push({ vertices: list, texture: texture & 0x7fff, doubleSided: (texture & 0x8000) !== 0, effects });
        }
        return faces;
    };
    const quads = readFaces(4);
    const triangles = readFaces(3);
    if (engine !== 4) {
        // Flat-coloured faces keep their raw palette reference in `texture`
        // for now; the caller swaps it for a swatch.
        const colouredQuads = readFaces(4).map((face) => ({ ...face, texture: -1 - face.texture }));
        const colouredTriangles = readFaces(3).map((face) => ({ ...face, texture: -1 - face.texture }));
        quads.push(...colouredQuads);
        triangles.push(...colouredTriangles);
    }
    return { vertices, normals, shades, quads, triangles, empty: false };
}

const EMPTY_MESH: Mesh = { vertices: [], normals: null, shades: null, quads: [], triangles: [], empty: true };

// ---------------------------------------------------------------- the file

interface Body {
    rooms: Room[];
    meshes: Mesh[];
    meshTree: Int32Array;
    frames: Int16Array;
    moveables: Map<number, MoveableDef>;
    statics: Map<number, StaticDef>;
    objectTextures: ObjectTexture[];
    items: Item[];
    floorData: Uint16Array;
    flybyCameras: FlybyCamera[];
    /** TR1's palette, which comes near the end of the file. */
    palette8: Uint8Array | null;
}

/**
 * Reads everything from the room count on. TR1–3 keep this in the file
 * itself, TR4 in a compressed block.
 */
function readBody(r: Reader, engine: LevelEngine, tub: boolean): Body {
    const roomCount = r.u16();
    const rooms: Room[] = [];
    for (let i = 0; i < roomCount; i++) rooms.push(readRoom(r, engine, i));

    const floorData = r.u16Array(r.count32(2, 'floor data words'));

    const meshWords = r.count32(2, 'mesh data words');
    const meshStart = r.pos;
    r.skip(meshWords * 2);
    const pointerCount = r.count32(4, 'mesh pointers');
    const pointers = r.u32Array(pointerCount);
    const afterPointers = r.pos;
    const meshCache = new Map<number, Mesh>();
    const meshes = Array.from(pointers, (pointer) => {
        if (pointer >= meshWords * 2) return EMPTY_MESH;
        let mesh = meshCache.get(pointer);
        if (mesh === undefined) {
            r.pos = meshStart + pointer;
            mesh = readMesh(r, engine);
            // A mesh at offset 0 is often Lara's placeholder; mark it so
            // objects that point at it draw nothing.
            if (pointer === 0) mesh = { ...mesh, empty: true };
            meshCache.set(pointer, mesh);
        }
        return mesh;
    });
    r.pos = afterPointers;

    r.skip(r.count32(engine === 4 ? 40 : 32, 'animations') * (engine === 4 ? 40 : 32));
    r.skip(r.count32(6, 'state changes') * 6);
    r.skip(r.count32(8, 'animation dispatches') * 8);
    r.skip(r.count32(2, 'animation commands') * 2);
    const meshTree = r.i32Array(r.count32(4, 'mesh tree entries'));
    const frames = r.i16Array(r.count32(2, 'frame words'));

    const moveables = new Map<number, MoveableDef>();
    const moveableCount = r.count32(18, 'moveables');
    for (let i = 0; i < moveableCount; i++) {
        const objectId = r.u32();
        const meshCount = r.u16();
        const firstMesh = r.u16();
        const tree = r.u32();
        const frameOffset = r.u32();
        const animation = r.u16();
        moveables.set(objectId, { objectId, meshCount, firstMesh, meshTree: tree, frame: frameOffset / 2, animation });
    }

    const statics = new Map<number, StaticDef>();
    const staticCount = r.count32(32, 'static mesh definitions');
    for (let i = 0; i < staticCount; i++) {
        const objectId = r.u32();
        const mesh = r.u16();
        r.skip(24); // visibility and collision boxes
        const flags = r.u16();
        statics.set(objectId, { mesh, flags });
    }

    let objectTextures: ObjectTexture[] = [];
    const readObjectTextures = () => {
        const size = engine === 4 ? 38 : 20;
        const count = r.count32(size, 'object textures');
        objectTextures = [];
        for (let i = 0; i < count; i++) objectTextures.push(readObjectTexture(r, engine));
    };
    if (engine <= 2) readObjectTextures();

    if (engine === 4) r.skip(3); // "SPR"
    r.skip(r.count32(16, 'sprite textures') * 16);
    r.skip(r.count32(8, 'sprite sequences') * 8);

    let palette8: Uint8Array | null = null;
    if (tub) palette8 = r.take(768);

    r.skip(r.count32(16, 'cameras') * 16);

    const flybyCameras: FlybyCamera[] = [];
    if (engine === 4) {
        const count = r.count32(40, 'flyby cameras');
        for (let i = 0; i < count; i++) {
            const x = r.i32();
            const y = r.i32();
            const z = r.i32();
            const targetX = r.i32();
            const targetY = r.i32();
            const targetZ = r.i32();
            const sequence = r.u8();
            const index = r.u8();
            const fov = r.u16();
            const roll = r.i16();
            const timer = r.u16();
            const speed = r.u16();
            const flags = r.u16();
            const room = r.u32();
            flybyCameras.push({ x, y, z, targetX, targetY, targetZ, sequence, index, fov, roll, timer, speed, flags, room });
        }
    }

    r.skip(r.count32(16, 'sound sources') * 16);
    const boxBytes = engine === 1 ? 20 : 8;
    const boxCount = r.count32(boxBytes, 'boxes');
    r.skip(boxCount * boxBytes);
    r.skip(r.count32(2, 'overlaps') * 2);
    r.skip(boxCount * (engine === 1 ? 12 : 20)); // zones
    r.skip(r.count32(2, 'animated texture words') * 2);

    if (engine === 3) readObjectTextures();
    if (engine === 4) {
        r.skip(1 + 3); // UV rotation count, "TEX"
        readObjectTextures();
    }

    const itemBytes = engine === 1 ? 22 : 24;
    const items: Item[] = [];
    const itemCount = r.count32(itemBytes, 'items');
    for (let i = 0; i < itemCount; i++) {
        const objectId = r.i16();
        const room = r.i16();
        const x = r.i32();
        const y = r.i32();
        const z = r.i32();
        const angle = r.u16();
        const intensity = r.i16();
        if (engine !== 1) r.skip(2); // second intensity, or TR4's code bits
        const flags = r.u16();
        let shade: Shade | null = null;
        if (engine === 1 || engine === 2) shade = intensity < 0 ? null : shadeFromDarkness(intensity);
        else if (engine === 3) shade = intensity < 0 ? null : shadeFromColour15(intensity, engine);
        items.push({ objectId, room, x, y, z, angle, shade, flags });
    }

    if (engine === 1 && !tub) {
        r.skip(8192); // light map
        palette8 = r.take(768);
    }

    return { rooms, floorData, meshes, meshTree, frames, moveables, statics, objectTextures, items, flybyCameras, palette8 };
}

/** Swaps flat-coloured faces for textured ones on the palette tile. */
function resolveColouredFaces(meshes: Mesh[], objectTextures: ObjectTexture[], engine: LevelEngine, tile: number): void {
    const swatches = new Map<number, number>();
    const swatch = (raw: number): number => {
        // TR1 names a palette entry in the low byte, TR2 and TR3 their 16-bit
        // palette's entry in the high byte.
        const index = engine === 1 ? raw & 0xff : (raw >> 8) & 0xff;
        let texture = swatches.get(index);
        if (texture === undefined) {
            texture = objectTextures.length;
            objectTextures.push(swatchTexture(tile, index));
            swatches.set(index, texture);
        }
        return texture;
    };
    const resolve = (face: Face): Face => (face.texture < 0 ? { ...face, texture: swatch(-1 - face.texture) } : face);
    for (const mesh of new Set(meshes)) {
        mesh.quads = mesh.quads.map(resolve);
        mesh.triangles = mesh.triangles.map(resolve);
    }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readCompressed(r: Reader): Promise<Uint8Array> {
    const size = r.u32();
    const compressed = r.u32();
    const data = await inflate(r.take(compressed));
    if (data.length !== size) throw new LevelFormatError('A compressed block of the level is damaged.');
    return data;
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/**
 * Reads a level file. TR1 .tub files (Unfinished Business) move the palette;
 * which layout a TR1 file uses is tried rather than trusted to its name.
 */
export async function parseLevel(bytes: Uint8Array, fileName = ''): Promise<Level> {
    const engine = levelEngine(bytes);
    if (engine === undefined) throw new LevelFormatError(`${fileName || 'This file'} is not a TR1–TR4 level.`);
    const r = new Reader(bytes);
    r.skip(4);

    if (engine === 4) {
        const roomTiles = r.u16();
        const objectTiles = r.u16();
        const bumpTiles = r.u16();
        const tiles32 = await readCompressed(r);
        // The 16-bit copy of the tiles: its uncompressed size, then its data.
        r.skip(4);
        r.skip(r.u32());
        const misc = await readCompressed(r);
        const body = new Reader(await readCompressed(r));
        body.skip(4);
        const level = readBody(body, engine, false);
        const mainCount = roomTiles + objectTiles + bumpTiles;
        if (tiles32.length < mainCount * TILE_BYTES) throw new LevelFormatError('The level has fewer tiles than it says.');
        const tileCount = mainCount + misc.length / TILE_BYTES;
        const tiles = tilesFrom32Bit(concat([tiles32.subarray(0, mainCount * TILE_BYTES), misc]), tileCount);
        return { engine, tiles, tileCount, ...withoutPalette(level) };
    }

    let tiles8: Uint8Array;
    let tileCount: number;
    let tiles: Uint8Array | null = null;
    let palette16: Uint8Array | null = null;
    if (engine === 1) {
        tileCount = r.count32(TILE_TEXELS, 'tiles');
        tiles8 = r.take(tileCount * TILE_TEXELS);
    } else {
        r.skip(768); // 8-bit palette, unused when 16-bit tiles exist
        palette16 = r.take(1024);
        tileCount = r.count32(TILE_TEXELS * 3, 'tiles');
        tiles8 = r.take(tileCount * TILE_TEXELS);
        tiles = tilesFrom16Bit(r.take(tileCount * TILE_TEXELS * 2), tileCount);
    }
    r.skip(4);
    const bodyStart = r.pos;

    let level: Body;
    let tub = /\.tub$/i.test(fileName);
    try {
        level = readBody(r, engine, tub);
        if (engine === 1 && !paletteLooksRight(level.palette8)) throw new LevelFormatError('Not a .phd palette.');
    } catch (error) {
        if (engine !== 1) throw error;
        tub = !tub;
        r.pos = bodyStart;
        level = readBody(r, engine, tub);
        if (!paletteLooksRight(level.palette8)) throw error;
    }

    const paletteIndex = tileCount;
    let swatches: Uint8Array;
    if (engine === 1) {
        const palette = level.palette8!;
        tiles = tilesFrom8Bit(tiles8, tileCount, palette);
        swatches = paletteTile((i) => [palette[i * 3]! * 4, palette[i * 3 + 1]! * 4, palette[i * 3 + 2]! * 4]);
    } else {
        const palette = palette16!;
        swatches = paletteTile((i) => [palette[i * 4]!, palette[i * 4 + 1]!, palette[i * 4 + 2]!]);
    }
    resolveColouredFaces(level.meshes, level.objectTextures, engine, paletteIndex);
    return {
        engine,
        tiles: concat([tiles!, swatches]),
        tileCount: tileCount + 1,
        ...withoutPalette(level),
    };
}

function paletteLooksRight(palette: Uint8Array | null): boolean {
    // 6-bit components only.
    return palette !== null && palette.every((value) => value < 64);
}

function withoutPalette(body: Body): Omit<Body, 'palette8'> {
    const { palette8: _palette, ...rest } = body;
    return rest;
}
