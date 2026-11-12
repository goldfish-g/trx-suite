// Lara's guns in a game made before TRX dressed her in outfits: the converter
// gives each level an object of the gun meshes it carries, which TRX draws
// over hers at each joint. TR2 drew a rifle on her back with the rifle
// object's head mesh, one bone on from her torso, and left that object's
// torso mesh a stand-in; TR1 swapped her torso for the rifle object's.
import { describe, expect, it } from 'vitest';
import { withGunsObject } from '../../../converter/client/src/converter/legacy.ts';
import {
    addMeshObject,
    boneOffset,
    frameRotation,
    meshData,
    placeMesh,
    readLevelObjects,
} from '../../../converter/client/src/converter/level.ts';

type Vertex = [number, number, number];

/** A mesh of TR1-3's layout: its vertices, normals and one textured triangle per three vertices. */
function mesh(vertices: Vertex[], normals: Vertex[] = []): number[] {
    const words: number[] = [0, 0, 0, 100, 0]; // centre, collision radius
    words.push(vertices.length, ...vertices.flat());
    words.push(normals.length, ...normals.flat());
    words.push(0); // textured quads
    const triangles = Math.floor(vertices.length / 3);
    words.push(triangles);
    for (let i = 0; i < triangles; i++) words.push(i * 3, i * 3 + 1, i * 3 + 2, 5);
    words.push(0, 0); // coloured quads, triangles
    return words;
}

type TestObject = { id: number; meshes: number[][]; bones?: Vertex[]; frame?: number[] };

/**
 * A level file with only the tables the converter reads around objects:
 * no rooms, the given objects' meshes, bones and first frames, and a tail
 * that must come through unchanged.
 */
function level(game: 1 | 2, objects: TestObject[]): Uint8Array {
    const parts: number[] = [];
    const u32 = (v: number) => parts.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
    const u16 = (v: number) => parts.push(v & 255, (v >> 8) & 255);
    u32(game === 1 ? 0x20 : 45);
    if (game === 2) for (let i = 0; i < 1792; i++) parts.push(0);
    u32(0); // texture pages
    u32(0); // unused
    u16(0); // rooms
    u32(0); // floor data

    const meshWords: number[] = [];
    const pointers: number[] = [];
    const firstMesh: number[] = [];
    const shared = new Map<number[], number>();
    for (const object of objects) {
        firstMesh.push(pointers.length);
        for (const words of object.meshes) {
            let pointer = shared.get(words);
            if (pointer === undefined) {
                pointer = meshWords.length * 2;
                shared.set(words, pointer);
                meshWords.push(...words);
            }
            pointers.push(pointer);
        }
    }
    u32(meshWords.length);
    meshWords.forEach((w) => u16(w & 0xffff));
    u32(pointers.length);
    pointers.forEach(u32);
    for (let i = 0; i < 4; i++) u32(0); // animations, changes, ranges, commands

    const bones: number[] = [];
    const trees: number[] = [];
    for (const object of objects) {
        trees.push(bones.length);
        for (let i = 1; i < object.meshes.length; i++) bones.push(0, ...(object.bones?.[i - 1] ?? [0, 0, 0]));
    }
    u32(bones.length);
    bones.forEach(u32);

    const frames: number[] = [];
    const frameAt: number[] = [];
    for (const object of objects) {
        frameAt.push(frames.length * 2);
        frames.push(...(object.frame ?? []));
    }
    u32(frames.length);
    frames.forEach((w) => u16(w & 0xffff));

    u32(objects.length);
    objects.forEach((object, i) => {
        u32(object.id);
        u16(object.meshes.length);
        u16(firstMesh[i]);
        u32(trees[i]);
        u32(frameAt[i]);
        u16(0xffff);
    });
    parts.push(0xde, 0xad, 0xbe, 0xef); // what follows the objects
    return Uint8Array.from(parts);
}

/** A first frame turning nothing but the head, by the given packed words. */
function tr2Frame(head: number[]): number[] {
    return [...new Array(9).fill(0), ...new Array(14).fill(0x4000), ...head];
}

