import type { Texture } from 'pixi.js';
import { parseDat, type DatFile, type ThingType } from './dat';
import { parseSpr, releaseSprBuffer } from './spr';
import {
  buildAtlasPages,
  collectReferencedSpriteIds,
  computeAtlasLayout,
  type AtlasPages,
  type SpriteLocation,
} from './atlas';
import { buildCreatureIndex } from './player';
import {
  createAtlasTextures,
  getSpriteTexture,
  buildDatIndex,
  type AtlasTextures,
} from './tileRenderer';

/**
 * Build-once-per-page texture atlas the live renderer reads from. Parses
 * .dat + .spr, decodes every referenced sprite (items, creatures,
 * effects, missiles) into atlas pages, uploads them as PixiJS textures,
 * and exposes a sprite-ID → Texture getter. No rendering happens here.
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
  /**
   * CPU-side atlas pages, retained for outfit tinting (renderPlayer
   * composes base + colour-mask layers from raw pixels). ~16 MB per page.
   */
  atlasPages: AtlasPages;
  /** lookType → creature ThingType, for rendering creatures/players. */
  creatureIndex: Map<number, ThingType>;
  /** 1-based effect id (the 0x83 wire byte) → effect ThingType. */
  effectIndex: Map<number, ThingType>;
  /** 1-based missile id (the 0x85 wire byte) → missile ThingType. */
  missileIndex: Map<number, ThingType>;
}

/** O(1) id → ThingType lookup, same shape as buildCreatureIndex. */
function buildThingIndex(things: ThingType[]): Map<number, ThingType> {
  const index = new Map<number, ThingType>();
  for (const thing of things) {
    index.set(thing.id, thing);
  }
  return index;
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
  const creatureIndex = buildCreatureIndex(dat);
  const effectIndex = buildThingIndex(dat.effects);
  const missileIndex = buildThingIndex(dat.missiles);
  const textureCache = new Map<number, Texture | null>();

  return {
    atlasTextures,
    layout,
    datIndex,
    dat,
    atlasPages,
    creatureIndex,
    effectIndex,
    missileIndex,
    get(spriteId) {
      const cached = textureCache.get(spriteId);
      if (cached !== undefined) return cached;
      const tex = getSpriteTexture(spriteId, atlasTextures, layout);
      textureCache.set(spriteId, tex);
      return tex;
    },
  };
}
