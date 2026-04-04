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

/**
 * Spatial index for map tiles. Converts OTBM server item IDs to client IDs
 * and provides fast tile lookups by position.
 */
export class TileMap {
  private tiles = new Map<string, ResolvedTile>();
  private _minX = Infinity;
  private _minY = Infinity;
  private _maxX = -Infinity;
  private _maxY = -Infinity;

  constructor(otbm: OtbmFile, otb: OtbFile) {
    for (const tile of otbm.tiles) {
      const resolved = this.resolveTile(tile, otb);
      if (resolved.items.length === 0) continue;

      const key = TileMap.key(tile.position.x, tile.position.y, tile.position.z);
      this.tiles.set(key, resolved);

      this._minX = Math.min(this._minX, tile.position.x);
      this._minY = Math.min(this._minY, tile.position.y);
      this._maxX = Math.max(this._maxX, tile.position.x);
      this._maxY = Math.max(this._maxY, tile.position.y);
    }
  }

  get minX(): number { return this._minX; }
  get minY(): number { return this._minY; }
  get maxX(): number { return this._maxX; }
  get maxY(): number { return this._maxY; }
  get size(): number { return this.tiles.size; }

  static key(x: number, y: number, z: number): string {
    return `${x}:${y}:${z}`;
  }

  getTile(x: number, y: number, z: number): ResolvedTile | undefined {
    return this.tiles.get(TileMap.key(x, y, z));
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

  private resolveTile(tile: OtbmTile, otb: OtbFile): ResolvedTile {
    const items: ResolvedItem[] = [];
    for (const item of tile.items) {
      const clientId = otb.serverToClient.get(item.id);
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
