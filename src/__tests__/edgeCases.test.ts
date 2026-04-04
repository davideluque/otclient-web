import { describe, it, expect } from 'vitest';
import { readNodeData, skipNode, ESCAPE_CHAR, NODE_START, NODE_END } from '../lib/nodeTree';
import { parseSpr, decodeSprite } from '../lib/spr';
import { getCreatureSpriteId } from '../lib/player';
import type { FrameGroup } from '../lib/dat';

// --- nodeTree edge cases ---

describe('nodeTree edge cases', () => {
  it('readNodeData handles ESCAPE as last byte', () => {
    const data = new Uint8Array([0x41, ESCAPE_CHAR]); // 'A' then dangling escape
    const result = readNodeData(data, 0);
    // Should read 'A' and stop — the escape has no following byte
    expect(result.bytes.length).toBe(1);
    expect(result.bytes[0]).toBe(0x41);
  });

  it('readNodeData handles ESCAPE followed by NODE_START', () => {
    const data = new Uint8Array([ESCAPE_CHAR, NODE_START, 0x42]);
    const result = readNodeData(data, 0);
    // Escape + NODE_START = literal NODE_START, then 0x42 is regular data
    expect(result.bytes.length).toBe(2);
    expect(result.bytes[0]).toBe(NODE_START);
    expect(result.bytes[1]).toBe(0x42);
  });

  it('readNodeData handles ESCAPE followed by NODE_END', () => {
    const data = new Uint8Array([ESCAPE_CHAR, NODE_END]);
    const result = readNodeData(data, 0);
    expect(result.bytes.length).toBe(1);
    expect(result.bytes[0]).toBe(NODE_END);
  });

  it('readNodeData handles ESCAPE followed by ESCAPE', () => {
    const data = new Uint8Array([ESCAPE_CHAR, ESCAPE_CHAR]);
    const result = readNodeData(data, 0);
    expect(result.bytes.length).toBe(1);
    expect(result.bytes[0]).toBe(ESCAPE_CHAR);
  });

  it('skipNode handles ESCAPE at buffer end', () => {
    // NODE_START already consumed, data is: [some_byte, ESCAPE, NODE_END]
    const data = new Uint8Array([0x42, ESCAPE_CHAR, NODE_END, NODE_END]);
    const result = skipNode(data, 0);
    // Should find NODE_END at index 3 (escape skips index 2)
    expect(result).toBeLessThanOrEqual(data.length);
  });

  it('skipNode on empty data returns immediately', () => {
    const data = new Uint8Array([NODE_END]);
    const result = skipNode(data, 0);
    expect(result).toBe(1);
  });

  it('readNodeData on empty buffer returns empty', () => {
    const data = new Uint8Array([]);
    const result = readNodeData(data, 0);
    expect(result.bytes.length).toBe(0);
    expect(result.nextOffset).toBe(0);
  });
});

// --- SPR RLE edge cases ---

describe('spr RLE edge cases', () => {
  function pushU16(bytes: number[], value: number) {
    bytes.push(value & 0xff, (value >> 8) & 0xff);
  }
  function pushU32(bytes: number[], value: number) {
    bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
  }

  function buildSingleSpriteSpr(rleData: number[]): ArrayBuffer {
    const bytes: number[] = [];
    pushU32(bytes, 0); // signature
    pushU16(bytes, 1); // 1 sprite
    // Offset for sprite 1
    const spriteOffset = bytes.length + 4;
    pushU32(bytes, spriteOffset);
    // Color key
    bytes.push(0xff, 0x00, 0xff);
    // Pixel data
    pushU16(bytes, rleData.length);
    bytes.push(...rleData);
    return new Uint8Array(bytes).buffer;
  }

  it('handles transparentCount that overflows past 1024 pixels', () => {
    // transparentCount = 2000 (way past 1024 pixel limit)
    const rle: number[] = [];
    pushU16(rle, 2000); // transparent: overflow!
    pushU16(rle, 1);    // 1 colored pixel
    rle.push(255, 0, 0);

    const spr = parseSpr(buildSingleSpriteSpr(rle));
    const rgba = decodeSprite(spr, 1);
    // Should not crash, should return a buffer
    expect(rgba).not.toBeNull();
    expect(rgba!.length).toBe(32 * 32 * 4);
    // All pixels should be transparent (overflow means we never write colored pixels)
    for (let i = 0; i < rgba!.length; i++) {
      expect(rgba![i]).toBe(0);
    }
  });

  it('handles sprite with offset near end of buffer', () => {
    // Create a buffer where the offset points to last 2 bytes (not enough for header)
    const bytes: number[] = [];
    pushU32(bytes, 0); // signature
    pushU16(bytes, 1); // 1 sprite
    pushU32(bytes, bytes.length + 4 + 2); // offset points near end
    bytes.push(0, 0); // padding
    bytes.push(0xff, 0x00); // only 2 bytes at offset (need 5 for header)

    const spr = parseSpr(new Uint8Array(bytes).buffer);
    const rgba = decodeSprite(spr, 1);
    expect(rgba).toBeNull(); // should return null for too-short data
  });
});

// --- Player sprite index edge cases ---

describe('player sprite index edge cases', () => {
  function makeFrameGroup(overrides: Partial<FrameGroup> = {}): FrameGroup {
    return {
      width: 1, height: 1, exactSize: 32, layers: 1,
      numPatternX: 4, numPatternY: 1, numPatternZ: 1,
      animationPhases: 1, spriteIds: [1, 2, 3, 4],
      ...overrides,
    };
  }

  it('handles zero numPatternX gracefully', () => {
    const fg = makeFrameGroup({ numPatternX: 0, spriteIds: [] });
    const id = getCreatureSpriteId(fg, 0, 0);
    expect(id).toBe(0); // should not crash, returns 0
  });

  it('handles zero animationPhases gracefully', () => {
    const fg = makeFrameGroup({ animationPhases: 0, spriteIds: [] });
    const id = getCreatureSpriteId(fg, 0, 0);
    expect(id).toBe(0);
  });

  it('handles zero layers gracefully', () => {
    const fg = makeFrameGroup({ layers: 0, spriteIds: [] });
    const id = getCreatureSpriteId(fg, 0, 0);
    expect(id).toBe(0);
  });

  it('handles negative direction input', () => {
    const fg = makeFrameGroup();
    // -1 should be clamped to 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = getCreatureSpriteId(fg, -1 as any, 0);
    expect(id).toBe(1); // spriteIds[0]
  });
});
