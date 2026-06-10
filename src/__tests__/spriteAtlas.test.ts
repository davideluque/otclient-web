import { describe, it, expect, vi } from 'vitest';
import { buildSpriteAtlas } from '../lib/spriteAtlas';
import * as tileRenderer from '../lib/tileRenderer';
import { DatAttr, ITEM_ID_OFFSET } from '../lib/dat';

function pushU16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}
function pushU32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

function minimalFrameGroup(spriteId: number): number[] {
  const bytes: number[] = [];
  bytes.push(1, 1); // width, height (1x1, no exactSize byte)
  bytes.push(1, 1, 1, 1, 1); // layers, patX, patY, patZ, phases
  pushU16(bytes, spriteId);
  return bytes;
}

/** 1 item (id 100), no creatures/effects/missiles, referencing sprite 1. */
function buildDat(): ArrayBuffer {
  const bytes: number[] = [];
  pushU32(bytes, 0xdeadbeef); // signature
  pushU16(bytes, ITEM_ID_OFFSET); // max item id = 100 → 1 item
  pushU16(bytes, 0); // creatures
  pushU16(bytes, 0); // effects
  pushU16(bytes, 0); // missiles
  bytes.push(DatAttr.Last); // no attributes
  bytes.push(...minimalFrameGroup(1));
  return new Uint8Array(bytes).buffer;
}

/** .spr with N single-red-pixel sprites. */
function buildSpr(count: number): ArrayBuffer {
  const bytes: number[] = [];
  pushU32(bytes, 0); // signature
  pushU16(bytes, count);

  const offsetTableStart = bytes.length;
  for (let i = 0; i < count; i++) pushU32(bytes, 0);

  for (let i = 0; i < count; i++) {
    const offset = bytes.length;
    bytes[offsetTableStart + i * 4] = offset & 0xff;
    bytes[offsetTableStart + i * 4 + 1] = (offset >> 8) & 0xff;
    bytes[offsetTableStart + i * 4 + 2] = (offset >> 16) & 0xff;
    bytes[offsetTableStart + i * 4 + 3] = (offset >> 24) & 0xff;
    bytes.push(0xff, 0x00, 0xff); // color key
    const pixelData: number[] = [];
    pushU16(pixelData, 0); // transparent count
    pushU16(pixelData, 1); // colored count
    pixelData.push(255, 0, 0);
    pushU16(bytes, pixelData.length);
    bytes.push(...pixelData);
  }
  return new Uint8Array(bytes).buffer;
}

describe('buildSpriteAtlas', () => {
  it('wires .dat → datIndex with the parsed item', () => {
    const atlas = buildSpriteAtlas(buildDat(), buildSpr(1));
    expect(atlas.datIndex.has(ITEM_ID_OFFSET)).toBe(true);
    expect(atlas.dat.items).toHaveLength(1);
  });

  it('builds atlas layout for the sprite referenced by the .dat', () => {
    const atlas = buildSpriteAtlas(buildDat(), buildSpr(1));
    expect(atlas.layout.get(1)).toEqual({ page: 0, x: 0, y: 0 });
  });

  it('exposes a .get() that returns a Texture for known sprite IDs', () => {
    const atlas = buildSpriteAtlas(buildDat(), buildSpr(1));
    const tex = atlas.get(1);
    expect(tex).not.toBeNull();
    expect(tex?.frame.width).toBe(32);
    expect(tex?.frame.height).toBe(32);
  });

  it('returns null for unknown sprite IDs', () => {
    const atlas = buildSpriteAtlas(buildDat(), buildSpr(1));
    expect(atlas.get(9999)).toBeNull();
  });

  it('memoises .get() — repeated calls return the same Texture instance', () => {
    const atlas = buildSpriteAtlas(buildDat(), buildSpr(1));
    expect(atlas.get(1)).toBe(atlas.get(1));
  });

  it('memoises .get() null misses — underlying slice runs once per unknown id', () => {
    // Spy *before* building so the construction-time call (which probes
    // the layout once during atlas creation) is captured in `mockClear`.
    const spy = vi.spyOn(tileRenderer, 'getSpriteTexture');
    const atlas = buildSpriteAtlas(buildDat(), buildSpr(1));
    spy.mockClear();
    atlas.get(9999);
    atlas.get(9999);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
