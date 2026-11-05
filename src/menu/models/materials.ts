// The artifacts' shared material language.
//
// Every artifact is built from a handful of presets (gold, brass, bronze,
// steel, obsidian, lapis, meteoric rock, glow) so the eight read as one set:
// polished warm metals, deep glossy stones, and a single emissive accent each.
//
// Each material can be "petrified" for the locked state: a shader patch blends
// the albedo (after maps and vertex colours) towards a dark, grainy, weathered
// stone, while the CPU side lerps metalness/roughness/clearcoat and fades the
// glow, so a locked artifact reads as an old carved statue of itself.
// Only uniforms change, so locking never rebuilds geometry or recompiles.

import * as THREE from 'three';

/** Parameters that are interpolated between the lit and the petrified look. */
interface Look {
    metalness: number;
    roughness: number;
    envMapIntensity: number;
    clearcoat: number;
}

/** The weathered stone every locked artifact turns into (sRGB, converted to linear). */
const STONE_TINT = new THREE.Color('#3f3b36');

const PETRIFY_COMMON = /* glsl */ `
uniform float uLock;
uniform vec3 uStone;
varying vec3 vArtifactPos;
float artifactHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float artifactValueNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(artifactHash(i), artifactHash(i + vec3(1, 0, 0)), f.x),
            mix(artifactHash(i + vec3(0, 1, 0)), artifactHash(i + vec3(1, 1, 0)), f.x), f.y),
        mix(mix(artifactHash(i + vec3(0, 0, 1)), artifactHash(i + vec3(1, 0, 1)), f.x),
            mix(artifactHash(i + vec3(0, 1, 1)), artifactHash(i + vec3(1, 1, 1)), f.x), f.y),
        f.z);
}
`;

// Blend the albedo towards stone. The source luminance is kept (compressed) so
// a gold collar on a black body still separates as light-on-dark stone, and a
// two-octave grain sells the carved-stone surface.
const PETRIFY_FRAGMENT = /* glsl */ `
if (uLock > 0.0) {
    float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float grain = 0.65 * artifactValueNoise(vArtifactPos * 18.0)
                + 0.35 * artifactValueNoise(vArtifactPos * 55.0);
    vec3 stone = uStone * (0.5 + 0.9 * sqrt(lum)) * (0.78 + 0.44 * grain);
    diffuseColor.rgb = mix(diffuseColor.rgb, stone, uLock);
}
`;

function patchPetrify(material: THREE.MeshStandardMaterial, lock: { value: number }): void {
    const stone = { value: STONE_TINT };
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uLock = lock;
        shader.uniforms.uStone = stone;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vArtifactPos;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArtifactPos = position;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${PETRIFY_COMMON}`)
            .replace('#include <color_fragment>', `#include <color_fragment>\n${PETRIFY_FRAGMENT}`);
    };
    // Every artifact material shares the same patch, so they can share programs.
    material.customProgramCacheKey = () => 'artifact-petrify-v1';
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A material plus the two looks it moves between. `pulse` is the artifact's
 * animated glow multiplier; `apply` combines it with the locked/selected
 * blend factors once per frame.
 */
export class ArtifactMaterial {
    readonly material: THREE.MeshStandardMaterial;
    /** Animated multiplier on the emissive glow (1 = designed strength). */
    pulse = 1;
    private readonly lit: Look;
    private readonly stone: Look;
    private readonly emissiveIntensity: number;
    private readonly lock = { value: 0 };

    constructor(material: THREE.MeshStandardMaterial, stone: Partial<Look> = {}) {
        this.material = material;
        const clearcoat = material instanceof THREE.MeshPhysicalMaterial ? material.clearcoat : 0;
        this.lit = {
            metalness: material.metalness,
            roughness: material.roughness,
            envMapIntensity: material.envMapIntensity,
            clearcoat,
        };
        this.stone = {
            metalness: 0,
            roughness: 0.9,
            envMapIntensity: 0.3,
            // Never cross zero: three.js recompiles when clearcoat toggles on/off.
            clearcoat: clearcoat > 0 ? 0.02 : 0,
            ...stone,
        };
        this.emissiveIntensity = material.emissiveIntensity;
        patchPetrify(material, this.lock);
    }

