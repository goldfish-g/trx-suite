// Checks that drawing only the rooms seen through doorways looks the same as
// drawing every room: /dev/cullcheck.html?level=<url>. Renders moments along
// every route both ways and reports how many pixels differ.

import * as THREE from 'three';
import { FlybyLayer } from '../src/flyby/FlybyLayer';
import { loadPreparedLevel } from '../src/flyby/load';

const url = new URLSearchParams(location.search).get('level') ?? '/gd/tr3/app/DATA/HOUSE.TR2';
const info = document.getElementById('info')!;
const W = 320;
const H = 180;
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
const gl = renderer.getContext();

function grab(): Uint8Array {
    const pixels = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
}

async function main() {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const prepared = await loadPreparedLevel(bytes, url.slice(url.lastIndexOf('/') + 1), Number(new URLSearchParams(location.search).get('seed') ?? 1));
    const layer = new FlybyLayer(prepared, { reducedMotion: false });
    let worst = 0;
    let worstAt = '';
    let samples = 0;
    let culledRooms = 0;
    let allRooms = 0;
    for (let route = 0; route < layer.routeCount; route++) {
        for (let t = 1; t < 40; t += 2.5) {
            const render = (culling: boolean) => {
                layer.cullingEnabled = culling;
                layer.debugJump(route, t);
                layer.update(0, W / H);
                renderer.clear();
                layer.render(renderer);
                return grab();
            };
            const culled = render(true);
            culledRooms += layer.visibleCount;
            const full = render(false);
            allRooms += layer.visibleCount;
            let differing = 0;
            for (let i = 0; i < culled.length; i += 4) {
                if (Math.abs(culled[i]! - full[i]!) + Math.abs(culled[i + 1]! - full[i + 1]!) + Math.abs(culled[i + 2]! - full[i + 2]!) > 48) differing++;
            }
            const ratio = differing / (W * H);
            samples++;
            if (ratio > worst) {
                worst = ratio;
                worstAt = `route ${route} t ${t}`;
            }
        }
    }
    info.textContent = `${url}: ${samples} samples, worst ${(worst * 100).toFixed(2)}% pixels differ at ${worstAt}, rooms drawn ${(culledRooms / samples).toFixed(1)} vs ${(allRooms / samples).toFixed(1)}`;
    (window as unknown as { __ready: boolean }).__ready = true;
}
main().catch((error) => {
    info.textContent = String(error);
    (window as unknown as { __ready: boolean }).__ready = true;
});
