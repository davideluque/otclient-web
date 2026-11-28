import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { controllerFlow, fakeController } from './controller-flow.mjs';
import { mockAssets } from './mock-assets.mjs';

const [executablePath, url] = process.argv.slice(2);
if (!executablePath || !url || !process.env.PUPPETEER_2_DIR) {
  throw Error('Set PUPPETEER_2_DIR to the directory containing the old Puppeteer installation. Pass Chromium path and the hosted TV URL.');
}
const requireOld = createRequire(resolve(process.env.PUPPETEER_2_DIR,'package.json'));
const browser = await requireOld('puppeteer').launch({executablePath, args:['--use-gl=swiftshader']});
try {
  for (const [width,height] of [[1280,720],[1920,1080]]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({width,height});
    await page.evaluateOnNewDocument(fakeController);
    await page.setRequestInterception(true);
    page.on('request', req => {
      const name = new URL(req.url()).pathname.split('/').pop();
      if (Object.hasOwn(mockAssets,name)) req.respond({status:200,contentType:'application/octet-stream',body:mockAssets[name]});
      else req.continue();
    });
    await controllerFlow(page,url,true);
    if (errors.length) throw Error(errors.join('\n'));
    await page.close();
  }
} finally { await browser.close(); }
