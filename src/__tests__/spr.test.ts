import { describe, it, expect } from 'vitest';
import { parseSpr, decodeSprite, releaseSprBuffer, SPRITE_DATA_SIZE } from '../lib/spr';

/** Helper: write little-endian U16 */
function pushU16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

/** Helper: write little-endian U32 */
function pushU32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

/**
 * Build a minimal .spr file with given sprites.
 * Each sprite is defined by its RLE runs: [transparentCount, [r,g,b], [r,g,b], ...]
 */
function buildSpr(
  sprites: Array<{ transparent: number; pixels: [number, number, number][] }[] | null>,
): ArrayBuffer {
  const bytes: number[] = [];

  // Header
  pushU32(bytes, 0xaabbccdd); // signature
  pushU16(bytes, sprites.length); // sprite count

  // Reserve space for offset table
  const offsetTableStart = bytes.length;
  for (let i = 0; i < sprites.length; i++) {
    pushU32(bytes, 0); // placeholder
  }

  // Write sprite data and fill in offsets
  for (let i = 0; i < sprites.length; i++) {
    const sprite = sprites[i];
    if (sprite === null) {
      // Empty sprite — offset stays 0
      continue;
    }

    // Record offset
    const offset = bytes.length;
    bytes[offsetTableStart + i * 4] = offset & 0xff;
    bytes[offsetTableStart + i * 4 + 1] = (offset >> 8) & 0xff;
    bytes[offsetTableStart + i * 4 + 2] = (offset >> 16) & 0xff;
    bytes[offsetTableStart + i * 4 + 3] = (offset >> 24) & 0xff;

    // Color key (3 bytes) — magenta
    bytes.push(0xff, 0x00, 0xff);

    // Build pixel data into a temp buffer to know its length
    const pixelData: number[] = [];
    for (const run of sprite) {
      pushU16(pixelData, run.transparent);
      pushU16(pixelData, run.pixels.length);
      for (const [r, g, b] of run.pixels) {
        pixelData.push(r, g, b);
      }
    }

    // Pixel data length
    pushU16(bytes, pixelData.length);
    bytes.push(...pixelData);
  }

  return new Uint8Array(bytes).buffer;
}

describe('parseSpr', () => {
  it('parses header and offset table', () => {
    const buffer = buildSpr([null, null]);
    const spr = parseSpr(buffer);
    expect(spr.signature).toBe(0xaabbccdd);
    expect(spr.spriteCount).toBe(2);
    expect(spr.offsets).toHaveLength(2);
    expect(spr.offsets[0]).toBe(0); // empty sprite
    expect(spr.offsets[1]).toBe(0); // empty sprite
  });

  it('returns null for empty sprite (offset 0)', () => {
    const spr = parseSpr(buildSpr([null]));
    expect(decodeSprite(spr, 1)).toBeNull();
  });

  it('returns null for out-of-range sprite IDs', () => {
    const spr = parseSpr(buildSpr([null]));
    expect(decodeSprite(spr, 0)).toBeNull();
    expect(decodeSprite(spr, 2)).toBeNull();
    expect(decodeSprite(spr, -1)).toBeNull();
  });

  it('decodes a fully transparent sprite', () => {
    // One run: skip 1024 transparent pixels, 0 colored
    const spr = parseSpr(buildSpr([[{ transparent: 1024, pixels: [] }]]));
    const rgba = decodeSprite(spr, 1)!;
    expect(rgba).not.toBeNull();
    expect(rgba.length).toBe(SPRITE_DATA_SIZE);
    // All bytes should be 0 (transparent)
    for (let i = 0; i < SPRITE_DATA_SIZE; i++) {
      expect(rgba[i]).toBe(0);
    }
  });

  it('decodes colored pixels at the start', () => {
    // 0 transparent, then 2 colored pixels
    const spr = parseSpr(
      buildSpr([
        [
          {
            transparent: 0,
            pixels: [
              [255, 0, 0],
              [0, 255, 0],
            ],
          },
        ],
      ]),
    );
    const rgba = decodeSprite(spr, 1)!;
    // Pixel 0: red
    expect(rgba[0]).toBe(255);
    expect(rgba[1]).toBe(0);
    expect(rgba[2]).toBe(0);
    expect(rgba[3]).toBe(255); // alpha
    // Pixel 1: green
    expect(rgba[4]).toBe(0);
    expect(rgba[5]).toBe(255);
    expect(rgba[6]).toBe(0);
    expect(rgba[7]).toBe(255);
    // Pixel 2: should be transparent
    expect(rgba[8]).toBe(0);
    expect(rgba[9]).toBe(0);
    expect(rgba[10]).toBe(0);
    expect(rgba[11]).toBe(0);
  });

  it('decodes pixels after transparent gap', () => {
    // Skip 5 transparent, then 1 blue pixel
    const spr = parseSpr(buildSpr([[{ transparent: 5, pixels: [[0, 0, 255]] }]]));
    const rgba = decodeSprite(spr, 1)!;
    // Pixels 0-4 should be transparent
    for (let i = 0; i < 5 * 4; i++) {
      expect(rgba[i]).toBe(0);
    }
    // Pixel 5: blue
    const off = 5 * 4;
    expect(rgba[off]).toBe(0);
    expect(rgba[off + 1]).toBe(0);
    expect(rgba[off + 2]).toBe(255);
    expect(rgba[off + 3]).toBe(255);
  });

  it('decodes multiple RLE runs', () => {
    const spr = parseSpr(
      buildSpr([
        [
          { transparent: 0, pixels: [[255, 0, 0]] },    // pixel 0: red
          { transparent: 2, pixels: [[0, 0, 255]] },    // skip 2, pixel 3: blue
        ],
      ]),
    );
    const rgba = decodeSprite(spr, 1)!;
    // Pixel 0: red
    expect(rgba[0]).toBe(255);
    expect(rgba[3]).toBe(255);
    // Pixel 1-2: transparent
    expect(rgba[4 + 3]).toBe(0);
    expect(rgba[8 + 3]).toBe(0);
    // Pixel 3: blue
    expect(rgba[12]).toBe(0);
    expect(rgba[13]).toBe(0);
    expect(rgba[14]).toBe(255);
    expect(rgba[15]).toBe(255);
  });

  it('handles multiple sprites in one file', () => {
    const spr = parseSpr(
      buildSpr([
        [{ transparent: 0, pixels: [[255, 0, 0]] }],   // sprite 1: red pixel
        null,                                            // sprite 2: empty
        [{ transparent: 0, pixels: [[0, 255, 0]] }],   // sprite 3: green pixel
      ]),
    );
    expect(spr.spriteCount).toBe(3);

    const s1 = decodeSprite(spr, 1)!;
    expect(s1[0]).toBe(255); // red

    expect(decodeSprite(spr, 2)).toBeNull();

    const s3 = decodeSprite(spr, 3)!;
    expect(s3[1]).toBe(255); // green
  });

  it('releases the original SPR buffer', () => {
    const spr = parseSpr(buildSpr([[{ transparent: 0, pixels: [[255, 0, 0]] }]]));
    expect(spr.buffer.byteLength).toBeGreaterThan(0);

    releaseSprBuffer(spr);

    expect(spr.buffer.byteLength).toBe(0);
    expect(decodeSprite(spr, 1)).toBeNull();
  });
});
