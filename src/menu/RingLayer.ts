// The ring of games: one artifact per game on a slowly turning circle, the
// chosen one in front, lit like a museum piece. The player turns it with
// arrows, a d-pad, a swipe, the mouse wheel or a click.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Layer, Viewport } from '../stage/Stage';
import type { Artifact } from './models';

export interface RingEntry {
    locked: boolean;
}

interface Slot {
    group: THREE.Group;
    /** Null until its model has loaded. */
    artifact: Artifact | null;
    /** 0..1: fades a model in as it arrives. */
    appear: number;
    locked: boolean;
    /** Smoothed 0..1: how much this slot is the chosen one. */
    focus: number;
    spin: number;
}

const VERTICAL_FOV = 34;

function haloTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 196, 120, 0.55)');
    gradient.addColorStop(0.35, 'rgba(255, 160, 80, 0.18)');
    gradient.addColorStop(1, 'rgba(255, 140, 60, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export class RingLayer implements Layer {
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, 0.1, 100);

    private readonly slots: Slot[] = [];
    private readonly halo: THREE.Mesh;
    private readonly haloTex: THREE.CanvasTexture;
    private environment: THREE.Texture | null = null;
    /** Whether every model's shaders are built. */
    private compiled = false;
    /** Where the ring is turned to, in slots; not wrapped, so turns stay smooth. */
    private position = 0;
    private target = 0;
    private dragOffset = 0;
    private time = 0;
    private readonly reducedMotion: boolean;
    private readonly projected = new THREE.Vector3();

    constructor(entries: RingEntry[], selected: number, reducedMotion: boolean) {
        this.reducedMotion = reducedMotion;
        this.position = this.target = selected;
        for (const entry of entries) {
            const group = new THREE.Group();
            this.scene.add(group);
            this.slots.push({ group, artifact: null, appear: 0, locked: entry.locked, focus: 0, spin: 0 });
        }

        const key = new THREE.DirectionalLight(0xffe0b4, 2.4);
        key.position.set(3, 5, 7);
        const rim = new THREE.DirectionalLight(0x8fb2ff, 1.3);
        rim.position.set(-5, 3, -4);
        const fill = new THREE.HemisphereLight(0xfff1dc, 0x1a1410, 0.35);
        this.scene.add(key, rim, fill);

        this.haloTex = haloTexture();
        this.halo = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
                map: this.haloTex,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false,
            }),
        );
        this.halo.renderOrder = -1;
        this.scene.add(this.halo);
    }

    get count(): number {
        return this.slots.length;
    }

    /** The slot in front, as the ring rests or is dragged. */
    get frontIndex(): number {
        const n = this.slots.length;
        return ((Math.round(this.position + this.dragOffset) % n) + n) % n;
    }

    /** Turns the ring to a slot the short way round. */
    select(index: number): void {
        const n = this.slots.length;
        const current = this.target;
        const wrapped = ((current % n) + n) % n;
        let delta = index - wrapped;
        if (delta > n / 2) delta -= n;
        if (delta < -n / 2) delta += n;
        this.target = current + delta;
    }

    step(direction: number): number {
        this.target = Math.round(this.target) + direction;
        const n = this.slots.length;
        return ((this.target % n) + n) % n;
    }

    /** Puts a slot's model in place, fading it in. */
    setArtifact(index: number, artifact: Artifact): void {
        const slot = this.slots[index];
        if (slot === undefined) {
            artifact.dispose();
            return;
        }
        if (slot.artifact !== null) {
            slot.group.remove(slot.artifact.object);
            slot.artifact.dispose();
        }
        slot.artifact = artifact;
        slot.appear = 0;
        slot.group.add(artifact.object);
        this.compiled = false;
    }

    setLocked(index: number, locked: boolean): void {
        const slot = this.slots[index];
        if (slot !== undefined) slot.locked = locked;
    }

    /** While a finger or the mouse drags the ring, in slots. */
    drag(offset: number): void {
        this.dragOffset = offset;
    }

    /** Ends a drag, carrying on in the direction of a flick. Returns the new front slot. */
    release(velocity: number): number {
        const n = this.slots.length;
        const resting = Math.round(this.position + this.dragOffset + Math.max(-2, Math.min(2, velocity * 0.25)));
        this.position += this.dragOffset;
        this.dragOffset = 0;
        this.target = resting;
        return ((resting % n) + n) % n;
    }

    update(dt: number, viewport: Viewport): void {
        this.time += dt;
        const ease = 1 - Math.exp(-dt * (this.reducedMotion ? 14 : 7));
        this.position += (this.target - this.position) * ease;
        if (Math.abs(this.target - this.position) < 1e-4) this.position = this.target;

        // The front of a ring, seen from close: the chosen artifact large in
        // the middle, two neighbours either side shrinking away, the rest
        // hidden behind. Portrait screens show one neighbour peeking in.
        const portrait = viewport.aspect < 0.9;
        const radius = portrait ? 2.3 : 3.3;
        const spacing = portrait ? 0.78 : 0.62;
        this.camera.aspect = viewport.aspect;
        this.camera.fov = VERTICAL_FOV;
        this.camera.position.set(0, 0.55, portrait ? 10.2 : 7.4);
        // Aim below the ring so it sits in the upper part, leaving room for titles.
        this.camera.lookAt(0, portrait ? -0.95 : -0.62, 0);
        this.camera.updateProjectionMatrix();

        const n = this.slots.length;
        const front = this.frontIndex;
        const turning = this.position + this.dragOffset;
        this.slots.forEach((slot, index) => {
            // How many places from the front, the short way round.
            let offset = index - turning;
            offset -= Math.round(offset / n) * n;
            const distance = Math.abs(offset);
            const angle = offset * spacing;
            const wanted = index === front && this.dragOffset === 0 ? 1 : 0;
            slot.focus += (wanted - slot.focus) * (1 - Math.exp(-dt * 6));
            const fade = Math.min(1, Math.max(0, (3 - distance) / 0.8));
            if (slot.artifact !== null) slot.appear = Math.min(1, slot.appear + dt * (this.reducedMotion ? 6 : 2.5));
            const appear = 1 - (1 - slot.appear) ** 3;
            const scale = 1.3 * Math.exp(-0.62 * distance) * fade * (1 + slot.focus * 0.08) * appear;
            slot.group.visible = scale > 0.01;
            const bob = this.reducedMotion ? 0 : Math.sin(this.time * 1.2) * 0.06 * slot.focus;
            slot.group.position.set(Math.sin(angle) * radius, bob, (Math.cos(angle) - 1) * radius);
            slot.group.scale.setScalar(Math.max(scale, 0.0001));
            // The chosen artifact turns slowly; the others lean towards it.
            slot.spin += dt * (this.reducedMotion ? 0.12 : 0.45) * slot.focus;
            slot.group.rotation.y = -angle * 0.6 + slot.spin;
            slot.artifact?.update(dt, { selected: slot.focus > 0.5, locked: slot.locked, time: this.time });
        });

        const chosen = this.slots[front];
        if (chosen !== undefined) {
            this.halo.position.copy(chosen.group.position);
            this.halo.position.z -= 0.8;
            this.halo.quaternion.copy(this.camera.quaternion);
            const size = 3.6 * chosen.group.scale.x * (chosen.locked ? 0.55 : 1);
            this.halo.scale.setScalar(size);
            (this.halo.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * chosen.focus;
        }
    }

    render(renderer: THREE.WebGLRenderer): void {
        if (this.environment === null) {
            const pmrem = new THREE.PMREMGenerator(renderer);
            this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
            pmrem.dispose();
            this.scene.environment = this.environment;
        }
        if (!this.compiled) {
            this.compiled = true;
            // Build every artifact's shaders now, hidden ones too, so turning
            // the ring never stalls on one appearing for the first time.
            const hidden = this.slots.filter((slot) => !slot.group.visible);
            for (const slot of hidden) slot.group.visible = true;
            renderer.compile(this.scene, this.camera);
            for (const slot of hidden) slot.group.visible = false;
        }
        renderer.render(this.scene, this.camera);
    }

    /** The slot under a point of the screen, in normalised device coordinates. */
    pick(x: number, y: number): number | null {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
        let best: number | null = null;
        let bestDistance = Infinity;
        this.slots.forEach((slot, index) => {
            if (!slot.group.visible) return;
            const sphere = new THREE.Sphere(slot.group.position, slot.group.scale.x * 1.05);
            const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3());
            if (hit === null) return;
            const distance = hit.distanceTo(this.camera.position);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = index;
            }
        });
        return best;
    }

    /** Where a slot's artifact appears on screen, in CSS pixels, and how large. */
    screenPosition(index: number, viewport: Viewport): { x: number; y: number; size: number } | null {
        const slot = this.slots[index];
        if (slot === undefined || !slot.group.visible || slot.group.scale.x < 0.3) return null;
        this.projected.copy(slot.group.position).project(this.camera);
        const edge = slot.group.position.clone();
        edge.y += slot.group.scale.x;
        edge.project(this.camera);
        return {
            x: ((this.projected.x + 1) / 2) * viewport.width,
            y: ((1 - this.projected.y) / 2) * viewport.height,
            size: Math.abs(edge.y - this.projected.y) * viewport.height,
        };
    }

    dispose(): void {
        for (const slot of this.slots) slot.artifact?.dispose();
        this.halo.geometry.dispose();
        (this.halo.material as THREE.Material).dispose();
        this.haloTex.dispose();
        this.environment?.dispose();
    }
}
