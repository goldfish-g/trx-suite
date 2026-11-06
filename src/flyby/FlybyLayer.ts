// Draws a level as the menu's background and flies a camera through it,
// fading between routes. The look follows the original renderer: textures
// multiplied by baked vertex light, sharp texels, and depth fading into the
// dark.

import * as THREE from 'three';
import type { SceneChunk } from './build/geometry';
import type { PreparedLevel, RouteData } from './prepare';
import { CameraAim, createPlayer, type RoutePlayer } from './route/player';
import { RoomCuller } from './visibility';

const VERTEX = /* glsl */ `
in float layer;
in vec3 shade;
uniform float uFogNear;
uniform float uFogFar;
out vec2 vUv;
flat out float vLayer;
out vec3 vShade;
out float vFog;

void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    vUv = uv;
    vLayer = layer;
    vShade = shade;
    vFog = smoothstep(uFogNear, uFogFar, length(viewPosition.xyz));
}
`;

const FRAGMENT = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uTiles;
uniform vec3 uFogColor;
uniform float uFade;
uniform float uAdditive;
in vec2 vUv;
flat in float vLayer;
in vec3 vShade;
in float vFog;
out vec4 fragColor;

void main() {
    vec4 texel = texture(uTiles, vec3(vUv, vLayer));
    if (texel.a < 0.5) discard;
    vec3 colour = min(texel.rgb * vShade, vec3(1.0));
    if (uAdditive > 0.5) {
        // Glows and flames add light; fog takes it away.
        fragColor = vec4(colour * (1.0 - vFog) * uFade, 1.0);
    } else {
        fragColor = vec4(mix(colour, uFogColor, vFog) * uFade, 1.0);
    }
}
`;

export interface FlybyOptions {
    reducedMotion: boolean;
}

const SPEED = 1.15; // squares a second
const FADE_SECONDS = 1.4;
const BASE_FOV = 78; // horizontal, degrees

function chunkGeometry(chunk: SceneChunk): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(chunk.uvs, 2));
    geometry.setAttribute('layer', new THREE.BufferAttribute(chunk.layers, 1));
    geometry.setAttribute('shade', new THREE.BufferAttribute(chunk.shades, 3));
    geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
    geometry.addGroup(0, chunk.additiveStart, 0);
    geometry.addGroup(chunk.additiveStart, chunk.indices.length - chunk.additiveStart, 1);
    geometry.computeBoundingSphere();
    return geometry;
}

export class FlybyLayer {
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera(60, 1, 0.03, 80);
    /** The rooms the current route passes, for tests and diagnostics. */
    currentRooms: number[] = [];

    private readonly texture: THREE.DataArrayTexture;
    private readonly materials: THREE.ShaderMaterial[] = [];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly fade = { value: 0 };
    private readonly routes: RouteData[];
    private readonly speed: number;
    private readonly reducedMotion: boolean;
    private readonly sky: THREE.Object3D | null = null;
    private player: RoutePlayer | null = null;
    private routeOrder: number[] = [];
    private time = 0;
    private orbitCentre = new THREE.Vector3();
    private readonly position = new THREE.Vector3();
    private readonly target = new THREE.Vector3();
    private readonly aim = new CameraAim();
    private readonly roomMeshes = new Map<number, THREE.Mesh>();
    private readonly culler: RoomCuller;
    /** How many rooms the last frame drew, for diagnostics. */
    visibleCount = 0;
    /** Off draws every room, to check culling hides nothing that shows. */
    cullingEnabled = true;

    constructor(prepared: PreparedLevel, options: FlybyOptions) {
        const { scene } = prepared;
        this.reducedMotion = options.reducedMotion;
        this.speed = options.reducedMotion ? SPEED * 0.5 : SPEED;
        this.routes = prepared.routes;
        this.culler = new RoomCuller(scene.visibility);

        this.texture = new THREE.DataArrayTexture(scene.tiles as Uint8Array<ArrayBuffer>, 256, 256, scene.tileCount);
        this.texture.format = THREE.RGBAFormat;
        this.texture.type = THREE.UnsignedByteType;
        // Smooth filtering suits a backdrop; sharp texels fight the UI over it.
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.minFilter = THREE.LinearMipmapLinearFilter;
        this.texture.anisotropy = 4;
        this.texture.generateMipmaps = true;
        this.texture.needsUpdate = true;

        const makeMaterial = (additive: boolean, fog: boolean) => {
            const material = new THREE.ShaderMaterial({
                glslVersion: THREE.GLSL3,
                vertexShader: VERTEX,
                fragmentShader: FRAGMENT,
                uniforms: {
                    uTiles: { value: this.texture },
                    uFogColor: { value: new THREE.Color(0x07090c) },
                    uFogNear: { value: fog ? 7 : 1e6 },
                    uFogFar: { value: fog ? 26 : 2e6 },
                    uFade: this.fade,
                    uAdditive: { value: additive ? 1 : 0 },
                },
                transparent: additive,
                blending: additive ? THREE.AdditiveBlending : THREE.NoBlending,
                depthWrite: !additive && fog,
                depthTest: fog,
            });
            this.materials.push(material);
            return material;
        };
        const roomMaterials = [makeMaterial(false, true), makeMaterial(true, true)];
        if (scene.sky !== null) {
            // Levels with a sky are outdoors: let the view reach further.
            for (const material of roomMaterials) {
                material.uniforms.uFogNear!.value = 12;
                material.uniforms.uFogFar!.value = 42;
            }
        }
        const skyMaterials = [makeMaterial(false, false), makeMaterial(true, false)];

        const bounds = new THREE.Box3();
        for (const chunk of scene.chunks) {
            const geometry = chunkGeometry(chunk);
            this.geometries.push(geometry);
            const mesh = new THREE.Mesh(geometry, roomMaterials);
            mesh.matrixAutoUpdate = false;
            this.scene.add(mesh);
            this.roomMeshes.set(chunk.room, mesh);
            geometry.computeBoundingBox();
            if (geometry.boundingBox !== null) bounds.union(geometry.boundingBox);
        }
        if (scene.sky !== null) {
            const geometry = chunkGeometry(scene.sky);
            this.geometries.push(geometry);
            const sky = new THREE.Mesh(geometry, skyMaterials);
            sky.renderOrder = -1;
            sky.frustumCulled = false;
            this.sky = sky;
            this.scene.add(sky);
        }
        bounds.getCenter(this.orbitCentre);
        this.nextRoute();
    }

    /** Holds the camera at a moment of a route, for previews and screenshots. */
    debugJump(route: number, time: number): void {
        this.routeOrder = [route];
        this.nextRoute();
        this.time = Math.min(time, (this.player?.duration ?? 0) / 2);
        this.update(0, 1);
        this.aim.reset();
    }

    get routeCount(): number {
        return this.routes.length;
    }

    private nextRoute(): void {
        if (this.routes.length === 0) {
            this.player = null;
            return;
        }
        if (this.routeOrder.length === 0) {
            this.routeOrder = this.routes.map((_, i) => i).sort(() => Math.random() - 0.5);
        }
        const route = this.routes[this.routeOrder.pop()!]!;
        this.currentRooms = route.rooms;
        this.player = createPlayer(route, this.speed);
        this.time = 0;
        this.aim.reset();
    }

    update(dt: number, aspect: number): void {
        this.time += dt;
        let fov: number | null = null;
        let roll = 0;
        if (this.player !== null) {
            if (this.time > this.player.duration) this.nextRoute();
        }
        if (this.player !== null) {
            const sampled = this.player.sample(this.time, this.position, this.target);
            fov = sampled.fov;
            roll = this.reducedMotion ? 0 : sampled.roll;
            const { duration } = this.player;
            const fadeIn = Math.min(this.time / FADE_SECONDS, 1);
            const fadeOut = Math.min((duration - this.time) / FADE_SECONDS, 1);
            this.fade.value = Math.max(0, Math.min(fadeIn, fadeOut));
        } else {
            // Nowhere to fly: circle the middle of the level.
            const angle = this.time * 0.05;
            this.position.set(this.orbitCentre.x + Math.cos(angle) * 6, this.orbitCentre.y + 2, this.orbitCentre.z + Math.sin(angle) * 6);
            this.target.copy(this.orbitCentre);
            this.fade.value = Math.min(this.time / FADE_SECONDS, 1);
        }

        const camera = this.camera;
        camera.position.copy(this.position);
        camera.quaternion.copy(this.aim.update(dt, this.position, this.target, roll, this.player?.turnRate));

        const horizontal = fov ?? BASE_FOV;
        const vertical = (2 * Math.atan(Math.tan((horizontal * Math.PI) / 360) / aspect) * 180) / Math.PI;
        camera.fov = Math.min(Math.max(vertical, 42), 82);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        if (this.sky !== null) this.sky.position.copy(camera.position);

        camera.updateMatrixWorld();
        const visible = this.cullingEnabled ? this.culler.visibleRooms(camera) : null;
        this.visibleCount = 0;
        for (const [room, mesh] of this.roomMeshes) {
            mesh.visible = visible === null || visible.has(room);
            if (mesh.visible) this.visibleCount++;
        }
    }

    render(renderer: THREE.WebGLRenderer): void {
        renderer.render(this.scene, this.camera);
    }

    dispose(): void {
        for (const geometry of this.geometries) geometry.dispose();
        for (const material of this.materials) material.dispose();
        this.texture.dispose();
    }
}
