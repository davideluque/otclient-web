import { describe, it, expect } from 'vitest';
import { ParseError } from '../lib/parseError';
import { parseDat, DatAttr, ThingCategory, ITEM_ID_OFFSET } from '../lib/dat';
import type { Light } from '../lib/dat';

/** Helper: write little-endian U16 into bytes array */
function pushU16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

/** Helper: write little-endian U32 into bytes array */
function pushU32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

/**
 * Build a minimal frame group for a 1x1, single-layer, single-pattern, single-phase thing.
 * Returns the bytes for the frame group section with a single sprite ID.
 */
function minimalFrameGroup(spriteId: number): number[] {
  const bytes: number[] = [];
  bytes.push(1);  // width
  bytes.push(1);  // height
  // no exactSize byte for 1x1
  bytes.push(1);  // layers
  bytes.push(1);  // numPatternX
  bytes.push(1);  // numPatternY
  bytes.push(1);  // numPatternZ
  bytes.push(1);  // animationPhases
  // 1 sprite: U16
  pushU16(bytes, spriteId);
  return bytes;
}

/**
 * Build a minimal .dat buffer with the given number of items/creatures/effects/missiles.
 * Each thing has no attributes (just the 0xFF terminator) and a minimal 1x1 frame group.
 */
function buildMinimalDat(opts: {
  signature?: number;
  items?: number;
  creatures?: number;
  effects?: number;
  missiles?: number;
}): ArrayBuffer {
  const bytes: number[] = [];
  pushU32(bytes, opts.signature ?? 0xdeadbeef);

  // Counts in header are the max ID for that category
  // Items: max ID = ITEM_ID_OFFSET + numItems - 1
  const numItems = opts.items ?? 0;
  const numCreatures = opts.creatures ?? 0;
  const numEffects = opts.effects ?? 0;
  const numMissiles = opts.missiles ?? 0;

  pushU16(bytes, numItems > 0 ? ITEM_ID_OFFSET + numItems - 1 : ITEM_ID_OFFSET - 1);
  pushU16(bytes, numCreatures);
  pushU16(bytes, numEffects);
  pushU16(bytes, numMissiles);

  // Write thing data
  const allCounts = [numItems, numCreatures, numEffects, numMissiles];
  let spriteCounter = 1;
  for (const count of allCounts) {
    for (let i = 0; i < count; i++) {
      bytes.push(DatAttr.Last); // no attributes
      bytes.push(...minimalFrameGroup(spriteCounter++));
    }
  }

  return new Uint8Array(bytes).buffer;
}

