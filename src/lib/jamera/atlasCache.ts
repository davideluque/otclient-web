import type { Texture } from 'pixi.js';
import { parseDat, type DatFile, type ThingType } from '../dat';
import { parseSpr, releaseSprBuffer } from '../spr';
import {
  buildAtlasPages,
  collectReferencedSpriteIds,
  computeAtlasLayout,
  type SpriteLocation,
} from '../atlas';
import {
  createAtlasTextures,
  getSpriteTexture,
  buildDatIndex,
  type AtlasTextures,
} from '../tileRenderer';

/**
 * Build-once-per-page texture atlas the jamera renderer will read from.
 * Parses .dat + .spr, decodes every referenced item/creature sprite into
 * atlas pages, uploads them as PixiJS textures, and exposes a
 * sprite-ID → Texture getter. No rendering happens here.
 *
 * `dat` is retained so follow-up code can derive a creature index without
 * re-parsing — the renderer PR will need it for outfit rendering.
 */
export interface JameraAtlas {
  get(spriteId: number): Texture | null;
  atlasTextures: AtlasTextures;
  layout: Map<number, SpriteLocation>;
  datIndex: Map<number, ThingType>;
  dat: DatFile;
}

export function buildJameraAtlas(datBuffer: ArrayBuffer, sprBuffer: ArrayBuffer): JameraAtlas {
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

  return {
    atlasTextures,
    layout,
    datIndex,
    dat,
    get(spriteId) {
      return getSpriteTexture(spriteId, atlasTextures, layout);
    },
  };
}
