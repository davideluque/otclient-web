import type { Texture } from 'pixi.js';
import { parseDat, type DatFile, type ThingType } from './dat';
import { parseSpr, releaseSprBuffer } from './spr';
import {
  buildAtlasPages,
  collectReferencedSpriteIds,
  computeAtlasLayout,
  type SpriteLocation,
} from './atlas';
import {
  createAtlasTextures,
  getSpriteTexture,
  buildDatIndex,
  type AtlasTextures,
} from './tileRenderer';

/**
 * Build-once-per-page texture atlas the live renderer reads from. Parses
 * .dat + .spr, decodes every referenced item/creature sprite into atlas
 * pages, uploads them as PixiJS textures, and exposes a sprite-ID → Texture
 * getter. No rendering happens here.
 *
 * `.get()` memoises slices internally so callers can use it as a plain
 * lookup without worrying about per-call `Texture` / `Rectangle`
 * allocations — `getSpriteTexture` creates fresh frame views each time
 * it's called, which would churn the GC on a hot render path.
 *
 * `dat` is retained so follow-up code can derive a creature index without
 * re-parsing — the renderer will need it for outfit rendering.
 */
export interface SpriteAtlas {
  get(spriteId: number): Texture | null;
  atlasTextures: AtlasTextures;
  layout: Map<number, SpriteLocation>;
  datIndex: Map<number, ThingType>;
  dat: DatFile;
}

export function buildSpriteAtlas(datBuffer: ArrayBuffer, sprBuffer: ArrayBuffer): SpriteAtlas {
  const dat = parseDat(datBuffer);
  const spr = parseSpr(sprBuffer);
  const referencedSpriteIds = collectReferencedSpriteIds(dat);
  const atlasPages = buildAtlasPages(spr, referencedSpriteIds);
  // Release the raw .spr ArrayBuffer once every sprite has been decoded
  // into atlas pages — keeping it around would double memory for no gain.
  releaseSprBuffer(spr);
  const atlasTextures = createAtlasTextures(atlasPages);
  const layout = computeAtlasLayout(spr.spriteCount, referencedSpriteIds);
  const datIndex = buildDatIndex(dat);
  const textureCache = new Map<number, Texture | null>();

  return {
    atlasTextures,
    layout,
    datIndex,
    dat,
    get(spriteId) {
      const cached = textureCache.get(spriteId);
      if (cached !== undefined) return cached;
      const tex = getSpriteTexture(spriteId, atlasTextures, layout);
      textureCache.set(spriteId, tex);
      return tex;
    },
  };
}
