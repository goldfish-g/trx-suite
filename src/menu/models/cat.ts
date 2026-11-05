// The Bastet idol (Unfinished Business): a seated cat in polished black
// obsidian, upright and alert in the classic Egyptian pose, tail curled around
// its feet. Gold marks it as sacred: a double collar with a pendant, a hoop
// earring that sways, and a basalt plinth banded in gold. Its eyes glow emerald.
//
// The body is one smooth signed-distance sculpt (see sdf.ts), so it reads as a
// single carved stone rather than an assembly of primitives.

import * as THREE from 'three';
import { merge, place, squareProfile } from './geometry';
import { basalt, glow, gold, obsidian } from './materials';
import { ArtifactRig, breathe } from './rig';
import { blend, ellipsoid, meshSdf, roundCone, type Sdf } from './sdf';
import type { Artifact } from './types';

const EYES = '#58ff8a';
const PLINTH_TOP = -0.775;

function catField(): Sdf {
    const body = blend(
        0.07,
        // Haunches and thighs, set back on the plinth.
        ellipsoid([0, -0.56, -0.09], [0.19, 0.22, 0.25]),
        ellipsoid([0.115, -0.6, -0.1], [0.12, 0.17, 0.2]),
        ellipsoid([-0.115, -0.6, -0.1], [0.12, 0.17, 0.2]),
        // Torso rising to a proud chest.
        roundCone([0, -0.5, -0.07], [0, -0.02, 0.045], 0.18, 0.12),
        ellipsoid([0, -0.2, 0.08], [0.12, 0.21, 0.115]),
        // Neck.
        roundCone([0, -0.04, 0.045], [0, 0.3, 0.06], 0.1, 0.078),
    );
    const legs = blend(
        0.035,
        roundCone([0.062, -0.755, 0.2], [0.068, -0.3, 0.125], 0.036, 0.05),
        roundCone([-0.062, -0.755, 0.2], [-0.068, -0.3, 0.125], 0.036, 0.05),
        ellipsoid([0.062, -0.752, 0.225], [0.045, 0.026, 0.064]),
        ellipsoid([-0.062, -0.752, 0.225], [0.045, 0.026, 0.064]),
        // Hind feet peeking out beside the front legs.
        ellipsoid([0.155, -0.755, 0.06], [0.05, 0.026, 0.1]),
        ellipsoid([-0.155, -0.755, 0.06], [0.05, 0.026, 0.1]),
    );
    const head = blend(
        0.04,
        ellipsoid([0, 0.425, 0.065], [0.118, 0.108, 0.112]),
        ellipsoid([0, 0.385, 0.1], [0.115, 0.07, 0.09]),
        ellipsoid([0, 0.37, 0.165], [0.055, 0.045, 0.05]),
    );
    // Tall, pointed ears leaning slightly outward.
    const ears = blend(
        0.02,
        roundCone([0.07, 0.49, 0.05], [0.112, 0.69, 0.035], 0.048, 0.006),
        roundCone([-0.07, 0.49, 0.05], [-0.112, 0.69, 0.035], 0.048, 0.006),
    );
    // Tail: from behind the haunch, curling round the right side to the front.
    const tail = blend(
        0.03,
        roundCone([0.08, -0.74, -0.3], [0.2, -0.752, -0.2], 0.036, 0.032),
        roundCone([0.2, -0.752, -0.2], [0.245, -0.756, -0.02], 0.032, 0.03),
        roundCone([0.245, -0.756, -0.02], [0.22, -0.758, 0.15], 0.03, 0.027),
        roundCone([0.22, -0.758, 0.15], [0.14, -0.76, 0.26], 0.027, 0.022),
    );
    return blend(0.05, body, legs, blend(0.06, head, ears), tail);
}

export function createCat(): Artifact {
    const rig = new ArtifactRig('cat');
    rig.setSway({ phase: 3.6 });
    const stone = rig.material(obsidian({ vertexColors: true }));
    const metal = rig.material(gold());
    const eyes = rig.material(glow(EYES, 2.6));

    // Body: sculpted field, with cavities darkened through vertex colour so the
    // form still reads once petrified into stone.
    const { geometry, occlusion } = meshSdf(catField(), [-0.3, -0.79, -0.42], [0.3, 0.72, 0.36], 0.035, true);
    const colors = new Float32Array((occlusion?.length ?? 0) * 3);
    occlusion?.forEach((ao, i) => {
        const v = 0.35 + 0.65 * ao;
        colors.set([v, v, v], i * 3);
    });
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    rig.mesh(geometry, stone);

    // Plinth: a basalt block between a gold cap and a chamfered gold foot.
    const T = PLINTH_TOP;
    const plinth = (profile: [number, number][]) => place(squareProfile(profile, 1.2), [0, 0, -0.02]);
    rig.mesh(plinth([[0.205, T - 0.016], [0.205, T - 0.06], [0, T - 0.06]]), rig.material(basalt()));
    const gilt: THREE.BufferGeometry[] = [
        plinth([[0, T], [0.212, T], [0.222, T - 0.008], [0.222, T - 0.016], [0.2, T - 0.016]]),
        plinth([[0.19, T - 0.06], [0.225, T - 0.06], [0.235, T - 0.07], [0.235, T - 0.085], [0.224, T - 0.095], [0, T - 0.095]]),
    ];

    // Double collar, dipping at the front, with a small disc pendant.
    for (const [y, r, tube] of [
        [0.165, 0.098, 0.014],
        [0.125, 0.11, 0.012],
    ] as const) {
        gilt.push(place(new THREE.TorusGeometry(r, tube, 8, 40), [0, y, 0.055], [Math.PI / 2 + 0.38, 0, 0], [1, 1.12, 1]));
    }
    gilt.push(place(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 20), [0, 0.04, 0.165], [Math.PI / 2 - 0.35, 0, 0]));
    rig.mesh(merge(gilt), metal);

    // Earring on the right ear, hung from a pivot so it can sway.
    const earPivot = new THREE.Group();
    earPivot.position.set(0.108, 0.53, 0.06);
    rig.body.add(earPivot);
    rig.mesh(place(new THREE.TorusGeometry(0.03, 0.0065, 6, 20), [0, -0.03, 0]), metal, earPivot);

    // Almond eyes, slanted, set into the head surface.
    rig.mesh(
        merge([
            place(new THREE.SphereGeometry(1, 12, 8), [0.048, 0.43, 0.165], [0, 0.35, -0.3], [0.03, 0.014, 0.014]),
            place(new THREE.SphereGeometry(1, 12, 8), [-0.048, 0.43, 0.165], [0, -0.35, 0.3], [0.03, 0.014, 0.014]),
        ]),
        eyes,
    );
    const glints = [rig.halo(EYES, 0.26, [0.05, 0.43, 0.2], 0.6), rig.halo(EYES, 0.26, [-0.05, 0.43, 0.2], 0.6)];

    return rig.finish((t) => {
        const pulse = breathe(t, 0.6, 0.9);
        eyes.pulse = 0.65 + 0.55 * pulse;
        for (const g of glints) g.pulse = 0.5 + 0.7 * pulse;
        earPivot.rotation.z = Math.sin(t * 1.7) * 0.25 * (1 - rig.lock);
    });
}
