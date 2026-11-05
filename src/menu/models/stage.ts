// The lighting the artifacts are designed under. It mirrors what the menu's
// RingLayer and Stage set up (keep the two in sync), so the dev preview shows
// what ships:
//   - scene.environment: RoomEnvironment through PMREM (soft studio
//     reflections for the metals and clearcoats),
//   - a warm key light from the upper right front,
//   - a cool rim light from behind on the left to separate silhouettes from a
//     dark background, and a faint warm hemisphere fill,
//   - ACES filmic tone mapping and sRGB output on the renderer.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface ArtifactLighting {
    key: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
    fill: THREE.HemisphereLight;
    environment: THREE.Texture;
    /** Removes the lights and environment from the scene and frees them. */
    dispose(): void;
}

export const LIGHTING = {
    exposure: 1.05,
    environmentIntensity: 1,
    key: { color: 0xffe0b4, intensity: 2.4, position: [3, 5, 7] },
    rim: { color: 0x8fb2ff, intensity: 1.3, position: [-5, 3, -4] },
    fill: { sky: 0xfff1dc, ground: 0x1a1410, intensity: 0.35 },
} as const;

export function setupArtifactLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene): ArtifactLighting {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = LIGHTING.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => {
        if (o instanceof THREE.Mesh) {
            (o.geometry as THREE.BufferGeometry).dispose();
            (o.material as THREE.Material).dispose();
        }
    });
    pmrem.dispose();
    scene.environment = environment;
    scene.environmentIntensity = LIGHTING.environmentIntensity;

    const key = new THREE.DirectionalLight(LIGHTING.key.color, LIGHTING.key.intensity);
    key.position.set(...LIGHTING.key.position);
    const rim = new THREE.DirectionalLight(LIGHTING.rim.color, LIGHTING.rim.intensity);
    rim.position.set(...LIGHTING.rim.position);
    const fill = new THREE.HemisphereLight(LIGHTING.fill.sky, LIGHTING.fill.ground, LIGHTING.fill.intensity);
    scene.add(key, rim, fill);

    return {
        key,
        rim,
        fill,
        environment,
        dispose() {
            scene.remove(key, rim, fill);
            key.dispose();
            rim.dispose();
            fill.dispose();
            if (scene.environment === environment) scene.environment = null;
            environment.dispose();
        },
    };
}
