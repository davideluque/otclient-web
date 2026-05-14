import { describe, it, expect } from 'vitest';
import { directionFromKnob } from '../lib/joystick';
import { Direction } from '../lib/player';

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
