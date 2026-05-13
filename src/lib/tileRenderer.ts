import { Container, Sprite, Texture, BufferImageSource, Rectangle } from 'pixi.js';
import type { TileMap, ResolvedTile } from './tileMap';
import type { DatFile, ThingType } from './dat';
import { SPRITE_SIZE } from './spr';
import type { SpriteLocation } from './atlas';
import { ATLAS_SIZE } from './atlas';

const TILE_SIZE = 32;

export interface AtlasTextures {
  pages: Texture[];
}

/**
 * Create PixiJS base textures from raw RGBA atlas page buffers.
 */
export function createAtlasTextures(pages: Uint8Array[]): AtlasTextures {
  const textures: Texture[] = [];
  for (const rgba of pages) {
    const source = new BufferImageSource({
      resource: rgba,
      width: ATLAS_SIZE,
      height: ATLAS_SIZE,
      format: 'rgba8unorm',
      alphaMode: 'premultiply-alpha-on-upload',
    });
    textures.push(new Texture({ source }));
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
  if (!loc || loc.page >= atlasTextures.pages.length) return null;

  const base = atlasTextures.pages[loc.page];
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

  for (const item of tile.items) {
    const thingType = datIndex.get(item.clientId);
    if (!thingType) continue;

    const spriteId = thingType.frameGroup.spriteIds[0];
    if (!spriteId) continue;

    const texture = getTexture(spriteId);
    if (!texture) continue;

    const sprite = new Sprite(texture);
    sprite.x = screenX;
    sprite.y = screenY;
    container.addChild(sprite);
  }
}
