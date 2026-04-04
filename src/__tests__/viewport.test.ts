import { describe, it, expect } from 'vitest';
import { Viewport } from '../lib/viewport';

describe('Viewport', () => {
  function makeViewport(opts?: Partial<ConstructorParameters<typeof Viewport>[0]>) {
    return new Viewport({
      centerX: 100,
      centerY: 100,
      screenWidth: 640,
      screenHeight: 480,
      zoom: 1,
      ...opts,
    });
  }

  it('computes visible tile range at zoom 1', () => {
    const vp = makeViewport();
    const rect = vp.getVisibleTiles();
    // 640/32 = 20 tiles wide, 480/32 = 15 tiles tall
    // Center at 100, half = 10 → x1=89, x2=111 (with padding)
    expect(rect.x1).toBe(89);
    expect(rect.x2).toBe(111);
    expect(rect.y1).toBe(91);
    expect(rect.y2).toBe(109);
  });

  it('zooming in shows fewer tiles', () => {
    const vp = makeViewport({ zoom: 2 });
    const rect = vp.getVisibleTiles();
    const width = rect.x2 - rect.x1;
    const vp1 = makeViewport({ zoom: 1 });
    const rect1 = vp1.getVisibleTiles();
    const width1 = rect1.x2 - rect1.x1;
    expect(width).toBeLessThan(width1);
  });

  it('zooming out shows more tiles', () => {
    const vp = makeViewport({ zoom: 0.5 });
    const rect = vp.getVisibleTiles();
    const width = rect.x2 - rect.x1;
    const vp1 = makeViewport({ zoom: 1 });
    const rect1 = vp1.getVisibleTiles();
    const width1 = rect1.x2 - rect1.x1;
    expect(width).toBeGreaterThan(width1);
  });

  it('clamps zoom to min/max', () => {
    const vp = makeViewport({ minZoom: 0.5, maxZoom: 3 });
    vp.setZoom(0.1);
    expect(vp.zoom).toBe(0.5);
    vp.setZoom(10);
    expect(vp.zoom).toBe(3);
  });

  it('panning moves center', () => {
    const vp = makeViewport();
    vp.pan(32, 0); // pan right by 1 tile worth of pixels
    expect(vp.centerX).toBe(99); // moved left in tile space
    expect(vp.centerY).toBe(100); // unchanged
  });

  it('zoomBy multiplies current zoom', () => {
    const vp = makeViewport({ zoom: 1 });
    vp.zoomBy(2);
    expect(vp.zoom).toBe(2);
    vp.zoomBy(0.5);
    expect(vp.zoom).toBe(1);
  });

  it('getContainerOffset centers view', () => {
    const vp = makeViewport({ centerX: 0, centerY: 0, zoom: 1 });
    const offset = vp.getContainerOffset();
    expect(offset.x).toBe(320); // half screen width
    expect(offset.y).toBe(240); // half screen height
  });

  it('tile size scales with zoom', () => {
    const vp = makeViewport({ zoom: 2 });
    expect(vp.tileSizeOnScreen).toBe(64);
  });
});
