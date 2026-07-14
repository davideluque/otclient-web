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
  // Transient zero/negative/NaN dimensions happen during init and mid-
  // orientation; Infinity/NaN here would poison every position calc.
  // Negated > comparisons so NaN/undefined fall into the guard too.
  if (!(screenWidth > 0) || !(screenHeight > 0)) return 1;
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
    const viewport = window.visualViewport;
    const w = viewport?.width ?? window.innerWidth;
    const h = viewport?.height ?? window.innerHeight;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    if (!(w >= 1) || !(h >= 1)) return; // hidden tab / mid-orientation
    const zoom = computeCoverZoom(w, h);
    const sizeChanged = w !== app.screen.width || h !== app.screen.height;
    const positionChanged = app.canvas.style.left !== `${left}px`
      || app.canvas.style.top !== `${top}px`;
    // visualViewport.resize fires liberally (URL-bar reveal, pinch) and
    // the cold-start path applies twice by design — skip the renderer
    // churn and the downstream recenters when nothing actually changed.
    if (!sizeChanged && !positionChanged && zoom === app.stage.scale.x) return;
    if (sizeChanged) app.renderer.resize(w, h);
    // visualViewport dimensions describe the visible rectangle, but its
    // origin can be displaced from the layout viewport after Safari focuses
    // (and auto-zooms around) a login input. Keep the fixed canvas over that
    // rectangle instead of leaving it at layout (0, 0), which makes the
    // centered scene appear cropped / zoomed after the login overlay hides.
    app.canvas.style.left = `${left}px`;
    app.canvas.style.top = `${top}px`;
    app.stage.scale.set(zoom);
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
  // Pinch/focus panning can change offsetLeft/offsetTop without changing the
  // visual viewport's size, in which case only `scroll` fires.
  window.visualViewport?.addEventListener('scroll', schedule);

  apply();
  // Cold-start fixes: iOS (Safari and installed PWAs) can report a
  // stale viewport for a while after load — URL-bar/status-bar layout
  // settles late and does NOT always fire a resize when it does. A
  // wrong first measurement leaves the canvas larger than the screen,
  // top-anchored by inset:0 — the player renders below the visible
  // center and "only the north tiles" show. apply() no-ops when
  // nothing changed, so a few delayed remeasures are free insurance.
  schedule();
  const settleTimers = [300, 1000, 3000].map((ms) => setTimeout(schedule, ms));
  // First interaction is the strongest "layout is real now" signal.
  const onFirstTouch = (): void => schedule();
  window.addEventListener('pointerdown', onFirstTouch, { once: true });

  return () => {
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    for (const t of settleTimers) clearTimeout(t);
    window.removeEventListener('pointerdown', onFirstTouch);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
  };
}
