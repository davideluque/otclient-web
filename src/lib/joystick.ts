import { Direction } from './player';
import type { Pixel } from './types';

export interface JoystickHandle {
  /** The base DOM element. Attached to the parent in `createJoystick`. */
  readonly el: HTMLElement;
  /** Show or hide the joystick. */
  setVisible(visible: boolean): void;
  /** Remove the joystick from the DOM and unbind listeners. */
  destroy(): void;
}

export interface JoystickOptions {
  /** Where to attach the joystick DOM. Defaults to `document.body`. */
  parent?: HTMLElement;
  /** Fires when the active cardinal direction changes. `null` means released
   *  or inside the dead zone. */
  onChange: (dir: Direction | null) => void;
}

const BASE_SIZE_PX: Pixel = 120;
const KNOB_SIZE_PX: Pixel = 50;
const DEAD_ZONE_FRACTION = 0.35;
// How much the dominant axis must exceed the secondary axis (as a ratio)
// before a direction change is accepted. Prevents accidental flips when
// the finger is near a diagonal. 1.0 = no hysteresis, 2.0 = very sticky.
const AXIS_DOMINANCE_RATIO = 1.5;

/**
 * Translate a knob displacement (pixels from the base center) into a cardinal
 * direction, applying a dead zone and axis-dominance hysteresis. Pure so
 * the math can be unit-tested without a DOM.
 *
 * `currentDir` enables hysteresis: the active direction is kept unless
 * the new direction's axis clearly dominates (by AXIS_DOMINANCE_RATIO).
 * Pass `null` for the initial press.
 */
export function directionFromKnob(
  dx: Pixel,
  dy: Pixel,
  radius: Pixel,
  currentDir: Direction | null = null,
  deadZoneFraction = DEAD_ZONE_FRACTION,
): Direction | null {
  const dist = Math.hypot(dx, dy);
  if (dist < radius * deadZoneFraction) return null;

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Determine the raw candidate direction
  let candidate: Direction;
  if (absDx >= absDy) {
    candidate = dx > 0 ? Direction.East : Direction.West;
  } else {
    candidate = dy > 0 ? Direction.South : Direction.North;
  }

  // If we already have a direction, require clear dominance to switch
  // axes. This prevents flips when the finger wobbles near a diagonal.
  // 180° flips on the same axis (East↔West, North↔South) are always
  // allowed — the user clearly reversed direction.
  if (currentDir !== null && candidate !== currentDir) {
    const isOpposite =
      (currentDir === Direction.East && candidate === Direction.West)
      || (currentDir === Direction.West && candidate === Direction.East)
      || (currentDir === Direction.North && candidate === Direction.South)
      || (currentDir === Direction.South && candidate === Direction.North);
    if (!isOpposite) {
      const dominantAxis = absDx >= absDy ? absDx : absDy;
      const secondaryAxis = absDx >= absDy ? absDy : absDx;
      if (dominantAxis < secondaryAxis * AXIS_DOMINANCE_RATIO) {
        return currentDir; // Not dominant enough — keep current
      }
    }
  }

  return candidate;
}

/**
 * Create a virtual joystick overlay in the bottom-left of the parent. The
 * knob captures the pointer on touch/click and emits a cardinal direction
 * while held; releasing or returning to the dead zone emits `null`.
 *
 * Hidden by default — call `setVisible(true)` when orientation/UI rules say
 * the joystick should be on screen.
 */
