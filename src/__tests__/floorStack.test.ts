import { describe, it, expect } from 'vitest';
import {
  drawnFloorsBelow, drawnFloorsAbove, dirtyFloors, glideEndpoints, coveringRevisionKey,
  partitionByFloor, dirtyFloorsWithBelowOcclusion,
} from '../lib/render/floorStack';

describe('drawnFloorsBelow', () => {
  it('the surface floor draws alone — holes never show underground', () => {
    expect(drawnFloorsBelow(7)).toEqual([7]);
  });

  it('elevated surface floors see up to 3 below, deepest first', () => {
    expect(drawnFloorsBelow(3)).toEqual([6, 5, 4, 3]);
    // The cap, not the surface, is the binding constraint high up.
    expect(drawnFloorsBelow(0)).toEqual([3, 2, 1, 0]);
  });

  it('near the surface the draw range caps before the 3-floor cap', () => {
    // z=5 could see 3 below (8) but the surface stack ends at 7.
    expect(drawnFloorsBelow(5)).toEqual([7, 6, 5]);
    expect(drawnFloorsBelow(6)).toEqual([7, 6]);
  });

  it('underground the server z+2 window binds before the cap', () => {
    expect(drawnFloorsBelow(9)).toEqual([11, 10, 9]);
    expect(drawnFloorsBelow(12)).toEqual([14, 13, 12]);
  });

  it('the deepest floor draws alone', () => {
    expect(drawnFloorsBelow(15)).toEqual([15]);
    expect(drawnFloorsBelow(14)).toEqual([15, 14]);
  });
});

describe('drawnFloorsAbove', () => {
  it('roof culled — cover directly above leaves nothing to draw', () => {
    expect(drawnFloorsAbove(7, 7)).toEqual([]);
    expect(drawnFloorsAbove(10, 10)).toEqual([]);
  });

  it('open sky at the surface draws the whole stack, deepest first', () => {
    expect(drawnFloorsAbove(0, 7)).toEqual([6, 5, 4, 3, 2, 1, 0]);
  });

  it('cover higher up draws only the floors beneath it', () => {
    expect(drawnFloorsAbove(5, 7)).toEqual([6, 5]);
  });

  it('underground spans down to the z−2 base at most', () => {
    expect(drawnFloorsAbove(8, 10)).toEqual([9, 8]);
  });
});

describe('glideEndpoints', () => {
  it('at rest both endpoints are the camera tile', () => {
    expect(glideEndpoints(60, 60)).toEqual({ fromX: 60, fromY: 60, toX: 60, toY: 60 });
  });

  it('mid-glide the endpoints are the departed and destination tiles', () => {
    // Walking east, 30% through the step.
    expect(glideEndpoints(60.3, 60)).toEqual({ fromX: 60, fromY: 60, toX: 61, toY: 60 });
    // Walking north (screen up = decreasing y), 70% through.
    expect(glideEndpoints(60, 59.3)).toEqual({ fromX: 60, fromY: 59, toX: 60, toY: 60 });
  });

  it('diagonal glides yield the bounding corners', () => {
    expect(glideEndpoints(60.5, 59.5)).toEqual({ fromX: 60, fromY: 59, toX: 61, toY: 60 });
  });
});

describe('coveringRevisionKey', () => {
  const rev = (entries: Array<[number, number]>): Map<number, number> => new Map(entries);

  it('moves when a potentially-covering floor changes', () => {
    const before = coveringRevisionKey(rev([]), 7);
    const after = coveringRevisionKey(rev([[6, 1]]), 7);
    expect(after).not.toBe(before);
  });

  it('ignores the player floor and floors below it', () => {
    const before = coveringRevisionKey(rev([]), 7);
    expect(coveringRevisionKey(rev([[7, 5], [8, 2]]), 7)).toBe(before);
  });

  it('underground only watches down to the z−2 base', () => {
    // z=10 → base 8: floor 7 (stored but never drawn underground) is out.
    const before = coveringRevisionKey(rev([]), 10);
    expect(coveringRevisionKey(rev([[7, 3]]), 10)).toBe(before);
    expect(coveringRevisionKey(rev([[8, 1]]), 10)).not.toBe(before);
  });
});

