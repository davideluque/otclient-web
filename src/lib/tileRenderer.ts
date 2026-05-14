import { Container, Sprite, Texture, BufferImageSource, Rectangle } from 'pixi.js';
import type { TileMap, ResolvedTile } from './tileMap';
import type { DatFile, ThingType } from './dat';
import { DatAttr } from './dat';
import { SPRITE_SIZE } from './spr';
import type { AtlasPages, SpriteLocation } from './atlas';
import { ATLAS_SIZE } from './atlas';
import type { PlayerState } from './player';
import { extractSpritePixels, tintOutfitSprite } from './outfitTint';

export const TILE_SIZE = 32;

/** Cache key → tinted 32×32 texture, owned by the caller (main.ts). */
export type TintedTextureCache = Map<string, Texture>;

export interface AtlasTextures {
  pages: Map<number, Texture>;
}

/**
 * Create PixiJS base textures from raw RGBA atlas page buffers.
 */
export function createAtlasTextures(pages: AtlasPages): AtlasTextures {
  const textures = new Map<number, Texture>();
  for (const [pageIndex, rgba] of pages) {
    const source = new BufferImageSource({
      resource: rgba,
      width: ATLAS_SIZE,
      height: ATLAS_SIZE,
      format: 'rgba8unorm',
      alphaMode: 'premultiply-alpha-on-upload',
      scaleMode: 'nearest',
    });
    textures.set(pageIndex, new Texture({ source }));
  }
  return { pages: textures };
}

/**
 * Get a PixiJS Texture for a specific sprite ID by slicing from the atlas.
 */
export function getSpriteTexture(
  spriteId: number,
  atlasTextures: AtlasTextures,
  layout: Map<number, SpriteLocation>,
): Texture | null {
  const loc = layout.get(spriteId);
  if (!loc) return null;

  const base = atlasTextures.pages.get(loc.page);
  if (!base) return null;

  return new Texture({
    source: base.source,
    frame: new Rectangle(loc.x, loc.y, SPRITE_SIZE, SPRITE_SIZE),
  });
}

/** Build an O(1) lookup from client item ID → ThingType. */
export function buildDatIndex(dat: DatFile): Map<number, ThingType> {
  const index = new Map<number, ThingType>();
  for (const thing of dat.items) {
    index.set(thing.id, thing);
  }
  return index;
}

/**
 * Render the player at its current world coordinate facing its current
 * direction. Handles creatures with multi-tile footprints (width/height > 1,
 * like dragons) and stacked layers (base outfit + colour overlay). Returns
 * null if the creature lookType isn't in the loaded .dat or no sprites
 * resolve — caller should skip adding a child in that case.
 */
export function renderPlayer(
  player: PlayerState,
  creatureIndex: Map<number, ThingType>,
  atlasTextures: AtlasTextures,
  atlasPages: AtlasPages,
  layout: Map<number, SpriteLocation>,
  tintedCache: TintedTextureCache,
): Container | null {
  const creature = creatureIndex.get(player.outfit.lookType);
  if (!creature) return null;

  const fg = creature.frameGroup;
  const dir = Math.max(0, Math.min(player.direction, fg.numPatternX - 1));
  const phase = Math.max(0, Math.min(player.animationPhase, fg.animationPhases - 1));
  const hasMask = fg.layers >= 2;

  // Creatures declare a pixel displacement so the sprite's visible body
  // sits over the tile origin instead of jutting into the bottom-right
  // corner. Tibia 7.6 creatures typically use (8, 8). Without subtracting
  // this, the citizen renders shifted down-and-right.
  const displacement = creature.attrs.get(DatAttr.Displacement);
  const dispX = (typeof displacement === 'object' && displacement && 'x' in displacement) ? displacement.x : 0;
  const dispY = (typeof displacement === 'object' && displacement && 'y' in displacement) ? displacement.y : 0;

  const container = new Container();
  let drew = false;

  // Sprite index layout: (((((phase*patZ + 0)*patY + 0)*patX + dir)*layers + layer)*height + h)*width + w
  // We pick the (h, w) anchor cell pair per piece, and either compose the
  // tinted layer-0 + layer-1 outfit (when layers >= 2) or just draw layer 0.
  for (let h = fg.height - 1; h >= 0; h--) {
    for (let w = fg.width - 1; w >= 0; w--) {
      const baseIdx = layerSpriteIndex(fg, phase, dir, 0, h, w);
      const baseSpriteId = fg.spriteIds[baseIdx];
      if (!baseSpriteId) continue;

      let texture: Texture | null;
      if (hasMask) {
        const maskIdx = layerSpriteIndex(fg, phase, dir, 1, h, w);
        const maskSpriteId = fg.spriteIds[maskIdx] ?? 0;
        texture = resolveTintedTexture(baseSpriteId, maskSpriteId, player, atlasPages, layout, tintedCache);
      } else {
        texture = getSpriteTexture(baseSpriteId, atlasTextures, layout);
      }
      if (!texture) continue;

      const sprite = new Sprite(texture);
      sprite.x = (player.x - w) * TILE_SIZE - dispX;
      sprite.y = (player.y - h) * TILE_SIZE - dispY;
      container.addChild(sprite);
      drew = true;
    }
  }

  return drew ? container : null;
}

