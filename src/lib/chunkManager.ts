import type { OtbFile } from './otb';
import { parseTilesInTileArea } from './otbmIndex';
import type { OtbmIndex, OtbmTileAreaEntry } from './otbmIndex';
import type { TileMap } from './tileMap';

const TILE_AREA_SIZE = 256;

function entryKey(entry: OtbmTileAreaEntry): string {
  return `${entry.baseX}:${entry.baseY}:${entry.baseZ}`;
}

/**
 * Lazy chunked OTBM loader. Holds the source buffer and a prebuilt index,
 * and parses individual TileArea nodes on demand into a shared TileMap.
 *
 * Chunk identity is the TileArea node's (baseX, baseY, baseZ), so the same
 * chunk is never parsed twice even when overlapping requests come in from
 * the viewport.
 */
export class ChunkManager {
  private readonly loaded = new Set<string>();
  private readonly buffer: ArrayBuffer;
  private readonly otb: OtbFile;
  private readonly index: OtbmIndex;
  private readonly tileMap: TileMap;
  // Spatial lookup keyed by `${baseZ}:${baseX}:${baseY}`. Lets ensureChunksAround
  // probe candidate aligned positions directly instead of scanning every entry,
  // which matters when the index has tens or hundreds of thousands of areas.
  private readonly lookup = new Map<string, OtbmTileAreaEntry>();

  constructor(buffer: ArrayBuffer, otb: OtbFile, index: OtbmIndex, tileMap: TileMap) {
    this.buffer = buffer;
    this.otb = otb;
    this.index = index;
    this.tileMap = tileMap;
    for (const entry of index.tileAreas) {
      this.lookup.set(`${entry.baseZ}:${entry.baseX}:${entry.baseY}`, entry);
    }
  }

  get loadedChunkCount(): number {
    return this.loaded.size;
  }

  get totalChunkCount(): number {
    return this.index.tileAreas.length;
  }

  /**
   * Ensure every TileArea node intersecting the box (centerX±radius,
   * centerY±radius) on floor z has been parsed and merged into the TileMap.
   * Returns the number of chunks newly loaded by this call.
   */
  ensureChunksAround(centerX: number, centerY: number, z: number, radius: number): number {
    const minX = centerX - radius;
    const maxX = centerX + radius;
    const minY = centerY - radius;
    const maxY = centerY + radius;

    let newlyLoaded = 0;
    const startX = Math.floor(minX / TILE_AREA_SIZE) * TILE_AREA_SIZE;
    const startY = Math.floor(minY / TILE_AREA_SIZE) * TILE_AREA_SIZE;

    for (let baseX = startX; baseX <= maxX; baseX += TILE_AREA_SIZE) {
      for (let baseY = startY; baseY <= maxY; baseY += TILE_AREA_SIZE) {
        const entry = this.lookup.get(`${z}:${baseX}:${baseY}`);
        if (!entry) continue;
        const key = entryKey(entry);
        if (this.loaded.has(key)) continue;

        const tiles = parseTilesInTileArea(this.buffer, entry);
        this.tileMap.addTiles(tiles, this.otb);
        this.loaded.add(key);
        newlyLoaded++;
      }
    }
    return newlyLoaded;
  }
}
