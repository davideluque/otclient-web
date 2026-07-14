// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
  GUARANTEED_TILES_X,
  GUARANTEED_TILES_Y,
  VIEWPORT_EVENT,
  computeCoverZoom,
  bindViewportCover,
} from '../lib/jamera/viewport';
import { TILE_SIZE } from '../constants';
import type { Application } from 'pixi.js';

describe('computeCoverZoom', () => {
  it('derives the guaranteed core from the server region (17×13)', () => {
    expect(GUARANTEED_TILES_X).toBe(17);
    expect(GUARANTEED_TILES_Y).toBe(13);
  });

  it('portrait phones are height-bound', () => {
    // 390×844: the 13 guaranteed rows must stretch over 844px.
    expect(computeCoverZoom(390, 844)).toBeCloseTo(844 / (13 * TILE_SIZE), 5);
  });

  it('landscape phones are width-bound', () => {
    expect(computeCoverZoom(844, 390)).toBeCloseTo(844 / (17 * TILE_SIZE), 5);
  });

  it('never returns less than full coverage on either axis', () => {
    for (const [w, h] of [[320, 568], [1920, 1080], [768, 1024]]) {
      const zoom = computeCoverZoom(w, h);
      expect(zoom * GUARANTEED_TILES_X * TILE_SIZE).toBeGreaterThanOrEqual(w - 1e-6);
      expect(zoom * GUARANTEED_TILES_Y * TILE_SIZE).toBeGreaterThanOrEqual(h - 1e-6);
    }
  });

  it('guards degenerate dimensions', () => {
    expect(computeCoverZoom(0, 600)).toBe(1);
    expect(computeCoverZoom(800, -1)).toBe(1);
  });
});

describe('bindViewportCover', () => {
  function makeApp() {
    const screen = { width: 0, height: 0 };
    const scale = { x: 1, y: 1, set: (v: number) => { scale.x = v; scale.y = v; } };
    const resize = vi.fn((w: number, h: number) => { screen.width = w; screen.height = h; });
    const canvas = document.createElement('canvas');
    return {
      app: { canvas, screen, stage: { scale }, renderer: { resize } } as unknown as Application,
      canvas, screen, scale, resize,
    };
  }

  it('sizes the renderer and applies the cover zoom immediately', () => {
    const { app, scale, resize } = makeApp();
    const events: string[] = [];
    const onViewport = () => events.push('viewport');
    window.addEventListener(VIEWPORT_EVENT, onViewport);

    const unbind = bindViewportCover(app);
    expect(resize).toHaveBeenCalledWith(window.innerWidth, window.innerHeight);
    expect(scale.x).toBeCloseTo(computeCoverZoom(window.innerWidth, window.innerHeight), 5);
    expect(events.length).toBeGreaterThan(0);

    unbind();
    window.removeEventListener(VIEWPORT_EVENT, onViewport);
  });

  it('a no-change re-apply neither resizes nor re-dispatches', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    try {
      const { app, resize } = makeApp();
      let events = 0;
      const onViewport = () => events++;
      window.addEventListener(VIEWPORT_EVENT, onViewport);
      const unbind = bindViewportCover(app);
      const calls = resize.mock.calls.length;
      const dispatched = events;

      // Debounced re-apply with identical dimensions (covers the
      // cold-start double-apply and liberal visualViewport.resize).
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
      expect(resize.mock.calls.length).toBe(calls);
      expect(events).toBe(dispatched);

      unbind();
      window.removeEventListener(VIEWPORT_EVENT, onViewport);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks visual viewport offsets that change without a resize', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    const originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    let unbind: (() => void) | undefined;
    try {
      const viewport = new EventTarget() as VisualViewport;
      Object.assign(viewport, {
        width: 390,
        height: 700,
        offsetLeft: 12,
        offsetTop: 48,
      });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });

      const { app, canvas, resize } = makeApp();
      unbind = bindViewportCover(app);
      expect(canvas.style.left).toBe('12px');
      expect(canvas.style.top).toBe('48px');
      const resizeCalls = resize.mock.calls.length;

      Object.assign(viewport, { offsetLeft: 20, offsetTop: 64 });
      viewport.dispatchEvent(new Event('scroll'));
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();

      expect(canvas.style.left).toBe('20px');
      expect(canvas.style.top).toBe('64px');
      expect(resize.mock.calls.length).toBe(resizeCalls);
    } finally {
      unbind?.();
      if (originalViewport) {
        Object.defineProperty(window, 'visualViewport', originalViewport);
      } else {
        Reflect.deleteProperty(window, 'visualViewport');
      }
      vi.useRealTimers();
    }
  });
});
