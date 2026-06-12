import { BinaryReader } from './BinaryReader';
import type { Pixel } from './types';

export const SPRITE_SIZE: Pixel = 32;
const RGB_BYTES_PER_PIXEL = 3;
const RGBA_BYTES_PER_PIXEL = 4;

export const SPRITE_PIXELS = SPRITE_SIZE * SPRITE_SIZE;
export const SPRITE_DATA_SIZE = SPRITE_PIXELS * RGBA_BYTES_PER_PIXEL;

// RGB transparency color preceding each sprite's data — unused, we use alpha.
const COLOR_KEY_BYTES = 3;
const SPRITE_HEADER_BYTES = COLOR_KEY_BYTES + 2; // color key + u16 data length
const OPAQUE_ALPHA = 255;

export interface SprFile {
  signature: number;
  spriteCount: number;
  offsets: Uint32Array;
  /** The raw file buffer, kept for lazy sprite decoding. */
  buffer: ArrayBuffer;
}

export function parseSpr(buffer: ArrayBuffer): SprFile {
  const reader = new BinaryReader(buffer);

  const signature = reader.getU32();
  const spriteCount = reader.getU16();

  const offsets = new Uint32Array(spriteCount);
  for (let i = 0; i < spriteCount; i++) {
    offsets[i] = reader.getU32();
  }

  return { signature, spriteCount, offsets, buffer };
}

export function releaseSprBuffer(spr: SprFile): void {
  spr.buffer = new ArrayBuffer(0);
}

/**
 * Decode a single sprite into a 32x32 RGBA Uint8Array (4096 bytes).
 * Returns null for empty sprites (offset 0).
 */
export function decodeSprite(spr: SprFile, spriteId: number): Uint8Array | null {
  if (spriteId < 1 || spriteId > spr.spriteCount) return null;

  const offset = spr.offsets[spriteId - 1];
  if (offset === 0) return null;

  const view = new DataView(spr.buffer);
  if (offset + SPRITE_HEADER_BYTES > spr.buffer.byteLength) return null;

  const dataLength = view.getUint16(offset + COLOR_KEY_BYTES, true);
  const dataStart = offset + SPRITE_HEADER_BYTES;
  const dataEnd = dataStart + dataLength;
  if (dataEnd > spr.buffer.byteLength) return null;

  // Zero-initialized — the RLE decoder relies on skipped runs staying
  // transparent (alpha 0).
  const rgba = new Uint8Array(SPRITE_DATA_SIZE);
  decodeSpriteRle(view, dataStart, dataEnd, rgba);

  return rgba;
}

function decodeSpriteRle(
  view: DataView,
  dataStart: number,
  dataEnd: number,
  rgba: Uint8Array,
): void {
  let dataOffset = dataStart;
  let pixelIndex = 0;

  // Run lengths come from the file; the dataEnd guards keep a malformed
  // sprite from reading past its slice instead of throwing a RangeError.
  while (dataOffset + 2 <= dataEnd && pixelIndex < SPRITE_PIXELS) {
    const transparentRunLength = view.getUint16(dataOffset, true);
    dataOffset += 2;
    pixelIndex += transparentRunLength;
    if (pixelIndex >= SPRITE_PIXELS) break;

    if (dataOffset + 2 > dataEnd) break;
    const coloredRunLength = view.getUint16(dataOffset, true);
    dataOffset += 2;

    for (let i = 0; i < coloredRunLength && pixelIndex < SPRITE_PIXELS; i++) {
      if (dataOffset + RGB_BYTES_PER_PIXEL > dataEnd) return;
      const rgbaOffset = pixelIndex * RGBA_BYTES_PER_PIXEL;
      rgba[rgbaOffset] = view.getUint8(dataOffset);
      rgba[rgbaOffset + 1] = view.getUint8(dataOffset + 1);
      rgba[rgbaOffset + 2] = view.getUint8(dataOffset + 2);
      rgba[rgbaOffset + 3] = OPAQUE_ALPHA;
      dataOffset += RGB_BYTES_PER_PIXEL;
      pixelIndex++;
    }
  }
}
