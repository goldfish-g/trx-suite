// Signed distance fields, meshed once at build time.
//
// The organic artifacts (the Bastet cat, the Hand of Rathmore) are sculpted as
// smooth unions of capsules and ellipsoids and then polygonised with naive
// surface nets. That gives one seamless, cast-looking surface instead of a
// pile of intersecting primitives, at a resolution we choose to fit the
// triangle budget. The field is also reused for cheap ambient occlusion so
// crevices can be tinted (verdigris, cavity darkening) through vertex colours.

import * as THREE from 'three';

export type Sdf = (x: number, y: number, z: number) => number;
export type V3 = readonly [number, number, number];

// The fields below are evaluated tens of thousands of times per artifact, so
// they avoid allocation and Math.hypot (slow in V8) in the per-sample path.

/** Row-major 3×3 that takes world offsets into a primitive's local frame. */
type Basis = readonly [number, number, number, number, number, number, number, number, number];

function basis(rotation?: V3): Basis {
    if (!rotation) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    // The inverse of a rotation is its transpose; Matrix4 elements are column-major,
    // so reading them in order yields the transpose's rows directly.
    const e = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])).elements;
    return [e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!];
}

/** Ellipsoid with radii `r`, optionally rotated (Euler XYZ, radians). Bound, not exact. */
export function ellipsoid(c: V3, r: V3, rotation?: V3): Sdf {
    const [cx, cy, cz] = c;
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = basis(rotation);
    const ix = 1 / r[0];
    const iy = 1 / r[1];
    const iz = 1 / r[2];
    const inside = -Math.min(r[0], r[1], r[2]);
    return (x, y, z) => {
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        const px = m0 * dx + m1 * dy + m2 * dz;
        const py = m3 * dx + m4 * dy + m5 * dz;
        const pz = m6 * dx + m7 * dy + m8 * dz;
        const ax = px * ix;
        const ay = py * iy;
        const az = pz * iz;
        const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
        const bx = ax * ix;
        const by = ay * iy;
        const bz = az * iz;
        const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
        return k1 === 0 ? inside : (k0 * (k0 - 1)) / k1;
    };
}

/** Segment a→b swept by a sphere whose radius goes r1 → r2 (a "round cone"). */
export function roundCone(a: V3, b: V3, r1: number, r2: number): Sdf {
    const bax = b[0] - a[0];
    const bay = b[1] - a[1];
    const baz = b[2] - a[2];
    const l2 = bax * bax + bay * bay + baz * baz;
    const rr = r1 - r2;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    return (x, y, z) => {
        const pax = x - a[0];
        const pay = y - a[1];
        const paz = z - a[2];
        const yy = pax * bax + pay * bay + paz * baz;
        const zz = yy - l2;
        const qx = pax * l2 - bax * yy;
        const qy = pay * l2 - bay * yy;
        const qz = paz * l2 - baz * yy;
        const x2 = qx * qx + qy * qy + qz * qz;
        const y2 = yy * yy * l2;
        const z2 = zz * zz * l2;
        const k = Math.sign(rr) * rr * rr * x2;
        if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
        if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
        return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    };
}

/** Box with half-extents `h` and rounded edges of radius `round`, optionally rotated. */
export function roundBox(c: V3, h: V3, round: number, rotation?: V3): Sdf {
    const [cx, cy, cz] = c;
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = basis(rotation);
    const hx = h[0] - round;
    const hy = h[1] - round;
    const hz = h[2] - round;
    return (x, y, z) => {
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        const qx = Math.abs(m0 * dx + m1 * dy + m2 * dz) - hx;
        const qy = Math.abs(m3 * dx + m4 * dy + m5 * dz) - hy;
        const qz = Math.abs(m6 * dx + m7 * dy + m8 * dz) - hz;
        const ox = qx > 0 ? qx : 0;
        const oy = qy > 0 ? qy : 0;
        const oz = qz > 0 ? qz : 0;
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - round;
    };
}

/** Polynomial smooth minimum: blends surfaces within distance `k` of each other. */
export function smin(a: number, b: number, k: number): number {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
}

/** Smooth union of several fields with blend radius `k`. */
export function blend(k: number, ...fields: Sdf[]): Sdf {
    return (x, y, z) => {
        let d = Infinity;
        for (const f of fields) d = d === Infinity ? f(x, y, z) : smin(d, f(x, y, z), k);
        return d;
    };
}

