// Shows a level's flyby on its own: /dev/flyby.html?level=<url>&route=<i>&t=<seconds>
// With route and t set, the camera holds still at that moment (for screenshots).

import * as THREE from 'three';
import { FlybyLayer } from '../src/flyby/FlybyLayer';
import { loadPreparedLevel } from '../src/flyby/load';

const params = new URLSearchParams(location.search);
const url = params.get('level') ?? '/gd/tr3/app/DATA/HOUSE.TR2';
const route = params.get('route');
const at = params.get('t');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const info = document.getElementById('info')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));

async function main() {
    const started = performance.now();
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const prepared = await loadPreparedLevel(bytes, url.slice(url.lastIndexOf('/') + 1), Number(new URLSearchParams(location.search).get('seed') ?? 1));
    const layer = new FlybyLayer(prepared, { reducedMotion: false });
    // Routes are random; a seed in the URL keeps a preview repeatable.

    const loadMs = Math.round(performance.now() - started);
    const resize = () => renderer.setSize(innerWidth, innerHeight, false);
    resize();
    addEventListener('resize', resize);
    layer.cullingEnabled = params.get('cull') !== '0';
    if (route !== null) layer.debugJump(Number(route), Number(at ?? 0));
    let last = performance.now();
    let frames = 0;
    const frame = (now: number) => {
        const dt = route !== null ? 0 : Math.min((now - last) / 1000, 0.1);
        last = now;
        layer.update(dt, innerWidth / innerHeight);
        layer.render(renderer);
        frames++;
        info.textContent = `${url} · ${prepared.routes.length} routes (${prepared.routes.filter((r) => r.kind === 'scripted').length} scripted) · drawn rooms ${layer.visibleCount} · route ${layer.currentRooms.join(',')} · load ${loadMs} ms · calls ${renderer.info.render.calls} · tris ${renderer.info.render.triangles}`;
        if (frames === 5) (window as unknown as { __ready: boolean }).__ready = true;
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}
main().catch((error) => {
    info.textContent = String(error);
    console.error(error);
    (window as unknown as { __ready: boolean }).__ready = true;
});
