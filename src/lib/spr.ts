import { BinaryReader } from './BinaryReader';

export const SPRITE_SIZE = 32;
export const SPRITE_PIXELS = SPRITE_SIZE * SPRITE_SIZE; // 1024
export const SPRITE_DATA_SIZE = SPRITE_PIXELS * 4; // RGBA bytes

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

/**
 * Decode a single sprite into a 32x32 RGBA Uint8Array (4096 bytes).
 * Returns null for empty sprites (offset 0).
 */
export function decodeSprite(spr: SprFile, spriteId: number): Uint8Array | null {
  if (spriteId < 1 || spriteId > spr.spriteCount) return null;

  const offset = spr.offsets[spriteId - 1];
  if (offset === 0) return null;

  const view = new DataView(spr.buffer);
  let pos = offset;

  // Validate offset has enough room for header (3 color key + 2 data length)
  if (offset + 5 > spr.buffer.byteLength) return null;

  // Skip 3-byte color key (RGB transparency color, unused — we use alpha)
  pos += 3;

  // Pixel data length
  const dataLength = view.getUint16(pos, true);
  pos += 2;

  const rgba = new Uint8Array(SPRITE_DATA_SIZE); // initialized to 0 (transparent)

  const dataEnd = pos + dataLength;
  let pixelIndex = 0;

  while (pos < dataEnd && pixelIndex < SPRITE_PIXELS) {
    // Transparent pixel count
    const transparentCount = view.getUint16(pos, true);
    pos += 2;
    pixelIndex += transparentCount;
    if (pixelIndex >= SPRITE_PIXELS) break;

    // Colored pixel count
    const coloredCount = view.getUint16(pos, true);
    pos += 2;

    for (let i = 0; i < coloredCount && pixelIndex < SPRITE_PIXELS; i++) {
      const byteOffset = pixelIndex * 4;
      rgba[byteOffset] = view.getUint8(pos);     // R
      rgba[byteOffset + 1] = view.getUint8(pos + 1); // G
      rgba[byteOffset + 2] = view.getUint8(pos + 2); // B
      rgba[byteOffset + 3] = 255;                 // A
      pos += 3;
      pixelIndex++;
    }
  }

  return rgba;
}