/** Carves `cut` out of `base` with a smooth edge of radius `k`. */
export function carve(base: Sdf, cut: Sdf, k: number): Sdf {
    return (x, y, z) => -smin(-base(x, y, z), cut(x, y, z), k);
}

export interface SdfMesh {
    geometry: THREE.BufferGeometry;
    /** Per-vertex ambient occlusion in [0, 1] (1 = fully open), if requested. */
    occlusion?: Float32Array;
}

/**
 * Polygonises the zero level set of `f` inside [min, max] with naive surface
 * nets. Vertices are snapped onto the surface with a Newton step, and normals
 * come from the field gradient, so shading is smooth at any resolution.
 */
export function meshSdf(f: Sdf, min: V3, max: V3, cell: number, occlusion = false): SdfMesh {
    const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
    const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
    const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
    const values = new Float32Array(nx * ny * nz);

    // Narrow band: sample each 4×4×4 block of grid points at its centre first.
    // If the field there is well beyond the block's reach, no surface passes
    // through it, so its points get a conservative estimate (|d| − offset)
    // instead of a full evaluation. Most of the bounding box is skipped.
    const B = 4;
    const reach = Math.sqrt(3) * (B / 2) * cell;
    for (let bk = 0; bk < nz; bk += B) {
        for (let bj = 0; bj < ny; bj += B) {
            for (let bi = 0; bi < nx; bi += B) {
                const ex = Math.min(bi + B, nx);
                const ey = Math.min(bj + B, ny);
                const ez = Math.min(bk + B, nz);
                const ci = (bi + ex - 1) / 2;
                const cj = (bj + ey - 1) / 2;
                const ck = (bk + ez - 1) / 2;
                const d = f(min[0] + ci * cell, min[1] + cj * cell, min[2] + ck * cell);
                const far = Math.abs(d) > 2 * reach;
                for (let k = bk; k < ez; k++) {
                    for (let j = bj; j < ey; j++) {
                        for (let i = bi; i < ex; i++) {
                            const x = min[0] + i * cell;
                            const y = min[1] + j * cell;
                            const z = min[2] + k * cell;
                            let value: number;
                            if (far) {
                                const di = (i - ci) * cell;
                                const dj = (j - cj) * cell;
                                const dk = (k - ck) * cell;
                                value = Math.sign(d) * (Math.abs(d) - Math.sqrt(di * di + dj * dj + dk * dk));
                            } else {
                                value = f(x, y, z);
                            }
                            values[i + nx * (j + ny * k)] = value;
                        }
                    }
                }
            }
        }
    }
    const value = (i: number, j: number, k: number) => values[i + nx * (j + ny * k)]!;

    // One vertex per cell that straddles the surface: the mean of its edge crossings.
    const cx = nx - 1;
    const cy = ny - 1;
    const cz = nz - 1;
    const cellVertex = new Int32Array(cx * cy * cz).fill(-1);
    const positions: number[] = [];
    const corners = [
        [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
        [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ] as const;
    const edges = [
        [0, 1], [2, 3], [4, 5], [6, 7],
        [0, 2], [1, 3], [4, 6], [5, 7],
        [0, 4], [1, 5], [2, 6], [3, 7],
    ] as const;
    const v = new Float32Array(8);
    for (let k = 0; k < cz; k++) {
        for (let j = 0; j < cy; j++) {
            for (let i = 0; i < cx; i++) {
                let mask = 0;
                for (let c = 0; c < 8; c++) {
                    const [di, dj, dk] = corners[c]!;
                    v[c] = value(i + di, j + dj, k + dk);
                    if (v[c]! < 0) mask |= 1 << c;
                }
                if (mask === 0 || mask === 255) continue;
                let sx = 0;
                let sy = 0;
                let sz = 0;
                let n = 0;
                for (const [a, b] of edges) {
                    const va = v[a]!;
                    const vb = v[b]!;
                    if (va < 0 === vb < 0) continue;
                    const t = va / (va - vb);
                    const ca = corners[a];
                    const cb = corners[b];
                    sx += ca[0] + (cb[0] - ca[0]) * t;
                    sy += ca[1] + (cb[1] - ca[1]) * t;
                    sz += ca[2] + (cb[2] - ca[2]) * t;
                    n++;
                }
                cellVertex[i + cx * (j + cy * k)] = positions.length / 3;
                positions.push(
                    min[0] + (i + sx / n) * cell,
                    min[1] + (j + sy / n) * cell,
                    min[2] + (k + sz / n) * cell,
                );
            }
        }
    }

    // One quad per grid edge that crosses the surface, joining the four cells around it.
    const index: number[] = [];
    const cellAt = (i: number, j: number, k: number) => cellVertex[i + cx * (j + cy * k)]!;
    const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
        if (flip) [b, d] = [d, b];
        const pa = a * 3;
        const pb = b * 3;
        const pc = c * 3;
        const pd = d * 3;
        const ac = (positions[pa]! - positions[pc]!) ** 2 + (positions[pa + 1]! - positions[pc + 1]!) ** 2 + (positions[pa + 2]! - positions[pc + 2]!) ** 2;
        const bd = (positions[pb]! - positions[pd]!) ** 2 + (positions[pb + 1]! - positions[pd + 1]!) ** 2 + (positions[pb + 2]! - positions[pd + 2]!) ** 2;
        if (ac <= bd) index.push(a, b, c, a, c, d);
        else index.push(a, b, d, b, c, d);
    };
    for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const inside = value(i, j, k) < 0;
                if (i < cx && j > 0 && k > 0 && j < ny - 1 && k < nz - 1 && inside !== value(i + 1, j, k) < 0) {
                    quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k), !inside);
                }
                if (j < cy && i > 0 && k > 0 && i < nx - 1 && k < nz - 1 && inside !== value(i, j + 1, k) < 0) {
                    quad(cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1), !inside);
                }
                if (k < cz && i > 0 && j > 0 && i < nx - 1 && j < ny - 1 && inside !== value(i, j, k + 1) < 0) {
                    quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k), !inside);
                }
            }
        }
    }

    // Snap to the surface (one clamped Newton step) and take normals from the
    // gradient, using the 4-sample tetrahedral difference.
    const count = positions.length / 3;
    const pos = new Float32Array(positions);
    const nor = new Float32Array(count * 3);
    const e = cell * 0.25;
    const g = [0, 0, 0];
    const gradient = (x: number, y: number, z: number) => {
        const a = f(x + e, y - e, z - e);
        const b = f(x - e, y - e, z + e);
        const c = f(x - e, y + e, z - e);
        const d = f(x + e, y + e, z + e);
        const gx = a - b - c + d;
        const gy = -a - b + c + d;
        const gz = -a + b - c + d;
        const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
        g[0] = gx / len;
        g[1] = gy / len;
        g[2] = gz / len;
    };
    for (let p = 0; p < count; p++) {
        let x = pos[p * 3]!;
        let y = pos[p * 3 + 1]!;
        let z = pos[p * 3 + 2]!;
        gradient(x, y, z);
        const step = Math.max(-cell * 0.5, Math.min(cell * 0.5, f(x, y, z)));
        x -= g[0]! * step;
        y -= g[1]! * step;
        z -= g[2]! * step;
        gradient(x, y, z);
        pos[p * 3] = x;
        pos[p * 3 + 1] = y;
        pos[p * 3 + 2] = z;
        nor[p * 3] = g[0]!;
        nor[p * 3 + 1] = g[1]!;
        nor[p * 3 + 2] = g[2]!;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setIndex(index);

    if (!occlusion) return { geometry };
    // Classic SDF AO: march along the normal; the field falling short of the
    // marched distance means nearby geometry is crowding this point.
    const ao = new Float32Array(count);
    const step = cell * 1.5;
    for (let p = 0; p < count; p++) {
        const x = pos[p * 3]!;
        const y = pos[p * 3 + 1]!;
        const z = pos[p * 3 + 2]!;
        const n0 = nor[p * 3]!;
        const n1 = nor[p * 3 + 1]!;
        const n2 = nor[p * 3 + 2]!;
        let occ = 0;
        let w = 1;
        for (let s = 1; s <= 4; s++) {
            const h = step * s;
            occ += w * Math.max(0, h - f(x + n0 * h, y + n1 * h, z + n2 * h));
            w *= 0.6;
        }
        ao[p] = Math.max(0, Math.min(1, 1 - (occ / step) * 0.45));
    }
    return { geometry, occlusion: ao };
}