export function createJoystick(opts: JoystickOptions): JoystickHandle {
  const parent = opts.parent ?? document.body;

  const base = document.createElement('div');
  base.className = 'joystick';
  base.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'left:24px',
    `width:${BASE_SIZE_PX}px`,
    `height:${BASE_SIZE_PX}px`,
    'border-radius:50%',
    'background:rgba(60,60,60,0.35)',
    'border:2px solid rgba(255,255,255,0.4)',
    // Block native scroll/zoom gestures from interfering with the knob.
    'touch-action:none',
    'z-index:50',
    'display:none',
    'user-select:none',
  ].join(';');

  const knob = document.createElement('div');
  knob.style.cssText = [
    'position:absolute',
    `width:${KNOB_SIZE_PX}px`,
    `height:${KNOB_SIZE_PX}px`,
    'left:50%',
    'top:50%',
    'border-radius:50%',
    'background:rgba(255,255,255,0.65)',
    'pointer-events:none',
    'transform:translate(-50%,-50%)',
  ].join(';');
  base.appendChild(knob);
  parent.appendChild(base);

  let activePointerId: number | null = null;
  let baseRect: DOMRect | null = null;
  let currentDir: Direction | null = null;

  function setKnob(dx: Pixel, dy: Pixel) {
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  function emit(dir: Direction | null) {
    if (dir === currentDir) return;
    currentDir = dir;
    opts.onChange(dir);
  }

  function reset() {
    setKnob(0, 0);
    emit(null);
  }

  function trySetPointerCapture(pointerId: number) {
    if (typeof base.setPointerCapture !== 'function') return;
    try {
      base.setPointerCapture(pointerId);
    } catch {
      // The browser can cancel a touch between pointerdown and capture.
    }
  }

  function tryReleasePointerCapture(pointerId: number) {
    if (typeof base.releasePointerCapture !== 'function') return;

    try {
      if (
        typeof base.hasPointerCapture !== 'function'
        || base.hasPointerCapture(pointerId)
      ) {
        base.releasePointerCapture(pointerId);
      }
    } catch {
      // Capture may already be gone after cancellation, blur, or page hide.
    }
  }

  function cancelActive() {
    const pointerId = activePointerId;
    activePointerId = null;
    baseRect = null;
    reset();

    if (pointerId !== null) tryReleasePointerCapture(pointerId);
  }

  /** Compute clamped knob displacement from a pointer event. */
  function knobDelta(e: PointerEvent): { dx: Pixel; dy: Pixel; r: Pixel } | null {
    if (!baseRect) return null;
    const cx = baseRect.left + baseRect.width / 2;
    const cy = baseRect.top + baseRect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const r = baseRect.width / 2;
    const dist = Math.hypot(dx, dy);
    if (dist > r) { dx = (dx / dist) * r; dy = (dy / dist) * r; }
    return { dx, dy, r };
  }

  function update(e: PointerEvent) {
    const d = knobDelta(e);
    if (!d) return;
    setKnob(d.dx, d.dy);
    emit(directionFromKnob(d.dx, d.dy, d.r, currentDir));
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    baseRect = base.getBoundingClientRect();
    trySetPointerCapture(e.pointerId);
    // Don't emit a direction on touch-down — wait for the drag to
    // establish intent. Just move the knob visually.
    const d = knobDelta(e);
    if (d) setKnob(d.dx, d.dy);
    e.preventDefault();
  }

  function onMove(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    update(e);
    e.preventDefault();
  }

  function endActive(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    cancelActive();
  }

  function onLostPointerCapture(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    cancelActive();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') cancelActive();
  }

  base.addEventListener('pointerdown', onDown);
  base.addEventListener('pointermove', onMove);
  base.addEventListener('pointerup', endActive);
  base.addEventListener('pointercancel', endActive);
  base.addEventListener('lostpointercapture', onLostPointerCapture);
  window.addEventListener('pointerup', endActive);
  window.addEventListener('pointercancel', endActive);
  window.addEventListener('blur', cancelActive);
  window.addEventListener('pagehide', cancelActive);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    el: base,
    setVisible(visible: boolean) {
      if (!visible) cancelActive();
      base.style.display = visible ? 'block' : 'none';
    },
    destroy() {
      cancelActive();
      base.removeEventListener('pointerdown', onDown);
      base.removeEventListener('pointermove', onMove);
      base.removeEventListener('pointerup', endActive);
      base.removeEventListener('pointercancel', endActive);
      base.removeEventListener('lostpointercapture', onLostPointerCapture);
      window.removeEventListener('pointerup', endActive);
      window.removeEventListener('pointercancel', endActive);
      window.removeEventListener('blur', cancelActive);
      window.removeEventListener('pagehide', cancelActive);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      base.remove();
    },
  };
}
