// The Eye of Horus (The Last Revelation): a pectoral plaque in the shape of an
// Egyptian shrine (naos), its lapis field framed in gold and topped by a
// reeded cavetto cornice. The wedjat eye is cast in raised, beveled gold:
// brow, lids, the cosmetic line, the falcon's cheek marking and its spiral,
// with a carnelian pupil that glows like an ember.

import * as THREE from 'three';
import { extrude, merge, place, spline2, strokeShape } from './geometry';
import { gem, gold, lapis } from './materials';
import { ArtifactRig, breathe } from './rig';
import { lapisTexture } from './textures';
import type { Artifact } from './types';

const EMBER = '#ff7a2c';

/** The shrine outline, grown outward by `g` (used for the frame). */
function naos(g: number): THREE.Shape {
    const right: [number, number][] = [
        [0.0, -0.5 - g],
        [0.55 + g, -0.5 - g],
        [0.59 + g, 0.27 + g * 0.3],
        [0.64 + g, 0.34 + g * 0.6],
        [0.71 + g, 0.45 + g],
        [0.71 + g, 0.52 + g],
    ];
    const pts = [...right, ...right.slice().reverse().map(([x, y]) => [-x, y] as [number, number])];
    return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}

/** A tapered gold stroke along a smooth curve through `points`. */
function stroke(points: [number, number][], width: (t: number) => number, samples = 32): THREE.Shape {
    return strokeShape(spline2(points, samples), width);
}

/** Width profile helpers: constant, tapered to a point at the end, or swelling in the middle. */
const constant = (w: number) => () => w;
const taperEnd = (w: number, keep = 0.6) => (t: number) => (t < keep ? w : w * (1 - ((t - keep) / (1 - keep)) ** 1.5));
const swell = (w0: number, w1: number) => (t: number) => w0 + (w1 - w0) * Math.sin(Math.PI * t);

function eyeShapes(): THREE.Shape[] {
    return [
        // Brow: heavy over the eye, sweeping out to a point behind it.
        stroke([[-0.37, 0.12], [-0.2, 0.2], [0.02, 0.225], [0.25, 0.2], [0.43, 0.15], [0.52, 0.13]], (t) => (t < 0.15 ? 0.022 + 0.1 * t : taperEnd(0.037, 0.55)(t))),
        // Upper lid, ending in the long cosmetic line.
        stroke([[-0.35, -0.005], [-0.2, 0.085], [0.0, 0.115], [0.2, 0.07], [0.32, 0.015], [0.44, 0.03], [0.53, 0.035]], (t) => (t < 0.7 ? 0.024 : taperEnd(0.024, 0.85)(t)), 48),
        // Lower lid.
        stroke([[-0.35, -0.005], [-0.18, -0.065], [0.05, -0.075], [0.22, -0.045], [0.33, 0.012]], constant(0.019)),
        // The falcon's cheek marking: a straight drop with a weighted end.
        stroke([[-0.13, -0.07], [-0.135, -0.2], [-0.15, -0.33]], swell(0.022, 0.028), 16),
        // The spiral flourish.
        stroke(
            [[0.04, -0.07], [0.1, -0.16], [0.18, -0.24], [0.27, -0.3], [0.35, -0.3], [0.385, -0.25], [0.36, -0.2], [0.31, -0.205], [0.3, -0.24]],
            (t) => 0.022 * (1 - 0.45 * t),
            56,
        ),
    ];
}

export function createEye(): Artifact {
    const rig = new ArtifactRig('eye');
    rig.setSway({ phase: 2.7 });
    rig.setPresence(0.9);
    const metal = rig.material(gold());
    const map = rig.track(lapisTexture(9));
    // Fit the plaque's ~1.4-unit extent into one tile of the (non-tiling) texture.
    map.repeat.set(0.68, 0.68);
    map.offset.set(0.5, 0.5);
    const stone = rig.material(lapis(map));
    const pupil = rig.material(gem(EMBER, 0.9));

    // Layers front to back: gold motif, lapis field, gold frame, gold back plate.
    const field = extrude(naos(0), { depth: 0.06, bevel: 0.012, bevelSegments: 2 });
    rig.mesh(field, stone);

    const frameShape = naos(0.045);
    frameShape.holes.push(new THREE.Path(naos(-0.012).getPoints()));
    const frame = extrude(frameShape, { depth: 0.09, bevel: 0.014, bevelSegments: 2 });
    const back = place(extrude(naos(0.03), { depth: 0.03, bevel: 0.01, bevelSegments: 1 }), [0, 0, -0.045]);

    // Cornice: a horizontal torus moulding and a row of reeds above it.
    const moulding = place(
        extrude(new THREE.Shape([new THREE.Vector2(-0.6, 0.255), new THREE.Vector2(0.6, 0.255), new THREE.Vector2(0.6, 0.29), new THREE.Vector2(-0.6, 0.29)]), {
            depth: 0.02,
            bevel: 0.012,
            bevelSegments: 2,
        }),
        [0, 0, 0.035],
    );
    const reeds: THREE.BufferGeometry[] = [];
    for (let i = -6; i <= 6; i++) {
        const x = i * 0.1;
        const half = 0.026;
        const top = 0.47 + Math.abs(x) * 0.02;
        const reed = new THREE.Shape([
            new THREE.Vector2(x - half * 0.7, 0.315),
            new THREE.Vector2(x + half * 0.7, 0.315),
            new THREE.Vector2(x + half, top - 0.02),
            new THREE.Vector2(x, top),
            new THREE.Vector2(x - half, top - 0.02),
        ]);
        reeds.push(place(extrude(reed, { depth: 0.016, bevel: 0.009, bevelSegments: 1, curveSegments: 1 }), [0, 0, 0.035]));
    }

    const motif = place(extrude(eyeShapes(), { depth: 0.026, bevel: 0.011, bevelSegments: 2 }), [0, -0.06, 0.042]);
    rig.mesh(merge([frame, back, moulding, ...reeds, motif]), metal);

    // Carnelian pupil: a low faceted cabochon set into the eye.
    rig.mesh(place(new THREE.SphereGeometry(0.068, 14, 7), [-0.01, -0.04, 0.04], [Math.PI / 2, 0, 0], [1, 0.55, 1]), pupil);
    const ember = rig.halo(EMBER, 0.5, [-0.01, -0.04, 0.09], 0.5);

    return rig.finish((t) => {
        const pulse = breathe(t, 0.7, 2.2);
        pupil.pulse = 0.65 + 0.6 * pulse;
        ember.pulse = 0.5 + 0.8 * pulse;
    });
}