    /** `lock` and `select` are smoothed blend factors in [0, 1]. */
    apply(lock: number, select: number): void {
        const m = this.material;
        const sheen = 1 + 0.1 * select * (1 - lock);
        m.metalness = lerp(this.lit.metalness, this.stone.metalness, lock);
        m.roughness = lerp(this.lit.roughness, this.stone.roughness, lock);
        m.envMapIntensity = lerp(this.lit.envMapIntensity, this.stone.envMapIntensity, lock) * sheen;
        if (m instanceof THREE.MeshPhysicalMaterial && this.lit.clearcoat > 0) {
            m.clearcoat = lerp(this.lit.clearcoat, this.stone.clearcoat, lock);
        }
        m.emissiveIntensity = this.emissiveIntensity * this.pulse * (1 + 0.7 * select) * (1 - lock) ** 2;
        this.lock.value = lock;
    }

    dispose(): void {
        this.material.dispose();
    }
}

// ---------------------------------------------------------------------------
// Presets. Colours are sRGB hex; three converts them to linear.

interface PresetOptions {
    color?: THREE.ColorRepresentation;
    roughness?: number;
    vertexColors?: boolean;
    flatShading?: boolean;
}

/** Polished yellow gold: the family's signature metal. */
export function gold(o: PresetOptions = {}): ArtifactMaterial {
    return new ArtifactMaterial(
        new THREE.MeshStandardMaterial({
            color: o.color ?? '#e2a548',
            metalness: 1,
            roughness: o.roughness ?? 0.28,
            // A touch dimmer than the studio environment gives, so the key
            // light's highlights stand out and the gold reads saturated.
            envMapIntensity: 0.7,
            vertexColors: o.vertexColors ?? false,
            flatShading: o.flatShading ?? false,
        }),
    );
}

/** Slightly paler, more worn brass for instruments. */
export function brass(o: PresetOptions = {}): ArtifactMaterial {
    return gold({ color: '#d9b27a', roughness: 0.32, ...o });
}

/** Old bronze; meant to be used with vertex colours that add verdigris. */
export function bronze(o: PresetOptions = {}): ArtifactMaterial {
    return new ArtifactMaterial(
        new THREE.MeshStandardMaterial({
            color: o.color ?? '#ffffff',
            metalness: 0.85,
            roughness: o.roughness ?? 0.42,
            vertexColors: o.vertexColors ?? true,
            flatShading: o.flatShading ?? false,
        }),
    );
}

/** Bright, slightly cool blade steel. */
export function steel(o: PresetOptions = {}): ArtifactMaterial {
    return new ArtifactMaterial(
        new THREE.MeshStandardMaterial({
            color: o.color ?? '#d6dbe2',
            metalness: 1,
            roughness: o.roughness ?? 0.2,
            flatShading: o.flatShading ?? false,
            vertexColors: o.vertexColors ?? false,
        }),
    );
}

/** Black volcanic glass: near-black base under a mirror clearcoat. */
export function obsidian(o: PresetOptions = {}): ArtifactMaterial {
    return new ArtifactMaterial(
        new THREE.MeshPhysicalMaterial({
            color: o.color ?? '#111014',
            metalness: 0.1,
            roughness: o.roughness ?? 0.32,
            clearcoat: 1,
            clearcoatRoughness: 0.06,
            vertexColors: o.vertexColors ?? false,
            flatShading: o.flatShading ?? false,
        }),
    );
}