function layerSpriteIndex(fg: ThingType['frameGroup'], phase: number, dir: number, layer: number, h: number, w: number): number {
  return ((((phase * fg.numPatternZ * fg.numPatternY) * fg.numPatternX + dir) * fg.layers + layer) * fg.height + h) * fg.width + w;
}

function resolveTintedTexture(
  baseSpriteId: number,
  maskSpriteId: number,
  player: PlayerState,
  atlasPages: AtlasPages,
  layout: Map<number, SpriteLocation>,
  cache: TintedTextureCache,
): Texture | null {
  const { lookType, headColor, bodyColor, legsColor, feetColor } = player.outfit;
  const key = `${lookType}:${baseSpriteId}:${maskSpriteId}:${headColor}:${bodyColor}:${legsColor}:${feetColor}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const basePixels = extractSpritePixels(atlasPages, layout, baseSpriteId);
  if (!basePixels) return null;

  const maskPixels = maskSpriteId ? extractSpritePixels(atlasPages, layout, maskSpriteId) : null;
  const finalPixels = maskPixels
    ? tintOutfitSprite(basePixels, maskPixels, { head: headColor, body: bodyColor, legs: legsColor, feet: feetColor })
    : basePixels;

  const source = new BufferImageSource({
    resource: finalPixels,
    width: SPRITE_SIZE,
    height: SPRITE_SIZE,
    format: 'rgba8unorm',
    alphaMode: 'premultiply-alpha-on-upload',
    scaleMode: 'nearest',
  });
  const texture = new Texture({ source });
  cache.set(key, texture);
  return texture;
}

/**
 * Animated sprite plus its frame-by-frame texture list. The render loop
 * keeps an array of these for the visible region and swaps `sprite.texture`
 * each animation tick — no allocation per frame.
 */
export interface AnimatedSprite {
  sprite: Sprite;
  texturesByPhase: (Texture | null)[];
}

export interface RenderedRegion {
  container: Container;
  animated: AnimatedSprite[];
}

/**
 * Render a rectangular region of tiles into a PixiJS Container.
 * Each tile's items are stacked in order (ground first, then items on top).
 *
 * `datIndex` and `layout` should be pre-computed once and reused across frames.
 */
export function renderTileRegion(
  tileMap: TileMap,
  datIndex: Map<number, ThingType>,
  atlasTextures: AtlasTextures,
  layout: Map<number, SpriteLocation>,
  x1: number, y1: number, x2: number, y2: number, z: number,
): RenderedRegion {
  const container = new Container();
  const animated: AnimatedSprite[] = [];

  // Cache textures to avoid recreating for the same sprite ID
  const textureCache = new Map<number, Texture | null>();

  function getTexture(spriteId: number): Texture | null {
    if (textureCache.has(spriteId)) return textureCache.get(spriteId)!;
    const tex = getSpriteTexture(spriteId, atlasTextures, layout);
    textureCache.set(spriteId, tex);
    return tex;
  }

  for (const tile of tileMap.tilesInRegion(x1, y1, x2, y2, z)) {
    renderTile(tile, container, animated, datIndex, getTexture);
  }

  return { container, animated };
}

function renderTile(
  tile: ResolvedTile,
  container: Container,
  animated: AnimatedSprite[],
  datIndex: Map<number, ThingType>,
  getTexture: (spriteId: number) => Texture | null,
): void {
  const screenX = tile.x * TILE_SIZE;
  const screenY = tile.y * TILE_SIZE;

  // The DAT Elevation attribute is how many pixels items placed *on top* of
  // this one shift up by. We accumulate it as we walk the stack so a table
  // on a carpet renders raised above the floor.
  let elevation = 0;

  for (const item of tile.items) {
    const thingType = datIndex.get(item.clientId);
    if (!thingType) continue;

    // Pixel offset applied to every cell of this item — walls and door frames
    // use it to sit flush against the tile edge, wall-mounted fixtures use it
    // to overhang properly. Reads {x, y} from dat; both default to 0.
    const displacement = thingType.attrs.get(DatAttr.Displacement);
    const dispX = (typeof displacement === 'object' && displacement && 'x' in displacement) ? displacement.x : 0;
    const dispY = (typeof displacement === 'object' && displacement && 'y' in displacement) ? displacement.y : 0;

    const { width, height, layers, numPatternX, numPatternY, numPatternZ, animationPhases, spriteIds } = thingType.frameGroup;
    // DAT sprite layout (matches OTClient reference):
    //   index = (((((phase*patZ + z)*patY + y)*patX + x)*layers + layer)*height + h)*width + w
    // For static rendering we pick phase=0, layer=0, z-pattern=0, and pick the
    // (x, y) pattern from the tile's world position. That gives cobblestone
    // and other ground tiles their natural-looking variation across a stretch
    // — the cosmetic random Tibia uses to avoid an obvious tiled grid.
    const patX = ((tile.x % numPatternX) + numPatternX) % numPatternX;
    const patY = ((tile.y % numPatternY) + numPatternY) % numPatternY;
    const patternOffset = (patY * numPatternX + patX) * height * width;
    // Stepping animationPhase by 1 advances the sprite index by this much.
    const phaseStride = numPatternZ * numPatternY * numPatternX * layers * height * width;
    const isAnimated = animationPhases > 1;

    // Iterate furthest piece first, anchor (h=0, w=0) last, so painter's-algorithm
    // ordering places the anchor on top of pieces extending up and to the left.
    for (let h = height - 1; h >= 0; h--) {
      for (let w = width - 1; w >= 0; w--) {
        const phase0Index = patternOffset + h * width + w;
        const spriteId = spriteIds[phase0Index];
        if (!spriteId) continue;

        const texture = getTexture(spriteId);
        if (!texture) continue;

        const sprite = new Sprite(texture);
        sprite.x = screenX - w * TILE_SIZE - dispX;
        sprite.y = screenY - h * TILE_SIZE - elevation - dispY;
        container.addChild(sprite);

        if (isAnimated) {
          // Pre-resolve every animation frame's texture so the ticker can
          // swap by reference — no allocation per frame.
          const texturesByPhase: (Texture | null)[] = new Array(animationPhases);
          for (let p = 0; p < animationPhases; p++) {
            const id = spriteIds[phase0Index + p * phaseStride];
            texturesByPhase[p] = id ? getTexture(id) : null;
          }
          animated.push({ sprite, texturesByPhase });
        }
      }
    }

    const itemElevation = thingType.attrs.get(DatAttr.Elevation);
    if (typeof itemElevation === 'number' && itemElevation > 0) {
      elevation += itemElevation;
    }
  }
}
