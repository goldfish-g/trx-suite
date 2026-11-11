// Draws the brand art the kit doesn't give as it is wanted, with a headless
// browser: node scripts/make-icons.mjs (needs Playwright's Chromium).
//   public/icons/maskable-512.png  the kit's icon-512.png, small enough for a launcher's mask
//   public/og-image.png            the link preview: the kit's, without its tagline
// The other icons come from the kit as they are.

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// Tomb black, the brand's background.
const BACKGROUND = '#14110F';

const browser = await chromium.launch();

// A launcher may cut a maskable icon down to the circle in its middle 80%;
// at 84 % the doorway keeps well inside it.
{
    const size = 512;
    const inner = Math.round(size * 0.84);
    const icon = readFileSync('public/icons/icon-512.png').toString('base64');
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
        `<html><body style="margin:0;background:${BACKGROUND};display:grid;place-items:center;width:${size}px;height:${size}px">` +
            `<img src="data:image/png;base64,${icon}" width="${inner}" height="${inner}"></body></html>`,
    );
    await page.screenshot({ path: 'public/icons/maskable-512.png' });
    await page.close();
    console.log('maskable-512.png');
}

// 1200 by 630 with the kit's hairline frame 28 pixels in, and the logo at the
// kit's size, its doorway centred on the height.
{
    const [width, height, scale] = [1200, 630, 1.34];
    const logo = readFileSync('src/ui/brand/logo.svg', 'utf8');
    // The doorway's strokes run from 10.5 to 112 of the logo's 120.
    const top = Math.round(height / 2 - ((10.5 + 112) / 2) * scale);
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(
        `<html><body style="margin:0;background:${BACKGROUND};width:${width}px;height:${height}px;position:relative">` +
            `<div style="position:absolute;inset:28px;border:1px solid #2a241e"></div>` +
            `<img src="data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}" style="position:absolute;left:50%;top:${top}px;height:${120 * scale}px;transform:translateX(-50%)">` +
            `</body></html>`,
    );
    await page.screenshot({ path: 'public/og-image.png' });
    await page.close();
    console.log('og-image.png');
}

await browser.close();
