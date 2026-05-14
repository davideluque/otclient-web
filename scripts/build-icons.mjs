// Generates the PWA PNG icons (180×180 for iOS apple-touch-icon, 512×512 for
// the manifest PNG fallback) from the same procedural torch-glow design as
// public/icon.svg. Zero dependencies — uses Node's zlib for PNG compression
// and writes the PNG chunks by hand. Run with `npm run build:icons` whenever
// the icon design changes.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, 'public');

const BG = [0x10, 0x1a, 0x30];
const CENTER_DOT = [0xff, 0xf6, 0xc0];
const STOPS = [
  { t: 0.00, color: [0xff, 0xf6, 0xc0], alpha: 1.0 },
  { t: 0.35, color: [0xff, 0xb0, 0x60], alpha: 0.85 },
  { t: 0.75, color: [0xff, 0x70, 0x30], alpha: 0.25 },
  { t: 1.00, color: [0xff, 0x70, 0x30], alpha: 0.0 },
];

function lerp(a, b, t) { return a + (b - a) * t; }

function gradientColor(t) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / (b.t - a.t);
      return [
        Math.round(lerp(a.color[0], b.color[0], k)),
        Math.round(lerp(a.color[1], b.color[1], k)),
        Math.round(lerp(a.color[2], b.color[2], k)),
        lerp(a.alpha, b.alpha, k),
      ];
    }
  }
  return [0, 0, 0, 0];
}

function buildPixels(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2;
  const dotRadius = size * (22 / 512);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const i = (y * size + x) * 4;

      if (dist < dotRadius) {
        buf[i] = CENTER_DOT[0];
        buf[i + 1] = CENTER_DOT[1];
        buf[i + 2] = CENTER_DOT[2];
        buf[i + 3] = 255;
        continue;
      }

      const t = Math.min(1, dist / maxR);
      const [r, g, b, a] = gradientColor(t);
      // Alpha-composite the gradient over the solid dark background.
      buf[i] = Math.round(lerp(BG[0], r, a));
      buf[i + 1] = Math.round(lerp(BG[1], g, a));
      buf[i + 2] = Math.round(lerp(BG[2], b, a));
      buf[i + 3] = 255;
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function writePng(file, size, rgba) {
  // PNG requires a filter byte (0 = none) prefixed to every scanline.
  const stride = size * 4;
  const filtered = Buffer.alloc(size * (1 + stride));
  for (let y = 0; y < size; y++) {
    filtered[y * (1 + stride)] = 0;
    rgba.copy(filtered, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(file, png);
}

for (const size of [180, 512]) {
  const pixels = buildPixels(size);
  const out = join(publicDir, `icon-${size}.png`);
  writePng(out, size, pixels);
  console.log(`wrote ${out} (${size}×${size})`);
}
