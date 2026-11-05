// The Dagger of Xian (Tomb Raider II): a long, faceted steel blade rising from
// a gold dragon guard. The guard's wings curl down into scrolls like a
// dragon's whiskers, two flames lick up the base of the blade, and a crimson
// "dragon pearl" glows at the heart of the guard. The grip is bound in
// spiralling red cord between gold rings, ending in a bulbous pommel.

import * as THREE from 'three';
import { extrude, merge, place, revolve, taperedTube, type ProfilePoint } from './geometry';
import { gem, gold, leather, steel } from './materials';
import { ArtifactRig, breathe } from './rig';
import type { Artifact } from './types';

const PEARL = '#ff3a2a';
const BLADE_BASE = -0.03;
const BLADE_TIP = 0.95;

/** Half-width of the blade along its length (t: 0 at the guard, 1 at the tip). */
function bladeWidth(t: number): number {
    // A slight leaf swell, then a long curved taper into the point.
    const swell = 0.068 + 0.018 * Math.sin(Math.min(1, t / 0.75) * Math.PI * 0.85);
    const taper = t < 0.62 ? 1 : Math.cos(((t - 0.62) / 0.38) * Math.PI * 0.5) ** 0.75;
    return swell * taper;
}

/**
 * The blade: a lofted 8-sided section (edge bevels + a central ridge on each
 * face), flat-shaded so every facet catches the key light separately. The
 * ridge facets are etched darker for most of the length, leaving bright
 * polished edges and a polished point.
 */
function bladeGeometry(): THREE.BufferGeometry {
    const rows = 30;
    // Cross-section around the blade: [x, z] in units of (half-width, half-thickness).
    const section: [number, number][] = [
        [1, 0],
        [0.6, 0.55],
        [0, 1],
        [-0.6, 0.55],
        [-1, 0],
        [-0.6, -0.55],
        [0, -1],
        [0.6, -0.55],
    ];
    /** Facets between section points i and i + 1 that form the central ridge. */
    const ridge = new Set([1, 2, 5, 6]);
    const polished = new THREE.Color(1, 1, 1);
    const etched = new THREE.Color(0.42, 0.45, 0.55);
    const ring = (t: number): THREE.Vector3[] => {
        const w = bladeWidth(t);
        const th = Math.max(w * 0.26, 0.0001);
        const y = BLADE_BASE + (BLADE_TIP - BLADE_BASE) * t;
        return section.map(([x, z]) => new THREE.Vector3(x * w, y, z * th));
    };
    const positions: number[] = [];
    const colors: number[] = [];
    // Etched ridge facets fade back to polish towards the point (by vertex height).
    const etchAt = (v: THREE.Vector3) => {
        const t = (v.y - BLADE_BASE) / (BLADE_TIP - BLADE_BASE);
        return etched.clone().lerp(polished, THREE.MathUtils.smoothstep(t, 0.55, 0.8));
    };
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, etch = false) => {
        for (const v of [a, b, c]) {
            const color = etch ? etchAt(v) : polished;
            positions.push(v.x, v.y, v.z);
            colors.push(color.r, color.g, color.b);
        }
    };
    let prev = ring(0);
    // Base cap (hidden in the guard, but keeps the mesh closed).
    for (let i = 1; i < section.length - 1; i++) tri(prev[0]!, prev[i]!, prev[i + 1]!);
    for (let r = 1; r <= rows; r++) {
        const t = r / rows;
        const next = r === rows ? section.map(() => new THREE.Vector3(0, BLADE_TIP, 0)) : ring(t);
        for (let i = 0; i < section.length; i++) {
            const j = (i + 1) % section.length;
            const etch = ridge.has(i);
            tri(prev[i]!, next[i]!, prev[j]!, etch);
            if (r < rows) tri(prev[j]!, next[i]!, next[j]!, etch);
        }
        prev = next;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
}

/** One side of the guard: a dragon-whisker scroll, a flame along the blade, and a spur. */
function guardWing(side: 1 | -1): THREE.BufferGeometry[] {
    const p = (x: number, y: number, z: number) => new THREE.Vector3(x * side, y, z);
    const scroll = new THREE.CatmullRomCurve3([
        p(0.04, -0.045, 0),
        p(0.12, -0.03, 0.01),
        p(0.2, -0.035, 0.02),
        p(0.265, -0.075, 0.025),
        p(0.28, -0.135, 0.02),
        p(0.245, -0.175, 0.012),
        p(0.198, -0.162, 0.006),
        p(0.19, -0.122, 0),
        p(0.215, -0.1, 0),
        p(0.238, -0.118, 0),
    ]);
    const flame = new THREE.CatmullRomCurve3([
        p(0.04, -0.06, 0),
        p(0.1, -0.02, 0),
        p(0.135, 0.05, 0),
        p(0.13, 0.13, 0),
        p(0.1, 0.19, 0),
        p(0.075, 0.2, 0),
    ]);
    const spur = new THREE.CatmullRomCurve3([p(0.05, -0.07, 0), p(0.1, -0.12, 0.01), p(0.11, -0.17, 0.0), p(0.09, -0.2, 0)]);
    return [
        taperedTube(scroll, 40, 8, (t) => 0.036 * (1 - t) ** 0.8 + 0.009),
        taperedTube(flame, 22, 7, (t) => 0.032 * (1 - t) ** 0.9 + 0.004, 0.65),
        taperedTube(spur, 10, 6, (t) => 0.02 * (1 - t) + 0.005, 0.8),
    ];
}