describe('parseDat', () => {
  it('parses header signature and counts', () => {
    const dat = parseDat(buildMinimalDat({ signature: 0x12345678, items: 2, creatures: 3, effects: 1, missiles: 1 }));
    expect(dat.signature).toBe(0x12345678);
    expect(dat.items).toHaveLength(2);
    expect(dat.creatures).toHaveLength(3);
    expect(dat.effects).toHaveLength(1);
    expect(dat.missiles).toHaveLength(1);
  });

  it('assigns correct IDs to items starting at 100', () => {
    const dat = parseDat(buildMinimalDat({ items: 3 }));
    expect(dat.items[0].id).toBe(100);
    expect(dat.items[1].id).toBe(101);
    expect(dat.items[2].id).toBe(102);
    expect(dat.items[0].category).toBe(ThingCategory.Item);
  });

  it('assigns correct IDs to creatures starting at 1', () => {
    const dat = parseDat(buildMinimalDat({ creatures: 2 }));
    expect(dat.creatures[0].id).toBe(1);
    expect(dat.creatures[1].id).toBe(2);
    expect(dat.creatures[0].category).toBe(ThingCategory.Creature);
  });

  it('parses minimal frame group correctly', () => {
    const dat = parseDat(buildMinimalDat({ items: 1 }));
    const fg = dat.items[0].frameGroup;
    expect(fg.width).toBe(1);
    expect(fg.height).toBe(1);
    expect(fg.exactSize).toBe(32);
    expect(fg.layers).toBe(1);
    expect(fg.numPatternX).toBe(1);
    expect(fg.numPatternY).toBe(1);
    expect(fg.numPatternZ).toBe(1);
    expect(fg.animationPhases).toBe(1);
    expect(fg.spriteIds).toEqual([1]);
  });

  it('parses boolean attributes', () => {
    const bytes: number[] = [];
    pushU32(bytes, 0); // signature
    pushU16(bytes, ITEM_ID_OFFSET); // 1 item (max ID = 100)
    pushU16(bytes, 0);
    pushU16(bytes, 0);
    pushU16(bytes, 0);

    // Attributes: Container (4), Stackable (5), NotWalkable (12), then terminator
    bytes.push(DatAttr.Container);
    bytes.push(DatAttr.Stackable);
    bytes.push(DatAttr.NotWalkable);
    bytes.push(DatAttr.Last);
    bytes.push(...minimalFrameGroup(1));

    const dat = parseDat(new Uint8Array(bytes).buffer);
    const attrs = dat.items[0].attrs;
    expect(attrs.get(DatAttr.Container)).toBe(true);
    expect(attrs.get(DatAttr.Stackable)).toBe(true);
    expect(attrs.get(DatAttr.NotWalkable)).toBe(true);
    expect(attrs.has(DatAttr.Hangable)).toBe(false);
  });

  it('parses Ground attribute with speed value', () => {
    const bytes: number[] = [];
    pushU32(bytes, 0);
    pushU16(bytes, ITEM_ID_OFFSET);
    pushU16(bytes, 0);
    pushU16(bytes, 0);
    pushU16(bytes, 0);

    bytes.push(DatAttr.Ground);
    pushU16(bytes, 150); // ground speed
    bytes.push(DatAttr.Last);
    bytes.push(...minimalFrameGroup(1));

    const dat = parseDat(new Uint8Array(bytes).buffer);
    expect(dat.items[0].attrs.get(DatAttr.Ground)).toBe(150);
  });

  it('parses Light attribute', () => {
    const bytes: number[] = [];
    pushU32(bytes, 0);
    pushU16(bytes, ITEM_ID_OFFSET);
    pushU16(bytes, 0);
    pushU16(bytes, 0);
    pushU16(bytes, 0);

    bytes.push(DatAttr.Light);
    pushU16(bytes, 7);   // intensity
    pushU16(bytes, 215); // color
    bytes.push(DatAttr.Last);
    bytes.push(...minimalFrameGroup(1));

    const dat = parseDat(new Uint8Array(bytes).buffer);
    const light = dat.items[0].attrs.get(DatAttr.Light) as Light;
    expect(light.intensity).toBe(7);
    expect(light.color).toBe(215);
  });

  it('parses Displacement attribute', () => {
    const bytes: number[] = [];
    pushU32(bytes, 0);
    pushU16(bytes, ITEM_ID_OFFSET);
    pushU16(bytes, 0);
    pushU16(bytes, 0);
    pushU16(bytes, 0);

    bytes.push(DatAttr.Displacement);
    pushU16(bytes, 8);
    pushU16(bytes, 8);
    bytes.push(DatAttr.Last);
    bytes.push(...minimalFrameGroup(1));

    const dat = parseDat(new Uint8Array(bytes).buffer);
    const disp = dat.items[0].attrs.get(DatAttr.Displacement) as { x: number; y: number };
    expect(disp.x).toBe(8);
    expect(disp.y).toBe(8);
  });

  it('parses multi-tile frame group with exactSize', () => {
    const bytes: number[] = [];
    pushU32(bytes, 0);
    pushU16(bytes, ITEM_ID_OFFSET);
    pushU16(bytes, 0);
    pushU16(bytes, 0);
    pushU16(bytes, 0);

    bytes.push(DatAttr.Last); // no attrs

    // 2x2 frame group
    bytes.push(2);  // width
    bytes.push(2);  // height
    bytes.push(48); // realSize (exactSize = min(48, max(64, 64)) = 48)
    bytes.push(1);  // layers
    bytes.push(1);  // numPatternX
    bytes.push(1);  // numPatternY
    bytes.push(1);  // numPatternZ
    bytes.push(1);  // animationPhases
    // 2*2*1*1*1*1*1 = 4 sprites
    pushU16(bytes, 10);
    pushU16(bytes, 11);
    pushU16(bytes, 12);
    pushU16(bytes, 13);

    const dat = parseDat(new Uint8Array(bytes).buffer);
    const fg = dat.items[0].frameGroup;
    expect(fg.width).toBe(2);
    expect(fg.height).toBe(2);
    expect(fg.exactSize).toBe(48);
    expect(fg.spriteIds).toEqual([10, 11, 12, 13]);
  });

  it('reports invalid item counts and incomplete sprite references as parse errors', () => {
    const dat = buildMinimalDat({ items: 1 });
    expect(() => parseDat(dat.slice(0, -1))).toThrow(ParseError);
    new DataView(dat).setUint16(4, 1, true);
    expect(() => parseDat(dat)).toThrow(ParseError);
  });

  it('handles empty categories', () => {
    const dat = parseDat(buildMinimalDat({}));
    expect(dat.items).toHaveLength(0);
    expect(dat.creatures).toHaveLength(0);
    expect(dat.effects).toHaveLength(0);
    expect(dat.missiles).toHaveLength(0);
  });
});
