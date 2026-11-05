// Shared plumbing for every artifact: resource tracking for dispose(), smoothed
// locked/selected blend factors, additive glow halos, and the gentle idle sway.

import * as THREE from 'three';
import type { ArtifactMaterial } from './materials';
import { haloTexture } from './textures';
import type { Artifact, ArtifactState } from './types';

/** A soft additive glow sprite; `pulse` is set by the artifact's animation. */
export interface Halo {
    sprite: THREE.Sprite;
    opacity: number;
    pulse: number;
}

export interface SwayOptions {
    /** Peak tilt in radians. */
    tilt?: number;
    /** Peak vertical bob in units. */
    bob?: number;
    /** Phase offset so the set doesn't sway in lockstep. */
    phase?: number;
}

/** Artifact-specific animation, run every frame before materials update. */
export type Animate = (time: number, dt: number) => void;

export class ArtifactRig {
    /** The object the ring places. Never transformed by the artifact itself. */
    readonly object = new THREE.Group();
    /** Inner group carrying the idle sway; every part hangs below it. */
    readonly body = new THREE.Group();
    /** Smoothed locked blend, 0 → 1. */
    lock = 0;
    /** Smoothed selected blend, 0 → 1. */
    select = 0;

    private readonly materials: ArtifactMaterial[] = [];
    private readonly halos: Halo[] = [];
    private readonly disposables: { dispose(): void }[] = [];
    private haloMap: THREE.Texture | undefined;
    private sway: Required<SwayOptions> = { tilt: 0.035, bob: 0.015, phase: 0 };
    private started = false;

    constructor(name: string) {
        this.object.name = `artifact:${name}`;
        this.object.add(this.body);
    }

    /** Registers a material so it follows the locked/selected state. */
    material<M extends ArtifactMaterial>(m: M): M {
        this.materials.push(m);
        this.disposables.push(m);
        return m;
    }

    /** Adds a mesh to `parent` (the body by default) and tracks its geometry. */
    mesh(geometry: THREE.BufferGeometry, material: ArtifactMaterial, parent: THREE.Object3D = this.body): THREE.Mesh {
        this.disposables.push(geometry);
        const mesh = new THREE.Mesh(geometry, material.material);
        parent.add(mesh);
        return mesh;
    }

    /** Tracks a texture (or anything disposable) owned by this artifact. */
    track<T extends { dispose(): void }>(resource: T): T {
        this.disposables.push(resource);
        return resource;
    }

    /**
     * Adds a soft additive glow. Halos stand in for bloom: they make emissive
     * parts read as light sources against a dark level without postprocessing.
     */
    halo(
        color: THREE.ColorRepresentation,
        size: number,
        position: readonly [number, number, number],
        opacity: number,
        parent: THREE.Object3D = this.body,
    ): Halo {
        this.haloMap ??= this.track(haloTexture());
        const material = this.track(
            new THREE.SpriteMaterial({
                map: this.haloMap,
                color,
                blending: THREE.AdditiveBlending,
                transparent: true,
                depthWrite: false,
                opacity,
            }),
        );
        const sprite = new THREE.Sprite(material);
        sprite.scale.setScalar(size);
        sprite.position.set(...position);
        sprite.renderOrder = 1;
        parent.add(sprite);
        const halo = { sprite, opacity, pulse: 1 };
        this.halos.push(halo);
        return halo;
    }

    /**
     * Uniform scale of the body, to even out visual weight across the set:
     * broad, face-on pieces (plaque, mask, compass) are drawn in a little,
     * slender ones keep the full budget sphere.
     */
    setPresence(scale: number): void {
        this.body.scale.setScalar(scale);
    }

    setSway(options: SwayOptions): void {
        this.sway = { ...this.sway, ...options };
    }

    /** Wraps the rig as the public Artifact interface. */
    finish(animate: Animate): Artifact {
        return {
            object: this.object,
            update: (dt, state) => this.update(dt, state, animate),
            dispose: () => this.dispose(),
        };
    }

    private update(dt: number, state: ArtifactState, animate: Animate): void {
        // Ease towards the target state; snap on the first frame so artifacts
        // that start locked don't visibly fade out on load.
        const k = this.started ? 1 - Math.exp(-Math.max(0, dt) * 5) : 1;
        this.started = true;
        this.lock += ((state.locked ? 1 : 0) - this.lock) * k;
        this.select += ((state.selected ? 1 : 0) - this.select) * k;

        const t = state.time;
        const { tilt, bob, phase } = this.sway;
        // Petrified artifacts barely move; the selected one is a little livelier.
        const life = (1 - 0.85 * this.lock) * (1 + 0.4 * this.select);
        this.body.rotation.z = Math.sin(t * 0.47 + phase) * tilt * life;
        this.body.rotation.x = Math.sin(t * 0.31 + phase * 1.7) * tilt * 0.6 * life;
        this.body.position.y = Math.sin(t * 0.83 + phase * 0.6) * bob * life;

        animate(t, dt);

        for (const m of this.materials) m.apply(this.lock, this.select);
        const fade = (1 - this.lock) ** 2;
        for (const h of this.halos) {
            const opacity = h.opacity * h.pulse * (1 + 0.6 * this.select) * fade;
            h.sprite.material.opacity = opacity;
            h.sprite.visible = opacity > 0.003;
        }
    }

    private dispose(): void {
        for (const d of this.disposables) d.dispose();
        this.disposables.length = 0;
        this.materials.length = 0;
        this.halos.length = 0;
        this.object.removeFromParent();
        this.object.clear();
    }
}

/** A smooth 0..1 pulse with a slow breath and a faint shimmer on top. */
export function breathe(time: number, speed = 1, phase = 0): number {
    const slow = 0.5 + 0.5 * Math.sin(time * 1.3 * speed + phase);
    const shimmer = 0.5 + 0.5 * Math.sin(time * 4.1 * speed + phase * 2.3);
    return slow * 0.8 + shimmer * 0.2;
}
