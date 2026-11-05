// The meteorite artifact (Tomb Raider III): a jagged lump of dark meteoric
// iron whose crust has split into plates, with a blue-green core blazing
// through every crack, and a cluster of crystal shards forced out through the
// fractures.
//
// Construction: a noise-displaced icosahedron is cut into Voronoi plates.
// Each plate is mostly flattened onto its own plane (so the rock reads as big
// chipped facets rather than a lumpy ball), shrunk towards its centre to open
// the cracks, and given walls: a thin rock lip, then glowing rock deeper down,
// as if lit from the core beneath.

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { merge, place } from './geometry';
import { gem, glow, rock } from './materials';
import { fbm, gradientNoise, rng } from './noise';
import { ArtifactRig, breathe } from './rig';
import type { Artifact } from './types';

const CORE = '#0fd9a6';
const SEED = 115;
const PLATES = 28;

/** Overall stretch of the rock: taller than wide, like a fallen shard. */
const STRETCH = new THREE.Vector3(0.68, 0.76, 0.62);
/** Wall depths as fractions of the radius: the rock lip, then the lit interior. */
const LIP = 0.92;
const FLOOR = 0.8;

function crustGeometry(): { crust: THREE.BufferGeometry; seams: THREE.BufferGeometry } {
    const noise = gradientNoise(SEED);
    const random = rng(SEED);
    const base = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'));
    const pos = base.getAttribute('position');
    const index = base.getIndex();
    if (!index) throw new Error('expected indexed icosahedron');

    // Broad lumps give the outline; plates are flattened later.
    const dirs: THREE.Vector3[] = [];
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
        const d = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
        const lumps = fbm(noise, d.x * 1.3, d.y * 1.3, d.z * 1.3, 2);
        dirs.push(d);
        verts.push(d.clone().multiplyScalar(1 + 0.34 * lumps).multiply(STRETCH));
    }

    // Voronoi plates over the sphere, with warped borders.
    const seeds = Array.from({ length: PLATES }, () => new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize());
    const faces: [number, number, number][] = [];
    for (let f = 0; f < index.count; f += 3) faces.push([index.getX(f), index.getX(f + 1), index.getX(f + 2)]);
    const plateOf = faces.map(([a, b, c]) => {
        const centre = dirs[a]!.clone().add(dirs[b]!).add(dirs[c]!).normalize();
        centre.x += 0.16 * noise(centre.x * 4, centre.y * 4 + 3, centre.z * 4);
        centre.y += 0.16 * noise(centre.x * 4 + 5, centre.y * 4, centre.z * 4);
        let best = 0;
        let bestDot = -Infinity;
        seeds.forEach((s, i) => {
            const dot = s.dot(centre);
            if (dot > bestDot) {
                bestDot = dot;
                best = i;
            }
        });
        return best;
    });

    // Each plate's centre and facet normal (area-weighted face normals).
    const centres = seeds.map(() => new THREE.Vector3());
    const normals = seeds.map(() => new THREE.Vector3());
    const counts = seeds.map(() => 0);
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    faces.forEach(([a, b, c], f) => {
        const p = plateOf[f]!;
        centres[p]!.add(verts[a]!).add(verts[b]!).add(verts[c]!);
        counts[p]! += 3;
        ab.subVectors(verts[b]!, verts[a]!);
        ac.subVectors(verts[c]!, verts[a]!);
        normals[p]!.add(ab.cross(ac));
    });
    centres.forEach((c, i) => c.divideScalar(Math.max(1, counts[i]!)));
    normals.forEach((n) => n.normalize());
    // Facet tilt jitter, flatness and crack width vary per plate.
    normals.forEach((n) => n.add(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(0.12)).normalize());
    const flatness = seeds.map(() => 0.35 + random() * 0.2);
    const shrink = seeds.map(() => 0.95 + random() * 0.025);

    const moved = (v: number, plate: number) => {
        const c = centres[plate]!;
        const n = normals[plate]!;
        const p = verts[v]!.clone();
        // Pull towards the plate's plane, leaving a little of the original relief.
        const height = p.clone().sub(c).dot(n);
        p.addScaledVector(n, -height * flatness[plate]!);
        p.addScaledVector(dirs[v]!, 0.012 * noise(p.x * 9, p.y * 9, p.z * 9));
        return p.sub(c).multiplyScalar(shrink[plate]!).add(c);
    };

    const edgeFaces = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    faces.forEach((face, f) => {
        for (let e = 0; e < 3; e++) {
            const k = key(face[e]!, face[(e + 1) % 3]!);
            const list = edgeFaces.get(k) ?? [];
            list.push(f);
            edgeFaces.set(k, list);
        }
    });

    // Each plate gets its own tint (multiplied with the rock colour): some
    // rust-brown, some blue-black iron; crack lips are darker still.
    const tints = seeds.map(() => {
        const rust = new THREE.Color(1.25, 1.05, 0.92);
        const iron = new THREE.Color(0.85, 0.95, 1.2);
        return rust.lerp(iron, random()).multiplyScalar(0.8 + random() * 0.4);
    });
    const lipTint = new THREE.Color(0.55, 0.55, 0.55);

    const crust: number[] = [];
    const crustColors: number[] = [];
    const seams: number[] = [];
    const push = (out: number[], ...vs: THREE.Vector3[]) => vs.forEach((v) => out.push(v.x, v.y, v.z));
    const tint = (c: THREE.Color, count: number) => {
        for (let i = 0; i < count; i++) crustColors.push(c.r, c.g, c.b);
    };
    const wall = (out: number[], o0: THREE.Vector3, o1: THREE.Vector3, i0: THREE.Vector3, i1: THREE.Vector3) =>
        // (o1, o0, i0) keeps the wall facing out of its plate, into the crack.
        push(out, o1, o0, i0, o1, i0, i1);
    faces.forEach((face, f) => {
        const plate = plateOf[f]!;
        const [a, b, c] = face.map((v) => moved(v, plate)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
        push(crust, a, b, c);
        tint(tints[plate]!, 3);
        for (let e = 0; e < 3; e++) {
            const i0 = face[e]!;
            const i1 = face[(e + 1) % 3]!;
            const other = edgeFaces.get(key(i0, i1))!.find((g) => g !== f);
            if (other === undefined || plateOf[other] === plate) continue;
            const o0 = moved(i0, plate);
            const o1 = moved(i1, plate);
            const l0 = o0.clone().multiplyScalar(LIP);
            const l1 = o1.clone().multiplyScalar(LIP);
            wall(crust, o0, o1, l0, l1);
            tint(lipTint, 6);
            wall(seams, l0, l1, o0.clone().multiplyScalar(FLOOR), o1.clone().multiplyScalar(FLOOR));
        }
    });
    base.dispose();
    const build = (data: number[]) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
        geo.computeVertexNormals();
        return geo;
    };
    const crustGeo = build(crust);
    crustGeo.setAttribute('color', new THREE.Float32BufferAttribute(crustColors, 3));
    return { crust: crustGeo, seams: build(seams) };
}

