// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadTapToWalk, resetTapToWalkCache, saveTapToWalk,
} from '../lib/jamera/interactionPreferences';

describe('tap-to-walk preference', () => {
  beforeEach(() => {
    localStorage.clear();
    resetTapToWalkCache();
  });

  it('defaults on and persists changes', () => {
    expect(loadTapToWalk()).toBe(true);
    saveTapToWalk(false);
    resetTapToWalkCache();
    expect(loadTapToWalk()).toBe(false);
  });
});
