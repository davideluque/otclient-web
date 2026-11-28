import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';

process.chdir(path.resolve(import.meta.dirname, '..'));
if (existsSync('.env.tv.local')) process.loadEnvFile('.env.tv.local');
const env = process.env;
const command = process.argv[2];
const device = env.TV_DEVICE || 'sofa';
const id = 'org.otclient.tv';
const output = '.webos-build';
const ipk = output + '/' + id + '_1.0.0_all.ipk';
const port = env.TV_PORT || '8180';
const active = new Set();
function stop() { for (const child of active) child.kill(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
async function run(binary, args) {
  const child = spawn(binary, args, { stdio: 'inherit', env });
  active.add(child);
  try {
    const [code, signal] = await once(child, 'exit');
    if (code !== 0) throw Error(binary + ' exited with ' + (signal || code));
  } finally { active.delete(child); }
}
function origin() {
  if (!isIP(env.HOST_IP || '')) throw Error('Set HOST_IP in .env.tv.local to the address reachable from the TV.');
  const host = isIP(env.HOST_IP) === 6 ? '[' + env.HOST_IP + ']' : env.HOST_IP;
  return new URL('http://' + host + ':' + port).origin;
}
async function pack() {
  const resolution = env.TV_RESOLUTION || '1280x720';
  if (!['1280x720','1920x1080'].includes(resolution)) throw Error('Unsupported TV_RESOLUTION');
  await mkdir(output, { recursive: true });
  const shell = await mkdtemp(path.join(output, 'shell-'));
  try {
    for (const file of ['index.html','launch.js','icon.png','large-icon.png']) {
      await copyFile(path.join('platforms/webos/shell', file), path.join(shell, file));
    }
    const info = JSON.parse(await readFile('platforms/webos/shell/appinfo.json', 'utf8'));
    await writeFile(path.join(shell, 'appinfo.json'), JSON.stringify({ ...info, resolution }));
    await run('ares-package', [shell, '-o', output]);
  } finally {
    await rm(shell, { recursive: true, force: true });
  }
}
function launch() {
  return run('ares-launch', ['-d', device, id, '-p', JSON.stringify({
    origin: origin(), proxyPort: env.WS_PORT || '8090',
    resetPad: process.argv.includes('--reset-pad'), diagnostics: process.argv.includes('--diagnostics'), logs: process.argv.includes('--logs'),
  })]);
}
async function serve(onReady) {
  const url = origin();
  if (!env.OT_HOST) throw Error('Set OT_HOST in .env.tv.local.');
  env.WS_ALLOWED_ORIGINS = url;
  env.TV_DIAGNOSTICS = '1';
  const { preview } = await import('vite');
  const server = await preview({ configFile: 'vite.tv.config.ts',
    preview: { host:'0.0.0.0', port:Number(port), strictPort:true } });
  const proxy = spawn(process.execPath, ['--import', 'tsx', 'proxy/server.ts'], {
    stdio: ['ignore','inherit','inherit','ipc'], env,
  });
  active.add(proxy);
  const exited = once(proxy, 'exit').then(([code, signal]) => {
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') throw Error('Proxy exited with ' + (signal || code));
    return false;
  });
  try {
    const ready = once(proxy, 'message').then(([event]) => event === 'tv-proxy-listening');
    if (!await Promise.race([ready, exited])) return;
    if (onReady) await onReady();
    await exited;
  } finally {
    proxy.kill();
    active.delete(proxy);
    await server.close();
  }
}
const install = () => run('ares-install', ['-d', device, ipk]);
switch (command) {
  case 'package': await pack(); break;
  case 'install': await install(); break;
  case 'inspect': await run('ares-inspect', ['-d', device, '--app', id, '--open']); break;
  case 'launch': await launch(); break;
  case 'serve': await serve(); break;
  case 'deploy':
    origin();
    if (!env.OT_HOST) throw Error('Set OT_HOST in .env.tv.local.');
    await run('npm', ['run','tv:build']);
    await pack();
    await install();
    await serve(launch);
    break;
  default: throw Error('Unknown TV command');
}
