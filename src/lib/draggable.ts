import { bindVisualViewport, readVisualViewport } from './chat/viewportChat';
import { readPlayArea } from './safeArea';

/** Make a fixed panel movable by dragging a dedicated header/handle. */
export function makeDraggable(panel: HTMLElement, handle: HTMLElement): () => void {
  handle.style.cursor = 'grab';
  handle.style.touchAction = 'none';

  let activePointer: number | null = null;
  let offsetX = 0;
  let offsetY = 0;
  let panelWidth = 0;
  let panelHeight = 0;

  let stopViewport: (() => void) | undefined;

  const moveTo = (x: number, y: number): void => {
    const viewport = readVisualViewport();
    const area = readPlayArea(viewport.width, viewport.height);
    const left = viewport.offsetLeft + area.x;
    const top = viewport.offsetTop + area.y;
    const maxLeft = left + Math.max(0, area.width - panelWidth);
    const maxTop = top + Math.max(0, area.height - panelHeight);
    panel.style.left = `${Math.min(maxLeft, Math.max(left, x))}px`;
    panel.style.top = `${Math.min(maxTop, Math.max(top, y))}px`;
  };

  const keepInView = (): void => {
    const rect = panel.getBoundingClientRect();
    // A hidden panel reports zero. Its last visible size still keeps its
    // saved position reachable when reopened after a rotation.
    if (rect.width) panelWidth = rect.width;
    if (rect.height) panelHeight = rect.height;
    moveTo(parseFloat(panel.style.left), parseFloat(panel.style.top));
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    moveTo(event.clientX - offsetX, event.clientY - offsetY);
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
    stopViewport ??= bindVisualViewport(keepInView);
    handle.style.cursor = 'grabbing';
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  handle.addEventListener('pointerdown', onDown);
  return () => {
    activePointer = null;
    stopViewport?.();
    handle.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
  };
}
