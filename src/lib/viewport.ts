const TILE_SIZE = 32;

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

  readonly minZoom: number;
  readonly maxZoom: number;

  constructor(opts: {
    centerX: number;
    centerY: number;
    screenWidth: number;
    screenHeight: number;
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
  }) {
    this.centerX = opts.centerX;
    this.centerY = opts.centerY;
    this.screenWidth = opts.screenWidth;
    this.screenHeight = opts.screenHeight;
    this.zoom = opts.zoom ?? 1;
    this.minZoom = opts.minZoom ?? 0.25;
    this.maxZoom = opts.maxZoom ?? 4;
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
