import assert from 'node:assert/strict';

// These functions are also serialized into Chromium 79 by Puppeteer 2.
export function fakeController() {
  const pad = {
    id: 'Test standard controller', index: 0, mapping:'standard', connected: true,
    buttons: Array.from({length:17}, () => ({value:0, pressed:false})), axes:[0,0,0,0],
  };
  window.testPad = pad;
  window.padPolls = 0;
  Object.defineProperty(navigator, 'getGamepads', {configurable:true, value: function () {
    window.padPolls++;
    return [pad.connected ? pad : null];
  }});
  // Read server confirmations only. No client packets or credentials are captured.
  window.mockReplies = { east:0, messages:[] };
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      if (new URL(url).pathname !== '/game') return;
      window.dropMockSession = () => this.close();
      this.addEventListener('message', event => {
        const bytes = new Uint8Array(event.data);
        if (bytes[2] === 0x66) window.mockReplies.east++;
        if (bytes[2] === 0xaa || bytes[2] === 0xb4) {
          window.mockReplies.messages.push(String.fromCharCode.apply(null, bytes));
        }
      });
    }
  };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 150; i++) {
    const result = await fn();
    if (result) return result;
    await delay(100);
  }
  throw Error('Timed out waiting for ' + label);
}
export async function press(page, index, held = true) {
  await page.evaluate(({index,held}) => new Promise(done => {
    const b = window.testPad.buttons[index];
    b.pressed = held; b.value = held ? 1 : 0;
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)));
  }), {index,held});
}
async function tap(page, index) { await press(page,index); await press(page,index,false); }

// Drive focus using actual D-pad presses. The browser supplies geometry;
// the test never calls focus(), click(), fill(), or dispatches a key.
async function select(page, selector, label) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const decision = await page.evaluate(({selector,label}) => {
      const root = document.querySelector(selector);
      if (!root) return 'wait';
      const items = Array.from(root.querySelectorAll('button:enabled,input:enabled')).filter(e => e.getClientRects().length);
      const dest = items.find(e => (e.getAttribute('aria-label') || e.textContent).trim() === label || e.textContent.trim().startsWith(label + '  ·'));
      if (!dest) return 'wait';
      const current = items.indexOf(document.activeElement);
      if (items[current] === dest || current === -1 && items[0] === dest) return 'activate';
      if (current === -1) return 13;
      const rects = items.map(e => e.getBoundingClientRect());
      const search = [[current,null]], visited = new Set([current]);
      while (search.length) {
        const pair = search.shift(), i = pair[0], first = pair[1];
        for (const button of [12,13,14,15]) {
          const vertical = button === 12 || button === 13;
          const sign = button === 12 || button === 14 ? -1 : 1;
          let best = Infinity, next = i;
          rects.forEach((r,j) => {
            const dx = (r.left+r.right-rects[i].left-rects[i].right)/2;
            const dy = (r.top+r.bottom-rects[i].top-rects[i].bottom)/2;
            const forward = (vertical ? dy : dx)*sign;
            const cost = forward+3*Math.abs(vertical ? dx : dy);
            if (forward >= 1 && cost < best) { next = j; best = cost; }
          });
          if (items[next] === dest) return first === null ? button : first;
          if (!visited.has(next)) { visited.add(next); search.push([next,first === null ? button : first]); }
        }
      }
      throw Error('Unreachable focus target: ' + label);
    }, {selector,label});
    if (decision === 'activate') { await tap(page,0); return; }
    if (decision === 'wait') await delay(100); else await tap(page,decision);
  }
  throw Error('Failed to select ' + label);
}

