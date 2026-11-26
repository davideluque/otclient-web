import { describe, expect, it } from 'vitest';
import { buildAutoWalkPacket, buildMovePacket } from '../../lib/net/7.6/movementProtocol';

describe('buildAutoWalkPacket', () => {
  it('encodes all eight server autowalk direction bytes', () => {
    const bytes = [...buildAutoWalkPacket([0, 1, 2, 3, 4, 5, 6, 7]).toUint8Array()];
    expect(bytes).toEqual([0x64, 8, 3, 1, 7, 5, 2, 8, 6, 4]);
  });

  it('encodes the four diagonal single-step opcodes', () => {
    expect([4, 5, 6, 7].map((dir) => buildMovePacket(dir as 4 | 5 | 6 | 7).toUint8Array()[0]))
      .toEqual([0x6a, 0x6b, 0x6c, 0x6d]);
  });

  it('caps the route at the U8 count limit', () => {
    const route = Array.from({ length: 300 }, () => 1 as const);
    const bytes = [...buildAutoWalkPacket(route).toUint8Array()];
    expect(bytes[1]).toBe(255);
    expect(bytes.length).toBe(2 + 255);
  });
});
