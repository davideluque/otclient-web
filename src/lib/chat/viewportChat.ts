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
  const { width, height } = readVisualViewport();
  return width > height;
}

/**
 * Subscribe to viewport changes (resize, orientation, keyboard via
 * visualViewport). Returns an unsubscribe that removes every listener.
 */
export function bindVisualViewport(onChange: () => void): () => void {
  const schedule = (): void => {
    requestAnimationFrame(onChange);
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  return () => {
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
