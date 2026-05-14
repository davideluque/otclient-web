import { describe, it, expect } from 'vitest';
import {
  computeAtlasLayout,
  collectReferencedSpriteIds,
  buildAtlasPages,
  ATLAS_SIZE,
  SPRITES_PER_ROW,
  SPRITES_PER_PAGE,
} from '../lib/atlas';
import { ThingCategory } from '../lib/dat';
import { SPRITE_SIZE, parseSpr } from '../lib/spr';
import type { DatFile } from '../lib/dat';
import type { OtbFile } from '../lib/otb';
import type { OtbmFile } from '../lib/otbm';

function pushU16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function pushU32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

/** Build a .spr with N sprites, each a single colored pixel at position 0. */
function buildTestSpr(count: number, color: [number, number, number] = [255, 0, 0]): ArrayBuffer {
  const bytes: number[] = [];
  pushU32(bytes, 0); // signature
  pushU16(bytes, count);

  const offsetTableStart = bytes.length;
  for (let i = 0; i < count; i++) {
    pushU32(bytes, 0); // placeholder
  }

  for (let i = 0; i < count; i++) {
    const offset = bytes.length;
    bytes[offsetTableStart + i * 4] = offset & 0xff;
    bytes[offsetTableStart + i * 4 + 1] = (offset >> 8) & 0xff;
    bytes[offsetTableStart + i * 4 + 2] = (offset >> 16) & 0xff;
    bytes[offsetTableStart + i * 4 + 3] = (offset >> 24) & 0xff;

    // Color key
    bytes.push(0xff, 0x00, 0xff);

    // Pixel data: 0 transparent, 1 colored pixel
    const pixelData: number[] = [];
    pushU16(pixelData, 0); // transparent count
    pushU16(pixelData, 1); // colored count
    pixelData.push(color[0], color[1], color[2]);

    pushU16(bytes, pixelData.length);
    bytes.push(...pixelData);
  }

  return new Uint8Array(bytes).buffer;
}

describe('computeAtlasLayout', () => {
  it('places first sprite at page 0, position (0, 0)', () => {
    const layout = computeAtlasLayout(1);
    expect(layout.get(1)).toEqual({ page: 0, x: 0, y: 0 });
  });

  it('places sprites left-to-right then top-to-bottom', () => {
    const layout = computeAtlasLayout(SPRITES_PER_ROW + 1);
    // Second sprite is at column 1
    expect(layout.get(2)).toEqual({ page: 0, x: SPRITE_SIZE, y: 0 });
    // First sprite of second row
    expect(layout.get(SPRITES_PER_ROW + 1)).toEqual({ page: 0, x: 0, y: SPRITE_SIZE });
  });

  it('overflows to second page after filling first', () => {
    const layout = computeAtlasLayout(SPRITES_PER_PAGE + 1);
    const last = layout.get(SPRITES_PER_PAGE)!;
    expect(last.page).toBe(0);

    const overflow = layout.get(SPRITES_PER_PAGE + 1)!;
    expect(overflow.page).toBe(1);
    expect(overflow.x).toBe(0);
    expect(overflow.y).toBe(0);
  });

  it('keeps stable page indices for sparse sprite IDs', () => {
    const layout = computeAtlasLayout(SPRITES_PER_PAGE + 1, new Set([1, SPRITES_PER_PAGE + 1]));
    expect(layout.size).toBe(2);
    expect(layout.get(1)).toEqual({ page: 0, x: 0, y: 0 });
    expect(layout.get(SPRITES_PER_PAGE + 1)).toEqual({ page: 1, x: 0, y: 0 });
  });
});

