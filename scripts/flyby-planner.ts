// The part of scripts/plan-flybys.mjs that runs through Vite, so it can use
// the app's own modules: plans one level file's routes.

import { parseLevel } from '../shared/level/parse.ts';
import { listZip, readZipEntry, type ZipEntry } from '../server/src/zip.ts';
import { tr4Horizon } from '../src/flyby/build/horizons';
import { seeded } from '../src/flyby/prepare';
import { planRoutes } from '../src/flyby/route/plan';
import { isScenic } from '../src/flyby/scenic';
import { storeRoute, type StoredLevel } from '../src/flyby/stored';

export interface Job {
    mod: string;
    /** A zip and the entry in it, or a plain file. */
    zip: string | null;
    path: string;
}

/** The level files of a game's archive the menu may fly through. */
export async function archiveJobs(mod: string, zip: string): Promise<Job[]> {
    const entries = await listZip(zip);
    return entries
        .filter((entry) => entry.path.includes('/levels/') && isScenic(entry.path.slice(entry.path.lastIndexOf('/') + 1)))
        .map((entry) => ({ mod, zip, path: entry.path }));
}

/** A number from a name, so each level always gets the same routes. */
function seedOf(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return hash >>> 0;
}

export interface PlannedLevel {
    file: string;
    stored: StoredLevel;
    report: string;
}

export async function planJob(job: Job, attempts: number, readFile: (path: string) => Promise<Uint8Array>): Promise<PlannedLevel> {
    let bytes: Uint8Array;
    if (job.zip === null) bytes = await readFile(job.path);
    else {
        const entry = (await listZip(job.zip)).find((e: ZipEntry) => e.path === job.path)!;
        bytes = await readZipEntry(job.zip, entry);
    }
    const file = job.path.slice(job.path.lastIndexOf('/') + 1);
    const started = performance.now();
    const level = await parseLevel(bytes, file);
    const sky = level.engine === 4 ? tr4Horizon(file) !== null : undefined;
    const plan = planRoutes(level, { random: seeded(seedOf(`${job.mod}/${file.toLowerCase()}`)), attempts, sky });
    const seconds = plan.routes.map((r) => `${r.route.kind === 'scripted' ? 's' : ''}${r.duration.toFixed(0)}`).join(' ');
    const report = `${job.mod}/${file}: ${plan.routes.length} routes [${seconds}] best ${plan.routes[0]?.score.toFixed(2) ?? '-'} in ${((performance.now() - started) / 1000).toFixed(1)} s`;
    return { file: file.toLowerCase(), stored: { size: bytes.length, routes: plan.routes.map((r) => storeRoute(r.route)) }, report };
}
