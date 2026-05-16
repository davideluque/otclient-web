import { describe, it, expect } from 'vitest';
import { parseMapDescription, parsePosition } from '../lib/net/7.6/mapParser';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';

/**
 * Helper: write a canonical 7.6 tile-slot terminator — a single U16 with
 * high byte 0xFF and low byte = number of subsequent empty tiles to skip.
 */
function pushSkipMarker(out: OutputPacket, skipCount: number) {
  out.addU8(skipCount & 0xff);
  out.addU8(0xff);
}

/** Helper: build a deterministic non-empty tile slot containing one item. */
function pushItemTile(out: OutputPacket, itemId: number, skipAfter = 0) {
  out.addU16(itemId);
  pushSkipMarker(out, skipAfter);
}

/** Helper: fill an entire 8-floor area (1×1×8) with skip markers. */
function fillEmptyFloors(out: OutputPacket, floorCount: number) {
  // Each floor is one tile (the area is 1×1), so each floor needs its own
  // skip marker (count=0). The skip counter does NOT carry across separate
  // empty-slot markers — it only carries within a marker's count value.
  for (let i = 0; i < floorCount; i++) pushSkipMarker(out, 0);
}

describe('parsePosition', () => {
  it('reads the 5-byte position prefix', () => {
    const out = new OutputPacket();
    out.addU16(32060);
    out.addU16(32192);
    out.addU8(7);

    const pos = parsePosition(new InputPacket(out.toArrayBuffer()));
    expect(pos).toEqual({ x: 32060, y: 32192, z: 7 });
  });
});

describe('parseMapDescription', () => {
  it('parses a single tile with one item (1×1 area, player at z=7)', () => {
    const out = new OutputPacket();
    pushItemTile(out, 100);
    // Fill the remaining 7 floors (above-ground player sees 8 floors total).
    fillEmptyFloors(out, 7);

    const tiles = parseMapDescription(
      new InputPacket(out.toArrayBuffer()),
      10, 10, 10, 10, 7,
    );

    // Only the first floor (z=7) had an item.
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
    pushSkipMarker(out, 0); // close the slot
    fillEmptyFloors(out, 7); // remaining floors

    const tiles = parseMapDescription(
      new InputPacket(out.toArrayBuffer()),
      5, 5, 5, 5, 7,
    );

    expect(tiles[0].items).toHaveLength(3);
    expect(tiles[0].items.map(i => i.id)).toEqual([100, 200, 300]);
  });

  it('skip count from a non-empty slot skips the next N tiles within a floor', () => {
    // 4 tile slots (1 row × 4 cols), all on the same floor (z=7).
    // Tile 0: 1 item, skip-marker carries skipAfter=2 (skip slots 1 and 2).
    // Tile 3: 1 item, skip-marker close.
    // Then 7 more floors are empty.
    const out = new OutputPacket();
    pushItemTile(out, 100, /* skipAfter */ 2);
    pushItemTile(out, 200, /* skipAfter */ 0);
    fillEmptyFloors(out, 7);

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

  it('parses an unknown creature on a tile', () => {
    const out = new OutputPacket();
    out.addU16(100); // ground item

    // Unknown creature marker + creature data
    out.addU16(0x0062);
    out.addU32(0);       // removeKnown
    out.addU32(12345);   // creature ID
    out.addString('Player1');
    out.addU8(100);      // health
    out.addU8(2);        // direction
    out.addU16(128);     // lookType
    out.addU8(10); out.addU8(20); out.addU8(30); out.addU8(40); // outfit colors
    out.addU8(0); out.addU8(0); // light level + color
    out.addU16(220);     // speed
    out.addU8(0); out.addU8(0); // skull + shield

    pushSkipMarker(out, 0);
    fillEmptyFloors(out, 7);

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

  it('handles a single skip marker spanning multiple empty tiles within a floor', () => {
    // 4 tiles on z=7, all empty. One skip marker with count=3 covers the
    // current slot + 3 more. Then 7 empty floors.
    const out = new OutputPacket();
    pushSkipMarker(out, 3); // 1 + 3 = 4 tiles skipped on z=7
    fillEmptyFloors(out, 7);

    const tiles = parseMapDescription(
      new InputPacket(out.toArrayBuffer()),
      0, 0, 1, 1, 7,
    );

    expect(tiles).toHaveLength(0);
  });

  it('iterates 8 floors descending for above-ground players (z=7..0)', () => {
    // 1×1 area, 8 floors. Put a distinct item ID on each floor so we can
    // verify both that all 8 were parsed AND that they came out in the
    // expected descending order.
    const out = new OutputPacket();
    for (let i = 0; i < 8; i++) pushItemTile(out, 1000 + i);

    const tiles = parseMapDescription(
      new InputPacket(out.toArrayBuffer()),
      0, 0, 0, 0, 7,
    );

    expect(tiles).toHaveLength(8);
    expect(tiles.map(t => t.z)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(tiles.map(t => t.items[0].id)).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007]);
  });

  it('iterates 5 floors ascending for underground players (z-2..z+2)', () => {
    // Player at z=10 → server sends floors z=8, 9, 10, 11, 12.
    const out = new OutputPacket();
    for (let i = 0; i < 5; i++) pushItemTile(out, 2000 + i);

    const tiles = parseMapDescription(
      new InputPacket(out.toArrayBuffer()),
      0, 0, 0, 0, 10,
    );

    expect(tiles).toHaveLength(5);
    expect(tiles.map(t => t.z)).toEqual([8, 9, 10, 11, 12]);
  });
});
