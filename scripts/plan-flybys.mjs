// Plans the menu's flyby routes for every level of the official games in
// data/catalog.json, and writes them to src/flyby/planned/<game>.json for
// the app to ship (src/flyby/planned.ts). Run it after changing the route
// planner, or when the catalog's game files change:
//
//   node scripts/plan-flybys.mjs [--jobs 8] [--attempts 1000] [--only tr1,tr4/karnak1.tr4]
//
// Levels are planned in parallel, in child processes of this script.

import { fork } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback) {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? process.argv[at + 1] : fallback;
}

async function planner() {
    const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
    const module = await server.ssrLoadModule('/scripts/flyby-planner.ts');
    return { server, module };
}

if (process.env.PLAN_FLYBYS_CHILD) {
    // A child: plans the jobs it is sent, one at a time.
    const { module } = await planner();
    const attempts = Number(process.env.PLAN_FLYBYS_ATTEMPTS);
    process.on('message', async (job) => {
        if (job === null) process.exit(0);
        try {
            const planned = await module.planJob(job, attempts, async (path) => new Uint8Array(await readFile(path)));
            process.send({ job, planned });
        } catch (error) {
            process.send({ job, error: String(error?.stack ?? error) });
        }
    });
    process.send({ ready: true });
} else {
    const jobsCount = Number(option('jobs', Math.max(1, Math.min(8, availableParallelism() - 2))));
    const attempts = Number(option('attempts', 1000));
    const only = option('only', '')
        .split(',')
        .filter(Boolean);
    const catalog = JSON.parse(readFileSync(join(root, 'data/catalog.json'), 'utf8'));
    const { server, module } = await planner();
    let jobs = [];
    for (const [mod, zip] of Object.entries(catalog.games ?? {})) {
        jobs.push(...(await module.archiveJobs(mod, resolve(root, 'data', zip))));
    }
    await server.close();
    const wanted = (job) => {
        if (only.length === 0) return true;
        const file = job.path.slice(job.path.lastIndexOf('/') + 1).toLowerCase();
        return only.some((item) => item === job.mod || item.toLowerCase() === `${job.mod}/${file}`);
    };
    jobs = jobs.filter(wanted);
    console.log(`Planning ${jobs.length} levels in ${jobsCount} processes, ${attempts} tours each.`);

    const results = new Map(); // mod -> Map(file -> stored)
    const failures = [];
    let done = 0;
    const queue = [...jobs];
    await Promise.all(
        Array.from({ length: Math.min(jobsCount, jobs.length) }, () =>
            new Promise((resolveChild) => {
                const child = fork(fileURLToPath(import.meta.url), [], {
                    env: { ...process.env, PLAN_FLYBYS_CHILD: '1', PLAN_FLYBYS_ATTEMPTS: String(attempts) },
                });
                const next = () => child.send(queue.shift() ?? null);
                child.on('message', (message) => {
                    if (message.ready) return next();
                    done++;
                    if (message.error) {
                        failures.push(`${message.job.mod}/${message.job.path}: ${message.error}`);
                        console.log(`[${done}/${jobs.length}] FAILED ${message.job.mod}/${message.job.path}`);
                    } else {
                        const levels = results.get(message.job.mod) ?? new Map();
                        levels.set(message.planned.file, message.planned.stored);
                        results.set(message.job.mod, levels);
                        console.log(`[${done}/${jobs.length}] ${message.planned.report}`);
                    }
                    next();
                });
                child.on('exit', resolveChild);
            }),
        ),
    );

    // Merge into the games' files: levels planned now replace the old ones.
    const directory = join(root, 'src/flyby/planned');
    mkdirSync(directory, { recursive: true });
    for (const [mod, levels] of results) {
        const path = join(directory, `${mod}.json`);
        let game = { version: 1, levels: {} };
        try {
            game = JSON.parse(readFileSync(path, 'utf8'));
        } catch {
            // A new file.
        }
        for (const [file, stored] of levels) game.levels[file] = stored;
        const sorted = Object.fromEntries(Object.entries(game.levels).sort(([a], [b]) => a.localeCompare(b)));
        writeFileSync(path, `${JSON.stringify({ version: 1, levels: sorted })}\n`);
        console.log(`Wrote ${path}`);
    }
    if (failures.length > 0) {
        console.log(`\n${failures.length} levels failed:\n${failures.join('\n')}`);
        process.exitCode = 1;
    }
}
