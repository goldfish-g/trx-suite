// The Golden Mask (Tomb Raider II: The Golden Mask): a ceremonial face of
// beaten gold, curved to fit a face, with a heavy brow ridge, a
// faceted nose, full lips and ear spools. Turquoise is inlaid on the brow and
// cheeks, and cold spirit-light burns behind the eye slits.
//
// Every part starts as a flat beveled extrusion (outline with eye and mouth
// holes, rim, brow, inlays). Each is tessellated and then bent onto the same
// curved surface by moving its vertices, with normals corrected analytically,
// so the bevels stay crisp and the parts stay seated on the face.

import * as THREE from 'three';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { extrude, merge, place, spline2, strokeShape } from './geometry';
import { glow, gold, turquoise } from './materials';
import { ArtifactRig, breathe } from './rig';
import type { Artifact } from './types';

const SPIRIT = '#9fe8ff';

/** How strongly the plate curves back: z sag = KX·x² + KY·y². */
const KX = 0.85;
const KY = 0.22;
/** Pushes the curved plate forward so it is centred on z = 0. */
const Z_SHIFT = 0.13;
const sag = (x: number, y: number) => KX * x * x + KY * y * y;

/** Plate thickness; FRONT is the z of the plate's front face before bending. */
const DEPTH = 0.035;
const BEVEL = 0.022;
const FRONT = DEPTH / 2 + BEVEL;

const EYE_X = 0.2;
const EYE_Y = 0.15;
const MOUTH_Y = -0.43;

/** Bends a flat (z-facing) geometry onto the mask's curved surface, in place. */
function bend(geo: THREE.BufferGeometry): THREE.BufferGeometry {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        pos.setZ(i, pos.getZ(i) - sag(x, y) + Z_SHIFT);
        // Inverse-transpose of the bend's Jacobian: n' = (nx + gx·nz, ny + gy·nz, nz).
        n.fromBufferAttribute(nor, i);
        n.set(n.x + 2 * KX * x * n.z, n.y + 2 * KY * y * n.z, n.z).normalize();
        nor.setXYZ(i, n.x, n.y, n.z);
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    return geo;
}

/** Extrudes, lifts to height `z` above the plate centre, tessellates and bends. */
function relief(shapes: THREE.Shape | THREE.Shape[], depth: number, bevel: number, z: number, maxEdge = 0.16): THREE.BufferGeometry {
    const flat = place(extrude(shapes, { depth, bevel, bevelSegments: 1, curveSegments: 12 }), [0, 0, z]);
    const fine = new TessellateModifier(maxEdge, 8).modify(flat);
    flat.dispose();
    return bend(fine);
}

/** The face outline, clockwise from the top centre, as a smooth closed polygon. */
function faceOutline(): THREE.Vector2[] {
    const right = spline2(
        [
            [0, 0.79],
            [0.2, 0.77],
            [0.37, 0.69],
            [0.47, 0.54],
            [0.505, 0.34],
            [0.5, 0.12],
            [0.47, -0.1],
            [0.41, -0.33],
            [0.31, -0.54],
            [0.18, -0.7],
            [0.07, -0.78],
            [0, -0.8],
        ],
        28,
    );
    const left = right
        .slice(1, -1)
        .reverse()
        .map((p) => new THREE.Vector2(-p.x, p.y));
    return [...right, ...left];
}

/**
 * Almond outline centred at (cx, cy): two parabolic lids meeting in sharp
 * corners, the lower one flatter. `side` mirrors it for the left eye so the
 * tilt and the raised outer corner (`lift`) stay symmetric.
 */
function almond(cx: number, cy: number, w: number, h: number, tilt = 0, lift = 0, side = 1): THREE.Vector2[] {
    const n = 9;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < 2 * n; i++) {
        const upper = i < n;
        const s = upper ? 1 - (2 * i) / n : -1 + (2 * (i - n)) / n;
        const x = s * w;
        const y = (upper ? h : -0.75 * h) * (1 - s * s) + lift * s;
        const xr = x * Math.cos(tilt) - y * Math.sin(tilt);
        const yr = x * Math.sin(tilt) + y * Math.cos(tilt);
        pts.push(new THREE.Vector2(cx + side * xr, cy + yr));
    }
    return side < 0 ? pts.reverse() : pts;
}

const eye = (side: number, grow = 0) => almond(side * EYE_X, EYE_Y, 0.115 + grow, 0.04 + grow * 0.8, 0.12, 0.012, side);
const mouth = (grow = 0) => almond(0, MOUTH_Y, 0.13 + grow, 0.022 + grow * 0.6);

/** A ring shape: `outer` with `inner` cut out. */
function ring(outer: THREE.Vector2[], inner: THREE.Vector2[]): THREE.Shape {
    const shape = new THREE.Shape(outer);
    shape.holes.push(new THREE.Path(inner));
    return shape;
}

/** Faceted nose: a wedge from the bridge to a raised tip, flat-shaded. */
function noseGeometry(): THREE.BufferGeometry {
    const v = (x: number, y: number, z: number) => [x, y, FRONT + z] as const;
    const top = v(0, 0.25, -0.005);
    const bridgeL = v(-0.033, 0.12, 0.035);
    const bridgeR = v(0.033, 0.12, 0.035);
    const tip = v(0, -0.13, 0.14);
    const wingL = v(-0.085, -0.16, 0.02);
    const wingR = v(0.085, -0.16, 0.02);
    const base = v(0, -0.185, 0.065);
    const faces = [
        [top, bridgeL, bridgeR],
        [bridgeL, tip, bridgeR],
        [top, wingL, bridgeL],
        [bridgeL, wingL, tip],
        [top, bridgeR, wingR],
        [bridgeR, tip, wingR],
        [wingL, base, tip],
        [tip, base, wingR],
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(faces.flat(2), 3));
    geo.computeVertexNormals();
    const fine = new TessellateModifier(0.08, 6).modify(geo);
    geo.dispose();
    return bend(fine);
}

