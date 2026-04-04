import { Container, Sprite, Texture, BufferImageSource, Rectangle } from 'pixi.js';
import type { TileMap, ResolvedTile } from './tileMap';
import type { DatFile } from './dat';
import { SPRITE_SIZE } from './spr';
import { computeAtlasLayout, ATLAS_SIZE } from './atlas';

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
  layout: Map<number, { page: number; x: number; y: number }>,
): Texture | null {
  const loc = layout.get(spriteId);
  if (!loc || loc.page >= atlasTextures.pages.length) return null;

  const base = atlasTextures.pages[loc.page];
  return new Texture({
    source: base.source,
    frame: new Rectangle(loc.x, loc.y, SPRITE_SIZE, SPRITE_SIZE),
  });
}

/**
 * Render a rectangular region of tiles into a PixiJS Container.
 * Each tile's items are stacked in order (ground first, then items on top).
 */
export function renderTileRegion(
  tileMap: TileMap,
  dat: DatFile,
  atlasTextures: AtlasTextures,
  spriteCount: number,
  x1: number, y1: number, x2: number, y2: number, z: number,
): Container {
  const container = new Container();
  const layout = computeAtlasLayout(spriteCount);

  // Cache textures to avoid recreating for the same sprite ID
  const textureCache = new Map<number, Texture | null>();

  function getTexture(spriteId: number): Texture | null {
    if (textureCache.has(spriteId)) return textureCache.get(spriteId)!;
    const tex = getSpriteTexture(spriteId, atlasTextures, layout);
    textureCache.set(spriteId, tex);
    return tex;
  }

  for (const tile of tileMap.tilesInRegion(x1, y1, x2, y2, z)) {
    renderTile(tile, container, dat, getTexture, x1, y1);
  }

  return container;
}

function renderTile(
  tile: ResolvedTile,
  container: Container,
  dat: DatFile,
  getTexture: (spriteId: number) => Texture | null,
  originX: number,
  originY: number,
): void {
  const screenX = (tile.x - originX) * TILE_SIZE;
  const screenY = (tile.y - originY) * TILE_SIZE;

  for (const item of tile.items) {
    // Look up the thing type in .dat to get its sprite IDs
    const thingType = dat.items.find(t => t.id === item.clientId);
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
