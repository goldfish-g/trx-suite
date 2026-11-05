// The Scion (Tomb Raider, 1996): an elongated golden relic in three stacked
// pieces, held a hair apart by whatever power is inside it. Each piece is an
// eight-faceted bead of gold — a pointed crown, a diamond-cut heart with a
// crisp equator, and a long tapering root — and together they trace one
// spindle. The narrow waists between them glow with a warm molten core, and
// the same light leaks out of the fine engraved bands. The heart is turned
// half a facet against the others and slowly rotates, so the relic feels alive.

import * as THREE from 'three';
import { facetedRevolve, merge, type ProfilePoint } from './geometry';
import { glow, gold } from './materials';
import { ArtifactRig, breathe } from './rig';
import type { Artifact } from './types';

const SIDES = 8;
const GLOW = '#ffa040';

/** A V-groove engraved into the silhouette at height `y` (outer radius `r`). */
function groove(r: number, y: number): ProfilePoint[] {
    return [
        [r, y + 0.01, 1],
        [r - 0.016, y, 1],
        [r, y - 0.01, 1],
    ];
}

/** The glowing line at the bottom of a groove (see `groove`). */
function grooveLight(r: number, y: number): ProfilePoint[] {
    return [
        [r - 0.009, y + 0.004],
        [r - 0.009, y - 0.004],
    ];
}

// Profiles as [corner radius, height], top to bottom; a third element marks a
// crisp corner. Each groove is listed once so its light lines up with it.

const CROWN_GROOVES = [[0.236, 0.565], [0.28, 0.472]] as const;
const HEART_GROOVES = [[0.294, 0.14], [0.27, -0.14]] as const;
const ROOT_GROOVES = [[0.25, -0.455], [0.1, -0.78]] as const;

/** Crown: a stepped finial, a tall dome to a crisp shoulder, then tucked in to the seam. */
const CROWN: ProfilePoint[] = [
    [0, 0.955],
    [0.022, 0.945],
    [0.032, 0.922, 1],
    [0.02, 0.905, 1],
    [0.046, 0.89, 1],
    [0.056, 0.872],
    [0.046, 0.856, 1],
    [0.062, 0.835],
    [0.1, 0.775],
    [0.15, 0.7],
    [0.2, 0.625],
    [0.226, 0.585],
    ...groove(...CROWN_GROOVES[0]),
    [0.248, 0.54],
    [0.268, 0.5],
    ...groove(...CROWN_GROOVES[1]),
    [0.288, 0.45, 1],
    [0.27, 0.41],
    [0.24, 0.375],
    [0.215, 0.358, 1],
    [0.19, 0.35, 1],
    [0, 0.35],
];

/** Heart: the widest piece, two cones meeting at a crisp equator. */
const HEART: ProfilePoint[] = [
    [0, 0.3],
    [0.19, 0.3, 1],
    [0.215, 0.29, 1],
    [0.25, 0.235],
    [0.282, 0.17],
    ...groove(...HEART_GROOVES[0]),
    [0.305, 0.115],
    [0.32, 0.075],
    [0.338, 0.025, 1],
    [0.322, -0.03],
    [0.295, -0.1],
    ...groove(...HEART_GROOVES[1]),
    [0.255, -0.18],
    [0.22, -0.235, 1],
    [0.195, -0.25, 1],
    [0, -0.25],
];

/** Root: a short collar to a crisp shoulder, then a long tapering spike to a knob. */
const ROOT: ProfilePoint[] = [
    [0, -0.3],
    [0.195, -0.3, 1],
    [0.22, -0.31, 1],
    [0.25, -0.345],
    [0.268, -0.39, 1],
    [0.258, -0.43],
    ...groove(...ROOT_GROOVES[0]),
    [0.235, -0.5],
    [0.2, -0.58],
    [0.16, -0.66],
    [0.12, -0.74],
    ...groove(...ROOT_GROOVES[1]),
    [0.075, -0.83],
    [0.04, -0.88, 1],
    [0.054, -0.9],
    [0.048, -0.926],
    [0.024, -0.946],
    [0, -0.955],
];

/** Small gold beads studding the facet corners of a crisp shoulder at (r, y). */
function beads(r: number, y: number, phase: number): THREE.BufferGeometry {
    return merge(
        Array.from({ length: SIDES }, (_, s) => {
            const a = phase + (s / SIDES) * Math.PI * 2;
            const bead = new THREE.IcosahedronGeometry(0.019, 1);
            bead.translate((r + 0.006) * Math.sin(a), y, (r + 0.006) * Math.cos(a));
            return bead;
        }),
    );
}

export function createScion(): Artifact {
    const rig = new ArtifactRig('scion');
    rig.setSway({ phase: 0.0 });
    const metal = rig.material(gold({ roughness: 0.27 }));
    const core = rig.material(glow(GLOW, 2.6));

    const crown = new THREE.Group();
    const heart = new THREE.Group();
    const root = new THREE.Group();
    rig.body.add(crown, heart, root);

    // The heart is turned half a facet so its edges fall between the others'.
    const half = Math.PI / SIDES;
    rig.mesh(merge([facetedRevolve(CROWN, SIDES), beads(0.288, 0.45, 0)]), metal, crown);
    rig.mesh(merge([facetedRevolve(HEART, SIDES, half), beads(0.338, 0.025, half)]), metal, heart);
    rig.mesh(merge([facetedRevolve(ROOT, SIDES), beads(0.268, -0.39, 0)]), metal, root);

    // Light in the engraved lines, and the molten core showing through the waists.
    const lines = (grooves: readonly (readonly [number, number])[], phase = 0) => grooves.map(([r, y]) => facetedRevolve(grooveLight(r, y), SIDES, phase));
    rig.mesh(merge(lines(CROWN_GROOVES)), core, crown);
    rig.mesh(merge(lines(HEART_GROOVES, half)), core, heart);
    rig.mesh(merge([...lines(ROOT_GROOVES), facetedRevolve([[0.18, 0.38], [0.18, -0.33]], SIDES, half * 0.5)]), core, root);

    // A faint warm aura, brightest at the waists.
    const aura = rig.halo(GLOW, 2.0, [0, 0, 0], 0.16);
    const seams = [rig.halo(GLOW, 0.9, [0, 0.325, 0], 0.36), rig.halo(GLOW, 0.9, [0, -0.275, 0], 0.36)];

    return rig.finish((t, dt) => {
        const pulse = breathe(t, 0.8);
        core.pulse = 0.7 + 0.5 * pulse;
        aura.pulse = 0.75 + 0.5 * pulse;
        for (const s of seams) s.pulse = 0.6 + 0.8 * pulse;
        // The pieces drift apart and back as the core breathes; petrified, they settle.
        const life = 1 - rig.lock;
        const drift = 0.009 * pulse * life;
        crown.position.y = drift;
        root.position.y = -drift;
        heart.rotation.y += dt * 0.3 * life;
    });
}
