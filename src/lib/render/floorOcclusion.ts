import { DatAttr } from '../dat';
import type { ThingType } from '../dat';
import type { MapTile } from '../net/common/types';
import type { FloorTileSource } from './floorVisibility';
import { tilePositionKey } from '../../constants';

/**
 * Cascading FullGround occlusion in SCREEN space: a tile is hidden when
 * shallower drawn floors put FullGround on every screen cell its sprites
 * touch. Screen cells follow the classic per-floor perspective
 * (floorStack.floorLayerOffset): a tile at world (x, y) on floor z
 * occupies screen cell (x + dz, y + dz) with dz = z − cameraZ, so the
 * cell covering a below tile belongs to the world position one
 * north-west of it per level — matching OTClient's coveredUp
 * (x+n, y+n, z−n) read in the other direction.
 *
 * Only FullGround qualifies — broadening to Ground hid stairs
 * (design-doc lesson c0c30cc); the black gaps it leaves at walls are
 * correct classic behavior.
 *
 * Big sprites: an item wider/taller than one tile (64×64 stairs,
 * ladders under stairwell openings) paints up-left of its anchor, so
 * the anchor cell being covered is NOT enough to skip the tile — every
 * screen cell any of its items reach must be covered, or the sprite's
 * visible corner would vanish with it (the original "stair frame with
 * empty centre" misdiagnosis, design-doc lesson 988f86d/NDIT-204).
 *
 * `floors` must be ordered shallow → deep (nearest the viewer first).
 * Each floor's entry in the returned map is the set of that floor's OWN
 * tile positions (world-keyed, matching renderTileRegion's
 * skipPositions) that are fully covered by shallower floors.
 */
export function buildOcclusionSets(
  source: FloorTileSource,
  datIndex: Map<number, ThingType>,
  x1: number, y1: number, x2: number, y2: number,
  floors: number[],
  cameraZ: number,
): Map<number, Set<number>> {
  const sets = new Map<number, Set<number>>();
  // Screen cells covered by the floors processed so far (shallower ones).
  const covered = new Set<number>();
  for (const z of floors) {
    const dz = z - cameraZ;
    // Collect this floor's fully-covered tiles BEFORE adding its own
    // contributions: a floor never occludes itself, and a deeper floor
    // must never occlude a shallower one (design-doc lesson e66e78c).
    const skip = new Set<number>();
    if (covered.size > 0) {
      for (let sy = y1; sy <= y2; sy++) {
        for (let sx = x1; sx <= x2; sx++) {
          // The world tile of THIS floor occupying screen cell (sx, sy).
          if (!covered.has(tilePositionKey(sx, sy))) continue;
          const tile = source.getTile(sx - dz, sy - dz, z);
          if (tile && allSpriteCellsCovered(tile, datIndex, covered, sx, sy)) {
            skip.add(tilePositionKey(sx - dz, sy - dz));
          }
        }
      }
    }
    sets.set(z, skip);
    for (let sy = y1; sy <= y2; sy++) {
      for (let sx = x1; sx <= x2; sx++) {
        const cell = tilePositionKey(sx, sy);
        // Already covered by a shallower floor: adding again is a no-op,
        // so skip the tile lookup — in town floor 7 covers nearly
        // everything, making this the common case on deeper floors.
        if (covered.has(cell)) continue;
        const tile = source.getTile(sx - dz, sy - dz, z);
        if (tile && hasFullGround(tile, datIndex)) covered.add(cell);
      }
    }
  }
  return sets;
}

/**
 * True when every screen cell any of the tile's item sprites paint —
 * anchor plus the up-left extent of >1-tile frames — is covered.
 */
function allSpriteCellsCovered(
  tile: MapTile,
  datIndex: Map<number, ThingType>,
  covered: Set<number>,
  sx: number, sy: number,
): boolean {
  for (const item of tile.items) {
    const frame = datIndex.get(item.id)?.frameGroup;
    const w = frame?.width ?? 1;
    const h = frame?.height ?? 1;
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        if (!covered.has(tilePositionKey(sx - i, sy - j))) return false;
      }
    }
  }
  return true;
}

function hasFullGround(tile: MapTile, datIndex: Map<number, ThingType>): boolean {
  for (const item of tile.items) {
    if (datIndex.get(item.id)?.attrs.has(DatAttr.FullGround)) return true;
  }
  return false;
}
