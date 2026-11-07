// Draws the app icons from public/icons/icon.svg with a headless browser:
// node scripts/make-icons.mjs (needs Playwright's Chromium).

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const sizes = [
    ['icon-192.png', 192, 1],
    ['icon-512.png', 512, 1],
    ['apple-touch-icon.png', 180, 1],
    // Maskable icons keep their content inside the middle 80%.
    ['maskable-512.png', 512, 0.8],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, scale] of sizes) {
    await page.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * scale);
    await page.setContent(
        `<html><body style="margin:0;background:#000;display:grid;place-items:center;width:${size}px;height:${size}px">` +
            `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
    );
    await page.screenshot({ path: `public/icons/${name}`, omitBackground: false });
    console.log(name);
}
await browser.close();
