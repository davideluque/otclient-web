import { describe, expect, it } from 'vitest';
import {
  FORWARD_STEP_MAX_MS,
  FORWARD_STEP_MIN_MS,
  RENDER_DELAY_MS,
  STEP_GLIDE_DEFAULT_MS,
  STEP_GLIDE_MIN_MS,
  expectedStepMs,
  forwardStateAt,
  nextStepEma,
  playbackPosAt,
  playbackStateAt,
  appendPlaybackSample,
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

describe('expectedStepMs (server step-duration formula)', () => {
  it('matches otserv getStepDuration: 1000 × ground / speed', () => {
    // NPC base speed 110 on grass (ground speed 150) ≈ 1364ms/tile.
    expect(expectedStepMs(110, 150, false)).toBe(1364);
    expect(expectedStepMs(220, 150, false)).toBe(682);
  });

  it('doubles on diagonal steps', () => {
    expect(expectedStepMs(220, 150, true)).toBe(1364);
  });

  it('clamps degenerate values instead of freezing or teleporting', () => {
    expect(expectedStepMs(0, 150, false)).toBe(STEP_GLIDE_DEFAULT_MS);
    expect(expectedStepMs(10, 150, false)).toBe(FORWARD_STEP_MAX_MS);
    expect(expectedStepMs(5000, 150, false)).toBe(FORWARD_STEP_MIN_MS);
  });

  it('falls back to a typical ground speed when the tile is unknown', () => {
    expect(expectedStepMs(110, 0, false)).toBe(expectedStepMs(110, 150, false));
  });
});

describe('forwardStateAt (non-self creatures glide at their true speed)', () => {
  const npcStep: PlaybackSample[] = [
    { x: 100, y: 200, z: 7, at: 1000 },
    { x: 101, y: 200, z: 7, at: 5000, stepMs: 1364 },
  ];

  it('an NPC step spends its full duration crossing the tile', () => {
    // Standing at the old tile until the move sample plays...
    expect(forwardStateAt(npcStep, 4999)).toEqual({ x: 100, y: 200, moving: false });
    // ...then ambles across over stepMs, not RENDER_DELAY_MS.
    expect(forwardStateAt(npcStep, 5000)).toEqual({ x: 100, y: 200, moving: true });
    expect(forwardStateAt(npcStep, 5682).x).toBeCloseTo(100.5, 2);
    expect(forwardStateAt(npcStep, 6364)).toEqual({ x: 101, y: 200, moving: false });
  });

  it('a follow-up sample cuts the glide short at its own timestamp', () => {
    const burst: PlaybackSample[] = [
      { x: 100, y: 200, z: 7, at: 1000 },
      { x: 101, y: 200, z: 7, at: 2000, stepMs: 1364 },
      { x: 102, y: 200, z: 7, at: 2400, stepMs: 1364 },
    ];
    // Step into x=101 compresses into the actual 400ms gap.
    expect(forwardStateAt(burst, 2200).x).toBeCloseTo(100.5, 5);
    // Then the step into x=102 starts from x=101, no overshoot.
    expect(forwardStateAt(burst, 2400)).toEqual({ x: 101, y: 200, moving: true });
  });

  it('holds then snaps across discontinuities (floor change / teleport)', () => {
    const tele: PlaybackSample[] = [
      { x: 100, y: 200, z: 7, at: 1000 },
      { x: 130, y: 220, z: 8, at: 1500, stepMs: 500 },
    ];
    expect(forwardStateAt(tele, 1499)).toEqual({ x: 100, y: 200, moving: false });
    expect(forwardStateAt(tele, 1500)).toEqual({ x: 130, y: 220, moving: false });
  });

  it('rests at the first sample before the timeline starts, and handles empty', () => {
    expect(forwardStateAt(npcStep, 500)).toEqual({ x: 100, y: 200, moving: false });
    expect(forwardStateAt([], 500)).toEqual({ x: 0, y: 0, moving: false });
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

describe('appendPlaybackSample (floor changes snap)', () => {
  it('appends same-floor steps, keeping glide history', () => {
    const p = { samples: [{ x: 100, y: 200, z: 7, at: 1000 }] as PlaybackSample[], cadence: 380 };
    appendPlaybackSample(p, { x: 101, y: 200, z: 7, at: 1400 }, 400);
    expect(p.samples).toHaveLength(2);
    expect(p.samples[1]).toMatchObject({ x: 101, y: 200, z: 7, at: 1400 });
  });

  it('a floor change flushes the buffer — teleport, never a glide', () => {
    // Walking north, then the step onto the stairs teleports up a floor.
    const p = {
      samples: [
        { x: 100, y: 209, z: 7, at: 1000 },
        { x: 100, y: 208, z: 7, at: 1400 },
      ] as PlaybackSample[],
      cadence: 380,
    };
    appendPlaybackSample(p, { x: 100, y: 206, z: 6, at: 1450 }, 400);
    expect(p.samples).toHaveLength(1);
    expect(p.samples[0]).toMatchObject({ x: 100, y: 206, z: 6 });
    // Backdated past the render delay: the very next frame renders the
    // landing tile — no 180ms of standing on the old floor "behind the
    // stairs" while the floor stack has already switched.
    const selfState = playbackStateAt(p.samples, 380, 1451 - RENDER_DELAY_MS);
    expect(selfState).toMatchObject({ x: 100, y: 206, moving: false });
    const otherState = forwardStateAt(p.samples, 1451 - RENDER_DELAY_MS);
    expect(otherState).toMatchObject({ x: 100, y: 206, moving: false });
  });

  it('ignores a no-op sync (same tile)', () => {
    const p = { samples: [{ x: 100, y: 200, z: 7, at: 1000 }] as PlaybackSample[], cadence: 380 };
    appendPlaybackSample(p, { x: 100, y: 200, z: 7, at: 2000 }, 400);
    expect(p.samples).toHaveLength(1);
  });
});
