// Poses an object as the first frame of its first animation has it, in
// three.js space: (x, y, z) in the files becomes (x, -y, -z) / 1024, so y is
// up and a floor square is one unit wide. Matrices are 4×4 and column-major,
// as three.js keeps them, so either side can use them without three.js.

import type { Level, MoveableDef } from './types.ts';

export type Matrix = Float64Array;
export type Quaternion = readonly [number, number, number, number];

export const UNIT = 1 / 1024;

export function toThree(x: number, y: number, z: number): [number, number, number] {
    return [x * UNIT, -y * UNIT, -z * UNIT];
}

export function identity(): Matrix {
    const m = new Float64Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
}

/** a × b: b's transform first, then a's. */
export function multiply(a: Matrix, b: Matrix): Matrix {
    const out = new Float64Array(16);
    for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[column * 4 + k]!;
            out[column * 4 + row] = sum;
        }
    }
    return out;
}

/** A translation after a rotation, as three.js's Matrix4.compose with no scale. */
export function compose(position: readonly [number, number, number], q: Quaternion): Matrix {
    const [x, y, z, w] = q;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    const m = new Float64Array(16);
    m[0] = 1 - (yy + zz);
    m[1] = xy + wz;
    m[2] = xz - wy;
    m[4] = xy - wz;
    m[5] = 1 - (xx + zz);
    m[6] = yz + wx;
    m[8] = xz + wy;
    m[9] = yz - wx;
    m[10] = 1 - (xx + yy);
    m[12] = position[0];
    m[13] = position[1];
    m[14] = position[2];
    m[15] = 1;
    return m;
}

/** A rotation about y, then x, then z, as three.js's Euler order 'YXZ'. */
export function quaternionYXZ(x: number, y: number, z: number): Quaternion {
    const c1 = Math.cos(x / 2);
    const c2 = Math.cos(y / 2);
    const c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2);
    const s2 = Math.sin(y / 2);
    const s3 = Math.sin(z / 2);
    return [
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3,
        c1 * c2 * c3 + s1 * s2 * s3,
    ];
}

export function transformPoint(m: Matrix, x: number, y: number, z: number): [number, number, number] {
    return [
        m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
        m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
        m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    ];
}

/** A direction turned by a matrix's rotation, kept unit length. */
export function transformDirection(m: Matrix, x: number, y: number, z: number): [number, number, number] {
    const out: [number, number, number] = [m[0]! * x + m[4]! * y + m[8]! * z, m[1]! * x + m[5]! * y + m[9]! * z, m[2]! * x + m[6]! * y + m[10]! * z];
    const length = Math.hypot(out[0], out[1], out[2]) || 1;
    return [out[0] / length, out[1] / length, out[2] / length];
}

const ANGLE = (Math.PI * 2) / 1024;

/** Where an object's root sits and how each of its parts turns in a frame of animation. */
export function frameRotations(level: Level, frame: number, parts: number): { offset: [number, number, number]; rotations: Quaternion[] } {
    const words = level.frames;
    let p = frame;
    const at = (i: number) => (words[i] ?? 0) & 0xffff;
    const offset = toThree(words[p + 6] ?? 0, words[p + 7] ?? 0, words[p + 8] ?? 0);
    p += 9;
    if (level.engine === 1) p += 1; // TR1 counts its rotations here
    const rotations: Quaternion[] = [];
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
        rotations.push(quaternionYXZ(x, -y, -z));
    }
    return { offset, rotations };
}

const NO_TURN: Quaternion = [0, 0, 0, 1];

/** The matrix of each mesh of an object, as its first frame poses it, after `placement`. */
export function poseMoveable(level: Level, def: MoveableDef, placement: Matrix): Matrix[] {
    const { offset, rotations } = frameRotations(level, def.frame, def.meshCount);
    const matrices: Matrix[] = [multiply(placement, compose(offset, rotations[0] ?? NO_TURN))];
    const stack: number[] = [];
    let parent = 0;
    for (let part = 1; part < def.meshCount; part++) {
        const t = def.meshTree + (part - 1) * 4;
        const flags = level.meshTree[t] ?? 0;
        const local = toThree(level.meshTree[t + 1] ?? 0, level.meshTree[t + 2] ?? 0, level.meshTree[t + 3] ?? 0);
        if (flags & 1) parent = stack.pop() ?? 0;
        if (flags & 2) stack.push(parent);
        const parentMatrix = matrices[parent] ?? matrices[0]!;
        matrices.push(multiply(parentMatrix, compose(local, rotations[part] ?? NO_TURN)));
        parent = part;
    }
    return matrices;
}
