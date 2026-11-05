// pnpm dev: the API server and Vite side by side, their output interleaved
// under a prefix, and both stopped together. Arguments go to Vite, so
// `pnpm dev --host` makes the page reachable from a phone on the LAN.
//
// Vite proxies /api, /auth, /engines and /flyby to the API server (see
// vite/proxy.ts); it learns where from TRX_API_URL.
//
// Environment: API_PORT (default 3002) moves the API server. PUBLIC_URL
// defaults to Vite's own address, because Steam must send players back
// through the page's origin for the sign-in page to reach the app; set it
// when Vite listens elsewhere (another port, https, a LAN address). Every
// other variable passes through to the API server (see data/README.md).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiPort = process.env.API_PORT ?? '3002';
const apiUrl = process.env.TRX_API_URL ?? `${process.env.HTTPS_KEY ? 'https' : 'http'}://localhost:${apiPort}`;
const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:5173';
const viteBin = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');

const color = process.stdout.isTTY;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let stopping = false;
let exitCode = 0;

function start(name, colorCode, args, env, stdin) {
    const prefix = paint(colorCode, `[${name}]`);
    const child = spawn(process.execPath, args, {
        cwd: root,
        env: { ...process.env, ...(color ? { FORCE_COLOR: '1' } : {}), ...env },
        stdio: [stdin, 'pipe', 'pipe'],
    });
    for (const [stream, target] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
    ]) {
        createInterface({ input: stream, crlfDelay: Infinity }).on('line', (line) => target.write(`${prefix} ${line}\n`));
    }
    child.on('exit', (code, signal) => {
        if (!stopping) console.error(`${prefix} exited (${signal ?? `code ${code}`}); stopping the other one.`);
        stop(code ?? 1);
    });
    child.on('error', (error) => {
        console.error(`${prefix} could not start: ${error.message}`);
        stop(1);
    });
    children.push(child);
}

function running(child) {
    return child.exitCode === null && child.signalCode === null;
}

/** Stops both; exits with the code of whatever stopped first, once both are gone. */
function stop(code) {
    if (!stopping) {
        stopping = true;
        exitCode = code;
        for (const child of children) if (running(child)) child.kill('SIGTERM');
        // Give them a moment to close; then insist.
        setTimeout(() => {
            for (const child of children) if (running(child)) child.kill('SIGKILL');
            process.exit(exitCode);
        }, 5000).unref();
    }
    if (!children.some(running)) process.exit(exitCode);
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
process.on('SIGHUP', () => stop(129));
// Last resort if this process dies some other way.
process.on('exit', () => {
    for (const child of children) if (running(child)) child.kill('SIGKILL');
});

console.log(`${paint('36', '[dev]')} API server on ${apiUrl}, Steam returns players to ${publicUrl}`);
start(
    'api',
    '35',
    ['--watch', '--watch-preserve-output', 'server/src/main.ts'],
    { PORT: apiPort, PUBLIC_URL: publicUrl },
    'ignore',
);
// Vite gets the terminal's input for its keyboard shortcuts.
start('web', '32', [viteBin, ...process.argv.slice(2)], { TRX_API_URL: apiUrl }, 'inherit');
