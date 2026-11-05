// The Hand of Rathmore (The Lost Artifact): a bronze hand raised from a black
// plinth, palm out, fingers curling as if about to close. The metal is old and
// weathered — verdigris has gathered in the creases and between the fingers —
// and a violet stone set in the palm smoulders with a slow pulse.
//
// Like the cat, the hand is one smooth signed-distance sculpt: jointed
// round-cone phalanges blended into a palm, thenar pads and a wrist.

import * as THREE from 'three';
import { merge, squareProfile } from './geometry';
import { basalt, bronze, gem, gold } from './materials';
import { fbm, gradientNoise } from './noise';
import { ArtifactRig, breathe } from './rig';
import { blend, carve, ellipsoid, meshSdf, roundBox, roundCone, type Sdf, type V3 } from './sdf';
import type { Artifact } from './types';

const CURSE = '#7f4dff';
/** The hand is modelled with the knuckles near y = 0.1, then lifted onto the plinth. */
const LIFT = 0.07;
const GEM: V3 = [0.0, -0.07, 0.062];
const PLINTH_TOP = -0.47;

/** A finger as a chain of tapered phalanges, each joint curling towards the palm (+Z). */
function finger(base: V3, splay: number, lengths: readonly number[], radii: readonly number[], curls: readonly number[]): Sdf[] {
    const parts: Sdf[] = [];
    let p = base;
    let theta = 0;
    lengths.forEach((length, i) => {
        theta += curls[i] ?? 0;
        const q: V3 = [
            p[0] + Math.sin(splay) * Math.cos(theta) * length,
            p[1] + Math.cos(splay) * Math.cos(theta) * length,
            p[2] + Math.sin(theta) * length,
        ];
        parts.push(roundCone(p, q, radii[i] ?? 0.03, radii[i + 1] ?? 0.03));
        p = q;
    });
    return parts;
}

function handField(): Sdf {
    const palm = blend(
        0.05,
        roundBox([0, -0.1, 0], [0.165, 0.2, 0.05], 0.045),
        // Thenar (thumb) and hypothenar pads give the palm its cupped relief.
        ellipsoid([0.095, -0.19, 0.035], [0.09, 0.12, 0.05], [0, 0, -0.5]),
        ellipsoid([-0.11, -0.15, 0.03], [0.065, 0.14, 0.045]),
        // Wrist, oval in section, sinking into the plinth.
        roundCone([0.045, -0.26, -0.01], [0.04, -0.76, -0.02], 0.095, 0.1),
        roundCone([-0.045, -0.26, -0.01], [-0.04, -0.76, -0.02], 0.095, 0.1),
    );
    // Index to little finger: each curls a little more than the last.
    const fingers = blend(
        0.022,
        ...finger([0.122, 0.07, 0.005], 0.08, [0.18, 0.11, 0.085], [0.042, 0.038, 0.034, 0.029], [0.14, 0.4, 0.32]),
        ...finger([0.04, 0.085, 0.005], 0.01, [0.2, 0.125, 0.09], [0.044, 0.04, 0.035, 0.03], [0.12, 0.38, 0.3]),
        ...finger([-0.044, 0.078, 0.005], -0.06, [0.185, 0.115, 0.088], [0.042, 0.038, 0.034, 0.029], [0.18, 0.46, 0.34]),
        ...finger([-0.122, 0.055, 0.005], -0.15, [0.14, 0.09, 0.075], [0.037, 0.033, 0.03, 0.026], [0.26, 0.52, 0.36]),
    );
    const thumb = blend(
        0.03,
        roundCone([0.12, -0.24, 0.02], [0.245, -0.11, 0.075], 0.056, 0.048),
        roundCone([0.245, -0.11, 0.075], [0.29, -0.015, 0.13], 0.048, 0.042),
        roundCone([0.29, -0.015, 0.13], [0.29, 0.065, 0.18], 0.042, 0.033),
    );
    const hand = blend(0.04, palm, fingers, thumb);
    // A shallow socket for the stone.
    const socketed = carve(hand, ellipsoid([GEM[0], GEM[1], GEM[2] + 0.02], [0.052, 0.068, 0.032]), 0.012);
    return (x, y, z) => socketed(x, y - LIFT, z);
}

export function createHand(): Artifact {
    const rig = new ArtifactRig('hand');
    rig.setSway({ phase: 5.4 });
    rig.setPresence(1.08);
    const metal = rig.material(bronze());
    const plinth = rig.material(basalt());
    const trim = rig.material(gold());
    const stone = rig.material(gem(CURSE, 0.75));

    // Bronze with patina: verdigris gathers where the hand is occluded, plus a
    // few noise blotches; open, handled surfaces stay warm bronze.
    const { geometry, occlusion } = meshSdf(handField(), [-0.24, PLINTH_TOP - 0.02, -0.14], [0.4, 0.68, 0.3], 0.024, true);
    const pos = geometry.getAttribute('position');
    const noise = gradientNoise(42);
    const metalColor = new THREE.Color('#a87443');
    const patina = new THREE.Color('#4e957d');
    const c = new THREE.Color();
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const ao = occlusion?.[i] ?? 1;
        const blotch = fbm(noise, pos.getX(i) * 6, pos.getY(i) * 6, pos.getZ(i) * 6, 3);
        const amount = Math.min(1, Math.max(0, (1 - ao) * 1.6 + blotch * 0.8 - 0.12));
        c.copy(metalColor)
            .multiplyScalar(0.65 + 0.35 * ao)
            .lerp(patina, amount * 0.7);
        colors.set([c.r, c.g, c.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    rig.mesh(geometry, metal);

    // Stepped plinth with chamfered edges, capped and footed in gold.
    const T = PLINTH_TOP;
    rig.mesh(
        squareProfile(
            [
                [0.178, T - 0.02],
                [0.178, T - 0.2],
                [0.192, T - 0.2],
                [0.226, T - 0.215],
                [0.236, T - 0.23],
                [0.236, T - 0.29],
                [0, T - 0.29],
            ],
            0.85,
        ),
        plinth,
    );
    rig.mesh(
        merge([
            squareProfile([[0, T], [0.182, T], [0.197, T - 0.01], [0.197, T - 0.022], [0.17, T - 0.022]], 0.85),
            squareProfile([[0.23, T - 0.29], [0.246, T - 0.296], [0.246, T - 0.314], [0, T - 0.314]], 0.85),
        ]),
        trim,
    );

    // The cursed stone in the palm.
    const at: V3 = [GEM[0], GEM[1] + LIFT, GEM[2]];
    const gemGeo = new THREE.IcosahedronGeometry(1, 1);
    gemGeo.scale(0.042, 0.056, 0.022);
    gemGeo.translate(...at);
    rig.mesh(gemGeo, stone);
    const glint = rig.halo(CURSE, 0.5, [at[0], at[1], at[2] + 0.04], 0.35);

    return rig.finish((t) => {
        const pulse = breathe(t, 0.55, 4.0);
        stone.pulse = 0.55 + 0.7 * pulse;
        glint.pulse = 0.45 + 0.9 * pulse;
    });
}
