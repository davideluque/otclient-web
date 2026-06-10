// E2E: jamera client → WS proxy → mock 7.6 server. Asserts the full
// boot, walking, and chat loop, then screenshots the live canvas.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_CHROME });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e}`));

const fail = (msg) => { console.log('FAIL:', msg); console.log(logs.slice(-25).join('\n')); process.exit(1); };

await page.goto('http://localhost:5180/jamera.html?proxy=ws://localhost:8090', { waitUntil: 'domcontentloaded' });

// Login form
await page.fill('input[name=account]', '1');
await page.fill('input[name=password]', '1');
await page.click('button[type=submit]');

// Character list → pick Trinity
try {
  await page.getByRole('button', { name: /Trinity/ }).click({ timeout: 10000 });
} catch { fail('character list never appeared'); }

// Wait for in_game + world populated
try {
  await page.waitForFunction(() => {
    const w = window.jameraWorld;
    return w && w.playerX === 100 && w.playerY === 100 && w.tileRevision > 0;
  }, null, { timeout: 15000 });
} catch { fail('never reached in_game with a populated world'); }

const before = await page.evaluate(() => {
  const w = window.jameraWorld;
  let tiles = 0; for (const _ of w.tilesInRegion(80, 80, 120, 120, 7)) tiles++;
  return { x: w.playerX, y: w.playerY, z: w.playerZ, tiles, creatures: w.getAllCreatures().length };
});
console.log('IN_GAME:', JSON.stringify(before));
if (before.tiles < 250) fail(`expected ~252 tiles, got ${before.tiles}`);
if (before.creatures < 1) fail('player creature missing from world');

// Give the atlas + renderer a moment, then walk east twice via keyboard.
await page.waitForTimeout(3000);
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(900);
await page.keyboard.up('ArrowRight');
await page.waitForFunction(() => window.jameraWorld.playerX > 100, null, { timeout: 5000 })
  .catch(() => fail('walking east never moved the player'));
const afterWalk = await page.evaluate(() => ({ x: window.jameraWorld.playerX, y: window.jameraWorld.playerY }));
console.log('WALKED:', JSON.stringify(afterWalk));

// Chat roundtrip: type → server echoes as 0xAA → message renders.
await page.fill('#chat-input', 'hello mock world');
await page.click('#chat-send');
try {
  await page.waitForFunction(() =>
    document.querySelector('#chat-messages')?.textContent?.includes('hello mock world'),
  null, { timeout: 5000 });
} catch { fail('chat echo never rendered'); }
console.log('CHAT: echo rendered');

// Speech bubble: the echoed 0xAA carries a position, so a bubble must be
// live in the ChatManager (the renderer draws from the same list).
const bubbleCount = await page.evaluate(() => window.jameraChat?.manager.speechBubbles.length ?? -1);
if (bubbleCount < 1) fail(`expected a live speech bubble, got ${bubbleCount}`);
console.log('BUBBLES:', bubbleCount);

await page.screenshot({ path: process.env.E2E_SHOT ?? '/tmp/e2e-jamera.png' });
const warnings = logs.filter((l) => l.startsWith('warning') && l.includes('Unhandled opcode'));
console.log('unhandled-opcode warnings:', warnings.length);
console.log('PASS');
await browser.close();