describe('partitionByFloor', () => {
  const c = (id: number, z: number): { id: number; z: number } => ({ id, z });

  it('groups creatures under their floor, preserving input order', () => {
    const groups = partitionByFloor([c(1, 7), c(2, 6), c(3, 7)], [8, 7, 6]);
    expect(groups.get(7)).toEqual([c(1, 7), c(3, 7)]);
    expect(groups.get(6)).toEqual([c(2, 6)]);
  });

  it('every drawn floor gets an entry even when nobody stands on it', () => {
    const groups = partitionByFloor([c(1, 7)], [8, 7]);
    expect([...groups.keys()]).toEqual([8, 7]);
    expect(groups.get(8)).toEqual([]);
  });

  it('creatures outside the drawn set are dropped, not misfiled', () => {
    // z=5 is roof-culled here — the creature upstairs must not render.
    const groups = partitionByFloor([c(1, 5), c(2, 7)], [7, 6]);
    expect(groups.get(7)).toEqual([c(2, 7)]);
    expect(groups.get(6)).toEqual([]);
    expect(groups.has(5)).toBe(false);
  });

  it('entries follow the drawn (stacking) order, not creature order', () => {
    const groups = partitionByFloor([c(1, 6), c(2, 8)], [8, 7, 6]);
    expect([...groups.keys()]).toEqual([8, 7, 6]);
  });
});

describe('dirtyFloors', () => {
  const rev = (entries: Array<[number, number]>): Map<number, number> => new Map(entries);

  it('in-sync maps yield nothing to rebuild', () => {
    expect(dirtyFloors([9, 8, 7], rev([[9, 1], [8, 2], [7, 3]]), rev([[9, 1], [8, 2], [7, 3]])))
      .toEqual([]);
  });

  it('only the floor whose revision moved is dirty', () => {
    expect(dirtyFloors([9, 8, 7], rev([[9, 1], [8, 2], [7, 3]]), rev([[9, 1], [8, 5], [7, 3]])))
      .toEqual([8]);
  });

  it('a never-painted floor is dirty even if the world never touched it', () => {
    // painted has no entry, world has no entry (≡ 0): still must paint once.
    expect(dirtyFloors([7], rev([]), rev([]))).toEqual([7]);
  });

  it('a floor painted at revision 0 is clean until the world bumps it', () => {
    expect(dirtyFloors([7], rev([[7, 0]]), rev([]))).toEqual([]);
    expect(dirtyFloors([7], rev([[7, 0]]), rev([[7, 1]]))).toEqual([7]);
  });

  it('changes on floors outside the drawn set are ignored', () => {
    expect(dirtyFloors([8, 7], rev([[8, 1], [7, 1]]), rev([[8, 1], [7, 1], [3, 9]])))
      .toEqual([]);
  });

  it('preserves the drawn (deepest-first) order for multiple dirty floors', () => {
    expect(dirtyFloors([9, 8, 7], rev([[9, 1], [8, 1], [7, 1]]), rev([[9, 2], [8, 1], [7, 2]])))
      .toEqual([9, 7]);
  });
});

describe('dirtyFloorsWithBelowOcclusion', () => {
  const rev = (entries: Array<[number, number]>): Map<number, number> => new Map(entries);

  it('rebuilds a dirty floor and all deeper floors that depend on its occlusion', () => {
    expect(dirtyFloorsWithBelowOcclusion(
      [9, 8, 7],
      rev([[9, 1], [8, 2], [7, 3]]),
      rev([[9, 1], [8, 5], [7, 3]]),
    )).toEqual([9, 8]);
  });

  it('rebuilds the whole below stack when the shallowest floor changes', () => {
    expect(dirtyFloorsWithBelowOcclusion(
      [9, 8, 7],
      rev([[9, 1], [8, 2], [7, 3]]),
      rev([[9, 1], [8, 2], [7, 4]]),
    )).toEqual([9, 8, 7]);
  });

  it('keeps a deepest-only change scoped to that floor', () => {
    expect(dirtyFloorsWithBelowOcclusion(
      [9, 8, 7],
      rev([[9, 1], [8, 2], [7, 3]]),
      rev([[9, 2], [8, 2], [7, 3]]),
    )).toEqual([9]);
  });
});
