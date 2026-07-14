import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELF_MOTION,
  resolveSelfMotionMode,
} from '../lib/render/motion/selfMotion';

describe('resolveSelfMotionMode', () => {
  it('accepts the two known modes', () => {
    expect(resolveSelfMotionMode('prewalk')).toBe('prewalk');
    expect(resolveSelfMotionMode('playout')).toBe('playout');
  });

  it('falls back to the default on absent or unknown values', () => {
    expect(resolveSelfMotionMode(null)).toBe(DEFAULT_SELF_MOTION);
    expect(resolveSelfMotionMode('')).toBe(DEFAULT_SELF_MOTION);
    expect(resolveSelfMotionMode('forward')).toBe(DEFAULT_SELF_MOTION);
    expect(resolveSelfMotionMode('PREWALK')).toBe(DEFAULT_SELF_MOTION);
  });
});
