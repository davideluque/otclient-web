import { Container, Sprite, Texture, BufferImageSource, Rectangle } from 'pixi.js';
import type { TileMap, ResolvedTile } from './tileMap';
import type { DatFile, ThingType } from './dat';
import { DatAttr } from './dat';
import { SPRITE_SIZE } from './spr';
import type { AtlasPages, SpriteLocation } from './atlas';
import { ATLAS_SIZE } from './atlas';
import type { PlayerState } from './player';

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
  layout: Map<number, SpriteLocation>,
): Container | null {
  const creature = creatureIndex.get(player.outfit.lookType);
  if (!creature) return null;

  const fg = creature.frameGroup;
  const dir = Math.max(0, Math.min(player.direction, fg.numPatternX - 1));
  const phase = Math.max(0, Math.min(player.animationPhase, fg.animationPhases - 1));

  const container = new Container();
  let drew = false;

  // Sprite index layout: ((phase * patZ * patY * patX + dir) * layers + layer) * h * w + (h * w + w)
  // Iterate every layer and every (w, h) cell of the creature's footprint.
  for (let layer = 0; layer < fg.layers; layer++) {
    const base = (((phase * fg.numPatternZ * fg.numPatternY) * fg.numPatternX + dir) * fg.layers + layer) * fg.height * fg.width;

    for (let h = fg.height - 1; h >= 0; h--) {
      for (let w = fg.width - 1; w >= 0; w--) {
        const spriteId = fg.spriteIds[base + h * fg.width + w];
        if (!spriteId) continue;
        const texture = getSpriteTexture(spriteId, atlasTextures, layout);
        if (!texture) continue;

        const sprite = new Sprite(texture);
        sprite.x = (player.x - w) * TILE_SIZE;
        sprite.y = (player.y - h) * TILE_SIZE;
        container.addChild(sprite);
        drew = true;
      }
    }
  }

  return drew ? container : null;
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

    // Pixel offset applied to every cell of this item — walls and door frames
    // use it to sit flush against the tile edge, wall-mounted fixtures use it
    // to overhang properly. Reads {x, y} from dat; both default to 0.
    const displacement = thingType.attrs.get(DatAttr.Displacement);
    const dispX = (typeof displacement === 'object' && displacement && 'x' in displacement) ? displacement.x : 0;
    const dispY = (typeof displacement === 'object' && displacement && 'y' in displacement) ? displacement.y : 0;

    const { width, height, numPatternX, numPatternY, spriteIds } = thingType.frameGroup;
    // DAT sprite layout (matches OTClient reference):
    //   index = (((((phase*patZ + z)*patY + y)*patX + x)*layers + layer)*height + h)*width + w
    // For static rendering we pick phase=0, layer=0, z-pattern=0, and pick the
    // (x, y) pattern from the tile's world position. That gives cobblestone
    // and other ground tiles their natural-looking variation across a stretch
    // — the cosmetic random Tibia uses to avoid an obvious tiled grid.
    const patX = ((tile.x % numPatternX) + numPatternX) % numPatternX;
    const patY = ((tile.y % numPatternY) + numPatternY) % numPatternY;
    const patternOffset = (patY * numPatternX + patX) * height * width;

    // Iterate furthest piece first, anchor (h=0, w=0) last, so painter's-algorithm
    // ordering places the anchor on top of pieces extending up and to the left.
    for (let h = height - 1; h >= 0; h--) {
      for (let w = width - 1; w >= 0; w--) {
        const spriteId = spriteIds[patternOffset + h * width + w];
        if (!spriteId) continue;

        const texture = getTexture(spriteId);
        if (!texture) continue;

        const sprite = new Sprite(texture);
        sprite.x = screenX - w * TILE_SIZE - dispX;
        sprite.y = screenY - h * TILE_SIZE - elevation - dispY;
        container.addChild(sprite);
      }
    }

    const itemElevation = thingType.attrs.get(DatAttr.Elevation);
    if (typeof itemElevation === 'number' && itemElevation > 0) {
      elevation += itemElevation;
    }
  }
}
