import type { Application } from 'pixi.js';
import { HALF_W_LEFT, HALF_W_RIGHT, HALF_H_TOP, HALF_H_BOTTOM } from './region';
import { TILE_SIZE } from '../../constants';

/**
 * Stage zoom + viewport tracking for the online client.
 *
 * Unlike the offline map browser — which has the whole map loaded and
 * can show as many tiles as fit — the server only ever describes an
 * 18×14 window around the player. The player sits off-center in it
 * (8 left / 9 right, 6 up / 7 down), so with the player tile centered
 * on screen the region guaranteed to be painted is the symmetric core:
 * 17 tiles wide, 13 tall. The *cover zoom* scales the stage so that
 * core covers the whole screen in both orientations — anything less
 * leaves bands of page background ("black spaces / purple UI") that
 * the server has no tiles for.
 */
export const GUARANTEED_TILES_X = 2 * Math.min(HALF_W_LEFT, HALF_W_RIGHT) + 1;
export const GUARANTEED_TILES_Y = 2 * Math.min(HALF_H_TOP, HALF_H_BOTTOM) + 1;

/** Fired on window after the app-level handler resizes + rescales. */
export const VIEWPORT_EVENT = 'jamera:viewport';

export function computeCoverZoom(screenWidth: number, screenHeight: number): number {
  // Transient zero/negative dimensions happen during init and mid-
  // orientation; Infinity/NaN here would poison every position calc.
  if (screenWidth <= 0 || screenHeight <= 0) return 1;
  return Math.max(
    screenWidth / (GUARANTEED_TILES_X * TILE_SIZE),
    screenHeight / (GUARANTEED_TILES_Y * TILE_SIZE),
  );
}

/**
 * Size the renderer to the *visual* viewport and scale the stage to the
 * cover zoom — now, and again on every resize / orientation change /
 * URL-bar reveal. Listeners are debounced over two animation frames:
 * iOS Safari fires `resize` while `innerWidth/innerHeight` are still
 * mid-rotation, and one frame isn't enough on slower devices (the same
 * dance the offline client does in src/main.ts).
 *
 * After applying a change this dispatches VIEWPORT_EVENT on window so
 * consumers that cache screen-derived positions (the renderer's
 * recenter) re-read them *after* the renderer actually resized — a
 * plain `resize` listener would fire before the debounce settles.
 */
export function bindViewportCover(app: Application): () => void {
  let resizeRaf: number | null = null;

  const apply = (): void => {
    const w = window.visualViewport?.width ?? window.innerWidth;
    const h = window.visualViewport?.height ?? window.innerHeight;
    if (w < 1 || h < 1) return; // hidden tab / mid-orientation
    if (w !== app.screen.width || h !== app.screen.height) {
      app.renderer.resize(w, h);
    }
    app.stage.scale.set(computeCoverZoom(w, h));
    window.dispatchEvent(new Event(VIEWPORT_EVENT));
  };

  const schedule = (): void => {
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        apply();
      });
    });
  };

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  // visualViewport tracks the actually-visible area (excludes the URL
  // bar) on mobile; its resize catches URL-bar reveal/hide and pinch.
  window.visualViewport?.addEventListener('resize', schedule);

  apply();
  // Cold-start fix: installed iOS PWAs can report visualViewport before
  // the status-bar layout settles, leaving a black strip at the top.
  // One deferred remeasure catches the post-layout size without user
  // interaction.
  schedule();

  return () => {
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
  };
}
