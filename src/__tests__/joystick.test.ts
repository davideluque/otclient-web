import { describe, it, expect } from 'vitest';
import { directionFromKnob } from '../lib/joystick';
import { Direction } from '../lib/player';

describe('directionFromKnob', () => {
  const RADIUS = 60;

  it('returns null inside the dead zone', () => {
    expect(directionFromKnob(0, 0, RADIUS)).toBeNull();
    // Default dead zone is 25% of radius = 15px.
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
    // Exact 45° — both axes equal magnitude. The convention is X wins.
    expect(directionFromKnob(30, 30, RADIUS)).toBe(Direction.East);
    expect(directionFromKnob(-30, -30, RADIUS)).toBe(Direction.West);
  });

  it('respects a custom dead-zone fraction', () => {
    expect(directionFromKnob(20, 0, RADIUS, 0.5)).toBeNull(); // 50% of 60 = 30
    expect(directionFromKnob(35, 0, RADIUS, 0.5)).toBe(Direction.East);
  });
});
