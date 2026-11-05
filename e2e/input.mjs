// Drives the menu with a simulated gamepad and a mouse drag.
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'https://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
// A fake standard gamepad whose buttons the test presses.
await page.addInitScript(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = { id: 'Test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [pad, null, null, null];
  window.__press = async (index) => {
    buttons[index].pressed = true; buttons[index].value = 1;
    await new Promise((r) => setTimeout(r, 120));
    buttons[index].pressed = false; buttons[index].value = 0;
    await new Promise((r) => setTimeout(r, 120));
  };
  window.addEventListener('load', () => window.dispatchEvent(new Event('gamepadconnected')));
});
const title = () => page.locator('.spotlight__title').innerText();
await page.goto(BASE + '/');
await page.locator('.hints__caption').waitFor({ timeout: 60000 });
console.log('start:', await title());
await page.evaluate(() => window.__press(15)); // d-pad right
await page.waitForTimeout(700);
console.log('after d-pad right:', await title(), '| hints:', await page.locator('.hints__list').innerText());
await page.evaluate(() => window.__press(0)); // A opens the sheet
await page.waitForTimeout(700);
console.log('after A, dialog open:', await page.getByRole('dialog').count(), '| focused:', await page.evaluate(() => document.activeElement?.textContent));
await page.evaluate(() => window.__press(13)); // d-pad down moves focus
await page.waitForTimeout(300);
console.log('after d-pad down, focused:', await page.evaluate(() => document.activeElement?.textContent));
await page.evaluate(() => window.__press(1)); // B closes
await page.waitForTimeout(700);
console.log('after B, dialog open:', await page.getByRole('dialog').count());
// Mouse drag to the left turns the ring forward.
await page.mouse.move(800, 300);
await page.mouse.down();
for (let x = 800; x >= 420; x -= 20) { await page.mouse.move(x, 300); await page.waitForTimeout(16); }
await page.mouse.up();
await page.waitForTimeout(1200);
console.log('after drag:', await title());
// Wheel turns back.
await page.mouse.move(640, 300);
await page.mouse.wheel(0, -120);
await page.waitForTimeout(900);
console.log('after wheel up:', await title());
// Clicking a neighbour selects it; clicking the front one opens it.
await page.mouse.click(640, 280);
await page.waitForTimeout(700);
console.log('after clicking the front artifact, dialog open:', await page.getByRole('dialog').count());
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.keyboard.press('ArrowUp');
console.log('after ArrowUp, focused:', await page.evaluate(() => document.activeElement?.textContent || document.activeElement?.getAttribute('aria-label')));
await page.keyboard.press('ArrowRight');
console.log('after ArrowRight in top bar, focused:', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent));
await browser.close();
