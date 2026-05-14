import { describe, it, expect } from 'vitest';
import { needsExpansion } from '../lib/regionExpansion';
import type { Bounds } from '../lib/tileMap';

const bounds: Bounds = { minX: 100, maxX: 300, minY: 100, maxY: 300 };

describe('needsExpansion', () => {
  it('returns null when viewport is comfortably inside bounds', () => {
    const visible = { x1: 170, y1: 170, x2: 230, y2: 230 };
    expect(needsExpansion(bounds, visible, 7, 30)).toBeNull();
  });

  it('triggers west expansion when near left edge', () => {
    const visible = { x1: 105, y1: 180, x2: 150, y2: 220 };
    const region = needsExpansion(bounds, visible, 7, 30);
    expect(region).not.toBeNull();
    expect(region!.centerX).toBeLessThan(bounds.minX);
    expect(region!.z).toBe(7);
  });

  it('triggers east expansion when near right edge', () => {
    const visible = { x1: 250, y1: 180, x2: 295, y2: 220 };
    const region = needsExpansion(bounds, visible, 7, 30);
    expect(region).not.toBeNull();
    expect(region!.centerX).toBeGreaterThan(bounds.maxX);
  });

  it('triggers north expansion when near top edge', () => {
    const visible = { x1: 180, y1: 105, x2: 220, y2: 150 };
    const region = needsExpansion(bounds, visible, 7, 30);
    expect(region).not.toBeNull();
    expect(region!.centerY).toBeLessThan(bounds.minY);
  });

  it('triggers south expansion when near bottom edge', () => {
    const visible = { x1: 180, y1: 250, x2: 220, y2: 295 };
    const region = needsExpansion(bounds, visible, 7, 30);
    expect(region).not.toBeNull();
    expect(region!.centerY).toBeGreaterThan(bounds.maxY);
  });

  it('returns null when bounds are null', () => {
    const visible = { x1: 0, y1: 0, x2: 50, y2: 50 };
    expect(needsExpansion(null, visible, 7, 30)).toBeNull();
  });

  it('respects z parameter in returned region', () => {
    const visible = { x1: 105, y1: 180, x2: 150, y2: 220 };
    const region = needsExpansion(bounds, visible, 5, 30);
    expect(region!.z).toBe(5);
  });
});
