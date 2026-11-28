import { readFile } from 'node:fs/promises';
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
    if (production) await page.addInitScript(() => {
      delete Element.prototype.replaceChildren;
      delete Array.prototype.at;
    });
    for (const [name,body] of Object.entries(mockAssets)) {
      await page.route('**/assets/760/' + name, r => r.fulfill({contentType:'application/octet-stream',body}));
    }
    if (!production) {
      let first = true;
      await page.routeWebSocket(/\/login$/, socket => {
        if (first) {
          first = false;
          socket.onMessage(() => socket.close({code:1000, reason:'mock early close'}));
        } else socket.connectToServer();
      });
    }
    await controllerFlow(page,'/jamera.html?autologin=0&telemetry=0&metrics=1&' + (production ? 'tv=1&tvlogs=1' : 'gamepad=1') + '&proxy=ws://127.0.0.1:18090',production,!production);
    expect(errors).toEqual([]);
    if (production) {
      const file = new URL('../test-results/tv-diagnostics/device-events.jsonl',import.meta.url);
      await expect.poll(async () => {
        try { return (await readFile(file,'utf8')).includes('"kind":"renderer-ready"'); }
        catch { return false; }
      }).toBe(true);
    }
  });
}
test('flags off leave controller and TV modules unloaded', async ({page}) => {
  const paths = [];
  page.on('request', r => paths.push(new URL(r.url()).pathname));
  await page.addInitScript(fakeController);
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', {configurable:true, value:'Web0S test'}));
  for (const [name,body] of Object.entries(mockAssets)) {
    await page.route('**/assets/760/' + name, r => r.fulfill({contentType:'application/octet-stream',body}));
  }
  await page.goto('/jamera.html?tv=0&gamepad=0&autologin=0&telemetry=0&proxy=ws://127.0.0.1:18090');
  await page.getByLabel('Account number').fill('1');
  await page.getByLabel('Password',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Log in'}).click();
  await page.getByRole('button',{name:/Trinity/}).click();
  await expect(page.locator('.hud')).toBeVisible();
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(await page.evaluate(() => window.padPolls)).toBe(0);
  expect(paths.filter(p => /\/lib\/(gamepad|tv)\//.test(p) || /\/assets\/(?:lazy-)?(?:runtime|setup|logs)-/.test(p))).toEqual([]);
  await expect(page.locator('.pad-active,.tv-layout,.controller-hud,[data-pad-dialog]')).toHaveCount(0);
});

if (production) test('diagnostics save the TV observations on the proxy host', async ({page}) => {
  await page.addInitScript(fakeController);
  await page.goto('/diagnostics.html?proxy=ws://127.0.0.1:18090');
  await page.evaluate(() => { window.testPad.buttons[1].pressed = true; window.testPad.buttons[1].value = 1; });
  await page.keyboard.press('ArrowDown');
  const file = new URL('../test-results/tv-diagnostics/device-report.json',import.meta.url);
  await expect.poll(async () => {
    try {
      const report = JSON.parse(await readFile(file,'utf8'));
      return report.fps > 0 && report.websocket.roundTripMs >= 0 && report.pads[0].buttonCount === 17
        && report.keys.some(e => e.code === 'ArrowDown' && e.ms >= 0)
        && report.padChanges.some(([, , kind, i, v]) => kind === 'button' && i === 1 && v === 1);
    } catch { return false; }
  }, {timeout:15000}).toBe(true);
  await expect(page.locator('#status')).toHaveText('Report saved on host.');
});

async function fallbackSession(page) {
  await page.addInitScript(fakeController);
  for (const [name,body] of Object.entries(mockAssets)) {
    await page.route('**/assets/760/' + name, r => r.fulfill({contentType:'application/octet-stream',body}));
  }
  await page.goto('/jamera.html?tv=1&autologin=0&telemetry=0&metrics=1&proxy=ws://127.0.0.1:18090');
  await page.getByLabel('Account number').fill('1');
  await page.getByLabel('Password',{exact:true}).fill('1');
  await page.getByRole('button',{name:'Log in'}).click();
  await page.getByRole('button',{name:/Trinity/}).click();
  await expect(page.locator('.hud')).toBeVisible();
}

test('attached pad leaves keyboard walk and remote activation available', async ({page}) => {
  await fallbackSession(page);
  await page.keyboard.down('ArrowRight');
  try { await expect.poll(() => page.evaluate(() => window.mockReplies.east)).toBeGreaterThan(0); }
  finally { await page.keyboard.up('ArrowRight'); }
  await page.locator('.game-menu-btn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.game-menu-pane.open')).toBeVisible();
  await page.waitForTimeout(200); // The following input is a separate press.
  await page.evaluate(() => {
    const button = document.querySelector('.game-menu-pane.open button');
    button.focus();
    window.activations = 0;
    button.addEventListener('click', e => { e.stopImmediatePropagation(); window.activations++; }, true);
    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => { window.testPad.buttons[0].pressed = true; }));
      function check() {
        if (!window.activations) { requestAnimationFrame(check); return; }
        const enter = new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
        if (button.dispatchEvent(enter)) button.click();
        resolve();
      }
      requestAnimationFrame(check);
    });
  });
  expect(await page.evaluate(() => window.activations)).toBe(1);
  await page.evaluate(() => { window.testPad.buttons[0].pressed = false; });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const button = document.activeElement;
    if (button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))) button.click();
    window.testPad.buttons[0].pressed = true;
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.evaluate(() => window.activations)).toBe(2);
});

