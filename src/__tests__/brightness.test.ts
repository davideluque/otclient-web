// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BRIGHTNESS, loadBrightness, resetBrightnessCache, saveBrightness } from '../lib/lighting';

afterEach(() => {
  localStorage.clear();
  resetBrightnessCache();
});

describe('brightness preference', () => {
  it('defaults to DEFAULT_BRIGHTNESS for new users (getItem null ≠ 0%)', () => {
    // Regression: Number(null) === 0 once silently defaulted everyone
    // to full darkness.
    expect(loadBrightness()).toBe(DEFAULT_BRIGHTNESS);
  });

  it('round-trips through storage with clamping', () => {
    saveBrightness(60);
    resetBrightnessCache();
    expect(loadBrightness()).toBe(60);

    saveBrightness(140);
    expect(loadBrightness()).toBe(100);
    saveBrightness(-5);
    expect(loadBrightness()).toBe(0);
  });

  it('a stored 0 is a real preference, not a missing key', () => {
    saveBrightness(0);
    resetBrightnessCache();
    expect(loadBrightness()).toBe(0);
  });

  it('ignores garbage in storage', () => {
    localStorage.setItem('jamera.brightness', 'potato');
    expect(loadBrightness()).toBe(DEFAULT_BRIGHTNESS);
  });
});
