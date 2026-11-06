// The ring's artifacts made from the games themselves: an object cut out of
// a level (shared/ring/extract.ts), with its own texels, lit like a museum
// piece. A locked game's object turns to stone.

import * as THREE from 'three';
import type { RingModelFile } from '../../../shared/api.ts';
import type { ObjectModel } from '../../../shared/ring/extract.ts';
import type { Artifact } from './types';

/** How an object sits and shines on the ring. */
export interface Look {
    /** Turns, in degrees, applied in x, y, z order: how the object stands. */
    turn?: [number, number, number];
    metalness?: number;
    roughness?: number;
    /** How much the texture glows by itself, 0–1. */
    glow?: number;
    /** Size against the others, 1 by default. */
    scale?: number;
}

function stoneMaterial(options: THREE.MeshStandardMaterialParameters, stone: { value: number }): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(options);
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uStone = stone;
        shader.fragmentShader = `uniform float uStone;\n${shader.fragmentShader}`
            .replace(
                '#include <map_fragment>',
                `#include <map_fragment>
                float stoneLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04 + stoneLuma * 0.42) * vec3(0.86, 0.81, 0.74), uStone);`,
            )
            .replace(
                '#include <metalnessmap_fragment>',
                `#include <metalnessmap_fragment>
                metalnessFactor *= 1.0 - uStone;`,
            )
            .replace(
                '#include <roughnessmap_fragment>',
                `#include <roughnessmap_fragment>
                roughnessFactor = mix(roughnessFactor, 0.92, uStone);`,
            );
    };
    // One program for every stone-capable material, apart from plain ones.
    material.customProgramCacheKey = () => 'ring-stone';
    return material;
}

function geometryOf(model: Pick<ObjectModel, 'blendStart'> & { positions: ArrayLike<number>; normals: ArrayLike<number>; uvs: ArrayLike<number>; indices: ArrayLike<number> }, look: Look): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(model.positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(model.normals), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(model.uvs), 2));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(model.indices), 1));
    // Objects that are mostly glow (crystals) are drawn solid, glowing from
    // within, so they keep their shape and can still turn to stone.
    const blendStart = model.blendStart < model.indices.length / 2 ? model.indices.length : model.blendStart;
    geometry.addGroup(0, blendStart, 0);
    geometry.addGroup(blendStart, model.indices.length - blendStart, 1);

    // Centred, turned to stand as it should, and fitted inside a unit sphere.
    geometry.computeBoundingBox();
    const centre = geometry.boundingBox!.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z);
    const [x, y, z] = (look.turn ?? [0, 0, 0]).map(THREE.MathUtils.degToRad) as [number, number, number];
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ')));
    geometry.computeBoundingBox();
    const again = geometry.boundingBox!.getCenter(new THREE.Vector3());
    geometry.translate(-again.x, -again.y, -again.z);
    const position = geometry.getAttribute('position');
    let radius = 0;
    for (let i = 0; i < position.count; i++) radius = Math.max(radius, Math.hypot(position.getX(i), position.getY(i), position.getZ(i)));
    const scale = radius > 0 ? (0.8 * (look.scale ?? 1)) / radius : 1;
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingSphere();
    return geometry;
}

function configure(texture: THREE.Texture): THREE.Texture {
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
}

function assemble(geometry: THREE.BufferGeometry, texture: THREE.Texture, look: Look): Artifact {
    const stone = { value: 0 };
    const glow = look.glow ?? 0;
    const solid = stoneMaterial(
        {
            map: texture,
            alphaTest: 0.5,
            metalness: look.metalness ?? 0.15,
            roughness: look.roughness ?? 0.6,
            emissive: new THREE.Color(0xffffff),
            emissiveMap: texture,
            emissiveIntensity: glow,
        },
        stone,
    );
    const shine = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, [solid, shine]);
    const object = new THREE.Group();
    object.add(mesh);
    let lockedness: number | null = null;
    return {
        object,
        update(dt, state) {
            const wanted = state.locked ? 1 : 0;
            lockedness = lockedness === null ? wanted : lockedness + (wanted - lockedness) * (1 - Math.exp(-dt * 3));
            stone.value = lockedness;
            solid.emissiveIntensity = glow * (1 - lockedness * 0.9) * (state.selected ? 1 : 0.75);
            shine.opacity = 1 - lockedness;
        },
        dispose() {
            geometry.dispose();
            solid.dispose();
            shine.dispose();
            texture.dispose();
        },
    };
}

/** An artifact from a model the server sent. */
export async function createGameArtifact(file: RingModelFile, look: Look): Promise<Artifact> {
    const image = new Image();
    image.src = file.texture;
    await image.decode();
    return assemble(geometryOf(file, look), configure(new THREE.Texture(image)), look);
}

/** An artifact straight from a parsed level, for previews. */
export function artifactFromModel(model: ObjectModel, look: Look): Artifact {
    const { width, height, pixels } = model.atlas;
    const texture = new THREE.DataTexture(pixels as Uint8Array<ArrayBuffer>, width, height, THREE.RGBAFormat);
    return assemble(geometryOf(model, look), configure(texture), look);
}

/** A plain mesh of the model, for the contact sheet. */
export function modelMesh(model: ObjectModel): THREE.Object3D {
    return artifactFromModel(model, {}).object;
}
