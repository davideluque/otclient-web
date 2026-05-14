const TILE_SIZE = 32;

/**
 * Number of horizontal tiles we want visible at the device's "play zoom"
 * (the baseline zoom we snap back to). Portrait shows fewer tiles because
 * the screen is narrow; landscape shows more so the play area doesn't look
 * cramped on a wide phone or iPad. Pinch/wheel can deviate within bounds.
 */
export const PORTRAIT_PLAY_TILES_X = 15;
export const LANDSCAPE_PLAY_TILES_X = 18;
export const PLAY_ZOOM_MIN_FACTOR = 0.7;
export const PLAY_ZOOM_MAX_FACTOR = 1.5;

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
    this.minZoom = opts.minZoom ?? this.playZoom * PLAY_ZOOM_MIN_FACTOR;
    this.maxZoom = opts.maxZoom ?? this.playZoom * PLAY_ZOOM_MAX_FACTOR;
  }

  /**
   * Recompute the baseline zoom for new screen dimensions, snap the active
   * zoom to it, and adjust pinch bounds proportionally. Call on resize /
   * orientation change so the play area stays consistent across devices.
   */
  applyPlayZoom(newPlayZoom: number): void {
    this.playZoom = newPlayZoom;
    this.zoom = newPlayZoom;
    this.minZoom = newPlayZoom * PLAY_ZOOM_MIN_FACTOR;
    this.maxZoom = newPlayZoom * PLAY_ZOOM_MAX_FACTOR;
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
