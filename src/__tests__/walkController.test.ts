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

describe('createWalkController cancel (server 0xB5)', () => {
  it('flushes the pipeline and suppresses re-sends into the wall for 250ms', () => {
    const { client, world, sent } = makeFakes();
    const walker = createWalkController({
      client, world, getHeldDirection: () => Direction.East, tickMs: 25,
    });

    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(2); // first + lookahead, none confirmed

    walker.cancel();
    // Still held into the wall: quiet — no send→0xB5→send loop…
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(2);
    // …but the flush freed both slots, so once the window elapses a
    // retry goes out long before the 800ms step timeout would have.
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(3);

    walker.destroy();
  });

  it('suppresses the wire direction, not a newer lookahead direction', () => {
    const { client, world, sent } = makeFakes();
    let held: Direction | null = Direction.East;
    const walker = createWalkController({
      client, world, getHeldDirection: () => held, tickMs: 25,
    });

    vi.advanceTimersByTime(150); // first send goes out east
    held = Direction.North;
    vi.advanceTimersByTime(50); // lookahead goes out north
    expect(sent).toHaveLength(2);

    // The wall was east — the 0xB5 carries east even though the last
    // SENT direction was north. North must not be stalled.
    walker.cancel(Direction.East);
    vi.advanceTimersByTime(30);
    expect(sent).toHaveLength(3);
    expect(sent[2]).toBe(ClientOp.MoveNorth);

    walker.destroy();
  });

  it('a held-direction change lifts the suppression immediately', () => {
    const { client, world, sent } = makeFakes();
    let held: Direction | null = Direction.East;
    const walker = createWalkController({
      client, world, getHeldDirection: () => held, tickMs: 25,
    });

    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(2);

    walker.cancel();
    held = Direction.North; // turned away from the wall
    vi.advanceTimersByTime(30);
    expect(sent).toHaveLength(3); // no 250ms wait
    expect(sent[2]).toBe(ClientOp.MoveNorth);

    walker.destroy();
  });

  it('cancel with nothing outstanding is harmless and still rate-limits', () => {
    const { client, world, sent } = makeFakes();
    let held: Direction | null = null;
    const walker = createWalkController({
      client, world, getHeldDirection: () => held, tickMs: 25,
    });

    vi.advanceTimersByTime(100);
    walker.cancel();
    expect(sent).toHaveLength(0);

    // Nothing was ever sent, so there is no wall direction to suppress:
    // a fresh hold starts walking immediately.
    held = Direction.South;
    vi.advanceTimersByTime(30);
    expect(sent).toEqual([ClientOp.MoveSouth]);

    walker.destroy();
  });
});
