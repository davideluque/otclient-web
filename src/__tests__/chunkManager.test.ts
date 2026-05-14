import { describe, it, expect } from 'vitest';
import { OtbmNode, OtbmAttr } from '../lib/otbm';
import { buildOtbmIndex } from '../lib/otbmIndex';
import { ChunkManager } from '../lib/chunkManager';
import { TileMap } from '../lib/tileMap';
import type { OtbFile } from '../lib/otb';

const NODE_START = 0xfe;
const NODE_END = 0xff;
const ESCAPE_CHAR = 0xfd;

function pushU16(b: number[], v: number) { b.push(v & 0xff, (v >> 8) & 0xff); }
function pushU32(b: number[], v: number) { b.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); }

function escapeBytes(raw: number[]): number[] {
  const out: number[] = [];
  for (const b of raw) {
    if (b === NODE_START || b === NODE_END || b === ESCAPE_CHAR) out.push(ESCAPE_CHAR, b);
    else out.push(b);
  }
  return out;
}

function buildRootData(): number[] {
  const raw: number[] = [OtbmNode.RootV1];
  pushU32(raw, 2); pushU16(raw, 1024); pushU16(raw, 1024); pushU32(raw, 3); pushU32(raw, 760);
  return escapeBytes(raw);
}

function buildTileNode(xOff: number, yOff: number, groundItemId: number): number[] {
  const raw: number[] = [OtbmNode.Tile, xOff, yOff, OtbmAttr.Item];
  pushU16(raw, groundItemId);
  return [NODE_START, ...escapeBytes(raw), NODE_END];
}

function buildTileArea(baseX: number, baseY: number, baseZ: number, tiles: number[]): number[] {
  const raw: number[] = [OtbmNode.TileArea];
  pushU16(raw, baseX); pushU16(raw, baseY); raw.push(baseZ);
  return [NODE_START, ...escapeBytes(raw), ...tiles, NODE_END];
}

function buildMapData(children: number[]): number[] {
  const raw: number[] = [OtbmNode.MapData];
  return [NODE_START, ...escapeBytes(raw), ...children, NODE_END];
}

function buildOtbm(areas: number[]): ArrayBuffer {
  const bytes: number[] = [];
  pushU32(bytes, 0);
  bytes.push(NODE_START);
  bytes.push(...buildRootData());
  bytes.push(...buildMapData(areas));
  bytes.push(NODE_END);
  return new Uint8Array(bytes).buffer;
}

function makeOtb(): OtbFile {
  return {
    version: { version: 0, majorVersion: 3, minorVersion: 760, buildNumber: 0, csdVersion: '' },
    items: [],
    serverToClient: new Map([[100, 200], [101, 201], [102, 202]]),
  };
}

function makeBuffer(): ArrayBuffer {
  const a1 = buildTileArea(0, 0, 7, [...buildTileNode(0, 0, 100)]);
  const a2 = buildTileArea(256, 0, 7, [...buildTileNode(0, 0, 101)]);
  const a3 = buildTileArea(0, 256, 7, [...buildTileNode(0, 0, 102)]);
  const a4 = buildTileArea(0, 0, 6, [...buildTileNode(0, 0, 100)]); // different floor
  return buildOtbm([...a1, ...a2, ...a3, ...a4]);
}

describe('ChunkManager', () => {
  it('loads only chunks intersecting the requested region', () => {
    const buffer = makeBuffer();
    const otb = makeOtb();
    const index = buildOtbmIndex(buffer);
    const tileMap = new TileMap({ header: index.header, tiles: [], towns: index.towns }, otb);
    const cm = new ChunkManager(buffer, otb, index, tileMap);

    // The (0,0) area on floor 7 covers (0..255, 0..255).
    const loaded = cm.ensureChunksAround(50, 50, 7, 10);
    expect(loaded).toBe(1);
    expect(cm.loadedChunkCount).toBe(1);
    expect(tileMap.getTile(0, 0, 7)?.items[0].clientId).toBe(200);
  });

  it('is idempotent on repeated overlapping requests', () => {
    const buffer = makeBuffer();
    const otb = makeOtb();
    const index = buildOtbmIndex(buffer);
    const tileMap = new TileMap({ header: index.header, tiles: [], towns: index.towns }, otb);
    const cm = new ChunkManager(buffer, otb, index, tileMap);

    cm.ensureChunksAround(50, 50, 7, 10);
    const second = cm.ensureChunksAround(60, 60, 7, 10);
    expect(second).toBe(0);
    expect(cm.loadedChunkCount).toBe(1);
  });

  it('loads multiple chunks when the region spans area boundaries', () => {
    const buffer = makeBuffer();
    const otb = makeOtb();
    const index = buildOtbmIndex(buffer);
    const tileMap = new TileMap({ header: index.header, tiles: [], towns: index.towns }, otb);
    const cm = new ChunkManager(buffer, otb, index, tileMap);

    // Center between three chunks on floor 7 with a generous radius.
    const loaded = cm.ensureChunksAround(200, 200, 7, 200);
    expect(loaded).toBe(3);
    expect(cm.loadedChunkCount).toBe(3);
  });

  it('does not load chunks on a different floor', () => {
    const buffer = makeBuffer();
    const otb = makeOtb();
    const index = buildOtbmIndex(buffer);
    const tileMap = new TileMap({ header: index.header, tiles: [], towns: index.towns }, otb);
    const cm = new ChunkManager(buffer, otb, index, tileMap);

    cm.ensureChunksAround(0, 0, 7, 50);
    expect(tileMap.getTile(0, 0, 6)).toBeUndefined();
    expect(cm.loadedChunkCount).toBe(1);
  });

  it('reports the total chunk count from the index', () => {
    const buffer = makeBuffer();
    const otb = makeOtb();
    const index = buildOtbmIndex(buffer);
    const tileMap = new TileMap({ header: index.header, tiles: [], towns: index.towns }, otb);
    const cm = new ChunkManager(buffer, otb, index, tileMap);

    expect(cm.totalChunkCount).toBe(4);
  });
});
