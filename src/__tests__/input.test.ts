import { describe, it, expect } from 'vitest';
import { screenToTile, directionTo, stepInDirection } from '../lib/input';
import { Direction } from '../lib/player';
import { Viewport } from '../lib/viewport';

describe('screenToTile', () => {
  function makeViewport(centerX = 10, centerY = 10) {
    return new Viewport({
      centerX,
      centerY,
      screenWidth: 640,
      screenHeight: 480,
      zoom: 1,
    });
  }

  it('converts screen center to camera center tile', () => {
    const vp = makeViewport(10, 10);
    // Screen center (320, 240) should map to tile (10, 10)
    const tile = screenToTile(320, 240, vp);
    expect(tile.x).toBe(10);
    expect(tile.y).toBe(10);
  });

  it('converts screen corner to offset tile', () => {
    const vp = makeViewport(10, 10);
    // Top-left corner of screen should map to a tile left/above center
    const tile = screenToTile(0, 0, vp);
    expect(tile.x).toBeLessThan(10);
    expect(tile.y).toBeLessThan(10);
  });

  it('respects zoom level', () => {
    const vp = new Viewport({
      centerX: 0,
      centerY: 0,
      screenWidth: 640,
      screenHeight: 480,
      zoom: 2,
    });
    // At zoom 2, tiles are 64px each
    // Screen center (320, 240) → tile (0, 0)
    const tile = screenToTile(320, 240, vp);
    expect(tile.x).toBe(0);
    expect(tile.y).toBe(0);
  });
});

describe('directionTo', () => {
  it('returns East for positive X delta', () => {
    expect(directionTo(0, 0, 5, 0)).toBe(Direction.East);
  });

  it('returns West for negative X delta', () => {
    expect(directionTo(5, 0, 0, 0)).toBe(Direction.West);
  });

  it('returns South for positive Y delta', () => {
    expect(directionTo(0, 0, 0, 5)).toBe(Direction.South);
  });

  it('returns North for negative Y delta', () => {
    expect(directionTo(0, 5, 0, 0)).toBe(Direction.North);
  });

  it('returns null for same position', () => {
    expect(directionTo(3, 3, 3, 3)).toBeNull();
  });

  it('prefers X axis when deltas are equal', () => {
    expect(directionTo(0, 0, 3, 3)).toBe(Direction.East);
  });

  it('returns correct direction for diagonal (Y dominant)', () => {
    expect(directionTo(0, 0, 1, 5)).toBe(Direction.South);
  });
});

describe('stepInDirection', () => {
  it('steps North', () => {
    expect(stepInDirection(5, 5, Direction.North)).toEqual({ x: 5, y: 4 });
  });

  it('steps East', () => {
    expect(stepInDirection(5, 5, Direction.East)).toEqual({ x: 6, y: 5 });
  });

  it('steps South', () => {
    expect(stepInDirection(5, 5, Direction.South)).toEqual({ x: 5, y: 6 });
  });

  it('steps West', () => {
    expect(stepInDirection(5, 5, Direction.West)).toEqual({ x: 4, y: 5 });
  });
});
