import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWalkController } from '../lib/jamera/walkController';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import type { GameClient } from '../lib/net/common/GameClient';
import type { GameWorld } from '../lib/GameWorld';
import { Direction } from '../lib/player';
import { ClientOp } from '../lib/net/7.6/opcodes';

function makeFakes() {
  const protocol = new GameProtocol();
  const sent: number[] = [];
  let state = 'in_game';
  const client = {
    getState: () => state,
    getProtocol: () => protocol,
    send: (p: { toUint8Array(): Uint8Array }) => { sent.push(p.toUint8Array()[0]); },
  } as unknown as GameClient;
  const world = { playerX: 100, playerY: 100, playerZ: 7, selfSteps: 0 } as GameWorld;
  return { client, world, sent, setState: (s: string) => { state = s; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createWalkController (one-step lookahead)', () => {
  it('banks exactly one lookahead move and never a third', () => {
    const { client, world, sent } = makeFakes();
    let held: Direction | null = Direction.East;
    const walker = createWalkController({
      client, world, getHeldDirection: () => held, tickMs: 25,
    });

    vi.advanceTimersByTime(30);
    expect(sent).toEqual([ClientOp.MoveEast]); // first send, immediate

    // The lookahead goes out only after the prequeue spacing…
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(60);
    expect(sent).toHaveLength(2);

    // …and with two outstanding, nothing more is sent.
    vi.advanceTimersByTime(400);
    expect(sent).toHaveLength(2);

    // One confirmation → one refill (after the prequeue spacing).
    world.selfSteps = 1;
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(3);

    held = null;
    world.selfSteps = 3;
    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(3); // release: pipeline drains, no new sends

    walker.destroy();
  });

  it('a Wi-Fi style confirmation burst drains both outstanding sends at once', () => {
    const { client, world, sent } = makeFakes();
    const walker = createWalkController({
      client, world, getHeldDirection: () => Direction.East, tickMs: 25,
    });
    vi.advanceTimersByTime(200); // first + lookahead out
    expect(sent).toHaveLength(2);

    world.selfSteps = 2; // both confirmations arrive together
    vi.advanceTimersByTime(30);
    expect(sent).toHaveLength(3); // refill resumes immediately

    walker.destroy();
  });

  it('flushes the whole pipeline on timeout — no stale queued move survives', () => {
    const { client, world, sent } = makeFakes();
    const walker = createWalkController({
      client, world, getHeldDirection: () => Direction.North, tickMs: 25, stepTimeoutMs: 300,
    });

    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(2); // first + lookahead, никто confirmed

    // No confirmation (blocked tile): after the timeout the controller
    // flushes both and tries fresh instead of wedging.
    vi.advanceTimersByTime(200);
    expect(sent.length).toBeGreaterThanOrEqual(3);

    walker.destroy();
  });

  it('goes quiet outside in_game and clears its pipeline', () => {
    const { client, world, sent, setState } = makeFakes();
    const walker = createWalkController({
      client, world, getHeldDirection: () => Direction.South, tickMs: 25,
    });

    vi.advanceTimersByTime(30);
    expect(sent).toHaveLength(1);

    setState('disconnected');
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);

    walker.destroy();
  });

  it('stops ticking after destroy', () => {
    const { client, world, sent } = makeFakes();
    const walker = createWalkController({
      client, world, getHeldDirection: () => Direction.West, tickMs: 25,
    });
    walker.destroy();
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(0);
  });
});