describe('buildAtlasPages', () => {
  it('creates correct number of pages', () => {
    const spr = parseSpr(buildTestSpr(1));
    const pages = buildAtlasPages(spr);
    expect(pages.size).toBe(1);
    expect(pages.get(0)!.length).toBe(ATLAS_SIZE * ATLAS_SIZE * 4);
  });

  it('places sprite pixel data at correct position', () => {
    const spr = parseSpr(buildTestSpr(1, [0, 255, 0]));
    const pages = buildAtlasPages(spr);
    // Sprite 1 at (0,0), pixel 0,0 should be green
    const page = pages.get(0)!;
    expect(page[0]).toBe(0);   // R
    expect(page[1]).toBe(255); // G
    expect(page[2]).toBe(0);   // B
    expect(page[3]).toBe(255); // A
  });

  it('places second sprite at correct atlas offset', () => {
    const spr = parseSpr(buildTestSpr(2, [0, 0, 255]));
    const pages = buildAtlasPages(spr);
    // Sprite 2 at (32, 0) → byte offset = (0 * ATLAS_SIZE + 32) * 4
    const off = 32 * 4;
    const page = pages.get(0)!;
    expect(page[off]).toBe(0);     // R
    expect(page[off + 1]).toBe(0); // G
    expect(page[off + 2]).toBe(255); // B
    expect(page[off + 3]).toBe(255); // A
  });

  it('allocates only pages that contain referenced sprites', () => {
    const spr = parseSpr(buildTestSpr(SPRITES_PER_PAGE + 1));
    const pages = buildAtlasPages(spr, new Set([SPRITES_PER_PAGE + 1]));
    expect(pages.size).toBe(1);
    expect(pages.has(0)).toBe(false);
    expect(pages.has(1)).toBe(true);
  });
});

describe('collectReferencedSpriteIds', () => {
  it('collects sprite IDs from OTBM server IDs through OTB and DAT mappings', () => {
    const dat = {
      signature: 0,
      itemCount: 101,
      creatureCount: 0,
      effectCount: 0,
      missileCount: 0,
      items: [
        {
          id: 100,
          category: ThingCategory.Item,
          attrs: new Map(),
          frameGroup: {
            width: 1,
            height: 1,
            exactSize: 32,
            layers: 1,
            numPatternX: 1,
            numPatternY: 1,
            numPatternZ: 1,
            animationPhases: 1,
            spriteIds: [11],
          },
        },
        {
          id: 101,
          category: ThingCategory.Item,
          attrs: new Map(),
          frameGroup: {
            width: 1,
            height: 1,
            exactSize: 32,
            layers: 1,
            numPatternX: 1,
            numPatternY: 1,
            numPatternZ: 1,
            animationPhases: 2,
            spriteIds: [0, 22],
          },
        },
      ],
      creatures: [],
      effects: [],
      missiles: [],
    } satisfies DatFile;

    const otb = {
      version: { version: 1, majorVersion: 1, minorVersion: 1, buildNumber: 1, csdVersion: '' },
      items: [],
      serverToClient: new Map([
        [2000, 100],
        [2001, 101],
      ]),
    } satisfies OtbFile;

    const otbm = {
      header: { version: 1, width: 1, height: 1, majorVersionItems: 1, minorVersionItems: 1 },
      tiles: [
        {
          position: { x: 100, y: 100, z: 7 },
          flags: 0,
          items: [{ id: 2000 }, { id: 2001 }, { id: 9999 }],
        },
      ],
      towns: [],
    } satisfies OtbmFile;

    expect(collectReferencedSpriteIds(dat, otb, otbm)).toEqual(new Set([11, 22]));
  });

  it('includes every creature sprite from the dat regardless of OTBM contents', () => {
    const dat = {
      signature: 0,
      itemCount: 100,
      creatureCount: 2,
      effectCount: 0,
      missileCount: 0,
      items: [],
      creatures: [
        {
          id: 128,
          category: ThingCategory.Creature,
          attrs: new Map(),
          frameGroup: {
            width: 1,
            height: 1,
            exactSize: 32,
            layers: 1,
            numPatternX: 4,
            numPatternY: 1,
            numPatternZ: 1,
            animationPhases: 1,
            spriteIds: [50, 51, 52, 53],
          },
        },
        {
          id: 129,
          category: ThingCategory.Creature,
          attrs: new Map(),
          frameGroup: {
            width: 1,
            height: 1,
            exactSize: 32,
            layers: 1,
            numPatternX: 1,
            numPatternY: 1,
            numPatternZ: 1,
            animationPhases: 1,
            spriteIds: [99],
          },
        },
      ],
      effects: [],
      missiles: [],
    } satisfies DatFile;

    const otb = {
      version: { version: 1, majorVersion: 1, minorVersion: 1, buildNumber: 1, csdVersion: '' },
      items: [],
      serverToClient: new Map(),
    } satisfies OtbFile;

    const otbm = {
      header: { version: 1, width: 1, height: 1, majorVersionItems: 1, minorVersionItems: 1 },
      tiles: [],
      towns: [],
    } satisfies OtbmFile;

    expect(collectReferencedSpriteIds(dat, otb, otbm)).toEqual(new Set([50, 51, 52, 53, 99]));
  });
});
