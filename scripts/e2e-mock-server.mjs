import { expect, test } from '@playwright/test';
import { mockAssets } from './mock-assets.mjs';

test('login, render the mock world, walk east and exchange chat', async ({ page }, testInfo) => {
  const errors = [];
  const consoleLog = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    consoleLog.push(message.type() + ': ' + message.text());
    if (/Unhandled opcode/i.test(message.text())) errors.push(message.text());
  });

  // Keep the shipped manifest, asset loader, parsers and renderer in the loop.
  for (const [filename, body] of Object.entries(mockAssets)) {
    await page.route('**/assets/760/' + filename, (route) =>
      route.fulfill({ contentType: 'application/octet-stream', body }));
  }

  try {
    await page.goto('/jamera.html?autologin=0&telemetry=0&proxy=ws://127.0.0.1:18090');
    await page.getByLabel('Account number').fill('1');
    await page.getByLabel('Password').fill('1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('button', { name: /Trinity/ }).click();

    // Stage children are attached only when the map, atlas and renderer are ready.
    await page.waitForFunction(() => window.jameraWorld?.tileRevision > 0 && window.jameraPixi?.stage.children.length > 0);
    const initial = await page.evaluate(() => {
      const w = window.jameraWorld;
      return {
        position: [w.playerX, w.playerY, w.playerZ],
        tiles: Array.from(w.tilesInRegion(80, 80, 120, 120, 7)).length,
        names: w.getAllCreatures().map((c) => c.name),
      };
    });
    expect(initial.position).toEqual([100, 100, 7]);
    expect(initial.tiles).toBe(18 * 14);
    expect(initial.names).toContain('Trinity');
    await expect(page.locator('body > canvas')).toBeVisible();

    await page.keyboard.down('ArrowRight');
    try {
      await page.waitForFunction(() => window.jameraWorld.playerX > 100);
    } finally {
      await page.keyboard.up('ArrowRight');
    }

    const text = 'hello mock world';
    await page.getByRole('button', { name: 'Open chat' }).click();
    const chat = page.getByRole('dialog', { name: 'Quick chat' });
    await chat.getByRole('textbox', { name: 'Chat message' }).fill(text);
    await chat.getByRole('button', { name: 'Send message' }).click();
    await expect(chat.getByText(text, { exact: true })).toBeVisible();
    await page.waitForFunction((expected) =>
      window.jameraChat.manager.speechBubbles.some((bubble) => bubble.senderName === 'Trinity' && bubble.text === expected), text);

    await page.screenshot({ path: process.env.E2E_SHOT ?? testInfo.outputPath('world.png') });
    expect(errors).toEqual([]);
  } catch (error) {
    console.error(consoleLog.slice(-30).join('\n'), errors);
    throw error;
  }
});
