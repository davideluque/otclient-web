import { describe, it, expect } from 'vitest';
import { drawnFloorsBelow, dirtyFloors } from '../lib/render/floorStack';

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
