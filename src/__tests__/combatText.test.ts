import { describe, expect, it } from 'vitest';
import { TEXT_RISE_PX, textJitterPx, textMotionAt } from '../lib/jamera/combatText';
import { missilePattern, shotProgressAt } from '../lib/jamera/renderer';
import { ANIMATED_TEXT_TTL_MS, DISTANCE_SHOT_TTL_MS } from '../lib/GameWorld';

describe('textJitterPx', () => {
  it('is deterministic for a given start stamp', () => {
    expect(textJitterPx(5000)).toBe(textJitterPx(5000));
  });

  it('stays within ±6 px', () => {
    for (let startedAt = 0; startedAt < 40; startedAt += 1.7) {
      const j = textJitterPx(startedAt);
      expect(j).toBeGreaterThanOrEqual(-6);
      expect(j).toBeLessThanOrEqual(6);
    }
  });

  it('spreads nearby stamps apart', () => {
    expect(textJitterPx(5000)).not.toBe(textJitterPx(5003));
  });
});

describe('textMotionAt', () => {
  it('starts at the tile, fully opaque', () => {
    expect(textMotionAt(5000, 5000)).toEqual({ rise: 0, alpha: 1 });
  });

  it('rises linearly to TEXT_RISE_PX over the text lifetime', () => {
    expect(textMotionAt(5000 + ANIMATED_TEXT_TTL_MS / 2, 5000).rise).toBeCloseTo(TEXT_RISE_PX / 2, 5);
    expect(textMotionAt(5000 + ANIMATED_TEXT_TTL_MS, 5000).rise).toBe(TEXT_RISE_PX);
  });

  it('holds full alpha through 75% of life, then fades to 0', () => {
    expect(textMotionAt(5000 + ANIMATED_TEXT_TTL_MS * 0.75, 5000).alpha).toBe(1);
    expect(textMotionAt(5000 + ANIMATED_TEXT_TTL_MS * 0.875, 5000).alpha).toBeCloseTo(0.5, 5);
    expect(textMotionAt(5000 + ANIMATED_TEXT_TTL_MS, 5000).alpha).toBe(0);
  });

  it('clamps past the lifetime instead of overshooting', () => {
    expect(textMotionAt(5000 + ANIMATED_TEXT_TTL_MS * 3, 5000)).toEqual({ rise: TEXT_RISE_PX, alpha: 0 });
  });
});

describe('missilePattern', () => {
  // The 3×3 grid: patX = west/none/east (0/1/2), patY = north/none/south.
  it.each([
    { name: 'north', dx: 0, dy: -1, patX: 1, patY: 0 },
    { name: 'northeast', dx: 1, dy: -1, patX: 2, patY: 0 },
    { name: 'east', dx: 1, dy: 0, patX: 2, patY: 1 },
    { name: 'southeast', dx: 1, dy: 1, patX: 2, patY: 2 },
    { name: 'south', dx: 0, dy: 1, patX: 1, patY: 2 },
    { name: 'southwest', dx: -1, dy: 1, patX: 0, patY: 2 },
    { name: 'west', dx: -1, dy: 0, patX: 0, patY: 1 },
    { name: 'northwest', dx: -1, dy: -1, patX: 0, patY: 0 },
  ])('$name', ({ dx, dy, patX, patY }) => {
    expect(missilePattern(dx, dy)).toEqual({ patX, patY });
  });

  it('snaps oblique shots by angle, not raw delta signs', () => {
    expect(missilePattern(7, 1)).toEqual({ patX: 2, patY: 1 }); // east
    expect(missilePattern(1, 7)).toEqual({ patX: 1, patY: 2 }); // south
    expect(missilePattern(-7, -1)).toEqual({ patX: 0, patY: 1 }); // west
    expect(missilePattern(5, 4)).toEqual({ patX: 2, patY: 2 }); // still southeast
  });

  it('degenerate zero-length shot renders the neutral center sprite', () => {
    expect(missilePattern(0, 0)).toEqual({ patX: 1, patY: 1 });
  });
});

describe('shotProgressAt', () => {
  it('lerps 0 → 1 over the shot lifetime and clamps at both ends', () => {
    expect(shotProgressAt(5000, 5000)).toBe(0);
    expect(shotProgressAt(5000 + DISTANCE_SHOT_TTL_MS / 2, 5000)).toBeCloseTo(0.5, 5);
    expect(shotProgressAt(5000 + DISTANCE_SHOT_TTL_MS, 5000)).toBe(1);
    expect(shotProgressAt(5000 + DISTANCE_SHOT_TTL_MS * 2, 5000)).toBe(1);
    expect(shotProgressAt(4000, 5000)).toBe(0);
  });
});
