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

  it('does not let a continuous identical movement warning linger forever', () => {
    vi.useFakeTimers();
    const overlay = createGameMessageOverlay();
    overlay.show(0x12, 'There is not enough room.');
    for (let elapsed = 0; elapsed < 8000; elapsed += 1000) {
      vi.advanceTimersByTime(1000);
      overlay.show(0x12, 'There is not enough room.');
    }
    expect(overlay.el.querySelectorAll('.message')).toHaveLength(0);

    // The cooldown follows the final duplicate attempt. Once the server
    // has been quiet for five seconds, the same warning may be shown again.
    vi.advanceTimersByTime(5000);
    overlay.show(0x12, 'There is not enough room.');
    expect(overlay.el.querySelectorAll('.message')).toHaveLength(1);
    overlay.destroy();
  });

  it('still shows different notices independently', () => {
    vi.useFakeTimers();
    const overlay = createGameMessageOverlay();
    overlay.show(0x12, 'There is not enough room.');
    overlay.show(0x12, 'Sorry, not possible.');
    expect(overlay.el.querySelectorAll('.message')).toHaveLength(2);
    overlay.destroy();
  });
});
