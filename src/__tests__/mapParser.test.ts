import { describe, it, expect } from 'vitest';
import { parseMapDescription } from '../lib/net/7.6/mapParser';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';

function pushSkipMarker(out: OutputPacket, skipCount: number) {
  out.addU8(0xff);
  out.addU8(0xff);
  out.addU16(skipCount);
}

describe('parseMapDescription', () => {
  it('parses a single tile with one item', () => {
    const out = new OutputPacket();
    out.addU16(100); // item ID
    pushSkipMarker(out, 0); // end of this tile, skip 0

    const tiles = parseMapDescription(
      new InputPacket(out.toArrayBuffer()),
      10, 10, 10, 10, 7,
    );

    expect(tiles).toHaveLength(1);
    expect(tiles[0].x).toBe(10);
    expect(tiles[0].y).toBe(10);
    expect(tiles[0].z).toBe(7);
    expect(tiles[0].items).toHaveLength(1);
    expect(tiles[0].items[0].id).toBe(100);
  });

  it('parses multiple items on a tile', () => {
    const out = new OutputPacket();
    out.addU16(100); // ground
    out.addU16(200); // item on top
    out.addU16(300); // another item
    pushSkipMarker(out, 0);

    const tiles = parseMapDescription(
      new InputPacket(out.toArrayBuffer()),
      5, 5, 5, 5, 7,
    );

    expect(tiles[0].items).toHaveLength(3);
    expect(tiles[0].items.map(i => i.id)).toEqual([100, 200, 300]);
  });

  it('handles skip markers to skip empty tiles', () => {
    const out = new OutputPacket();
    // First tile: 1 item, skip next 2 tiles
    out.addU16(100);
    pushSkipMarker(out, 2);
    // After skipping 2, fourth tile has an item
    out.addU16(200);
    pushSkipMarker(out, 0);

    const tiles = parseMapDescription(
      new InputPacket(out.toArrayBuffer()),
      0, 0, 3, 0, 7,
    );

    expect(tiles).toHaveLength(2);
    expect(tiles[0].x).toBe(0);
    expect(tiles[0].items[0].id).toBe(100);
    expect(tiles[1].x).toBe(3);
    expect(tiles[1].items[0].id).toBe(200);
  });

  it('parses an unknown creature', () => {
    const out = new OutputPacket();
    out.addU16(100); // ground item

    // Unknown creature marker
    out.addU16(0x0062);
    out.addU32(0); // removeKnown
    out.addU32(12345); // creature ID
    out.addString('Player1');
    out.addU8(100); // health
    out.addU8(2); // direction (south)
    out.addU16(128); // lookType
    out.addU8(10); // head color
    out.addU8(20); // body color
    out.addU8(30); // legs color
    out.addU8(40); // feet color
    out.addU8(0); // light level
    out.addU8(0); // light color
    out.addU16(220); // speed
    out.addU8(0); // skull
    out.addU8(0); // shield

    pushSkipMarker(out, 0);

    const tiles = parseMapDescription(
      new InputPacket(out.toArrayBuffer()),
      10, 10, 10, 10, 7,
    );

    expect(tiles).toHaveLength(1);
    expect(tiles[0].creatures).toHaveLength(1);
    const creature = tiles[0].creatures[0];
    expect(creature.id).toBe(12345);
    expect(creature.name).toBe('Player1');
    expect(creature.health).toBe(100);
    expect(creature.direction).toBe(2);
    expect(creature.outfit.lookType).toBe(128);
    expect(creature.speed).toBe(220);
  });

  it('handles empty area (all skipped)', () => {
    const out = new OutputPacket();
    pushSkipMarker(out, 3); // skip all 4 tiles (current + 3)

    const tiles = parseMapDescription(
      new InputPacket(out.toArrayBuffer()),
      0, 0, 1, 1, 7,
    );

    expect(tiles).toHaveLength(0);
  });
});
