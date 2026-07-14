// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGameMessageOverlay } from '../lib/jamera/gameMessageOverlay';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('game message overlay', () => {
  it('shows server messages in the game window and expires them', () => {
    vi.useFakeTimers();
    const overlay = createGameMessageOverlay();
    overlay.show(0x16, 'You see a dead rat.');
    expect(overlay.el.textContent).toContain('You see a dead rat.');
    vi.advanceTimersByTime(5000);
    expect(overlay.el.textContent).not.toContain('You see a dead rat.');
    overlay.destroy();
  });
});
