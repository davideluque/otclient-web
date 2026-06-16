import { describe, it, expect } from 'vitest';
import { expansionRegionForDestination, expansionRegionForViewportEdge } from '../lib/regionExpansion';
import type { Bounds } from '../lib/tileMap';

const bounds: Bounds = { minX: 100, maxX: 300, minY: 100, maxY: 300 };

describe('expansionRegionForViewportEdge', () => {
  it('returns null when viewport is comfortably inside bounds', () => {
    const visible = { x1: 170, y1: 170, x2: 230, y2: 230 };
    expect(expansionRegionForViewportEdge(bounds, visible, 7, 30)).toBeNull();
  });

  it('triggers west expansion when near left edge', () => {
    const visible = { x1: 105, y1: 180, x2: 150, y2: 220 };
    const region = expansionRegionForViewportEdge(bounds, visible, 7, 30);
    expect(region).not.toBeNull();
    expect(region!.centerX).toBeLessThan(bounds.minX);
    expect(region!.z).toBe(7);
  });

  it('triggers east expansion when near right edge', () => {
    const visible = { x1: 250, y1: 180, x2: 295, y2: 220 };
    const region = expansionRegionForViewportEdge(bounds, visible, 7, 30);
    expect(region).not.toBeNull();
    expect(region!.centerX).toBeGreaterThan(bounds.maxX);
  });

  it('triggers north expansion when near top edge', () => {
    const visible = { x1: 180, y1: 105, x2: 220, y2: 150 };
    const region = expansionRegionForViewportEdge(bounds, visible, 7, 30);
    expect(region).not.toBeNull();
    expect(region!.centerY).toBeLessThan(bounds.minY);
  });

  it('triggers south expansion when near bottom edge', () => {
    const visible = { x1: 180, y1: 250, x2: 220, y2: 295 };
    const region = expansionRegionForViewportEdge(bounds, visible, 7, 30);
    expect(region).not.toBeNull();
    expect(region!.centerY).toBeGreaterThan(bounds.maxY);
  });

  it('returns null when bounds are null', () => {
    const visible = { x1: 0, y1: 0, x2: 50, y2: 50 };
    expect(expansionRegionForViewportEdge(null, visible, 7, 30)).toBeNull();
  });

  it('respects z parameter in returned region', () => {
    const visible = { x1: 105, y1: 180, x2: 150, y2: 220 };
    const region = expansionRegionForViewportEdge(bounds, visible, 5, 30);
    expect(region!.z).toBe(5);
  });
});

describe('expansionRegionForDestination', () => {
  it('returns null when destination is comfortably inside bounds', () => {
    expect(expansionRegionForDestination(bounds, 200, 200, 7, 30)).toBeNull();
  });

  it('triggers when destination is near left edge', () => {
    const region = expansionRegionForDestination(bounds, 110, 200, 7, 30);
    expect(region).not.toBeNull();
    expect(region!.z).toBe(7);
    expect(region!.radius).toBeGreaterThanOrEqual(100);
  });

  it('triggers when destination is outside bounds entirely', () => {
    const region = expansionRegionForDestination(bounds, 500, 200, 7, 30);
    expect(region).not.toBeNull();
    expect(region!.radius).toBeGreaterThan(100);
  });

  it('returns null when bounds are null', () => {
    expect(expansionRegionForDestination(null, 200, 200, 7, 30)).toBeNull();
  });

  it('uses dynamic radius based on distance', () => {
    const near = expansionRegionForDestination(bounds, 120, 200, 7, 30);
    const far = expansionRegionForDestination(bounds, 600, 200, 7, 30);
    expect(far!.radius).toBeGreaterThan(near!.radius);
  });

  it('triggers when destination is near bottom edge', () => {
    const region = expansionRegionForDestination(bounds, 200, 290, 7, 30);
    expect(region).not.toBeNull();
  });

  it('centers between the nearest bounds edge and the destination, not the bounds center', () => {
    // Destination 200 tiles east of maxX. Measured from the nearest edge
    // (x=300), the region centers at x=400 and reaches the destination.
    // The old bounds-center math would have centered at x=350 with the
    // same y-skew problem on tall maps.
    const region = expansionRegionForDestination(bounds, 500, 200, 7, 30)!;
    expect(region.centerX).toBe(400);
    expect(region.centerY).toBe(200);
    expect(Math.abs(500 - region.centerX)).toBeLessThanOrEqual(region.radius);
  });

  it('reaches a far destination on a large explored map (regression: bounds-center skew)', () => {
    // Big map: bounds center is at x=1000, destination just past the east
    // edge at x=2050. Edge-based measurement puts the center at 2025 with
    // the minimum radius — and the destination inside the region. The old
    // center-based math produced center 1525 / radius ~500: the region's
    // east edge barely grazed the destination while re-parsing ~1000
    // already-loaded tiles.
    const big: Bounds = { minX: 0, maxX: 2000, minY: 0, maxY: 2000 };
    const region = expansionRegionForDestination(big, 2050, 1000, 7, 30)!;
    expect(Math.abs(2050 - region.centerX)).toBeLessThanOrEqual(region.radius);
    expect(region.centerX).toBeGreaterThan(2000);
  });
});

describe('expansionRegionForViewportEdge edge precedence', () => {
  it('prefers west over north when the viewport is near both edges', () => {
    // Documented behavior, not an accident: the edge checks run
    // west → east → north → south and return on the first hit. A
    // viewport hugging the top-left corner expands west first; the
    // north expansion happens on a later call once west is satisfied.
    const visible = { x1: 110, y1: 110, x2: 150, y2: 150 };
    const region = expansionRegionForViewportEdge(bounds, visible, 7, 30)!;
    expect(region.centerX).toBeLessThan(bounds.minX);
    expect(region.centerY).toBe(Math.floor((visible.y1 + visible.y2) / 2));
  });
});
