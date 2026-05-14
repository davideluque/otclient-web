import type { OtbmFile, OtbmTile } from './otbm';
import type { OtbFile } from './otb';
import { OtbFlags } from './otb';

/**
 * Where a tile sends the player on step-land. Encodes the five OTB
 * floor-change flag bits as a union: up-* variants take the player to
 * z-1 (and, in classic Tibia stair geometry, also shift them one tile
 * in that compass direction on the new floor); 'down' goes to z+1
 * without a horizontal shift. Undefined on tiles that don't change
 * floors.
 */
export type FloorChange = 'down' | 'up-north' | 'up-east' | 'up-south' | 'up-west';

export interface ResolvedItem {
  clientId: number;
  count?: number;
  /** Set when this item carries an OTB FloorChange* flag. The first
   *  such item on a tile is what `getFloorChange` reports. */
  floorChange?: FloorChange;
}

export interface ResolvedTile {
  x: number;
  y: number;
  z: number;
  flags: number;
  items: ResolvedItem[];
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Spatial index for map tiles. Converts OTBM server item IDs to client IDs
 * and provides fast tile lookups by position.
 */
export class TileMap {
  private tiles = new Map<string, ResolvedTile>();
  private otb: OtbFile;
  private zBounds = new Map<number, Bounds>();

  constructor(otbm: OtbmFile, otb: OtbFile) {
    this.otb = otb;
    this.ingestTiles(otbm.tiles);
  }

  get size(): number { return this.tiles.size; }

  static key(x: number, y: number, z: number): string {
    return `${x}:${y}:${z}`;
  }

  getTile(x: number, y: number, z: number): ResolvedTile | undefined {
    return this.tiles.get(TileMap.key(x, y, z));
  }

  /** Return the bounding box for a given floor, or null if empty. */
  getBounds(z: number): Bounds | null {
    return this.zBounds.get(z) ?? null;
  }

  /**
   * Return the floor-change direction for the tile at (x, y, z), or
   * null if the tile doesn't exist or has no floor-change item. If
   * multiple items on a tile carry floor-change flags, the first one
   * wins (matches the OTBM stack order).
   */
  getFloorChange(x: number, y: number, z: number): FloorChange | null {
    const tile = this.getTile(x, y, z);
    if (!tile) return null;
    for (const item of tile.items) {
      if (item.floorChange) return item.floorChange;
    }
    return null;
  }

  /**
   * Absorb tiles from another parsed OTBM region. For position collisions
   * the new tile wins (replace). Idempotent for identical content.
   */
  merge(otbm: OtbmFile): void {
    this.ingestTiles(otbm.tiles);
  }

  /** Iterate all tiles within a rectangular region on a given floor. */
  *tilesInRegion(
    x1: number, y1: number, x2: number, y2: number, z: number,
  ): Generator<ResolvedTile> {
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const tile = this.getTile(x, y, z);
        if (tile) yield tile;
      }
    }
  }

  private ingestTiles(rawTiles: readonly OtbmTile[]): void {
    for (const tile of rawTiles) {
      const resolved = this.resolveTile(tile);
      if (resolved.items.length === 0) continue;

      const key = TileMap.key(tile.position.x, tile.position.y, tile.position.z);
      this.tiles.set(key, resolved);
      this.expandBounds(tile.position.x, tile.position.y, tile.position.z);
    }
  }

  private expandBounds(x: number, y: number, z: number): void {
    let b = this.zBounds.get(z);
    if (!b) {
      b = { minX: x, maxX: x, minY: y, maxY: y };
      this.zBounds.set(z, b);
    } else {
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y);
      b.maxY = Math.max(b.maxY, y);
    }
  }

  private resolveTile(tile: OtbmTile): ResolvedTile {
    const items: ResolvedItem[] = [];
    for (const item of tile.items) {
      const clientId = this.otb.serverToClient.get(item.id);
      if (clientId === undefined) continue;
      const flags = this.otb.serverIdToFlags.get(item.id) ?? 0;
      const resolved: ResolvedItem = { clientId, count: item.count };
      const floorChange = floorChangeFromFlags(flags);
      if (floorChange) resolved.floorChange = floorChange;
      items.push(resolved);
    }
    return {
      x: tile.position.x,
      y: tile.position.y,
      z: tile.position.z,
      flags: tile.flags,
      items,
    };
  }
}

function floorChangeFromFlags(flags: number): FloorChange | undefined {
  // Down has no horizontal component (holes / open manholes); the four
  // up-* directions also shift the player one tile compass-wise on the
  // new floor — that geometry is the consumer's job, not ours.
  if (flags & OtbFlags.FloorChangeDown) return 'down';
  if (flags & OtbFlags.FloorChangeNorth) return 'up-north';
  if (flags & OtbFlags.FloorChangeEast) return 'up-east';
  if (flags & OtbFlags.FloorChangeSouth) return 'up-south';
  if (flags & OtbFlags.FloorChangeWest) return 'up-west';
  return undefined;
}
