export interface VisualViewportRect {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
}

/** Read the visible viewport rectangle, preferring VisualViewport when available. */
export function readVisualViewport(): VisualViewportRect {
  const vp = window.visualViewport;
  return {
    width: vp?.width ?? window.innerWidth,
    height: vp?.height ?? window.innerHeight,
    offsetTop: vp?.offsetTop ?? 0,
    offsetLeft: vp?.offsetLeft ?? 0,
  };
}

export function isLandscapeLayout(): boolean {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(orientation: landscape)').matches;
  }
  return window.innerWidth > window.innerHeight;
}

/**
 * Subscribe to viewport changes (resize, orientation, keyboard via
 * visualViewport). Returns an unsubscribe that removes every listener.
 */
export function bindVisualViewport(onChange: () => void): () => void {
  let rafId = 0;
  const schedule = (): void => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      onChange();
    });
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
  };
}

/**
 * Height of the on-screen keyboard: layout viewport minus visible viewport
 * bottom edge. Returns 0 when the keyboard is closed.
 */
export function keyboardOverlapHeight(): number {
  const vp = window.visualViewport;
  if (!vp) return 0;
  const layoutBottom = window.innerHeight;
  const visibleBottom = vp.offsetTop + vp.height;
  return Math.max(0, layoutBottom - visibleBottom);
}
