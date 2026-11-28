import { expect, test } from '@playwright/test';

test('packaged launcher retries the host and remembers it for a home-screen launch', async ({page}) => {
  const shell = new URL('../platforms/webos/shell/index.html',import.meta.url).href;
  const origin = 'http://127.0.0.1:15180';
  let reachable = false;
  await page.route(origin + '/icon-180.png*', route => reachable ? route.continue() : route.abort());
  await page.route(origin + '/jamera.html*', route => route.fulfill({contentType:'text/html',body:'<title>Hosted game</title>'}));
  await page.goto(shell);
  await page.evaluate(origin => document.dispatchEvent(new CustomEvent('webOSLaunch', {detail:{origin,proxyPort:'18090'}})),origin);
  await expect(page.locator('#message')).toContainText("Can't reach");
  reachable = true;
  await page.keyboard.press('Enter');
  await expect(page).toHaveTitle('Hosted game');
  const game = new URL(page.url());
  expect(game.searchParams.get('tv')).toBe('1');
  expect(game.searchParams.get('proxy')).toBe('ws://127.0.0.1:18090');
  await page.goto(shell);
  await expect(page).toHaveTitle('Hosted game');
});
