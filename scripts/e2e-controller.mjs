import { expect, test } from '@playwright/test';
import { controllerFlow, fakeController } from './controller-flow.mjs';
import { mockAssets } from './mock-assets.mjs';

const production = process.env.TV_SMOKE === '1';
const sizes = production ? [[1280,720],[1920,1080]] : [[1100,700]];
for (const [width,height] of sizes) {
  test('controller login, walk, cast and target at ' + width, async ({page}) => {
    test.setTimeout(120000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({width,height});
    await page.addInitScript(fakeController);
    for (const [name,body] of Object.entries(mockAssets)) {
      await page.route('**/assets/760/' + name, r => r.fulfill({contentType:'application/octet-stream',body}));
    }
    await controllerFlow(page,'/jamera.html?autologin=0&telemetry=0&metrics=1&' + (production ? 'tv=1' : 'gamepad=1') + '&proxy=ws://127.0.0.1:18090',production);
    expect(errors).toEqual([]);
  });
}
if (!production) test('flags off leave controller and TV modules unloaded', async ({page}) => {
  const paths = [];
  page.on('request', r => paths.push(new URL(r.url()).pathname));
  await page.addInitScript(fakeController);
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', {configurable:true, value:'Web0S test'}));
  for (const [name,body] of Object.entries(mockAssets)) {
    await page.route('**/assets/760/' + name, r => r.fulfill({contentType:'application/octet-stream',body}));
  }
  await page.goto('/jamera.html?tv=0&gamepad=0&autologin=0&telemetry=0&proxy=ws://127.0.0.1:18090');
  await page.getByLabel('Account number').fill('1');
  await page.getByLabel('Password').fill('1');
  await page.getByRole('button',{name:'Log in'}).click();
  await page.getByRole('button',{name:/Trinity/}).click();
  await expect(page.locator('.hud')).toBeVisible();
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(await page.evaluate(() => window.padPolls)).toBe(0);
  expect(paths.filter(p => /\/lib\/(gamepad|tv)\//.test(p))).toEqual([]);
  await expect(page.locator('.pad-active,.tv-layout,.controller-hud,[data-pad-dialog]')).toHaveCount(0);
});
