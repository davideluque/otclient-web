import { describe, expect, it } from 'vitest';
import {
  RENDER_DELAY_MS,
  STEP_GLIDE_MIN_MS,
  nextStepEma,
  playbackPosAt,
  playbackStateAt,
  type PlaybackSample,
} from '../lib/jamera/renderer';
import { GameWorld } from '../lib/GameWorld';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';

describe('playbackPosAt (playout buffer)', () => {
  const walk: PlaybackSample[] = [
    { x: 100, y: 200, z: 7, at: 1000 },
    { x: 101, y: 200, z: 7, at: 1400 },
    { x: 102, y: 200, z: 7, at: 1800 },
  ];

  it('interpolates each segment to land ON the sample at its timestamp', () => {
    expect(playbackPosAt(walk, 400, 1000)).toEqual({ x: 100, y: 200 });
    // The 180ms buffer is all the history available when the endpoint
    // arrives, so a slower cadence must not retroactively start earlier.
    expect(playbackPosAt(walk, 400, 1219)).toEqual({ x: 100, y: 200 });
    expect(playbackPosAt(walk, 400, 1310).x).toBeCloseTo(100.5, 5);
    expect(playbackPosAt(walk, 400, 1399).x).toBeCloseTo(100 + 179 / 180, 5);
    expect(playbackPosAt(walk, 400, 1710).x).toBeCloseTo(101.5, 5);
    expect(playbackPosAt(walk, 400, 5000)).toEqual({ x: 102, y: 200 }); // drained
  });

  it('never jumps into a step when its endpoint sample first arrives', () => {
    const afterPause: PlaybackSample[] = [
      { x: 100, y: 200, z: 7, at: 1000 },
      { x: 101, y: 200, z: 7, at: 5000 },
    ];
    // At wall-clock 5000 the renderer asks for 5000 - RENDER_DELAY_MS.
    // Before this fix the default 380ms cadence jumped 53% of a tile here.
    const state = playbackStateAt(afterPause, 380, 5000 - RENDER_DELAY_MS);
    expect(state).toEqual({ x: 100, y: 200, moving: true });
  });

  it('reports walking only for the visual glide, then returns to idle', () => {
    expect(playbackStateAt(walk, 400, 1219).moving).toBe(false);
    expect(playbackStateAt(walk, 400, 1220).moving).toBe(true);
    expect(playbackStateAt(walk, 400, 1399).moving).toBe(true);
    expect(playbackStateAt(walk, 400, 1400).moving).toBe(false);
  });

  it('a delivery burst (samples closer than cadence) still renders continuously', () => {
    const burst: PlaybackSample[] = [
      { x: 100, y: 200, z: 7, at: 1000 },
      { x: 101, y: 200, z: 7, at: 1100 }, // 100ms apart, cadence 400
    ];
    // The glide compresses into the actual 100ms gap — no overshoot, no jump back.
    expect(playbackPosAt(burst, 400, 1050).x).toBeCloseTo(100.5, 5);
    expect(playbackPosAt(burst, 400, 1100).x).toBe(101);
  });

  it('holds then snaps across discontinuities (floor change / teleport)', () => {
    const tele: PlaybackSample[] = [
      { x: 100, y: 200, z: 7, at: 1000 },
      { x: 130, y: 220, z: 8, at: 1500 },
    ];
    expect(playbackPosAt(tele, 400, 1499)).toEqual({ x: 100, y: 200 }); // holds
    expect(playbackPosAt(tele, 400, 1500)).toEqual({ x: 130, y: 220 }); // snaps
  });

  it('renders at the first sample before the timeline starts, and handles empty', () => {
    expect(playbackPosAt(walk, 400, 500)).toEqual({ x: 100, y: 200 });
    expect(playbackPosAt([], 400, 500)).toEqual({ x: 0, y: 0 });
  });

  it('exposes a sane render delay', () => {
    expect(RENDER_DELAY_MS).toBeGreaterThanOrEqual(120);
    expect(RENDER_DELAY_MS).toBeLessThanOrEqual(250);
  });
});

describe('nextStepEma', () => {
  it('converges toward plausible step durations', () => {
    let ema = 380;
    for (let i = 0; i < 20; i++) ema = nextStepEma(ema, 280);
    expect(ema).toBeLessThan(300);
    expect(ema).toBeGreaterThanOrEqual(280);
  });

  it('rejects arrival jitter and pauses (>500ms) and bursts (<150ms)', () => {
    expect(nextStepEma(400, 586)).toBe(400);
    expect(nextStepEma(400, 5000)).toBe(400);
    expect(nextStepEma(400, STEP_GLIDE_MIN_MS - 1)).toBe(400);
  });
});

describe('floor-change resync slices do not record walk confirmations', () => {
  it('snapSelfSync suppresses the origin and self-step count until a microtask re-arms it', async () => {
    const world = new GameWorld(new GameProtocol());
    world.playerCreatureId = 7;
    world.playerX = 50; world.playerY = 60; world.playerZ = 7;
    // @ts-expect-error private registry
    world.creatures.set(7, {
      id: 7, name: 'me', x: 50, y: 60, z: 7,
      direction: 2, health: 100, speed: 220,
      outfit: { lookType: 128, head: 0, body: 0, legs: 0, feet: 0 },
    });
    // @ts-expect-error private flag
    world.snapSelfSync = true;
    queueMicrotask(() => {
      // @ts-expect-error private flag
      world.snapSelfSync = false;
    });

    world.playerX = 49;
    // @ts-expect-error private method
    world.syncSelfCreature(50, 60, 7);
    expect(world.getCreature(7)?.fromX).toBeUndefined();
    expect(world.selfSteps).toBe(0);

    await Promise.resolve();

    world.playerY = 59;
    // @ts-expect-error private method
    world.syncSelfCreature(49, 60, 7);
    expect(world.getCreature(7)?.fromX).toBe(49);
    expect(world.selfSteps).toBe(1);
  });
});
