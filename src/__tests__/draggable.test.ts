// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeDraggable } from '../lib/draggable';

afterEach(() => document.body.replaceChildren());

describe('makeDraggable', () => {
  it('keeps a dragged panel reachable when the notch or viewport changes', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    const panel = document.createElement('div');
    const head = document.createElement('div');
    panel.append(head);
    document.body.append(panel);
    panel.getBoundingClientRect = () => ({ left: 8, top: 8, width: 200, height: 120 }) as DOMRect;
    const destroy = makeDraggable(panel, head);
    const css = document.documentElement.style;
    try {
      css.setProperty('--game-inset-left', '47px');
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersToNextFrame();
      expect(panel.style.left).toBe('');
      head.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 1, isPrimary: true, button: 0, clientX: 12, clientY: 12, bubbles: true,
      }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      window.dispatchEvent(new Event('orientationchange'));
      vi.advanceTimersToNextFrame();
      expect(panel.style.left).toBe('47px');
    } finally {
      destroy();
      css.removeProperty('--game-inset-left');
      vi.useRealTimers();
    }
  });

  it('moves a panel by its header and ignores header buttons', () => {
    const panel = document.createElement('div');
    const head = document.createElement('div');
    const button = document.createElement('button');
    head.appendChild(button);
    panel.appendChild(head);
    document.body.appendChild(panel);
    panel.getBoundingClientRect = () => ({
      left: 100, top: 100, width: 200, height: 150, right: 300, bottom: 250,
      x: 100, y: 100, toJSON: () => ({}),
    });
    const destroy = makeDraggable(panel, head);

    head.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1, isPrimary: true, button: 0, clientX: 120, clientY: 115, bubbles: true,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, clientX: 220, clientY: 215,
    }));
    expect(panel.style.left).toBe('200px');
    expect(panel.style.top).toBe('200px');

    button.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 2, isPrimary: true, button: 0, clientX: 0, clientY: 0, bubbles: true,
    }));
    expect(panel.style.left).toBe('200px');
    destroy();
  });
});
