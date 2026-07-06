import { DatAttr } from '../dat';
import type { ThingType } from '../dat';
import type { MapTile } from '../net/common/types';
import type { FloorTileSource } from './floorVisibility';

/**
 * Cascading FullGround occlusion, the mechanism proven in the offline
 * viewer (PR #82, live in src/main.ts): a tile is hidden when any
 * shallower drawn floor has a FullGround item at the same (x, y). Only
 * FullGround qualifies — broadening to Ground hid stairs (design-doc
 * lesson c0c30cc); the black gaps it leaves at walls are correct
 * classic behavior.
 *
 * `floors` must be ordered shallow → deep (nearest the viewer first,
 * i.e. the draw-on-top floor leading). Each floor's entry in the
 * returned map is the bit-packed `(x << 16) | y` position set covered
 * by SHALLOWER floors — exactly what renderTileRegion's skipPositions
 * expects when drawing that floor.
 */
export function buildOcclusionSets(
  source: FloorTileSource,
  datIndex: Map<number, ThingType>,
  x1: number, y1: number, x2: number, y2: number,
  floors: number[],
): Map<number, Set<number>> {
  const sets = new Map<number, Set<number>>();
  const covered = new Set<number>();
  for (const z of floors) {
    // Snapshot BEFORE adding this floor's own contributions: a floor
    // never occludes itself, and a deeper floor must never occlude a
    // shallower one — sharing the mutating set did exactly that
    // (design-doc lesson e66e78c).
    sets.set(z, new Set(covered));
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const packed = (x << 16) | y;
        // Already covered by a shallower floor: adding again is a no-op,
        // so skip the tile lookup — in town floor 7 covers nearly
        // everything, making this the common case on deeper floors.
        if (covered.has(packed)) continue;
        const tile = source.getTile(x, y, z);
        if (tile && hasFullGround(tile, datIndex)) covered.add(packed);
      }
    }
  }
  return sets;
}

function hasFullGround(tile: MapTile, datIndex: Map<number, ThingType>): boolean {
  for (const item of tile.items) {
    if (datIndex.get(item.id)?.attrs.has(DatAttr.FullGround)) return true;
  }
  return false;
}
