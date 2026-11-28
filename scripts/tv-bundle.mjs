import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

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
    for (const [start, end, replacement] of replacements.reverse()) {
      code = code.slice(0, start) + replacement + code.slice(end);
    }
    await write(name, code);
  }
  await write('jamera.html', (await read('jamera.html')).replace('<head>', '<head><script src="/compat.js"></script>'));
}

const polyfills = await read('compat.js');
const page = await read('jamera.html');
if (!page.includes('<head><script src="/compat.js"></script>')) throw Error('Missing early compatibility script');
async function check(dir) {
  for (const entry of await readdir(path.join(out, dir), { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) { await check(name); continue; }
    if (!/\.(?:js|mjs|html|css)$/.test(name)) continue;
    const code = await read(name);
    if (/(?:^|[;{\x22\x27\x60])\s*inset\s*:/m.test(code)) throw Error(name + ' uses inset shorthand');
    const scripts = name.endsWith('.html')
      ? Array.from(code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi), (match) => match[1])
      : name.endsWith('css') ? [] : [code];
    for (const script of scripts) {
      try { parse(script, { ecmaVersion: name === 'diagnostics.js' ? 2017 : 2019, sourceType: 'module' }); }
      catch (error) { throw Error(name + ' fails ES2019: ' + error.message); }
      for (const [call, owner] of [['replaceChildren', 'Element'], ['at', 'Array']]) {
        if (script.includes('.' + call + '(') && !polyfills.includes("Object.defineProperty(" + owner + ".prototype, '" + call + "'")) {
          throw Error(name + ' needs a polyfill for ' + call);
        }
      }
    }
  }
}
await check('');
console.log('Checked emitted scripts, inline HTML scripts, compatibility APIs and positioning.');
