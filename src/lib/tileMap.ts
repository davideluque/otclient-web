import type { OtbmFile, OtbmTile } from './otbm';
import type { OtbFile } from './otb';

export interface ResolvedItem {
  clientId: number;
  count?: number;
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
      if (clientId !== undefined) {
        items.push({ clientId, count: item.count });
      }
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
