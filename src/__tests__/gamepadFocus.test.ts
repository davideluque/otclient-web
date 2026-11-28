import { expect, it } from 'vitest';
import { neighbour } from '../lib/gamepad/focus';
import { Direction } from '../lib/player';
it('moves around a two-dimensional grid and stays on its edge', () => {
  const rects = [[0,0],[100,0],[0,50],[100,50]].map(([left, top]) => ({left, top, width:80, height:40} as DOMRect));
  expect(neighbour(rects,0,Direction.East)).toBe(1);
  expect(neighbour(rects,1,Direction.South)).toBe(3);
  expect(neighbour(rects,3,Direction.South)).toBe(3);
  expect(neighbour(rects,-1,Direction.West)).toBe(0);
});
