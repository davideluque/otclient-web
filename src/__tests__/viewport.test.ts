import { describe, it, expect } from 'vitest';
import {
  Viewport,
  computePlayZoom,
  PORTRAIT_PLAY_TILES_X,
  LANDSCAPE_PLAY_TILES_X,
} from '../lib/viewport';

describe('Viewport', () => {
  function makeViewport(opts?: Partial<ConstructorParameters<typeof Viewport>[0]>) {
    return new Viewport({
      centerX: 100,
      centerY: 100,
      screenWidth: 640,
      screenHeight: 480,
      zoom: 1,
      // Wide explicit bounds keep these legacy tests unaffected by the new
      // play-zoom-derived defaults.
      minZoom: 0.1,
      maxZoom: 10,
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

  describe('play zoom', () => {
    it('fits PORTRAIT_PLAY_TILES_X tiles across in portrait', () => {
      const screenW = 390;
      const screenH = 844;
      const zoom = computePlayZoom(screenW, screenH);
      const vp = new Viewport({ centerX: 0, centerY: 0, screenWidth: screenW, screenHeight: screenH, playZoom: zoom });
      const tilesX = vp.screenWidth / vp.tileSizeOnScreen;
      expect(tilesX).toBeCloseTo(PORTRAIT_PLAY_TILES_X, 5);
    });

    it('returns a finite fallback for zero/negative screen dimensions', () => {
      expect(computePlayZoom(0, 800)).toBe(1);
      expect(computePlayZoom(800, 0)).toBe(1);
      expect(computePlayZoom(-5, 800)).toBe(1);
    });

    it('fits LANDSCAPE_PLAY_TILES_X tiles across in landscape', () => {
      const screenW = 844;
      const screenH = 390;
      const zoom = computePlayZoom(screenW, screenH);
      const vp = new Viewport({ centerX: 0, centerY: 0, screenWidth: screenW, screenHeight: screenH, playZoom: zoom });
      const tilesX = vp.screenWidth / vp.tileSizeOnScreen;
      expect(tilesX).toBeCloseTo(LANDSCAPE_PLAY_TILES_X, 5);
    });

    it('defaults active zoom to play zoom when no zoom override is given', () => {
      const vp = new Viewport({ centerX: 0, centerY: 0, screenWidth: 768, screenHeight: 1024 });
      expect(vp.zoom).toBe(vp.playZoom);
    });

    it('locks bounds to play zoom by default so setZoom is a no-op', () => {
      const vp = new Viewport({ centerX: 0, centerY: 0, screenWidth: 768, screenHeight: 1024 });
      const baseline = vp.playZoom;
      vp.setZoom(baseline * 2);
      expect(vp.zoom).toBe(baseline);
      vp.setZoom(baseline / 2);
      expect(vp.zoom).toBe(baseline);
    });

    it('applyPlayZoom snaps zoom and bounds to a new baseline', () => {
      const vp = new Viewport({ centerX: 0, centerY: 0, screenWidth: 768, screenHeight: 1024 });
      vp.applyPlayZoom(2);
      expect(vp.playZoom).toBe(2);
      expect(vp.zoom).toBe(2);
      expect(vp.minZoom).toBe(2);
      expect(vp.maxZoom).toBe(2);
    });
  });
});
