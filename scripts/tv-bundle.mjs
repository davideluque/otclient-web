import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import { decode, encode } from '@jridgewell/sourcemap-codec';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const out = 'dist-tv';
const read = (name) => readFile(path.join(out, name), 'utf8');
const write = (name, value) => writeFile(path.join(out, name), value);
const assets = await readdir(path.join(out, 'assets'));
const checkOnly = process.argv.includes('--check');

// Chromium 79 understands dynamic import, but the requested ES2019 gate
// predates both import() and import.meta. Generate a static ESM entry for
// each lazy chunk. Chromium still owns module evaluation and caching.
function* nodes(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type) yield node;
  for (const child of Object.values(node)) yield* nodes(child);
}
if (!checkOnly) {
  await cp('platforms/webos/browser', out, { recursive: true });
  for (const file of assets.filter((file) => file.endsWith('.js'))) {
    const name = 'assets/' + file;
    let code = await read(name);
    const replacements = [];
    for (const n of nodes(parse(code, { ecmaVersion: 'latest', sourceType: 'module' }))) {
      if (n.type === 'MetaProperty' && n.meta.name === 'import') {
        replacements.push([n.start, n.end, '({url:new URL(' + JSON.stringify('/' + name) + ',location.origin).href})']);
      }
      if (n.type !== 'ImportExpression') continue;
      const specifier = n.source.value ?? n.source.quasis?.[0]?.value.cooked;
      if (!/^\.\/[\w.-]+\.js$/.test(specifier) || n.source.expressions?.length) {
        throw Error('Unexpected lazy import in ' + file);
      }
      const facade = '/assets/lazy-' + specifier.slice(2);
      await write(facade.slice(1), 'import * as module from ' + JSON.stringify(specifier)
        + '; window.tvModules[' + JSON.stringify(facade) + '] = module;\n');
      replacements.push([n.start, n.end, 'window.tvImport(' + JSON.stringify(facade) + ')']);
    }
    // The ES2019 rewrites occur after Vite emits its maps. Move the generated
    // columns on each affected line while preserving original source locations.
    if (replacements.length) {
      const map = JSON.parse(await read(name + '.map'));
      const lines = decode(map.mappings);
      const starts = [0];
      for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
      for (const [start,end,value] of replacements.slice().reverse()) {
        const line = starts.findLastIndex(offset => offset <= start);
        if (end > (starts[line+1] ?? Infinity) || value.includes('\n')) throw Error('Multiline module rewrite');
        const from = start-starts[line], to = end-starts[line];
        lines[line] = lines[line].filter(segment => segment[0] <= from || segment[0] >= to);
        for (const segment of lines[line]) if (segment[0] >= to) segment[0] += value.length-(end-start);
      }
      map.mappings = encode(lines);
      await write(name + '.map',JSON.stringify(map));
    }
    for (const [start, end, replacement] of replacements.reverse()) {
      code = code.slice(0, start) + replacement + code.slice(end);
    }
    await write(name, code);
  }
  await write('jamera.html', (await read('jamera.html')).replace('<head>', '<head><script src="/compat.js"></script>'));
}

const polyfills = await read('compat.js');
// Run the shipped file in a separate realm with the two native APIs removed.
// Checking behavior also catches bracket notation, renamed helpers and no-op shims.
const realm = new JSDOM('<div></div>', { runScripts: 'outside-only' });
try {
  const { window } = realm;
  delete window.Array.prototype.at;
  delete window.Element.prototype.replaceChildren;
  window.eval(polyfills);
  assert.equal(window.Array.of(3, 7).at(-1), 7);
  assert.equal(window.Array.of(3, 7).at(2), undefined);
  const host = window.document.querySelector('div');
  const child = window.document.createElement('i');
  host.replaceChildren('text', child);
  assert.equal(host.lastChild, child);
  assert.equal(host.textContent, 'text');
  host.replaceChildren();
  assert.equal(host.childNodes.length, 0);
} finally { realm.window.close(); }

const page = await read('jamera.html');
if (!page.includes('<head><script src="/compat.js"></script>')) throw Error('Missing early compatibility script');
const jsTypes = new Set([
  'application/ecmascript','application/javascript','application/x-ecmascript','application/x-javascript',
  'text/ecmascript','text/javascript','text/javascript1.0','text/javascript1.1','text/javascript1.2',
  'text/javascript1.3','text/javascript1.4','text/javascript1.5','text/jscript','text/livescript',
  'text/x-ecmascript','text/x-javascript',
]);
function inlineJavaScript(script) {
  if (script.closest('noscript') || script.hasAttribute('src') || script.hasAttribute('href')
    || script.hasAttributeNS('http://www.w3.org/1999/xlink','href')) return false;
  const language = script.getAttribute('language');
  const raw = script.getAttribute('type') ?? (language ? 'text/' + language : '');
  const type = raw.trim().toLowerCase().split(';')[0].trim();
  return !type || type === 'module' || jsTypes.has(type);
}
async function check(dir) {
  for (const entry of await readdir(path.join(out, dir), { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) { await check(name); continue; }
    if (!/\.(?:js|mjs|html|css)$/.test(name)) continue;
    const code = await read(name);
    if (/(?:^|[;{\x22\x27\x60])\s*inset\s*:/m.test(code)) throw Error(name + ' uses inset shorthand');
    let scripts = name.endsWith('.css') ? [] : [code];
    if (name.endsWith('.html')) {
      const page = JSDOM.fragment(code);
      scripts = Array.from(page.querySelectorAll('script')).filter(inlineJavaScript)
        .map(script => script.textContent);
    }
    for (const script of scripts) {
      try { parse(script, { ecmaVersion: name === 'diagnostics.js' ? 2017 : 2019, sourceType: 'module' }); }
      catch (error) { throw Error(name + ' fails ES2019: ' + error.message); }

    }
  }
}
await check('');
console.log('Checked emitted scripts, inline HTML scripts, compatibility APIs and positioning.');
