// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { makeDraggable } from '../lib/draggable';

afterEach(() => document.body.replaceChildren());

describe('makeDraggable', () => {
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