/** A bar that tapers to points at both ends. */
const bar = (points: [number, number][], w: number) => strokeShape(spline2(points, 16), (t) => w * Math.min(1, 6 * t, 6 * (1 - t)));

export function createMask(): Artifact {
    const rig = new ArtifactRig('mask');
    rig.setSway({ phase: 4.5 });
    rig.setPresence(0.92);
    const metal = rig.material(gold());
    const inlay = rig.material(turquoise());
    const spirit = rig.material(glow(SPIRIT, 2.8));

    // The face plate with its eye and mouth openings.
    const outline = faceOutline();
    const face = new THREE.Shape(outline);
    face.holes.push(new THREE.Path(eye(1)), new THREE.Path(eye(-1)), new THREE.Path(mouth()));
    const plate = relief(face, DEPTH, BEVEL, 0);

    // Brow ridge: a gull-wing band arching over both eyes, heaviest at the centre.
    const browPts = spline2([[-0.43, 0.27], [-0.25, 0.32], [-0.06, 0.275], [0, 0.26], [0.06, 0.275], [0.25, 0.32], [0.43, 0.27]], 30);
    const brow = relief(strokeShape(browPts, (t) => 0.02 + 0.026 * Math.sin(Math.PI * t) ** 0.5), 0.03, 0.016, FRONT + 0.01);

    // Raised lids around the eyes and full lips around the mouth.
    const lids = relief([ring(eye(1, 0.03), eye(1)), ring(eye(-1, 0.03), eye(-1))], 0.014, 0.01, FRONT + 0.004);
    const lips = relief(
        [
            strokeShape(spline2([[-0.16, -0.425], [-0.07, -0.392], [0, -0.398], [0.07, -0.392], [0.16, -0.425]], 16), (t) => 0.024 * Math.sin(Math.PI * t) ** 0.6 + 0.002),
            strokeShape(spline2([[-0.14, -0.445], [0, -0.475], [0.14, -0.445]], 14), (t) => 0.03 * Math.sin(Math.PI * t) ** 0.6 + 0.002),
        ],
        0.02,
        0.012,
        FRONT + 0.006,
    );

    // A medallion on the forehead: gold lozenge frame around a turquoise stone.
    const lozenge = (cx: number, cy: number, w: number, h: number) => [
        new THREE.Vector2(cx, cy + h),
        new THREE.Vector2(cx - w, cy),
        new THREE.Vector2(cx, cy - h),
        new THREE.Vector2(cx + w, cy),
    ];
    const medallion = relief(ring(lozenge(0, 0.5, 0.095, 0.13), lozenge(0, 0.5, 0.06, 0.088)), 0.022, 0.012, FRONT + 0.006);

    // Ear spools on either side, seated on the plate's curve (not bent themselves).
    const spools: THREE.BufferGeometry[] = [];
    const spoolInlays: THREE.BufferGeometry[] = [];
    for (const side of [1, -1]) {
        spools.push(place(new THREE.TorusGeometry(0.068, 0.024, 6, 18), [side * 0.505, 0.12, 0], [0, side * 0.6, 0]));
        spoolInlays.push(place(new THREE.CylinderGeometry(0.058, 0.058, 0.02, 16, 1), [side * 0.505, 0.12, 0], [Math.PI / 2, 0, -side * 0.6]));
    }
    for (const g of [...spools, ...spoolInlays]) g.translate(0, 0, -sag(0.505, 0.12) + Z_SHIFT + 0.01);

    rig.mesh(merge([plate, brow, lids, lips, medallion, noseGeometry(), ...spools]), metal);

    // Turquoise: the forehead stone and paired cheek bars.
    const stones = relief(
        [
            new THREE.Shape(lozenge(0, 0.5, 0.068, 0.096)),
            bar([[0.1, 0.03], [0.24, 0.0], [0.38, 0.01]], 0.016),
            bar([[0.12, -0.05], [0.25, -0.085], [0.36, -0.07]], 0.014),
            bar([[-0.1, 0.03], [-0.24, 0.0], [-0.38, 0.01]], 0.016),
            bar([[-0.12, -0.05], [-0.25, -0.085], [-0.36, -0.07]], 0.014),
        ],
        0.01,
        0.006,
        FRONT,
    );
    rig.mesh(merge([stones, ...spoolInlays]), inlay);

    // Spirit light behind the eye slits (and a hint of it in the mouth).
    const lights: THREE.BufferGeometry[] = [];
    for (const [x, y] of [
        [EYE_X, EYE_Y],
        [-EYE_X, EYE_Y],
        [0, MOUTH_Y],
    ] as const) {
        lights.push(place(new THREE.CircleGeometry(1, 20), [x, y, -sag(x, y) + Z_SHIFT - 0.06], [0, 0, 0], [0.16, 0.075, 1]));
    }
    rig.mesh(merge(lights), spirit);
    const glints = [
        rig.halo(SPIRIT, 0.36, [EYE_X, EYE_Y, -sag(EYE_X, EYE_Y) + Z_SHIFT + 0.04], 0.5),
        rig.halo(SPIRIT, 0.36, [-EYE_X, EYE_Y, -sag(EYE_X, EYE_Y) + Z_SHIFT + 0.04], 0.5),
    ];

    return rig.finish((t) => {
        const pulse = breathe(t, 0.5, 3.1);
        spirit.pulse = 0.6 + 0.6 * pulse;
        for (const g of glints) g.pulse = 0.45 + 0.8 * pulse;
    });
}
