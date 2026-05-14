import { describe, it, expect } from 'vitest';
import { startWalk, updateWalk, WALK_DURATION_MS } from '../lib/walkAnimation';
import { Direction, createPlayer } from '../lib/player';

const outfit = { lookType: 128, headColor: 0, bodyColor: 0, legsColor: 0, feetColor: 0 };

describe('startWalk', () => {
  it('initializes walk state from player position', () => {
    const player = createPlayer(10, 10, 7, outfit);
    const walk = startWalk(player, [{ x: 11, y: 10 }, { x: 12, y: 10 }], 0);
    expect(walk).not.toBeNull();
    expect(walk!.fromX).toBe(10);
    expect(walk!.fromY).toBe(10);
    expect(walk!.toX).toBe(11);
    expect(walk!.toY).toBe(10);
    expect(walk!.path).toEqual([{ x: 12, y: 10 }]);
    expect(walk!.active).toBe(true);
  });

  it('sets player direction toward first path node', () => {
    const player = createPlayer(10, 10, 7, outfit);
    startWalk(player, [{ x: 10, y: 9 }], 0);
    expect(player.direction).toBe(Direction.North);
  });

  it('returns null for empty path', () => {
    const player = createPlayer(10, 10, 7, outfit);
    expect(startWalk(player, [], 0)).toBeNull();
  });
});

describe('updateWalk', () => {
  it('interpolates position during walk', () => {
    const player = createPlayer(10, 10, 7, outfit);
    const walk = startWalk(player, [{ x: 11, y: 10 }], 0)!;

    const offset = updateWalk(walk, player, WALK_DURATION_MS / 2);
    expect(offset.offsetX).toBeCloseTo(16); // half of 32px
    expect(offset.offsetY).toBe(0);
    expect(walk.active).toBe(true);
  });

  it('completes step and moves player to destination', () => {
    const player = createPlayer(10, 10, 7, outfit);
    const walk = startWalk(player, [{ x: 11, y: 10 }], 0)!;

    updateWalk(walk, player, WALK_DURATION_MS);
    expect(player.x).toBe(11);
    expect(player.y).toBe(10);
    expect(walk.active).toBe(false);
    expect(player.animationPhase).toBe(0);
  });

  it('continues to next path node after step', () => {
    const player = createPlayer(10, 10, 7, outfit);
    const walk = startWalk(player, [{ x: 11, y: 10 }, { x: 12, y: 10 }], 0)!;

    updateWalk(walk, player, WALK_DURATION_MS);
    expect(player.x).toBe(11);
    expect(walk.active).toBe(true); // still walking to next node
    expect(walk.toX).toBe(12);
  });

  it('holds the walk phase for the duration of a step', () => {
    const player = createPlayer(10, 10, 7, outfit);
    const walk = startWalk(player, [{ x: 11, y: 10 }], 0)!;

    updateWalk(walk, player, WALK_DURATION_MS * 0.25);
    expect(player.animationPhase).toBe(1);

    updateWalk(walk, player, WALK_DURATION_MS * 0.75);
    expect(player.animationPhase).toBe(1);
  });

  it('alternates walk phase between steps so the gait does not snap', () => {
    const player = createPlayer(10, 10, 7, outfit);
    const walk = startWalk(player, [{ x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 }], 0)!;

    // Step 1: phase 1
    updateWalk(walk, player, WALK_DURATION_MS * 0.5);
    expect(player.animationPhase).toBe(1);

    // After step 1 completes, we should be on step 2 with phase 2
    updateWalk(walk, player, WALK_DURATION_MS);
    expect(player.x).toBe(11);
    updateWalk(walk, player, WALK_DURATION_MS + 50);
    expect(player.animationPhase).toBe(2);

    // After step 2 completes, step 3 with phase 1 again
    updateWalk(walk, player, WALK_DURATION_MS * 2);
    expect(player.x).toBe(12);
    updateWalk(walk, player, WALK_DURATION_MS * 2 + 50);
    expect(player.animationPhase).toBe(1);
  });

  it('returns zero offset when walk is inactive', () => {
    const player = createPlayer(10, 10, 7, outfit);
    const walk = startWalk(player, [{ x: 11, y: 10 }], 0)!;
    walk.active = false;

    const offset = updateWalk(walk, player, 50);
    expect(offset.offsetX).toBe(0);
    expect(offset.offsetY).toBe(0);
  });

  it('handles vertical walk', () => {
    const player = createPlayer(10, 10, 7, outfit);
    const walk = startWalk(player, [{ x: 10, y: 11 }], 0)!;

    const offset = updateWalk(walk, player, WALK_DURATION_MS / 2);
    expect(offset.offsetX).toBe(0);
    expect(offset.offsetY).toBeCloseTo(16);
  });
});
