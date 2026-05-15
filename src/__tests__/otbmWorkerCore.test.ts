import { describe, expect, it } from 'vitest';
import { OtbAttr } from '../lib/otb';
import { OtbmAttr, OtbmNode } from '../lib/otbm';
import { buildTileMapSnapshotInWorker } from '../lib/otbmWorkerCore';
import { TileMap } from '../lib/tileMap';
import type { OTBMWorkerProgressMessage } from '../lib/otbmWorkerCore';

const NODE_START = 0xfe;
const NODE_END = 0xff;
const ESCAPE_CHAR = 0xfd;

function pushU16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function pushU32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

function escapeBytes(raw: number[]): number[] {
  const escaped: number[] = [];
  for (const b of raw) {
    if (b === NODE_START || b === NODE_END || b === ESCAPE_CHAR) {
      escaped.push(ESCAPE_CHAR, b);
    } else {
      escaped.push(b);
    }
  }
  return escaped;
}

function buildOtbRootData(): number[] {
  const raw: number[] = [];
  raw.push(0x00);
  pushU32(raw, 0);
  raw.push(0x01);
  pushU16(raw, 148);
  pushU32(raw, 0);
  pushU32(raw, 3);
  pushU32(raw, 760);
  pushU32(raw, 0);

  const csd = 'OTB 7.60';
  for (let i = 0; i < 128; i++) {
    raw.push(i < csd.length ? csd.charCodeAt(i) : 0);
  }

  return escapeBytes(raw);
}

function buildOtbItemNode(serverId: number, clientId: number): number[] {
  const raw: number[] = [];
  raw.push(0x01);
  pushU32(raw, 0);
  raw.push(OtbAttr.ServerID);
  pushU16(raw, 2);
  pushU16(raw, serverId);
  raw.push(OtbAttr.ClientID);
  pushU16(raw, 2);
  pushU16(raw, clientId);
  return [NODE_START, ...escapeBytes(raw), NODE_END];
}

function buildOtb(): ArrayBuffer {
  const bytes: number[] = [];
  pushU32(bytes, 0);
  bytes.push(NODE_START);
  bytes.push(...buildOtbRootData());
  bytes.push(...buildOtbItemNode(100, 200));
  bytes.push(NODE_END);
  return new Uint8Array(bytes).buffer;
}

function buildOtbmRootData(): number[] {
  const raw: number[] = [];
  raw.push(OtbmNode.RootV1);
  pushU32(raw, 2);
  pushU16(raw, 1024);
  pushU16(raw, 1024);
  pushU32(raw, 3);
  pushU32(raw, 760);
  return escapeBytes(raw);
}

function buildOtbm(): ArrayBuffer {
  const tileAreaRaw: number[] = [];
  tileAreaRaw.push(OtbmNode.TileArea);
  pushU16(tileAreaRaw, 10);
  pushU16(tileAreaRaw, 20);
  tileAreaRaw.push(7);

  const tileRaw: number[] = [];
  tileRaw.push(OtbmNode.Tile);
  tileRaw.push(1);
  tileRaw.push(2);
  tileRaw.push(OtbmAttr.Item);
  pushU16(tileRaw, 100);

  const mapDataRaw = [OtbmNode.MapData];
  const bytes: number[] = [];
  pushU32(bytes, 0);
  bytes.push(NODE_START);
  bytes.push(...buildOtbmRootData());
  bytes.push(
    NODE_START,
    ...escapeBytes(mapDataRaw),
    NODE_START,
    ...escapeBytes(tileAreaRaw),
    NODE_START,
    ...escapeBytes(tileRaw),
    NODE_END,
    NODE_END,
    NODE_END,
    NODE_END,
  );
  return new Uint8Array(bytes).buffer;
}

describe('buildTileMapSnapshotInWorker', () => {
  it('parses OTB/OTBM buffers and returns reconstructable TileMap data', () => {
    const progress: OTBMWorkerProgressMessage[] = [];
    const snapshot = buildTileMapSnapshotInWorker(
      {
        type: 'build-tile-map',
        otbBuffer: buildOtb(),
        otbmBuffer: buildOtbm(),
      },
      message => progress.push(message),
    );

    const tileMap = TileMap.fromSnapshot(snapshot);

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)!.stage).toBe('parsing-otbm');
    expect(tileMap.size).toBe(1);
    expect(tileMap.getTile(11, 22, 7)!.items).toEqual([{ clientId: 200, count: undefined }]);
  });
});
