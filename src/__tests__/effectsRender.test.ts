import { describe, expect, it } from 'vitest';
import { EFFECT_PHASE_MS, effectPhaseAt } from '../lib/render/effects';
import { MAGIC_EFFECT_TTL_MS } from '../lib/GameWorld';

describe('effectPhaseAt', () => {
  it('advances one phase per EFFECT_PHASE_MS', () => {
    expect(effectPhaseAt(5000, 5000, 4)).toBe(0);
    expect(effectPhaseAt(5000 + EFFECT_PHASE_MS - 1, 5000, 4)).toBe(0);
    expect(effectPhaseAt(5000 + EFFECT_PHASE_MS, 5000, 4)).toBe(1);
    expect(effectPhaseAt(5000 + 3 * EFFECT_PHASE_MS, 5000, 4)).toBe(3);
  });

  it('returns -1 once the animation has played through (no looping)', () => {
    expect(effectPhaseAt(5000 + 4 * EFFECT_PHASE_MS, 5000, 4)).toBe(-1);
    expect(effectPhaseAt(5000 + 60_000, 5000, 4)).toBe(-1);
  });

  it('single-phase effects show exactly one tick', () => {
    expect(effectPhaseAt(5000, 5000, 1)).toBe(0);
    expect(effectPhaseAt(5000 + EFFECT_PHASE_MS, 5000, 1)).toBe(-1);
  });

  it('a 10-phase effect (the longest 7.6 uses) fits the world TTL exactly', () => {
    // GameWorld prunes magic effects at MAGIC_EFFECT_TTL_MS — the state
    // outlives (or matches) every animation, never cuts one short.
    expect(effectPhaseAt(5000 + MAGIC_EFFECT_TTL_MS - 1, 5000, 10)).toBe(9);
    expect(effectPhaseAt(5000 + MAGIC_EFFECT_TTL_MS, 5000, 10)).toBe(-1);
  });
});
