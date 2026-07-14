/** Make a fixed panel movable by dragging a dedicated header/handle. */
export function makeDraggable(panel: HTMLElement, handle: HTMLElement): () => void {
  handle.style.cursor = 'grab';
  handle.style.touchAction = 'none';

  let activePointer: number | null = null;
  let offsetX = 0;
  let offsetY = 0;
  let panelWidth = 0;
  let panelHeight = 0;

  const viewportBounds = (): { left: number; top: number; width: number; height: number } => ({
    left: window.visualViewport?.offsetLeft ?? 0,
    top: window.visualViewport?.offsetTop ?? 0,
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  });

  const moveTo = (clientX: number, clientY: number): void => {
    const bounds = viewportBounds();
    const maxLeft = bounds.left + Math.max(0, bounds.width - panelWidth);
    const maxTop = bounds.top + Math.max(0, bounds.height - panelHeight);
    panel.style.left = `${Math.min(maxLeft, Math.max(bounds.left, clientX - offsetX))}px`;
    panel.style.top = `${Math.min(maxTop, Math.max(bounds.top, clientY - offsetY))}px`;
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    moveTo(event.clientX, event.clientY);
  };

  const finish = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    handle.style.cursor = 'grab';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
  };

  const onDown = (event: PointerEvent): void => {
    if (activePointer !== null) return;
    if (!event.isPrimary || event.button !== 0) return;
    if (!(event.target instanceof Element)
      || event.target.closest('button, input, select, textarea, a')) return;
    const rect = panel.getBoundingClientRect();
    activePointer = event.pointerId;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    panelWidth = rect.width;
    panelHeight = rect.height;
    // Convert centered/right-anchored panels to an explicit viewport point.
    panel.style.position = 'fixed';
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';
    panel.style.margin = '0';
    handle.style.cursor = 'grabbing';
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  handle.addEventListener('pointerdown', onDown);
  return () => {
    activePointer = null;
    handle.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
  };
}
