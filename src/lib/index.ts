// Asset pipeline
export { parseDat } from './dat';
export type { DatFile, ThingType, FrameGroup, Light, MarketData } from './dat';
export { DatAttr, ThingCategory, ITEM_ID_OFFSET } from './dat';

export { parseSpr, decodeSprite, releaseSprBuffer, SPRITE_SIZE, SPRITE_PIXELS, SPRITE_DATA_SIZE } from './spr';
export type { SprFile } from './spr';

export { buildAtlasPages, collectReferencedSpriteIds, computeAtlasLayout, ATLAS_SIZE, SPRITES_PER_ROW, SPRITES_PER_PAGE } from './atlas';
export type { AtlasPages, SpriteLocation } from './atlas';

// Map file parsers
export { parseOtb } from './otb';
export type { OtbFile, OtbItem, OtbVersion } from './otb';
export { OtbAttr, OtbFlags } from './otb';

export { parseOtbm, parseOtbmRegion } from './otbm';
export type { OtbmFile, OtbmTile, OtbmItem, OtbmTown, OtbmHeader, OtbmRegion, Position } from './otbm';
export { OtbmNode, OtbmAttr } from './otbm';

// Rendering
export { TileMap } from './tileMap';
export type { ResolvedTile, ResolvedItem } from './tileMap';

export { createAtlasTextures, getSpriteTexture, buildDatIndex, renderTileRegion, renderPlayer } from './tileRenderer';
export type { AtlasTextures, TintedTextureCache } from './tileRenderer';

export { outfitIndexToRgb } from './outfitColors';
export type { OutfitRGB } from './outfitColors';

export { tintOutfitSprite, extractSpritePixels } from './outfitTint';
export type { OutfitColorIndices } from './outfitTint';

export {
  Viewport,
  computePlayZoom,
  PORTRAIT_PLAY_TILES_X,
  LANDSCAPE_PLAY_TILES_X,
} from './viewport';
export type { ViewRect } from './viewport';

// Player & movement
export { createPlayer, getCreatureSpriteId, buildCreatureIndex } from './player';
export type { PlayerState, Outfit } from './player';
export { Direction } from './player';

export { screenToTile, directionTo, stepInDirection } from './input';
export type { TileCoord } from './input';

export { findPath, isTileWalkable } from './pathfinding';
export type { PathNode } from './pathfinding';

export { startWalk, updateWalk, WALK_DURATION_MS } from './walkAnimation';
export type { WalkState } from './walkAnimation';

// Game world
export { GameWorld } from './GameWorld';
export type { WorldCreature } from './GameWorld';

export { initCreatureRenderer, updateCreatures, cleanupCreatures } from './creatureRenderer';
export type { CreatureRenderState } from './creatureRenderer';

// Shared utilities
export { BinaryReader } from './BinaryReader';
export { readNodeData, skipNode, NODE_START, NODE_END, ESCAPE_CHAR } from './nodeTree';
