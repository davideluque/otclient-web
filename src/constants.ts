import type { Pixel } from './lib/types';

export const TILE_SIZE: Pixel = 32;

export function tilePositionKey(x: number, y: number): number {
  return (x << 16) | y;
}