export async function controllerFlow(page, url, production = false) {
  await page.goto(url);
  await until(() => page.evaluate(() => window.padPolls > 2), 'controller polling');
  for (const label of ['Account number','Password']) {
    await select(page,'.jamera-login',label);
    await select(page,'[data-pad-dialog]','1');
    await select(page,'[data-pad-dialog]','Done');
  }
  await select(page,'.jamera-login','Log in');
  await select(page,'.jamera-login','Trinity');
  await until(() => page.evaluate(() => document.querySelector('.hud') && document.querySelector('body > canvas')), 'world HUD and canvas');
  await press(page,15);
  try { await until(() => page.evaluate(() => window.mockReplies.east > 0), 'server-confirmed movement'); }
  finally { await press(page,15,false); }
  await tap(page,0);
  const reply = word => until(() => page.evaluate(word => window.mockReplies.messages.some(m => m.endsWith(word)),word),word);
  await reply('exura');
  if (!production) assert.equal(await page.evaluate(() => window.jameraWorld.playerX > 100 && window.jameraChat.manager.speechBubbles.some(b => b.text === 'exura')),true);
  await tap(page,11); await reply('Target 1073741825');
  await tap(page,11); await reply('Target 1073741826');
  await tap(page,10); await reply('Target 0');
  const targets = await page.evaluate(() => window.mockReplies.messages.map(m => /Target (\d+)$/.exec(m)).filter(Boolean).map(match => Number(match[1])));
  assert.deepEqual(targets,[0x40000001,0x40000002,0]);
  if (!production) {
    await tap(page,9);
    await select(page,'.game-menu-pane.open','Controller spells');
    for (const [layer, spell] of [['L1','Haste · utani hur'],['L2','Antidote · exana pox']]) {
      await select(page,'[data-pad-dialog]', layer + ' ✕: Empty');
      await select(page,'[data-pad-dialog]',spell);
    }
    await tap(page,1);
    await tap(page,8);
    assert.equal(await page.evaluate(() => !!document.querySelector('[aria-label="Controller layout"]')),true);
    await tap(page,8);
    assert.equal(await page.evaluate(() => !!document.querySelector('[aria-label="Controller layout"]')),false);
  }
  for (const [index, layer] of [[4,'L1'],[6,'L2']]) {
    await press(page,index);
    assert.equal(await page.evaluate(() => document.querySelector('.controller-hud strong').textContent),layer);
    await tap(page,0);
    if (!production) await reply(layer === 'L1' ? 'utani hur' : 'exana pox');
    await press(page,index,false);
  }
  if (!production) {
    await press(page,15);
    await page.evaluate(() => { window.testPad.connected = false; });
    await until(() => page.evaluate(() => !!document.querySelector('[aria-label^="Controller disconnected"]')), 'disconnect notice');
    await page.evaluate(() => { window.testPad.connected = true; });
    await press(page,15,false);
    await tap(page,0);
    await until(() => page.evaluate(() => !document.querySelector('[aria-label^="Controller disconnected"]')), 'controller retry');
  }
  if (production) {
    await until(() => page.evaluate(() => Array.from(document.body.children).some(e => /^fps \d+/m.test(e.textContent) && /atlas [1-9]/.test(e.textContent) && /repaint [0-9]+ms/.test(e.textContent))), 'renderer metrics');
    const baseline = await page.evaluate(() => ({
      size:[innerWidth,innerHeight],
      heap: performance.memory ? performance.memory.usedJSHeapSize : null,
      metrics:Array.from(document.body.children).find(e => /^fps \d+/m.test(e.textContent)).textContent,
      globals:['jameraClient','jameraPixi','jameraWorld','jameraChat'].filter(k => k in window),
    }));
    assert.deepEqual(baseline.globals,[]);
    console.log('MOCK_BASELINE', JSON.stringify(baseline));
    await page.evaluate(() => window.dropMockSession());
    await until(() => page.evaluate(() => !!document.querySelector('[aria-label^="Game connection closed"]')), 'connection retry');
    await tap(page,0);
    assert.equal(await page.evaluate(() => document.querySelector('.jamera-login').hidden || !!document.querySelector('.controller-hud')),false);
    return baseline;
  }
}
