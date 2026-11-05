// The explorer's compass (custom levels): a brass pocket compass with a
// knurled bezel, crown and bow, a domed glass, and an engraved rose card.
// The needle never quite settles — it hunts back and forth around north.
// The card is faintly luminous, like old radium paint.

import * as THREE from 'three';
import { merge, place, revolve, type ProfilePoint } from './geometry';
import { ArtifactMaterial, brass, glass } from './materials';
import { ArtifactRig } from './rig';
import { compassDialTexture } from './textures';
import type { Artifact } from './types';

// Case profile, [radius, height along the axis], traced from the dial seat up
// over the bezel and round to the centre of the back. The face is at +height
// and is turned to face +Z afterwards.
const CASE: ProfilePoint[] = [
    [0.56, 0.02],
    [0.588, 0.02, 1],
    [0.588, 0.095, 1],
    [0.6, 0.108, 1],
    [0.628, 0.104, 1],
    [0.648, 0.09],
    [0.652, 0.07],
    [0.648, 0.048, 1],
    [0.635, 0.04, 1],
    [0.64, 0.02],
    [0.632, -0.02],
    [0.6, -0.06],
    [0.53, -0.088],
    [0.4, -0.1],
    [0, -0.1],
];
const DIAL_Z = 0.022;
const DIAL_R = 0.59;

/** Faces geometry built around +Y so it faces +Z instead. */
const faceForward = (geo: THREE.BufferGeometry) => place(geo, [0, 0, 0], [Math.PI / 2, 0, 0]);

/** Needle: a long flat lozenge with a raised spine; north half enamelled red. */
function needleGeometry(): THREE.BufferGeometry {
    const L = 0.43;
    const W = 0.042;
    const north = [0, L, 0.004];
    const south = [0, -L, 0.004];
    const left = [-W, 0, 0];
    const right = [W, 0, 0];
    const spine = [0, 0, 0.022];
    const faces = [
        [north, left, spine],
        [north, spine, right],
        [south, spine, left],
        [south, right, spine],
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(faces.flat(2), 3));
    const red = new THREE.Color('#c0261c');
    const blued = new THREE.Color('#2a3140');
    const colors = faces.flatMap((_, f) => {
        const c = f < 2 ? red : blued;
        return [c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b];
    });
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
}

export function createCompass(): Artifact {
    const rig = new ArtifactRig('compass');
    rig.setSway({ phase: 6.3 });
    rig.setPresence(0.9);
    const metal = rig.material(brass());
    const cover = rig.material(glass());
    const map = rig.track(compassDialTexture());
    const card = rig.material(
        new ArtifactMaterial(
            new THREE.MeshStandardMaterial({
                map,
                emissiveMap: map,
                emissive: '#ffe2a8',
                emissiveIntensity: 0.07,
                roughness: 0.55,
                metalness: 0,
            }),
        ),
    );
    const needleMat = rig.material(
        new ArtifactMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.3, flatShading: true })),
    );

    // Knurling on the bezel: the radius ripples only within the bezel band.
    const shell = revolve(CASE, 120, (theta, r, y) => (y > 0.045 && y < 0.095 ? r + 0.004 * Math.cos(theta * 60) : r));
    const crown = place(
        revolve([[0, 0.745], [0.035, 0.745], [0.045, 0.735], [0.045, 0.695, 1], [0.03, 0.69, 1], [0.03, 0.66], [0, 0.66]], 16, (theta, r) => r * (1 + 0.06 * Math.cos(theta * 8))),
        [0, -0.03, 0],
    );
    const stem = place(new THREE.CylinderGeometry(0.022, 0.03, 0.08, 12), [0, 0.655, 0]);
    const bow = place(new THREE.TorusGeometry(0.085, 0.019, 8, 28), [0, 0.8, 0]);
    const pivot = place(revolve([[0, 0.065], [0.018, 0.06], [0.026, 0.045], [0.022, 0.0]], 16), [0, 0, 0], [Math.PI / 2, 0, 0]);
    rig.mesh(merge([faceForward(shell), crown, stem, bow, pivot]), metal);

    rig.mesh(place(new THREE.CircleGeometry(DIAL_R, 64), [0, 0, DIAL_Z]), card);
    const needle = rig.mesh(place(needleGeometry(), [0, 0, DIAL_Z + 0.012]), needleMat);
    // Domed crystal over the card.
    rig.mesh(faceForward(revolve([[0, 0.115], [0.25, 0.111], [0.45, 0.103], [0.6, 0.094]], 64)), cover);

    let angle = 0;
    return rig.finish((t, dt) => {
        // Several incommensurate swings so the needle hunts without repeating.
        const target = 0.22 * Math.sin(t * 0.63) + 0.09 * Math.sin(t * 1.71 + 1.2) + 0.03 * Math.sin(t * 4.3);
        // Petrified, the needle stays wherever it was.
        angle += (target - angle) * Math.min(1, dt * 6) * (1 - rig.lock);
        needle.rotation.z = angle;
    });
}
