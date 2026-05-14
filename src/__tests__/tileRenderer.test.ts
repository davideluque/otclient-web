import { describe, it, expect } from 'vitest';
import { spriteIndex } from '../lib/tileRenderer';
import type { FrameGroup } from '../lib/dat';

function makeFg(overrides: Partial<FrameGroup>): FrameGroup {
  return {
    width: 1,
    height: 1,
    exactSize: 32,
    layers: 1,
    numPatternX: 1,
    numPatternY: 1,
    numPatternZ: 1,
    animationPhases: 1,
    spriteIds: [],
    ...overrides,
  };
}

describe('spriteIndex', () => {
  it('returns 0 for the trivial all-zero frame', () => {
    expect(spriteIndex(makeFg({}), 0, 0, 0, 0, 0, 0)).toBe(0);
  });

  it('steps by 1 for adjacent w within a row', () => {
    const fg = makeFg({ width: 4 });
    expect(spriteIndex(fg, 0, 0, 0, 0, 0, 0)).toBe(0);
    expect(spriteIndex(fg, 0, 0, 0, 0, 0, 1)).toBe(1);
    expect(spriteIndex(fg, 0, 0, 0, 0, 0, 3)).toBe(3);
  });

  it('steps by width for adjacent h', () => {
    const fg = makeFg({ width: 4, height: 3 });
    expect(spriteIndex(fg, 0, 0, 0, 0, 1, 0)).toBe(4);
    expect(spriteIndex(fg, 0, 0, 0, 0, 2, 3)).toBe(11);
  });

  it('multiplies by layers — the bug that motivated extracting this helper', () => {
    // layers=2: layer 1 must skip past the whole height*width block of layer 0.
    const fg = makeFg({ width: 2, height: 2, layers: 2 });
    expect(spriteIndex(fg, 0, 0, 0, 0, 0, 0)).toBe(0); // layer 0, top-left
    expect(spriteIndex(fg, 0, 0, 0, 1, 0, 0)).toBe(4); // layer 1, top-left — skip 4 = h*w of layer 0
    expect(spriteIndex(fg, 0, 0, 0, 1, 1, 1)).toBe(7);
  });

  it('steps through x-pattern variants', () => {
    // 4 directions × 1 layer × 1×1: each direction is one sprite index.
    const fg = makeFg({ numPatternX: 4 });
    expect(spriteIndex(fg, 0, 0, 0, 0, 0, 0)).toBe(0); // North-style
    expect(spriteIndex(fg, 0, 1, 0, 0, 0, 0)).toBe(1);
    expect(spriteIndex(fg, 0, 3, 0, 0, 0, 0)).toBe(3);
  });

  it('steps through y-pattern variants', () => {
    // 4 directions × 3 y-variants: y-variant adds numPatternX worth.
    const fg = makeFg({ numPatternX: 4, numPatternY: 3 });
    expect(spriteIndex(fg, 0, 0, 0, 0, 0, 0)).toBe(0);
    expect(spriteIndex(fg, 0, 0, 1, 0, 0, 0)).toBe(4); // y=1 → +numPatternX
    expect(spriteIndex(fg, 0, 2, 2, 0, 0, 0)).toBe(10); // y=2 + x=2 → 2*4 + 2
  });

  it('animation phase strides past the full pattern×layer×size block', () => {
    // 2 phases × 4 directions × 2 layers × 1×1 = 16 entries.
    // Phase 1 starts at index 8.
    const fg = makeFg({ numPatternX: 4, layers: 2, animationPhases: 2 });
    expect(spriteIndex(fg, 0, 0, 0, 0, 0, 0)).toBe(0);
    expect(spriteIndex(fg, 1, 0, 0, 0, 0, 0)).toBe(8);
    expect(spriteIndex(fg, 1, 3, 0, 1, 0, 0)).toBe(8 + 3 * 2 + 1); // 15
  });

  it('matches a real-creature index by hand calculation', () => {
    // Citizen-like: 1 phase pattern, 4 directions, 2 layers (base + mask),
    // 3 animation phases (idle, walk-A, walk-B), single-tile sprite.
    const fg = makeFg({ numPatternX: 4, layers: 2, animationPhases: 3 });
    // phase=2, dir=1 (east), patY=0, layer=1 (mask), h=0, w=0
    // ((((2*1)*1 + 0)*4 + 1)*2 + 1)*1 + 0)*1 + 0
    //   = ((2*4 + 1)*2 + 1) = 19
    expect(spriteIndex(fg, 2, 1, 0, 1, 0, 0)).toBe(19);
  });

  it('matches a real-ground index by hand calculation', () => {
    // Ground tile: 4 y-variants × 4 x-variants, single layer, no animation,
    // 1×1 sprite. A tile at (x=5, y=7) → patX=1, patY=3.
    const fg = makeFg({ numPatternX: 4, numPatternY: 4 });
    expect(spriteIndex(fg, 0, 1, 3, 0, 0, 0)).toBe(3 * 4 + 1); // 13
  });
});
