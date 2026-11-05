// End to end against the running dev app: free download, play, flyby from the library, test sign-in.
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const BASE = process.env.BASE ?? 'https://localhost:5173';
const SHOTS = process.env.SHOTS ?? '.work/shots';
mkdirSync(SHOTS, { recursive: true });
const start = Date.now();
const note = (text) => console.log(`[${((Date.now() - start) / 1000).toFixed(1)}] ${text}`);
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'trx-web-e2e-')), {
  ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 },
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') note(`console.error: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
const shot = async (name) => { await page.screenshot({ path: `${SHOTS}/e2e-${name}.png` }); note(`shot ${name}`); };

await page.goto(BASE + '/');
await page.getByText('Croft Manor').waitFor({ timeout: 60000 });
note('flyby caption: ' + await page.locator('.hints__caption').innerText());
for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300); }
await page.waitForTimeout(1200);
note('title: ' + await page.locator('.spotlight__title').innerText() + ' / ' + await page.locator('.spotlight__status').innerText());
await shot('1-gm');
await page.keyboard.press('Enter');
await page.getByRole('dialog').waitFor();
await page.waitForTimeout(600);
await shot('2-gm-sheet');
await page.getByRole('dialog').getByRole('button', { name: /Download/ }).click();
await page.getByRole('button', { name: /Start playing/ }).waitFor({ timeout: 120000 });
await page.waitForTimeout(500);
await shot('3-gm-ready');
await page.getByRole('button', { name: /Start playing/ }).click();
await page.waitForURL(/\/play\//);
note('play page');
await page.getByText('Tap to start').waitFor({ timeout: 240000 });
await shot('4-gate');
await page.getByText('Tap to start').click();
await page.waitForTimeout(25000);
await shot('5-running');
await page.goto(BASE + '/');
await page.locator('.hints__caption').waitFor({ timeout: 60000 });
note('flyby caption after install: ' + await page.locator('.hints__caption').innerText());
await page.waitForTimeout(2500);
await shot('6-home-after');
// Test sign-in unlocks the rest.
await page.getByRole('button', { name: /Sign in/ }).first().click();
await page.getByRole('dialog').waitFor();
await page.getByRole('button', { name: 'Sign in as a test player' }).click();
await page.getByText(/Unlocked:/).waitFor({ timeout: 20000 });
await page.waitForTimeout(500);
await shot('7-account');
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
note('ring status: ' + await page.locator('.spotlight__title').innerText() + ' / ' + await page.locator('.spotlight__status').innerText());
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400);
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400);
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400);
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(1200);
note('ring status: ' + await page.locator('.spotlight__title').innerText() + ' / ' + await page.locator('.spotlight__status').innerText());
await shot('8-tr2-unlocked');
await context.close();
