// Installs the built app, downloads a free game, plays it once online, then
// goes offline and checks the app, the background and the game still work.
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const BASE = process.env.BASE ?? 'https://localhost:8080';
const SHOTS = process.env.SHOTS ?? '.work/shots';
mkdirSync(SHOTS, { recursive: true });
const start = Date.now();
const note = (text) => console.log(`[${((Date.now() - start) / 1000).toFixed(1)}] ${text}`);
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'trx-suite-e2e-')), {
  ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 },
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'],
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') note(`console.error: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
const shot = async (name) => { await page.screenshot({ path: `${SHOTS}/offline-${name}.png` }); note(`shot ${name}`); };
const isolated = () => page.evaluate(() => `isolated=${crossOriginIsolated} sw=${navigator.serviceWorker.controller !== null}`);

await page.goto(BASE + '/');
await page.locator('.hints__caption').waitFor({ timeout: 60000 });
await Promise.race([page.evaluate(() => navigator.serviceWorker.ready.then(() => 'ready')), new Promise((r) => setTimeout(() => r('timeout'), 30000))]).then((r) => note('service worker ' + r));
note('online: ' + await isolated() + ' caption ' + await page.locator('.hints__caption').innerText());
await page.reload();
await page.locator('.hints__caption').waitFor({ timeout: 60000 });
note('after reload: ' + await isolated());
const cached = await page.evaluate(async () => (await caches.keys()).join(',') + ' | runtime: ' + (await (await caches.open('trx-suite-runtime')).keys()).map((r) => new URL(r.url).pathname).join(','));
note('caches: ' + cached);

// Download The Golden Mask and play it once, which stores the engine.
for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250); }
await page.keyboard.press('Enter');
await page.getByRole('dialog').getByRole('button', { name: /Download/ }).click();
await page.getByRole('button', { name: /Start playing/ }).waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /Start playing/ }).click();
await page.getByText('Tap to start').waitFor({ timeout: 300000 });
note('engine stored, gate shown online');

await context.setOffline(true);
note('OFFLINE');
await page.goto(BASE + '/');
await page.locator('.spotlight__title').waitFor({ timeout: 30000 });
note('offline home: ' + await isolated());
await page.locator('.hints__caption').waitFor({ timeout: 60000 }).catch(() => note('no flyby caption offline'));
note('offline caption: ' + await page.locator('.hints__caption').innerText().catch(() => '-'));
await page.waitForTimeout(2000);
await shot('1-home');
// Back to The Golden Mask, and play.
await page.keyboard.press('Enter');
await page.getByRole('dialog').waitFor();
await page.getByRole('button', { name: /Continue/ }).click();
await page.getByText('Tap to start').waitFor({ timeout: 120000 });
note('offline gate: ' + await isolated());
await page.getByText('Tap to start').click();
await page.waitForTimeout(30000);
await shot('2-playing');
await context.close();