/** The grip's swelling profile, sampled densely so the cord wrap has rows to live on. */
function gripProfile(): ProfilePoint[] {
    const rows = 34;
    return Array.from({ length: rows + 1 }, (_, i) => {
        const t = i / rows;
        return [0.041 + 0.007 * Math.sin(Math.PI * t), -0.095 - 0.53 * t] as const;
    });
}

const POMMEL: ProfilePoint[] = [
    [0.03, -0.615],
    [0.06, -0.635, 1],
    [0.068, -0.66],
    [0.083, -0.7],
    [0.08, -0.74],
    [0.055, -0.765, 1],
    [0.042, -0.775, 1],
    [0.056, -0.79],
    [0.06, -0.815],
    [0.048, -0.845],
    [0.024, -0.87],
    [0, -0.876],
];

/** A raised gold band of half-height `h` at height `y`. */
function ring(y: number, r: number, h: number): ProfilePoint[] {
    return [
        [r - 0.012, y + h],
        [r, y + h, 1],
        [r + 0.008, y + h * 0.4],
        [r + 0.008, y - h * 0.4],
        [r, y - h, 1],
        [r - 0.012, y - h],
    ];
}

export function createDagger(): Artifact {
    const rig = new ArtifactRig('dagger');
    rig.setSway({ phase: 0.9 });
    const blade = rig.material(steel({ flatShading: true, vertexColors: true }));
    const metal = rig.material(gold());
    const cord = rig.material(leather({ vertexColors: true }));
    const pearl = rig.material(gem(PEARL, 1.4));

    rig.mesh(bladeGeometry(), blade);

    // Spiral-bound cord: the radius dips along a helix, and the dips are
    // darkened, so the wrapped turns read even at a distance.
    const grip = revolve(gripProfile(), 18, (theta, r, y) => r * (0.9 + 0.1 * Math.sqrt(Math.abs(Math.sin(theta + y * 95)))));
    const gp = grip.getAttribute('position');
    const shade = new Float32Array(gp.count * 3);
    for (let i = 0; i < gp.count; i++) {
        const v = 0.45 + 0.55 * Math.sqrt(Math.abs(Math.sin(Math.atan2(gp.getX(i), gp.getZ(i)) + gp.getY(i) * 95)));
        shade.set([v, v, v], i * 3);
    }
    grip.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    rig.mesh(grip, cord);

    // A pointed gold sleeve grips the base of the blade, like the dragon's jaws.
    const sleeveShape = new THREE.Shape([
        new THREE.Vector2(-0.092, -0.06),
        new THREE.Vector2(0.092, -0.06),
        new THREE.Vector2(0.088, 0.03),
        new THREE.Vector2(0.06, 0.085),
        new THREE.Vector2(0.0, 0.16),
        new THREE.Vector2(-0.06, 0.085),
        new THREE.Vector2(-0.088, 0.03),
    ]);
    const sleeve = extrude(sleeveShape, { depth: 0.036, bevel: 0.01, bevelSegments: 2, curveSegments: 1 });

    const guardCore = place(revolve([[0, 0.02], [0.05, 0.005], [0.075, -0.04], [0.06, -0.085], [0.035, -0.1], [0, -0.105]], 20), [0, 0, 0], [0, 0, 0], [1.35, 1, 0.8]);
    const furniture = [
        sleeve,
        guardCore,
        ...guardWing(1),
        ...guardWing(-1),
        revolve(ring(-0.11, 0.05, 0.016), 20),
        revolve(ring(-0.36, 0.053, 0.014), 20),
        revolve(ring(-0.6, 0.05, 0.016), 20),
        revolve(POMMEL, 20),
    ];
    rig.mesh(merge(furniture), metal);

    // The dragon pearl, set front and back into the guard.
    const pearlGeo = merge([
        place(new THREE.IcosahedronGeometry(0.036, 1), [0, -0.045, 0.047], [0, 0, 0], [1, 1, 0.7]),
        place(new THREE.IcosahedronGeometry(0.036, 1), [0, -0.045, -0.047], [0, 0, 0], [1, 1, 0.7]),
    ]);
    rig.mesh(pearlGeo, pearl);
    const glint = rig.halo(PEARL, 0.42, [0, -0.045, 0.07], 0.5);

    return rig.finish((t) => {
        const pulse = breathe(t, 0.9, 1.3);
        pearl.pulse = 0.6 + 0.7 * pulse;
        glint.pulse = 0.5 + 0.8 * pulse;
    });
}
