import type { Pixel } from './lib/types';

export const TILE_SIZE: Pixel = 32;

/**
 * Bit-packed set key for a tile coordinate — the shared contract between
 * buildOcclusionSets and renderTileRegion's skipPositions. Assumes map
 * coordinates in [0, 0xFFFF] (they arrive as wire U16s); values outside
 * that range would collide or go negative.
 */
export function tilePositionKey(x: number, y: number): number {
  return (x << 16) | y;
}
