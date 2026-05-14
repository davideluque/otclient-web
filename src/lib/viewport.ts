const TILE_SIZE = 32;

/**
 * Number of horizontal tiles visible at the device's play zoom. Tibia is a
 * competitive shared world so the zoom stays fixed — every player sees the
 * same play area. Pulled back a bit from the classic 15×11 to maximise
 * situational awareness on mobile.
 */
export const PORTRAIT_PLAY_TILES_X = 17;
export const LANDSCAPE_PLAY_TILES_X = 21;

/**
 * Compute the zoom level that fits the desired horizontal tile count on
 * this device. Bigger screen → bigger tiles at the same zoom, so all
 * devices see roughly the same play area.
 */
export function computePlayZoom(screenWidth: number, screenHeight: number): number {
  const isLandscape = screenWidth > screenHeight;
  const target = isLandscape ? LANDSCAPE_PLAY_TILES_X : PORTRAIT_PLAY_TILES_X;
  return screenWidth / (target * TILE_SIZE);
}

export interface ViewRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Camera/viewport for the tile map. Tracks position, zoom, and computes
 * which tiles are visible on screen.
 */
export class Viewport {
  /** Center of the viewport in tile coordinates. */
  centerX: number;
  centerY: number;
  zoom: number;

  /** Screen dimensions in pixels. */
  screenWidth: number;
  screenHeight: number;

  minZoom: number;
  maxZoom: number;
  /** The baseline zoom for this device. Pinch/wheel deviates from it; resize
   *  + double-tap reset back to it. */
  playZoom: number;

  constructor(opts: {
    centerX: number;
    centerY: number;
    screenWidth: number;
    screenHeight: number;
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
    playZoom?: number;
  }) {
    this.centerX = opts.centerX;
    this.centerY = opts.centerY;
    this.screenWidth = opts.screenWidth;
    this.screenHeight = opts.screenHeight;
    const fallbackPlay = computePlayZoom(opts.screenWidth, opts.screenHeight);
    this.playZoom = opts.playZoom ?? fallbackPlay;
    this.zoom = opts.zoom ?? this.playZoom;
    // Bounds default to the play zoom so the locked view is also enforced
    // for any code that calls setZoom — keeps fairness invariants if some
    // future UI affordance forgets to disable itself.
    this.minZoom = opts.minZoom ?? this.playZoom;
    this.maxZoom = opts.maxZoom ?? this.playZoom;
  }

  /**
   * Recompute the play zoom for new screen dimensions and snap the active
   * zoom + bounds to it. Call on resize / orientation change so the play
   * area stays consistent across devices.
   */
  applyPlayZoom(newPlayZoom: number): void {
    this.playZoom = newPlayZoom;
    this.zoom = newPlayZoom;
    this.minZoom = newPlayZoom;
    this.maxZoom = newPlayZoom;
  }

  /** The effective pixel size of a tile at the current zoom level. */
  get tileSizeOnScreen(): number {
    return TILE_SIZE * this.zoom;
  }

  /**
   * Get the rectangular range of tile coordinates visible on screen.
   * Includes a 1-tile padding for smooth scrolling.
   */
  getVisibleTiles(): ViewRect {
    const tilesX = this.screenWidth / this.tileSizeOnScreen;
    const tilesY = this.screenHeight / this.tileSizeOnScreen;
    const halfX = tilesX / 2;
    const halfY = tilesY / 2;

    return {
      x1: Math.floor(this.centerX - halfX) - 1,
      y1: Math.floor(this.centerY - halfY) - 1,
      x2: Math.ceil(this.centerX + halfX) + 1,
      y2: Math.ceil(this.centerY + halfY) + 1,
    };
  }

  /**
   * Pan the camera by a pixel delta (screen space).
   */
  pan(dx: number, dy: number): void {
    this.centerX -= dx / this.tileSizeOnScreen;
    this.centerY -= dy / this.tileSizeOnScreen;
  }

  /**
   * Zoom by a factor, clamped to [minZoom, maxZoom].
   */
  setZoom(newZoom: number): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
  }

  /**
   * Zoom by a multiplicative factor around the current center.
   */
  zoomBy(factor: number): void {
    this.setZoom(this.zoom * factor);
  }

  /**
   * Get the screen-space pixel offset for the tile container.
   * This positions the tile container so that the camera center
   * is at the screen center.
   */
  getContainerOffset(): { x: number; y: number } {
    const tilePixel = this.tileSizeOnScreen;
    return {
      x: this.screenWidth / 2 - this.centerX * tilePixel,
      y: this.screenHeight / 2 - this.centerY * tilePixel,
    };
  }
}