test('launch reset and green remote key recover an unusable profile', async ({page}) => {
  await page.addInitScript(fakeController);
  await page.addInitScript(() => {
    localStorage.setItem('jamera.pad.old','old');
    localStorage.setItem('keep','yes');
  });
  await page.goto('/jamera.html?tv=1&autologin=0&reset-pad=1');
  await expect.poll(() => new URL(page.url()).searchParams.has('reset-pad')).toBe(false);
  expect(await page.evaluate(() => [localStorage.getItem('jamera.pad.old'),localStorage.getItem('keep')])).toEqual([null,'yes']);
  const green = () => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:404,bubbles:true})));
  await green();
  await expect(page.getByRole('button',{name:'Recalibrate'})).toBeFocused();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jamera.pad.' + window.testPad.id)))).toBe('standard');
  await green(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => localStorage.getItem('jamera.pad.' + window.testPad.id))).toBeNull();
  await green(); await page.getByText('Continue without controller',{exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Controller recovery'})).toHaveCount(0);
});

test('sleeping controller and closed game can both be dismissed with no pad', async ({page}) => {
  await fallbackSession(page);
  const disconnected = page.getByRole('dialog',{name:/Controller disconnected/});
  async function unplug() {
    await page.evaluate(() => { window.testPad.connected = false; });
    await expect(disconnected).toBeVisible();
  }
  async function reconnect() {
    await page.evaluate(() => { window.testPad.connected = true; window.testPad.buttons[8].pressed = true; });
    await expect(disconnected).toHaveCount(0);
    await page.evaluate(() => { window.testPad.buttons[8].pressed = false; });
  }
  await unplug();
  await page.keyboard.press('Enter');
  await expect(disconnected).toHaveCount(0);
  await reconnect(); await page.waitForTimeout(150);
  await unplug(); await reconnect();
  await page.waitForTimeout(150); await unplug();
  await page.getByRole('button',{name:'Continue without controller'}).click();
  await expect(disconnected).toHaveCount(0);
  await page.evaluate(() => window.dropMockSession());
  const network = page.getByRole('dialog',{name:/Game connection closed/});
  await expect(network).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown',{keyCode:461,bubbles:true})));
  await expect(network).toHaveCount(0);
  await expect(page.getByLabel('Account number')).toBeVisible();
});

test('pre-world errors and rejections show their message and forward a bounded stack', async ({page}) => {
  const records = [];
  await page.route('**/tv/log', async route => {
    records.push(route.request().postDataJSON());
    await route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.goto('/jamera.html?tv=1&tvlogs=1&autologin=0&proxy=ws://127.0.0.1:18090');
  await page.evaluate(() => {
    const error = new TypeError('Startup fixture');
    error.stack = 'Test stack ' + 'x'.repeat(5000);
    error.fieldValue = 'omit-this-field';
    window.dispatchEvent(new ErrorEvent('error',{error,message:error.message,lineno:42,colno:8}));
  });
  await expect(page.locator('.tv-render-error')).toContainText('Startup fixture');
  await expect.poll(() => records.some(r => r.message === 'Startup fixture' && r.line === 42 && r.stack.length === 4000)).toBe(true);
  await page.evaluate(() => void Promise.reject(new Error('Rejected fixture')));
  await expect(page.locator('.tv-render-error')).toContainText('Rejected fixture');
  await expect.poll(() => records.some(r => r.kind === 'unhandledrejection' && r.stack.includes('Rejected fixture'))).toBe(true);
  expect(JSON.stringify(records)).not.toContain('omit-this-field');
});
