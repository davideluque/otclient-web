import { Direction } from './player';

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

const BASE_SIZE_PX = 120;
const KNOB_SIZE_PX = 50;
const DEAD_ZONE_FRACTION = 0.25;

/**
 * Translate a knob displacement (pixels from the base center) into a cardinal
 * direction, applying a dead zone of `radius * DEAD_ZONE_FRACTION`. Pure so
 * the math can be unit-tested without a DOM.
 */
export function directionFromKnob(
  dx: number,
  dy: number,
  radius: number,
  deadZoneFraction = DEAD_ZONE_FRACTION,
): Direction | null {
  const dist = Math.hypot(dx, dy);
  if (dist < radius * deadZoneFraction) return null;
  // 4-way: pick the dominant axis. Tibia 7.6 walking is cardinal.
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? Direction.East : Direction.West;
  }
  return dy > 0 ? Direction.South : Direction.North;
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

  function setKnob(dx: number, dy: number) {
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

  function update(e: PointerEvent) {
    if (!baseRect) return;
    const cx = baseRect.left + baseRect.width / 2;
    const cy = baseRect.top + baseRect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const r = baseRect.width / 2;
    // Clamp to the base circle so the knob never wanders outside the well.
    const dist = Math.hypot(dx, dy);
    if (dist > r) {
      dx = (dx / dist) * r;
      dy = (dy / dist) * r;
    }
    setKnob(dx, dy);
    emit(directionFromKnob(dx, dy, r));
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    baseRect = base.getBoundingClientRect();
    base.setPointerCapture(e.pointerId);
    update(e);
    e.preventDefault();
  }

  function onMove(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    update(e);
    e.preventDefault();
  }

  function endActive(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    baseRect = null;
    reset();
    if (base.hasPointerCapture(e.pointerId)) base.releasePointerCapture(e.pointerId);
  }

  base.addEventListener('pointerdown', onDown);
  base.addEventListener('pointermove', onMove);
  base.addEventListener('pointerup', endActive);
  base.addEventListener('pointercancel', endActive);

  return {
    el: base,
    setVisible(visible: boolean) {
      base.style.display = visible ? 'block' : 'none';
      // Releasing visibility while held would otherwise leave a stale direction.
      if (!visible && currentDir !== null) reset();
    },
    destroy() {
      base.removeEventListener('pointerdown', onDown);
      base.removeEventListener('pointermove', onMove);
      base.removeEventListener('pointerup', endActive);
      base.removeEventListener('pointercancel', endActive);
      base.remove();
    },
  };
}