/** A hexagonal crystal with a faceted point, rising from the core along `dir`. */
function shard(dir: THREE.Vector3, from: number, length: number, radius: number, spin: number): THREE.BufferGeometry {
    const body = new THREE.CylinderGeometry(radius, radius * 0.85, length, 6, 1, true);
    body.translate(0, from + length / 2, 0);
    const tip = new THREE.ConeGeometry(radius, radius * 2.4, 6, 1, true);
    tip.translate(0, from + length + radius * 1.2, 0);
    const geo = merge([body, tip]).toNonIndexed();
    geo.computeVertexNormals();
    const d = dir.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    geo.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(d, spin).multiply(q));
    return geo;
}

export function createMeteorite(): Artifact {
    const rig = new ArtifactRig('meteorite');
    rig.setSway({ phase: 1.8, tilt: 0.05 });
    const crust = rig.material(rock({ vertexColors: true }));
    const core = rig.material(glow(CORE, 1.8, { flatShading: true }));
    const crystal = rig.material(gem(CORE, 0.7));

    // Lean the whole rock a little so it doesn't sit like an egg.
    const tilt = new THREE.Group();
    tilt.rotation.set(0.12, 0.5, -0.2);
    rig.body.add(tilt);

    const { crust: crustGeo, seams } = crustGeometry();
    rig.mesh(crustGeo, crust, tilt);
    rig.mesh(
        merge([seams, place(new THREE.IcosahedronGeometry(1, 1), [0, 0, 0], [0, 0, 0], [STRETCH.x * 0.82, STRETCH.y * 0.82, STRETCH.z * 0.82])]),
        core,
        tilt,
    );
    rig.mesh(
        merge([
            shard(new THREE.Vector3(0.2, 1, 0.15), 0.42, 0.35, 0.07, 0.3),
            shard(new THREE.Vector3(-0.5, 0.85, 0.3), 0.4, 0.38, 0.055, 1.1),
            shard(new THREE.Vector3(0.55, 0.7, -0.35), 0.4, 0.33, 0.05, 0.7),
            shard(new THREE.Vector3(0.15, 0.6, 0.8), 0.4, 0.33, 0.045, 0.2),
        ]),
        crystal,
        tilt,
    );

    const aura = rig.halo(CORE, 2.0, [0, 0, 0], 0.28);
    return rig.finish((t) => {
        // An uneven heartbeat: slow swell plus a quicker flicker.
        const pulse = breathe(t, 1.1, 0.4);
        const flicker = 0.5 + 0.5 * Math.sin(t * 9.7) * Math.sin(t * 3.1);
        core.pulse = 0.7 + 0.45 * pulse + 0.1 * flicker;
        crystal.pulse = 0.6 + 0.6 * pulse;
        aura.pulse = 0.7 + 0.5 * pulse;
    });
}
