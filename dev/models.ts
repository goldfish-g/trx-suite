// Preview of the menu artifacts under the menu's lighting.
//
//   /dev/models.html                 all eight in a 4×2 grid, slowly turning
//   ?kind=<key>                      one artifact, large
//   ?locked=1 / ?selected=1          show that state for all (or ?locked=scion,eye for some)
//   ?angle=<deg>                     fixed turn instead of spinning
//   ?t=<seconds>                     freeze animation time (for comparable shots)
//   ?elev=<deg>                      camera elevation (default 6)
//   ?labels=0                        hide the stats labels
//   ?bounds=1                        draw the radius-1 budget sphere
//   ?leak=1                          log whether dispose() frees every GPU resource
//
// Sets window.__ready once a few frames have rendered (for scripts/shoot.mjs).

import * as THREE from 'three';
import { ARTIFACT_KINDS, createArtifact, setupArtifactLighting, type Artifact, type ArtifactKind } from '../src/menu/models';

declare global {
    interface Window {
        __ready?: boolean;
    }
}

const params = new URLSearchParams(location.search);
const flag = (name: string) => params.get(name) === '1';
const num = (name: string) => {
    const v = params.get(name);
    return v === null || v === '' ? undefined : Number(v);
};
const kindParam = params.get('kind');
const kinds: readonly ArtifactKind[] = ARTIFACT_KINDS.includes(kindParam as ArtifactKind) ? [kindParam as ArtifactKind] : ARTIFACT_KINDS;
/** `?name=1` applies to every artifact; `?name=scion,eye` to the listed ones. */
const stateFor = (name: string) => {
    const v = params.get(name) ?? '';
    return (kind: ArtifactKind) => v === '1' || v.split(',').includes(kind);
};
const locked = stateFor('locked');
const selected = stateFor('selected');
const fixedAngle = num('angle');
const fixedTime = num('t');
const elevation = THREE.MathUtils.degToRad(num('elev') ?? 6);
const showLabels = params.get('labels') !== '0';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
setupArtifactLighting(renderer, scene);

// ?leak=1: build, draw and dispose every artifact a few times, and check that
// the renderer's geometry/texture/program counts return to where they were
// after a warm-up round (which lets three create its shared sprite quad).
if (flag('leak')) {
    const probe = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    probe.position.set(0, 0, 4);
    const counts = () => ({ ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 });
    let before = counts();
    for (let round = 0; round < 4; round++) {
        const all = ARTIFACT_KINDS.map((kind) => createArtifact(kind));
        for (const a of all) {
            scene.add(a.object);
            a.update(1 / 60, { locked: round === 1, selected: round === 2, time: round });
        }
        renderer.render(scene, probe);
        for (const a of all) a.dispose();
        renderer.render(scene, probe);
        if (round === 0) before = counts();
    }
    const after = counts();
    const leaked = after.geometries !== before.geometries || after.textures !== before.textures || after.programs !== before.programs;
    console.log(`leak check: before ${JSON.stringify(before)} after ${JSON.stringify(after)} ${leaked ? 'LEAK' : 'ok'}`);
}

interface Entry {
    kind: ArtifactKind;
    artifact: Artifact;
    pivot: THREE.Group;
    label?: HTMLDivElement;
}

/** Triangles, materials, and the farthest vertex from the origin. */
function measure(root: THREE.Object3D): { triangles: number; materials: number; radius: number } {
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const materials = new Set<THREE.Material>();
    const v = new THREE.Vector3();
    let triangles = 0;
    let radius = 0;
    root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const g = o.geometry as THREE.BufferGeometry;
        const pos = g.getAttribute('position');
        triangles += (g.index ? g.index.count : pos.count) / 3;
        materials.add(o.material as THREE.Material);
        const m = inverse.clone().multiply(o.matrixWorld);
        for (let i = 0; i < pos.count; i++) radius = Math.max(radius, v.fromBufferAttribute(pos, i).applyMatrix4(m).length());
    });
    return { triangles: Math.round(triangles), materials: materials.size, radius };
}

const entries: Entry[] = kinds.map((kind) => {
    const started = performance.now();
    const artifact = createArtifact(kind);
    const ms = performance.now() - started;
    const pivot = new THREE.Group();
    pivot.add(artifact.object);
    scene.add(pivot);
    const stats = measure(artifact.object);
    console.log(`${kind}: ${stats.triangles} tris, ${stats.materials} materials, r=${stats.radius.toFixed(3)}, built in ${ms.toFixed(1)} ms`);
    const entry: Entry = { kind, artifact, pivot };
    if (showLabels) {
        const label = document.createElement('div');
        label.className = 'label';
        label.innerHTML = `<b>${kind}</b>${(stats.triangles / 1000).toFixed(1)}k tris · ${stats.materials} mat · r ${stats.radius.toFixed(2)}`;
        document.body.appendChild(label);
        entry.label = label;
    }
    if (flag('bounds')) {
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(1, 24, 12),
            new THREE.MeshBasicMaterial({ color: 0x806040, wireframe: true, transparent: true, opacity: 0.15 }),
        );
        pivot.add(sphere);
    }
    return entry;
});

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

interface Cell {
    x: number;
    y: number;
    w: number;
    h: number;
}

function layout(): Cell[] {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (entries.length === 1) return [{ x: 0, y: 0, w: W, h: H }];
    const portrait = H > W;
    const cols = portrait ? 2 : 4;
    const rows = Math.ceil(entries.length / cols);
    const w = W / cols;
    const h = H / rows;
    return entries.map((_, i) => ({ x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h }));
}

function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let frames = 0;

function frame(): void {
    const dt = Math.min(clock.getDelta(), 0.1);
    const time = fixedTime ?? clock.elapsedTime;
    const cells = layout();
    const H = window.innerHeight;

    entries.forEach((entry, i) => {
        entry.pivot.rotation.y =
            fixedAngle !== undefined ? THREE.MathUtils.degToRad(fixedAngle) : time * 0.3 + i * 0.8;
        entry.artifact.update(dt, { locked: locked(entry.kind), selected: selected(entry.kind), time });
    });

    entries.forEach((entry, i) => {
        const cell = cells[i];
        if (!cell) return;
        // Frame the radius-1 budget sphere with a little margin, whatever the cell's aspect.
        const labelSpace = showLabels && entries.length > 1 ? 34 : 0;
        const h = cell.h - labelSpace;
        camera.aspect = cell.w / h;
        const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        const fit = 1.08 / Math.sin(Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect)));
        camera.position.set(0, Math.sin(elevation) * fit, Math.cos(elevation) * fit);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();

        for (const other of entries) other.pivot.visible = other === entry;
        renderer.setViewport(cell.x, H - cell.y - h, cell.w, h);
        renderer.setScissor(cell.x, H - cell.y - h, cell.w, h);
        renderer.render(scene, camera);

        if (entry.label) {
            entry.label.style.left = `${cell.x + cell.w / 2}px`;
            entry.label.style.top = `${cell.y + h - 4}px`;
        }
    });

    if (++frames === 6) window.__ready = true;
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
