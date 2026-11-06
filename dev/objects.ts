// A contact sheet of a level's objects, each in its own cell with its id:
// /dev/objects.html?level=<url>&page=0&cols=8&rows=5[&only=m145,s12]
// For finding which object is which (m = moveable, s = static mesh).

import * as THREE from 'three';
import { parseLevel } from '../shared/level/parse.ts';
import { extractObject, objectsIn, type ObjectRef } from '../shared/ring/extract.ts';
import { modelMesh } from '../src/menu/models/game';

const params = new URLSearchParams(location.search);
const url = params.get('level')!;
const cols = Number(params.get('cols') ?? 8);
const rows = Number(params.get('rows') ?? 5);
const page = Number(params.get('page') ?? 0);
const only = params.get('only');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const labels = document.getElementById('labels')!;
const info = document.getElementById('info')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight, false);
renderer.setScissorTest(true);
renderer.outputColorSpace = THREE.SRGBColorSpace;

async function main() {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const level = await parseLevel(bytes, url.slice(url.lastIndexOf('/') + 1));
    let refs = objectsIn(level);
    if (only !== null) {
        const wanted = new Set(only.split(','));
        refs = refs.filter((r) => wanted.has(`${r.kind[0]}${r.id}`));
    }
    const kinds = params.get('kinds') ?? 'ms';
    refs = refs.filter((r) => kinds.includes(r.kind[0]!));
    const maxRadius = Number(params.get('maxr') ?? Infinity);
    if (maxRadius < Infinity) {
        refs = refs.filter((r) => {
            const model = extractObject(level, r);
            if (model === null) return false;
            let radius = 0;
            for (let i = 0; i < model.positions.length; i++) radius = Math.max(radius, Math.abs(model.positions[i]!));
            return radius * 1024 <= maxRadius && model.indices.length / 3 >= Number(params.get('mint') ?? 0);
        });
    }
    const shown = refs.slice(page * cols * rows, (page + 1) * cols * rows);
    const cellW = innerWidth / cols;
    const cellH = innerHeight / rows;
    const scenes: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; ref: ObjectRef }[] = [];
    for (const ref of shown) {
        const model = extractObject(level, ref);
        if (model === null) continue;
        const scene = new THREE.Scene();
        const object = modelMesh(model);
        const box = new THREE.Box3().setFromObject(object);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        object.position.sub(sphere.center);
        object.rotation.y = 0;
        const holder = new THREE.Group();
        holder.add(object);
        holder.rotation.y = -0.6;
        scene.add(holder);
        scene.add(new THREE.HemisphereLight(0xfff4e0, 0x202030, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 2.2);
        sun.position.set(2, 3, 4);
        scene.add(sun);
        const camera = new THREE.PerspectiveCamera(30, cellW / cellH, 0.01, 100);
        const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05;
        const pitch = THREE.MathUtils.degToRad(Number(params.get('pitch') ?? 19));
        camera.position.set(0, Math.sin(pitch) * distance, Math.cos(pitch) * distance);
        camera.lookAt(0, 0, 0);
        scenes.push({ scene, camera, ref });
        const label = document.createElement('div');
        const index = scenes.length - 1;
        label.style.left = `${(index % cols) * cellW}px`;
        label.style.top = `${Math.floor(index / cols) * cellH}px`;
        label.textContent = `${ref.kind[0]}${ref.id} · ${(sphere.radius * 1024).toFixed(0)}u · ${model.indices.length / 3}t`;
        labels.appendChild(label);
    }
    scenes.forEach(({ scene, camera }, index) => {
        const x = (index % cols) * cellW;
        const y = innerHeight - (Math.floor(index / cols) + 1) * cellH;
        renderer.setViewport(x, y, cellW, cellH);
        renderer.setScissor(x, y, cellW, cellH);
        renderer.setClearColor(index % 2 === Math.floor(index / cols) % 2 ? 0x1b1e22 : 0x22262b);
        renderer.clear();
        renderer.render(scene, camera);
    });
    info.textContent = `${url} · engine ${level.engine} · ${refs.length} objects · page ${page + 1}/${Math.ceil(refs.length / (cols * rows))}`;
    (window as unknown as { __ready: boolean }).__ready = true;
}

main().catch((error) => {
    info.textContent = String(error);
    console.error(error);
    (window as unknown as { __ready: boolean }).__ready = true;
});
