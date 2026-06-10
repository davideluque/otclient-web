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
  const world = { playerX: 100, playerY: 100, playerZ: 7 } as GameWorld;
  return { client, world, sent, setState: (s: string) => { state = s; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createWalkController', () => {
  it('sends one move per server-confirmed step while a direction is held', () => {
    const { client, world, sent } = makeFakes();
    let held: Direction | null = Direction.East;
    const walker = createWalkController({
      client, world, getHeldDirection: () => held, tickMs: 60,
    });

    vi.advanceTimersByTime(70);
    expect(sent).toEqual([ClientOp.MoveEast]);

    // Held but unconfirmed: no resend.
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(1);

    // Server confirms (Move* handler bumps the world position) → next step.
    world.playerX += 1;
    vi.advanceTimersByTime(70);
    expect(sent).toEqual([ClientOp.MoveEast, ClientOp.MoveEast]);

    held = null;
    world.playerX += 1;
    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(2);

    walker.destroy();
  });

  it('re-arms after the step timeout when the server rejects the move', () => {
    const { client, world, sent } = makeFakes();
    const walker = createWalkController({
      client, world, getHeldDirection: () => Direction.North, tickMs: 60, stepTimeoutMs: 300,
    });

    vi.advanceTimersByTime(70);
    expect(sent).toHaveLength(1);

    // No confirmation (blocked tile / CancelWalk): after the timeout the
    // controller tries again instead of wedging forever.
    vi.advanceTimersByTime(400);
    expect(sent).toHaveLength(2);

    walker.destroy();
  });

  it('goes quiet outside in_game and clears its pending step', () => {
    const { client, world, sent, setState } = makeFakes();
    const walker = createWalkController({
      client, world, getHeldDirection: () => Direction.South, tickMs: 60,
    });

    vi.advanceTimersByTime(70);
    expect(sent).toHaveLength(1);

    setState('disconnected');
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);

    walker.destroy();
  });

  it('stops ticking after destroy', () => {
    const { client, world, sent } = makeFakes();
    const walker = createWalkController({
      client, world, getHeldDirection: () => Direction.West, tickMs: 60,
    });
    walker.destroy();
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(0);
  });
});
