import type * as THREE from 'three';

export type ArtifactKind = 'scion' | 'dagger' | 'meteorite' | 'eye' | 'cat' | 'mask' | 'hand' | 'compass';

export interface ArtifactState {
    selected: boolean;
    locked: boolean;
    /** seconds since start */
    time: number;
}

export interface Artifact {
    /** Centered at the origin, upright (+Y up), facing +Z, inside a sphere of radius 1. */
    object: THREE.Object3D;
    /**
     * Idle animation (glows pulse, needle swings, slow sway). The ring owns the
     * object's position/rotation/scale; this only animates its inner life.
     */
    update(dt: number, state: ArtifactState): void;
    /** Frees geometries, materials and textures. */
    dispose(): void;
}
