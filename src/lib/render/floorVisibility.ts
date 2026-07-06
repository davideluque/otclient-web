import { DatAttr } from '../dat';
import type { ThingType } from '../dat';
import type { MapTile } from '../net/common/types';

/**
 * Floor visibility rules: which z-range to draw, and the roof probe that
 * hides floors above the player when indoors. Ported from the roof-culling
 * PoC (PR #111) and upgraded to the full OTClient algorithm
 * (MapView::calcFirstVisibleFloor + Tile::limitsFloorsView), per
 * design/multifloor.md.
 *
 * Convention: z=0 is the highest floor (sky), z=7 the ground surface,
 * z=15 the deepest underground — "upward" means decreasing z.
 *
 * Pure: no DOM / Pixi state touched. Safe to call from anywhere and
 * trivial to unit-test.
 */

/** Ground surface floor — the deepest floor drawn above ground. */
export const SEA_FLOOR = 7;

/** Deepest floor the protocol can address. */
export const MAX_FLOOR = 15;

/** Underground the server sends (and the client may draw) z±2 floors. */
const UNDERGROUND_RANGE = 2;

/**
 * Minimal tile lookup the visibility rules need. GameWorld satisfies it
 * directly; tests can back it with a plain Map.
 */
export interface FloorTileSource {
  getTile(x: number, y: number, z: number): MapTile | undefined;
}

export interface DrawRange {
  /** Shallowest floor that may be drawn — the roof probe never goes above it. */
  base: number;
  /** Deepest floor to draw (floors below the player). */
  last: number;
}

/**
 * The drawable z-range around a player floor. Above ground the whole
 * surface stack 0..7 is in play; underground only the z±2 window the
 * server describes (the surface floors received at z=8 are stored but
 * never drawn underground).
 */
export function drawRange(playerZ: number): DrawRange {
  if (playerZ <= SEA_FLOOR) return { base: 0, last: SEA_FLOOR };
  return {
    base: Math.max(playerZ - UNDERGROUND_RANGE, SEA_FLOOR + 1),
    last: Math.min(playerZ + UNDERGROUND_RANGE, MAX_FLOOR),
  };
}

/** Sight passes through a position: the tile exists and nothing on it blocks projectiles. */
function isLookPossible(
  source: FloorTileSource,
  datIndex: Map<number, ThingType>,
  x: number,
  y: number,
  z: number,
): boolean {
  const tile = source.getTile(x, y, z);
  if (!tile) return false;
  for (const item of tile.items) {
    if (datIndex.get(item.id)?.attrs.has(DatAttr.BlockProjectile)) return false;
  }
  return true;
}

/**
 * Does this tile cut off the view of the floors above it? The first
 * stack thing must be an item (creatures never roof anything), must not
 * be DontHide, and must be Ground — or OnBottom, which only counts
 * unconditionally under freeView; otherwise it must also block
 * projectiles (an archway floor lets the view through, a solid one
 * doesn't).
 */
function limitsFloorsView(
  tile: MapTile,
  datIndex: Map<number, ThingType>,
  freeView: boolean,
): boolean {
  const first = tile.things[0];
  if (!first || first.kind !== 'item') return false;
  const thing = datIndex.get(first.item.id);
  if (!thing || thing.attrs.has(DatAttr.DontHide)) return false;
  if (thing.attrs.has(DatAttr.Ground)) return true;
  if (!thing.attrs.has(DatAttr.OnBottom)) return false;
  return freeView || thing.attrs.has(DatAttr.BlockProjectile);
}

/** Camera tile plus the 4 orthogonal neighbors — diagonals are never probed. */
const PROBE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0, -1], [1, 0], [0, 1], [-1, 0],
];

/**
 * The shallowest floor that should still render: walk upward from each
 * probed position and stop at the deepest tile that covers it — cover at
 * z=R hides R and everything above, so the first visible floor is R+1.
 * No cover anywhere returns drawRange().base.
 *
 * Each probe climbs two chains in lockstep: physically above (0,0,−1)
 * and the 2.5D perspective diagonal (+1,+1,−1) whose sprites visually
 * overlap the probed tile.
 */
export function calcFirstVisibleFloor(
  source: FloorTileSource,
  datIndex: Map<number, ThingType>,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
): number {
  const { base } = drawRange(cameraZ);
  let firstFloor = base;

  for (const [dx, dy] of PROBE_OFFSETS) {
    const px = cameraX + dx;
    const py = cameraY + dy;
    const lookPossible = isLookPossible(source, datIndex, px, py, cameraZ);
    // The camera tile is always probed; neighbors only when sight can
    // reach them — a wall next door must not leak its roof state in.
    if ((dx !== 0 || dy !== 0) && !lookPossible) continue;

    // z >= firstFloor (not base): cover above the running max can only
    // yield a candidate the max already beats, so skip the climb there.
    for (let z = cameraZ - 1; z >= firstFloor; z--) {
      const climbed = cameraZ - z;
      const upper = source.getTile(px, py, z);
      if (upper && limitsFloorsView(upper, datIndex, !lookPossible)) {
        firstFloor = z + 1;
        break;
      }
      const covered = source.getTile(px + climbed, py + climbed, z);
      if (covered && limitsFloorsView(covered, datIndex, lookPossible)) {
        firstFloor = z + 1;
        break;
      }
    }
  }

  return Math.min(firstFloor, cameraZ);
}

/**
 * First visible floor for a glide between two tiles: the more-covered
 * endpoint wins, so a roof doesn't blink back in for the half-step where
 * only one endpoint is indoors (design doc anti-flicker rule, PoC commit
 * fabe172).
 */
export function firstVisibleFloorForGlide(
  source: FloorTileSource,
  datIndex: Map<number, ThingType>,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  z: number,
): number {
  return Math.max(
    calcFirstVisibleFloor(source, datIndex, fromX, fromY, z),
    calcFirstVisibleFloor(source, datIndex, toX, toY, z),
  );
}
