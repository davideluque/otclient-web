/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createJoystick, directionFromKnob } from '../lib/joystick';
import { Direction } from '../lib/player';
import type { JoystickHandle } from '../lib/joystick';

const JOYSTICK_RECT = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 120,
  bottom: 120,
  width: 120,
  height: 120,
  toJSON: () => ({}),
} as DOMRect;

function pointer(type: string, init: PointerEventInit = {}) {
  return new PointerEvent(type, {
    pointerId: 1,
    button: 0,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

describe('directionFromKnob', () => {
  const RADIUS = 60;

  it('returns null inside the dead zone', () => {
    expect(directionFromKnob(0, 0, RADIUS)).toBeNull();
    // Dead zone is 35% of radius = 21px. (10,10) = ~14px, inside.
    expect(directionFromKnob(10, 10, RADIUS)).toBeNull();
  });

  it('returns east when the knob is dominantly to the right', () => {
    expect(directionFromKnob(30, 0, RADIUS)).toBe(Direction.East);
    expect(directionFromKnob(40, 10, RADIUS)).toBe(Direction.East);
  });

  it('returns west when the knob is dominantly to the left', () => {
    expect(directionFromKnob(-30, 0, RADIUS)).toBe(Direction.West);
    expect(directionFromKnob(-40, -10, RADIUS)).toBe(Direction.West);
  });

  it('returns north when the knob is dominantly upward (negative y)', () => {
    expect(directionFromKnob(0, -30, RADIUS)).toBe(Direction.North);
    expect(directionFromKnob(5, -40, RADIUS)).toBe(Direction.North);
  });

  it('returns south when the knob is dominantly downward (positive y)', () => {
    expect(directionFromKnob(0, 30, RADIUS)).toBe(Direction.South);
    expect(directionFromKnob(-5, 40, RADIUS)).toBe(Direction.South);
  });

  it('breaks ties on the X axis (matches walk preference for horizontal)', () => {
    expect(directionFromKnob(30, 30, RADIUS)).toBe(Direction.East);
    expect(directionFromKnob(-30, -30, RADIUS)).toBe(Direction.West);
  });

  it('respects a custom dead-zone fraction', () => {
    expect(directionFromKnob(20, 0, RADIUS, null, 0.5)).toBeNull(); // 50% of 60 = 30
    expect(directionFromKnob(35, 0, RADIUS, null, 0.5)).toBe(Direction.East);
  });

  describe('hysteresis', () => {
    it('keeps current direction when near a diagonal', () => {
      // Moving west with a slight upward drift — should stay West
      // dx=-25, dy=-20: absDx/absDy = 1.25, below the 1.5 threshold
      expect(directionFromKnob(-25, -20, RADIUS, Direction.West)).toBe(Direction.West);
    });

    it('switches direction when the new axis clearly dominates', () => {
      // Was heading West, now clearly pointing North
      // dx=-10, dy=-40: absDy/absDx = 4.0, well above 1.5 threshold
      expect(directionFromKnob(-10, -40, RADIUS, Direction.West)).toBe(Direction.North);
    });

    it('has no hysteresis when currentDir is null (initial press)', () => {
      // First press — should pick the dominant axis without stickiness
      expect(directionFromKnob(-25, -20, RADIUS, null)).toBe(Direction.West);
    });

    it('keeps current direction at exact diagonal', () => {
      // 45° exactly — ratio is 1.0, below 1.5 threshold, keeps current
      expect(directionFromKnob(30, 30, RADIUS, Direction.South)).toBe(Direction.South);
      expect(directionFromKnob(30, 30, RADIUS, Direction.East)).toBe(Direction.East);
    });

    it('allows 180° flips without hysteresis', () => {
      // Dragging from right to left — should flip immediately to West
      expect(directionFromKnob(-30, 5, RADIUS, Direction.East)).toBe(Direction.West);
      // Dragging from down to up — should flip immediately to North
      expect(directionFromKnob(5, -30, RADIUS, Direction.South)).toBe(Direction.North);
    });
  });
});

describe('createJoystick', () => {
  let handle: JoystickHandle | undefined;

  function mountJoystick() {
    const changes: Array<Direction | null> = [];
    handle = createJoystick({ onChange: (dir) => changes.push(dir) });
    handle.setVisible(true);
    vi.spyOn(handle.el, 'getBoundingClientRect').mockReturnValue(JOYSTICK_RECT);
    return changes;
  }

  function knobTransform() {
    const knob = handle?.el.firstElementChild as HTMLElement | undefined;
    return knob?.style.transform;
  }

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('clears held direction when pointer capture is lost', () => {
    const changes = mountJoystick();

    handle?.el.dispatchEvent(pointer('pointerdown', { pointerId: 7, clientX: 60, clientY: 60 }));
    handle?.el.dispatchEvent(pointer('pointermove', { pointerId: 7, clientX: 110, clientY: 60 }));
    expect(changes).toEqual([Direction.East]);

    handle?.el.dispatchEvent(pointer('lostpointercapture', { pointerId: 7 }));
    expect(changes).toEqual([Direction.East, null]);
    expect(knobTransform()).toBe('translate(calc(-50% + 0px), calc(-50% + 0px))');

    handle?.el.dispatchEvent(pointer('pointerdown', { pointerId: 8, clientX: 60, clientY: 60 }));
    handle?.el.dispatchEvent(pointer('pointermove', { pointerId: 8, clientX: 60, clientY: 110 }));
    expect(changes).toEqual([Direction.East, null, Direction.South]);
  });

  it('clears held direction when release lands outside the base element', () => {
    const changes = mountJoystick();

    handle?.el.dispatchEvent(pointer('pointerdown', { pointerId: 2, clientX: 60, clientY: 60 }));
    handle?.el.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 110, clientY: 60 }));
    expect(changes).toEqual([Direction.East]);

    window.dispatchEvent(pointer('pointerup', { pointerId: 2 }));
    expect(changes).toEqual([Direction.East, null]);
    expect(knobTransform()).toBe('translate(calc(-50% + 0px), calc(-50% + 0px))');
  });

  it('releases pointer capture when hasPointerCapture is unavailable', () => {
    const changes = mountJoystick();
    const el = handle?.el as HTMLElement;
    const releasePointerCapture = vi.fn();
    Object.defineProperties(el, {
      hasPointerCapture: { configurable: true, value: undefined },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });

    el.dispatchEvent(pointer('pointerdown', { pointerId: 9, clientX: 60, clientY: 60 }));
    el.dispatchEvent(pointer('pointermove', { pointerId: 9, clientX: 110, clientY: 60 }));
    expect(changes).toEqual([Direction.East]);

    window.dispatchEvent(pointer('pointerup', { pointerId: 9 }));
    expect(releasePointerCapture).toHaveBeenCalledWith(9);
    expect(changes).toEqual([Direction.East, null]);
  });

  it('clears active touch state when hidden before a direction is emitted', () => {
    const changes = mountJoystick();

    handle?.el.dispatchEvent(pointer('pointerdown', { pointerId: 3, clientX: 100, clientY: 60 }));
    expect(changes).toEqual([]);
    expect(knobTransform()).toBe('translate(calc(-50% + 40px), calc(-50% + 0px))');

    handle?.setVisible(false);
    expect(changes).toEqual([]);
    expect(knobTransform()).toBe('translate(calc(-50% + 0px), calc(-50% + 0px))');

    handle?.setVisible(true);
    handle?.el.dispatchEvent(pointer('pointerdown', { pointerId: 4, clientX: 60, clientY: 60 }));
    handle?.el.dispatchEvent(pointer('pointermove', { pointerId: 4, clientX: 60, clientY: 110 }));
    expect(changes).toEqual([Direction.South]);
  });

  it('clears held direction when the window blurs', () => {
    const changes = mountJoystick();

    handle?.el.dispatchEvent(pointer('pointerdown', { pointerId: 5, clientX: 60, clientY: 60 }));
    handle?.el.dispatchEvent(pointer('pointermove', { pointerId: 5, clientX: 60, clientY: 110 }));
    expect(changes).toEqual([Direction.South]);

    window.dispatchEvent(new Event('blur'));
    expect(changes).toEqual([Direction.South, null]);
    expect(knobTransform()).toBe('translate(calc(-50% + 0px), calc(-50% + 0px))');
  });

  it('clears held direction when destroyed', () => {
    const changes = mountJoystick();

    handle?.el.dispatchEvent(pointer('pointerdown', { pointerId: 6, clientX: 60, clientY: 60 }));
    handle?.el.dispatchEvent(pointer('pointermove', { pointerId: 6, clientX: 10, clientY: 60 }));
    expect(changes).toEqual([Direction.West]);

    handle?.destroy();
    expect(changes).toEqual([Direction.West, null]);
  });
});