/** Honed black basalt for plinths: dark and quiet, so the piece on it stands out. */
export function basalt(o: PresetOptions = {}): ArtifactMaterial {
    return new ArtifactMaterial(
        new THREE.MeshStandardMaterial({
            color: o.color ?? '#1d1a18',
            metalness: 0,
            roughness: o.roughness ?? 0.5,
            flatShading: o.flatShading ?? false,
        }),
        { roughness: 0.9 },
    );
}

/** Polished lapis lazuli; `map` carries the blue mottling and pyrite flecks. */
export function lapis(map: THREE.Texture): ArtifactMaterial {
    return new ArtifactMaterial(
        new THREE.MeshPhysicalMaterial({
            map,
            color: '#ffffff',
            metalness: 0,
            roughness: 0.42,
            clearcoat: 0.9,
            clearcoatRoughness: 0.12,
        }),
    );
}

/** Polished turquoise inlay. */
export function turquoise(o: PresetOptions = {}): ArtifactMaterial {
    return new ArtifactMaterial(
        new THREE.MeshPhysicalMaterial({
            color: o.color ?? '#169c92',
            metalness: 0,
            roughness: o.roughness ?? 0.38,
            clearcoat: 0.6,
            clearcoatRoughness: 0.2,
        }),
    );
}

/** Dark iron-rich meteoric rock, faceted. */
export function rock(o: PresetOptions = {}): ArtifactMaterial {
    return new ArtifactMaterial(
        new THREE.MeshStandardMaterial({
            color: o.color ?? '#2c2723',
            metalness: 0.6,
            roughness: o.roughness ?? 0.48,
            flatShading: o.flatShading ?? true,
            vertexColors: o.vertexColors ?? false,
        }),
    );
}

/** Dyed leather / silk cord for grips. */
export function leather(o: PresetOptions = {}): ArtifactMaterial {
    return new ArtifactMaterial(
        new THREE.MeshStandardMaterial({
            color: o.color ?? '#6b1a17',
            metalness: 0,
            roughness: o.roughness ?? 0.62,
            vertexColors: o.vertexColors ?? false,
        }),
    );
}

/**
 * A self-lit accent: a dark tinted base with a strong emissive term so it stays
 * luminous under ACES without bloom. `intensity` is the designed peak.
 */
export function glow(color: THREE.ColorRepresentation, intensity: number, o: PresetOptions = {}): ArtifactMaterial {
    const c = new THREE.Color(color);
    return new ArtifactMaterial(
        new THREE.MeshStandardMaterial({
            color: c.clone().multiplyScalar(0.35),
            emissive: c,
            emissiveIntensity: intensity,
            metalness: 0,
            roughness: o.roughness ?? 0.35,
            flatShading: o.flatShading ?? false,
            vertexColors: o.vertexColors ?? false,
        }),
        { roughness: 0.9 },
    );
}

/** A cut gemstone: glossy, clearcoated, with an inner emissive fire. */
export function gem(color: THREE.ColorRepresentation, intensity: number, o: PresetOptions = {}): ArtifactMaterial {
    const c = new THREE.Color(color);
    return new ArtifactMaterial(
        new THREE.MeshPhysicalMaterial({
            color: c.clone().multiplyScalar(0.6),
            emissive: c,
            emissiveIntensity: intensity,
            metalness: 0,
            roughness: 0.12,
            clearcoat: 1,
            clearcoatRoughness: 0.02,
            flatShading: o.flatShading ?? true,
        }),
    );
}

/** Thin instrument glass; transparent, mostly visible through reflections. */
export function glass(): ArtifactMaterial {
    return new ArtifactMaterial(
        new THREE.MeshPhysicalMaterial({
            color: '#ffffff',
            metalness: 0,
            roughness: 0.04,
            transparent: true,
            opacity: 0.24,
            depthWrite: false,
            clearcoat: 1,
            clearcoatRoughness: 0,
            envMapIntensity: 1.4,
        }),
        { roughness: 0.3, envMapIntensity: 0.6 },
    );
}
