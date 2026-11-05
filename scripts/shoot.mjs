#!/usr/bin/env node
// Screenshot tool: starts Vite, opens each given path in headless Chromium
// (software WebGL via SwiftShader), waits for the page to report
// `window.__ready = true`, and saves a PNG per path to .work/shots/.
//
// usage: node scripts/shoot.mjs [options] <path> [<path> ...]
//
//   --port <n>          Vite port (default 5181)
//   --viewport <WxH>    viewport size in CSS px (default 1280x720)
//   --mobile            390x844 @2x, touch, mobile UA flags (name gets "-mobile")
//   --scale <n>         deviceScaleFactor (default 1, or 2 with --mobile)
//   --wait <ms>         extra wait after ready (default 0)
//   --timeout <ms>      how long to wait for window.__ready (default 30000)
//   --no-ready          don't wait for window.__ready at all
//   --full-page         capture the full scrollable page
//   --out <dir>         output directory (default .work/shots)
//   --name <name>       file name for the first path (repeatable, in order)
//   --verbose           also print console.log/info/warn output
//
// Each shot is named after its path unless --name is given, e.g.
// "/dev/models.html?kind=hand" -> "dev-models-kind-hand.png".

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
    const opts = {
        port: 5181,
        width: 1280,
        height: 720,
        mobile: false,
        scale: undefined,
        wait: 0,
        timeout: 30000,
        ready: true,
        fullPage: false,
        out: path.join(root, '.work/shots'),
        names: [],
        verbose: false,
        paths: [],
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            const value = argv[++i];
            if (value === undefined) throw new Error(`${arg} needs a value`);
            return value;
        };
        switch (arg) {
            case '--port': opts.port = Number(next()); break;
            case '--viewport': {
                const m = /^(\d+)x(\d+)$/.exec(next());
                if (!m) throw new Error('--viewport expects WxH, e.g. 1280x720');
                opts.width = Number(m[1]);
                opts.height = Number(m[2]);
                break;
            }
            case '--mobile': opts.mobile = true; break;
            case '--scale': opts.scale = Number(next()); break;
            case '--wait': opts.wait = Number(next()); break;
            case '--timeout': opts.timeout = Number(next()); break;
            case '--no-ready': opts.ready = false; break;
            case '--full-page': opts.fullPage = true; break;
            case '--out': opts.out = path.resolve(next()); break;
            case '--name': opts.names.push(next()); break;
            case '--verbose': opts.verbose = true; break;
            case '-h':
            case '--help':
                console.log('usage: node scripts/shoot.mjs [--port n] [--viewport WxH] [--mobile] [--wait ms] <path>...');
                process.exit(0);
                break;
            default:
                if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
                opts.paths.push(arg.startsWith('/') ? arg : `/${arg}`);
        }
    }
    if (opts.paths.length === 0) throw new Error('no paths given');
    return opts;
}

/**
 * Waits for `window.__ready === true`. On a cold cache Vite may optimise new
 * dependencies and reload the page mid-wait, which destroys the execution
 * context; that just restarts the wait on the new page.
 */
async function waitForReady(page, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            await page.waitForFunction(() => window.__ready === true, null, { timeout: Math.max(1, deadline - Date.now()) });
            return true;
        } catch (err) {
            if (!/context was destroyed|navigat/i.test(String(err))) return false;
            await page.waitForLoadState('load').catch(() => {});
        }
    }
    return false;
}

/** "/dev/models.html?kind=hand" -> "dev-models-kind-hand" */
function nameFor(urlPath) {
    const name = urlPath
        .replace(/\.html?(?=$|[?#])/, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return name || 'index';
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    await mkdir(opts.out, { recursive: true });

    const server = await createServer({
        root,
        clearScreen: false,
        logLevel: 'warn',
        server: { port: opts.port, host: '127.0.0.1', strictPort: true },
    });
    let browser;
    let failures = 0;
    try {
        await server.listen();
        const base = `http://127.0.0.1:${opts.port}`;

        browser = await chromium.launch({
            args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        });
        const context = await browser.newContext(
            opts.mobile
                ? {
                      viewport: { width: 390, height: 844 },
                      deviceScaleFactor: opts.scale ?? 2,
                      isMobile: true,
                      hasTouch: true,
                  }
                : {
                      viewport: { width: opts.width, height: opts.height },
                      deviceScaleFactor: opts.scale ?? 1,
                  },
        );

        for (const [index, urlPath] of opts.paths.entries()) {
            const name = (opts.names[index] ?? nameFor(urlPath)) + (opts.mobile ? '-mobile' : '');
            const page = await context.newPage();
            const problems = [];
            page.on('console', (msg) => {
                const type = msg.type();
                if (type === 'error') problems.push(`console.error: ${msg.text()}`);
                else if (opts.verbose) console.log(`  [${type}] ${msg.text()}`);
            });
            page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
            page.on('requestfailed', (req) =>
                problems.push(`requestfailed: ${req.url()} (${req.failure()?.errorText ?? '?'})`),
            );

            const started = Date.now();
            let note = '';
            try {
                await page.goto(base + urlPath, { waitUntil: 'load', timeout: opts.timeout });
                if (opts.ready && !(await waitForReady(page, opts.timeout))) {
                    note = ' (timed out waiting for window.__ready)';
                    failures++;
                }
                if (opts.wait > 0) await page.waitForTimeout(opts.wait);
                const file = path.join(opts.out, `${name}.png`);
                await page.screenshot({ path: file, fullPage: opts.fullPage });
                console.log(`${urlPath} -> ${path.relative(root, file)} [${Date.now() - started} ms]${note}`);
            } catch (err) {
                failures++;
                console.log(`${urlPath} FAILED: ${err instanceof Error ? err.message : err}`);
            }
            for (const problem of problems) console.log(`  ${problem}`);
            await page.close();
        }
        await context.close();
    } finally {
        await browser?.close();
        await server.close();
    }
    process.exitCode = failures > 0 ? 1 : 0;
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
