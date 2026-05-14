import { SPRITE_SIZE } from './spr';
import type { SprFile } from './spr';
import { decodeSprite } from './spr';
import type { DatFile } from './dat';
import type { OtbFile } from './otb';
import type { OtbmFile } from './otbm';

/** Maximum atlas texture dimension (most GPUs support at least 2048). */
export const ATLAS_SIZE = 2048;

/** Number of sprites per row/column in one atlas page. */
export const SPRITES_PER_ROW = ATLAS_SIZE / SPRITE_SIZE; // 64

/** Number of sprites that fit in one atlas page. */
export const SPRITES_PER_PAGE = SPRITES_PER_ROW * SPRITES_PER_ROW; // 4096

export interface SpriteLocation {
  page: number;
  x: number;
  y: number;
}

export type AtlasPages = Map<number, Uint8Array>;

/**
 * Compute atlas page, x, y for every sprite ID (1-based).
 * Returns a Map from spriteId → SpriteLocation.
 */
export function computeAtlasLayout(
  spriteCount: number,
  referencedSpriteIds?: Iterable<number>,
): Map<number, SpriteLocation> {
  const layout = new Map<number, SpriteLocation>();
  const spriteIds = referencedSpriteIds ?? denseSpriteIds(spriteCount);

  for (const spriteId of spriteIds) {
    if (!Number.isInteger(spriteId) || spriteId < 1 || spriteId > spriteCount) continue;

    const denseIndex = spriteId - 1;
    const page = Math.floor(denseIndex / SPRITES_PER_PAGE);
    const indexInPage = denseIndex % SPRITES_PER_PAGE;
    const col = indexInPage % SPRITES_PER_ROW;
    const row = Math.floor(indexInPage / SPRITES_PER_ROW);
    layout.set(spriteId, {
      page,
      x: col * SPRITE_SIZE,
      y: row * SPRITE_SIZE,
    });
  }
  return layout;
}

function* denseSpriteIds(spriteCount: number): Generator<number> {
  for (let spriteId = 1; spriteId <= spriteCount; spriteId++) {
    yield spriteId;
  }
}

/**
 * Build the set of sprite IDs the atlas needs to contain for the loaded
 * world. Includes:
 *   1. Every item the OTBM places on the map (resolved server→client via OTB).
 *   2. Every creature defined in the .dat — players, NPCs, monsters all
 *      come over the wire at runtime, never from the OTBM, so we can't
 *      pre-filter by map data. Tibia 7.6 has ~600 creature types and they
 *      take a handful of atlas pages; the sparse-atlas storage means
 *      pages without any referenced sprites still aren't allocated.
 *
 * Effects and missiles are dynamic too but are deliberately left out for
 * now — we don't render them yet, and skipping them keeps the atlas
 * tighter. Easy to add when we wire those up.
 */
export function collectReferencedSpriteIds(dat: DatFile, otb: OtbFile, otbm: OtbmFile): Set<number> {
  const datItemsByClientId = new Map(dat.items.map(item => [item.id, item]));
  const referenced = new Set<number>();

  for (const tile of otbm.tiles) {
    for (const item of tile.items) {
      const clientId = otb.serverToClient.get(item.id);
      if (clientId === undefined) continue;

      const thingType = datItemsByClientId.get(clientId);
      if (!thingType) continue;

      for (const spriteId of thingType.frameGroup.spriteIds) {
        if (spriteId > 0) referenced.add(spriteId);
      }
    }
  }

  for (const creature of dat.creatures) {
    for (const spriteId of creature.frameGroup.spriteIds) {
      if (spriteId > 0) referenced.add(spriteId);
    }
  }

  return referenced;
}

/**
 * Build atlas page RGBA buffers by decoding all sprites and packing them.
 * Returns sparse Uint8Array pages keyed by stable dense page index.
 */
export function buildAtlasPages(spr: SprFile, referencedSpriteIds?: Iterable<number>): AtlasPages {
  const pageByteSize = ATLAS_SIZE * ATLAS_SIZE * 4;
  const pages: AtlasPages = new Map();
  const layout = computeAtlasLayout(spr.spriteCount, referencedSpriteIds);

  for (const [spriteId, loc] of layout) {
    const rgba = decodeSprite(spr, spriteId);
    if (!rgba) continue;

    let page = pages.get(loc.page);
    if (!page) {
      page = new Uint8Array(pageByteSize);
      pages.set(loc.page, page);
    }

    // Copy 32x32 sprite into atlas page row by row
    for (let row = 0; row < SPRITE_SIZE; row++) {
      const srcOffset = row * SPRITE_SIZE * 4;
      const dstOffset = ((loc.y + row) * ATLAS_SIZE + loc.x) * 4;
      page.set(rgba.subarray(srcOffset, srcOffset + SPRITE_SIZE * 4), dstOffset);
    }
  }

  return pages;
}
