// Every route of a level on one page, as a strip of frames per route:
// /dev/flybysheet.html?level=<url>&cols=6&seed=1. For reviewing flybys
// without watching each one.

import * as THREE from 'three';
import { FlybyLayer } from '../src/flyby/FlybyLayer';
import { loadPreparedLevel } from '../src/flyby/load';
import type { RouteData } from '../src/flyby/prepare';
import { createPlayer } from '../src/flyby/route/player';
import { checkView, fogFor } from '../src/flyby/route/plan';
import { buildWorld } from '../src/flyby/route/world';
import { tr4Horizon } from '../src/flyby/build/horizons';
import { roomVisibility } from '../src/flyby/build/geometry';
import { RoomCuller } from '../src/flyby/visibility';
import { parseLevel } from '../shared/level/parse.ts';

const params = new URLSearchParams(location.search);
const url = params.get('level') ?? '/gd/tr3/app/DATA/HOUSE.TR2';
const cols = Number(params.get('cols') ?? 6);
const W = Number(params.get('w') ?? 320);
const H = Math.round((W * 9) / 16);
const LABEL = 18;
const NOTE = 16;
const info = document.getElementById('info')!;

async function main() {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    // Routes planned elsewhere (routes=<url of a JSON list>), or planned here.
    const routesUrl = params.get('routes');
    const planned = routesUrl === null ? null : ((await (await fetch(routesUrl)).json()) as RouteData[]);
    const prepared = await loadPreparedLevel(bytes, url.slice(url.lastIndexOf('/') + 1), Number(params.get('seed') ?? 1), planned, Number(params.get('attempts') ?? 60));
    const layer = new FlybyLayer(prepared, { reducedMotion: false });
    // What the planner thinks of each view, written under it.
    const fileName = url.slice(url.lastIndexOf('/') + 1);
    const level = await parseLevel(new Uint8Array(await (await fetch(url)).arrayBuffer()), fileName);
    const world = buildWorld(level, level.engine === 4 ? tr4Horizon(fileName) !== null : undefined);
    const fog = fogFor(world.hasSky);
    const culler = new RoomCuller(roomVisibility(level));
    // The planner's camera for culling: wide enough for every sight line it casts.
    const checker = new THREE.PerspectiveCamera(66, 1.27, 0.03, 80);
    const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    const rows = Math.max(prepared.routes.length, 1);
    const sheet = document.getElementById('sheet') as HTMLCanvasElement;
    sheet.width = W * cols;
    sheet.height = (H + LABEL + NOTE) * rows;
    const g = sheet.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '13px monospace';
    for (const [r, route] of prepared.routes.entries()) {
        const { duration } = createPlayer(route, 1.15);
        const y = r * (H + LABEL + NOTE);
        g.fillStyle = '#ddd';
        g.fillText(`#${r} ${route.kind} ${duration.toFixed(1)} s · rooms ${route.rooms.join(',')}`, 4, y + 13);
        for (let c = 0; c < cols; c++) {
            const t = 1.4 + ((duration - 2.8) * c) / Math.max(cols - 1, 1);
            layer.debugFrame(r, Math.max(t, 0));
            layer.render(renderer);
            g.drawImage(renderer.domElement, c * W, y + LABEL);
            g.fillStyle = '#ff0';
            g.fillText(`${t.toFixed(1)}s`, c * W + 4, y + LABEL + 14);
            checker.position.copy(layer.camera.position);
            checker.quaternion.copy(layer.camera.quaternion);
            checker.updateMatrixWorld();
            const v = checkView(world, layer.camera.position, layer.camera.quaternion, fog, world.hasSky, culler.visibleRooms(checker));
            g.fillStyle = v.fault === null ? '#8f8' : '#f66';
            const owner = v.hole < 0 ? '' : ` h${world.owners[v.hole]}`;
            g.fillText(`${v.fault ?? 'ok'} ${v.score.toFixed(2)} n${(v.near * 100).toFixed(0)} m${v.median.toFixed(1)} f${(v.flat * 100).toFixed(0)} b${v.brightness.toFixed(2)} H${(v.holes * 100).toFixed(0)} c${(v.hidden * 100).toFixed(0)} s${(v.skyward * 100).toFixed(0)}${owner}`, c * W + 2, y + LABEL + H + 12);
        }
    }
    info.textContent = `${url} · ${prepared.routes.length} routes`;
    (window as unknown as { __ready: boolean }).__ready = true;
}
main().catch((error) => {
    info.textContent = String(error);
    console.error(error);
    (window as unknown as { __ready: boolean }).__ready = true;
});
