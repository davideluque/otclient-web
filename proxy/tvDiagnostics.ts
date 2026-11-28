import { mkdir, rename, writeFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

export async function handleTVReport(req: IncomingMessage, res: ServerResponse, allowed: string[]): Promise<void> {
  const origin = req.headers.origin;
  if (!origin || !allowed.includes(origin)) { res.writeHead(403).end(); return; }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods','POST');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    res.writeHead(204).end(); return;
  }
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
    const dir = process.env.TV_REPORT_DIR || 'docs/tv';
    await mkdir(dir, { recursive: true });
    if (req.url === '/tv/report') {
      if (typeof data.userAgent !== 'string' || !Array.isArray(data.pads)) throw Error();
      const tmp = join(dir, randomUUID() + '.tmp');
      await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
      await rename(tmp, join(dir, 'device-report.json'));
    } else {
      await appendFile(join(dir, 'device-events.jsonl'), JSON.stringify({ received: Date.now(), event: data }) + '\n');
    }
    res.writeHead(204).end();
  } catch { res.writeHead(400).end(); }
}
