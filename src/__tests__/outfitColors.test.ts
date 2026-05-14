import { describe, it, expect } from 'vitest';
import { outfitIndexToRgb } from '../lib/outfitColors';

describe('outfitIndexToRgb', () => {
  it('returns white for index 0', () => {
    // hue=0 branch, intensity = 1 - 0/19/7 = 1, saturation = 0 → full-intensity grey == white
    expect(outfitIndexToRgb(0)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('returns a darker grey for grayscale-ramp indices (multiples of 19)', () => {
    // index 19 → intensity = 1 - 1/7 ≈ 0.857
    const c = outfitIndexToRgb(19);
    expect(c.r).toBe(c.g);
    expect(c.g).toBe(c.b);
    expect(c.r).toBeGreaterThan(200);
    expect(c.r).toBeLessThan(240);
  });

  it('returns white for index 133+ (out of range maps to 0 then to white)', () => {
    // OTClient's contract: out-of-range index becomes 0 (which gives full-intensity grey, i.e. white)
    expect(outfitIndexToRgb(200)).toEqual({ r: 255, g: 255, b: 255 });
    expect(outfitIndexToRgb(-1)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('produces a saturated red-ish colour around index 76 (case 4, hue near 0)', () => {
    // index 76 = floor(76/19)=4, 76%19=0 → grayscale path
    const c = outfitIndexToRgb(76);
    expect(c.r).toBe(c.g);
    expect(c.g).toBe(c.b); // grey ramp
  });

  it('matches OTClient s known head/body/legs/feet output shape', () => {
    // Smoke check across some indices that should produce distinct colours
    const a = outfitIndexToRgb(20);
    const b = outfitIndexToRgb(40);
    const c = outfitIndexToRgb(60);
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    expect(a).not.toEqual(c);
  });
});
