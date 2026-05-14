import { Container, Sprite, Texture, BufferImageSource, Rectangle } from 'pixi.js';
import type { TileMap, ResolvedTile } from './tileMap';
import type { DatFile, ThingType } from './dat';
import { DatAttr } from './dat';
import { SPRITE_SIZE } from './spr';
import type { AtlasPages, SpriteLocation } from './atlas';
import { ATLAS_SIZE } from './atlas';

const TILE_SIZE = 32;

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
): Container {
  const container = new Container();

  // Cache textures to avoid recreating for the same sprite ID
  const textureCache = new Map<number, Texture | null>();

  function getTexture(spriteId: number): Texture | null {
    if (textureCache.has(spriteId)) return textureCache.get(spriteId)!;
    const tex = getSpriteTexture(spriteId, atlasTextures, layout);
    textureCache.set(spriteId, tex);
    return tex;
  }

  for (const tile of tileMap.tilesInRegion(x1, y1, x2, y2, z)) {
    renderTile(tile, container, datIndex, getTexture);
  }

  return container;
}

function renderTile(
  tile: ResolvedTile,
  container: Container,
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

    const { width, height, layers, numPatternX, numPatternY, numPatternZ, animationPhases, spriteIds } = thingType.frameGroup;
    // Sprites are laid out (h, w, layer, patternX, patternY, patternZ, anim) with anim innermost.
    // For static rendering we use the first layer/pattern/animation of each (w, h) cell.
    const perCell = layers * numPatternX * numPatternY * numPatternZ * animationPhases;

    // Iterate furthest piece first, anchor (h=0, w=0) last, so painter's-algorithm
    // ordering places the anchor on top of pieces extending up and to the left.
    for (let h = height - 1; h >= 0; h--) {
      for (let w = width - 1; w >= 0; w--) {
        const spriteId = spriteIds[(h * width + w) * perCell];
        if (!spriteId) continue;

        const texture = getTexture(spriteId);
        if (!texture) continue;

        const sprite = new Sprite(texture);
        sprite.x = screenX - w * TILE_SIZE;
        sprite.y = screenY - h * TILE_SIZE - elevation;
        container.addChild(sprite);
      }
    }

    const itemElevation = thingType.attrs.get(DatAttr.Elevation);
    if (typeof itemElevation === 'number' && itemElevation > 0) {
      elevation += itemElevation;
    }
  }
}