const lara = (marker: number) => Array.from({ length: 15 }, (_, i) => mesh([[marker, i, 0], [1, 0, 0], [0, 1, 0]]));
const standIn = mesh([[9, 9, 9], [9, 8, 9], [8, 9, 9]]);
const shotgunHead = mesh([[0, 10, 0], [0, 200, 0], [10, 0, 0]], [[0, 16384, 0], [16384, 0, 0], [0, 0, 16384]]);
const shotgunHand = mesh([[5, 5, 5], [6, 5, 5], [5, 6, 5]]);

function vertices(bytes: Uint8Array): Vertex[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getInt16(10, true);
    return Array.from({ length: count }, (_, i) => [0, 2, 4].map((o) => view.getInt16(12 + i * 6 + o, true)) as Vertex);
}

describe('mesh placing', () => {
    it('turns Y, X, Z as Matrix_Rot16 does, then offsets', () => {
        const bytes = Uint8Array.from(new Uint8Array(new Uint16Array(mesh([[0, 100, 0]], [[0, 16384, 0]])).buffer));
        // A quarter turn about X takes +Y to +Z.
        const placed = placeMesh(bytes, { x: 16384, y: 0, z: 0 }, { x: 1, y: 2, z: 3 });
        expect(vertices(placed)).toEqual([[1, 2, 103]]);
        const view = new DataView(placed.buffer);
        expect([view.getInt16(20, true), view.getInt16(22, true), view.getInt16(24, true)]).toEqual([0, 0, 16384]);
        // A quarter turn about Y takes +X to -Z; about Z, +X to +Y.
        const x = Uint8Array.from(new Uint8Array(new Uint16Array(mesh([[100, 0, 0]])).buffer));
        expect(vertices(placeMesh(x, { x: 0, y: 16384, z: 0 }, { x: 0, y: 0, z: 0 }))).toEqual([[0, 0, -100]]);
        expect(vertices(placeMesh(x, { x: 0, y: 0, z: 16384 }, { x: 0, y: 0, z: 0 }))).toEqual([[0, 100, 0]]);
    });

    it('reads a TR2 frame packed one axis or three at a time', () => {
        // Three axes: x = 1, y = 2, z = 3 (in 1024ths), packed as TRX's M_ExtractRotation reads them.
        const head = [(1 << 4) | (2 >> 6), ((2 & 63) << 10) | 3];
        const data = level(2, [{ id: 3, meshes: lara(3), frame: tr2Frame(head) }]);
        const objects = readLevelObjects(data)!;
        const rotation = frameRotation(data, objects, objects.objects[0], 14);
        expect(rotation).toEqual({ x: 64, y: 128, z: 192 });
        expect(frameRotation(data, objects, objects.objects[0], 13)).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('appends new meshes to the mesh data and keeps what follows', () => {
        const data = level(2, [{ id: 0, meshes: lara(1) }]);
        const objects = readLevelObjects(data)!;
        const extra = placeMesh(meshData(data, objects, 3), { x: 0, y: 0, z: 0 }, { x: 0, y: -50, z: 0 });
        const out = addMeshObject(data, objects, 333, [0, extra, 2]);
        const after = readLevelObjects(out)!;
        const added = after.objects.find((o) => o.id === 333)!;
        expect(added.meshCount).toBe(3);
        expect(meshData(out, after, added.firstMesh)).toEqual(meshData(data, objects, 0));
        expect(vertices(meshData(out, after, added.firstMesh + 1))).toEqual([[1, -47, 0], [1, -50, 0], [0, -49, 0]]);
        expect(after.meshPointers[added.firstMesh + 1] % 4).toBe(0);
        for (let i = 0; i < 15; i++) expect(meshData(out, after, i)).toEqual(meshData(data, objects, i));
        expect(Array.from(out.subarray(-4))).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });
});

describe('guns object', () => {
    const shotgun = (game: 1 | 2): TestObject => {
        const meshes = new Array(15).fill(standIn);
        meshes[10] = shotgunHand;
        if (game === 1) meshes[7] = mesh([[7, 7, 7], [7, 8, 7], [8, 7, 7]]);
        else meshes[14] = shotgunHead;
        const bones: Vertex[] = new Array(14).fill([0, 0, 0]);
        bones[13] = [2, -198, -23];
        return { id: game === 1 ? 2 : 3, meshes, bones, frame: game === 1 ? undefined : tr2Frame([0x4000 | 1]) };
    };

    it('puts a TR2 rifle on her back as TR2 drew it, not its stand-in torso', () => {
        const data = level(2, [{ id: 0, meshes: lara(1) }, shotgun(2)]);
        const out = withGunsObject(data, 2)!;
        const objects = readLevelObjects(out)!;
        const guns = objects.objects.find((o) => o.id === 333)!;
        expect(guns.meshCount).toBe(15 * 9);
        // TR2's blocks: pistols, autos, uzis, shotgun, …; the shotgun is the fourth.
        const base = 4 * 15;
        const back = vertices(meshData(out, objects, guns.firstMesh + base + 7));
        // Turned a 1024th of a circle about X, then moved one bone on.
        const turn = (64 / 65536) * 2 * Math.PI;
        const expected = ([[0, 10, 0], [0, 200, 0], [10, 0, 0]] as Vertex[]).map(([x, y, z]) => [
            x + 2,
            Math.round(y * Math.cos(turn) - z * Math.sin(turn)) - 198,
            Math.round(y * Math.sin(turn) + z * Math.cos(turn)) - 23,
        ]);
        expect(back).toEqual(expected);
        expect(meshData(out, objects, guns.firstMesh + base + 10)).toEqual(meshData(data, readLevelObjects(data)!, 15 + 10));
        // A gun the level has no object for is her own meshes again.
        expect(meshData(out, objects, guns.firstMesh + 15 + 7)).toEqual(meshData(data, readLevelObjects(data)!, 7));
    });

    it('keeps the TR1 rifle object\'s torso, which TR1 swapped hers for', () => {
        const data = level(1, [{ id: 0, meshes: lara(1) }, shotgun(1)]);
        const out = withGunsObject(data, 1)!;
        const objects = readLevelObjects(out)!;
        const guns = objects.objects.find((o) => o.id === 289)!;
        // TR1's blocks: pistols, shotgun, …; the shotgun is the second.
        expect(vertices(meshData(out, objects, guns.firstMesh + 2 * 15 + 7))).toEqual([[7, 7, 7], [7, 8, 7], [8, 7, 7]]);
    });

    it('puts a TR1 level\'s TR2-style rifle on her back, as TRX 1.0 drew it', () => {
        const tr2Style = { ...shotgun(2), id: 2, frame: [...new Array(10).fill(0), ...new Array(30).fill(0)] };
        const data = level(1, [{ id: 0, meshes: lara(1) }, tr2Style]);
        const out = withGunsObject(data, 1)!;
        const objects = readLevelObjects(out)!;
        const guns = objects.objects.find((o) => o.id === 289)!;
        expect(vertices(meshData(out, objects, guns.firstMesh + 2 * 15 + 7))).toEqual([[2, -188, -23], [2, 2, -23], [12, -198, -23]]);
    });

    it('draws her own mesh where a gun object has only a stand-in', () => {
        // Pistols whose holsters the level left to an injection.
        const pistols = new Array(15).fill(standIn);
        pistols[10] = shotgunHand;
        const data = level(1, [{ id: 0, meshes: lara(1) }, { id: 1, meshes: pistols }]);
        const out = withGunsObject(data, 1)!;
        const objects = readLevelObjects(out)!;
        const before = readLevelObjects(data)!;
        const guns = objects.objects.find((o) => o.id === 289)!;
        expect(meshData(out, objects, guns.firstMesh + 15 + 1)).toEqual(meshData(data, before, 1));
        expect(meshData(out, objects, guns.firstMesh + 15 + 10)).toEqual(meshData(data, before, 15 + 10));
    });

    it('reads its own bones and frames back from the level', () => {
        const data = level(2, [{ id: 0, meshes: lara(1) }, shotgun(2)]);
        const objects = readLevelObjects(data)!;
        const object = objects.objects.find((o) => o.id === 3)!;
        expect(boneOffset(data, objects, object, 14)).toEqual({ x: 2, y: -198, z: -23 });
        expect(frameRotation(data, objects, object, 14)).toEqual({ x: 64, y: 0, z: 0 });
    });
});
