import { describe, it, expect } from 'vitest';
import {
  Direction,
  getCreatureSpriteId,
  buildCreatureIndex,
  createPlayer,
} from '../lib/player';
import type { FrameGroup, ThingType, DatFile } from '../lib/dat';
import { ThingCategory } from '../lib/dat';

function makeFrameGroup(opts?: Partial<FrameGroup>): FrameGroup {
  const defaults: FrameGroup = {
    width: 1,
    height: 1,
    exactSize: 32,
    layers: 1,
    numPatternX: 4,
    numPatternY: 1,
    numPatternZ: 1,
    animationPhases: 3,
    // 1*1*1*4*1*1*3 = 12 sprites
    spriteIds: [
      // phase0: N=10, E=11, S=12, W=13
      10, 11, 12, 13,
      // phase1: N=20, E=21, S=22, W=23
      20, 21, 22, 23,
      // phase2: N=30, E=31, S=32, W=33
      30, 31, 32, 33,
    ],
  };
  return { ...defaults, ...opts };
}

function makeCreature(id: number, fg?: Partial<FrameGroup>): ThingType {
  return {
    id,
    category: ThingCategory.Creature,
    attrs: new Map(),
    frameGroup: makeFrameGroup(fg),
  };
}

describe('getCreatureSpriteId', () => {
  it('returns correct sprite for direction and phase', () => {
    const fg = makeFrameGroup();
    expect(getCreatureSpriteId(fg, Direction.North, 0)).toBe(10);
    expect(getCreatureSpriteId(fg, Direction.East, 0)).toBe(11);
    expect(getCreatureSpriteId(fg, Direction.South, 0)).toBe(12);
    expect(getCreatureSpriteId(fg, Direction.West, 0)).toBe(13);
  });

  it('returns correct sprite for walk animation phases', () => {
    const fg = makeFrameGroup();
    expect(getCreatureSpriteId(fg, Direction.South, 0)).toBe(12);
    expect(getCreatureSpriteId(fg, Direction.South, 1)).toBe(22);
    expect(getCreatureSpriteId(fg, Direction.South, 2)).toBe(32);
  });

  it('clamps phase to valid range', () => {
    const fg = makeFrameGroup();
    // Phase 10 should clamp to phase 2 (max)
    expect(getCreatureSpriteId(fg, Direction.South, 10)).toBe(32);
  });

  it('clamps direction to valid range', () => {
    // Only 1 pattern X (no direction support)
    const fg = makeFrameGroup({
      numPatternX: 1,
      animationPhases: 1,
      spriteIds: [42],
    });
    expect(getCreatureSpriteId(fg, Direction.East, 0)).toBe(42);
  });

  it('returns 0 for out-of-bounds index', () => {
    const fg = makeFrameGroup({ spriteIds: [] });
    expect(getCreatureSpriteId(fg, Direction.North, 0)).toBe(0);
  });
});

describe('buildCreatureIndex', () => {
  it('indexes creatures by ID', () => {
    const dat: DatFile = {
      signature: 0,
      itemCount: 0,
      creatureCount: 2,
      effectCount: 0,
      missileCount: 0,
      items: [],
      creatures: [makeCreature(1), makeCreature(2)],
      effects: [],
      missiles: [],
    };
    const index = buildCreatureIndex(dat);
    expect(index.size).toBe(2);
    expect(index.get(1)?.id).toBe(1);
    expect(index.get(2)?.id).toBe(2);
    expect(index.has(3)).toBe(false);
  });
});

describe('createPlayer', () => {
  it('creates a player with defaults', () => {
    const player = createPlayer(100, 200, 7, {
      lookType: 128,
      headColor: 0,
      bodyColor: 0,
      legsColor: 0,
      feetColor: 0,
    });
    expect(player.x).toBe(100);
    expect(player.y).toBe(200);
    expect(player.z).toBe(7);
    expect(player.direction).toBe(Direction.South);
    expect(player.animationPhase).toBe(0);
    expect(player.outfit.lookType).toBe(128);
  });
});
