// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindCombat } from '../lib/jamera/combatBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import type { GameClient } from '../lib/net/common/GameClient';
import type { GameWorld } from '../lib/GameWorld';

function makeWorld(creatures: Array<{ id: number; x: number; y: number; z: number; health: number }>): GameWorld {
  return {
    playerCreatureId: 1,
    playerX: 100, playerY: 100, playerZ: 7,
    getAllCreatures: () => creatures,
  } as unknown as GameWorld;
}

function makeClient() {
  const protocol = new GameProtocol();
  const sent: number[][] = [];
  const client = {
    getProtocol: () => protocol,
    getState: () => 'in_game',
    send: (p: { toUint8Array(): Uint8Array }) => sent.push([...p.toUint8Array()]),
  } as unknown as GameClient;
  return { client, sent };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('bindCombat', () => {
  it('casts spells by saying the words', () => {
    const { client, sent } = makeClient();
    bindCombat(client, makeWorld([]));

    const exura = [...document.querySelectorAll('.spell-bar button')]
      .find((b) => b.textContent === 'exura') as HTMLButtonElement;
    exura.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(0x96); // Say
  });

  it('attacks the nearest living creature when toggled, stops when toggled off', () => {
    const { client, sent } = makeClient();
    const world = makeWorld([
      { id: 1, x: 100, y: 100, z: 7, health: 100 },  // self — skipped
      { id: 7, x: 103, y: 100, z: 7, health: 100 },  // 3 tiles away
      { id: 9, x: 101, y: 101, z: 7, health: 100 },  // nearest (chebyshev 1)
      { id: 11, x: 100, y: 99, z: 7, health: 0 },    // dead — skipped
    ]);
    const binding = bindCombat(client, world);

    const toggle = [...document.querySelectorAll('.spell-bar button')]
      .find((b) => b.textContent === '⚔') as HTMLButtonElement;
    toggle.click();
    expect(binding.attacking).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(0xa1);
    expect(sent[0][1]).toBe(9); // nearest id, little-endian U32

    // Same target on later ticks → no resend spam.
    vi.advanceTimersByTime(1600);
    expect(sent).toHaveLength(1);

    toggle.click(); // off → stop packet
    expect(binding.attacking).toBe(false);
    expect(sent).toHaveLength(2);
    expect(sent[1].slice(1)).toEqual([0, 0, 0, 0]);

    binding.destroy();
  });

  it('sticks to the engaged target until it dies, then re-acquires the nearest', () => {
    const { client, sent } = makeClient();
    const creatures = [
      { id: 1, x: 100, y: 100, z: 7, health: 100 }, // self
      { id: 7, x: 102, y: 100, z: 7, health: 100 }, // nearest at engage time
    ];
    const world = makeWorld(creatures);
    const binding = bindCombat(client, world);

    const toggle = [...document.querySelectorAll('.spell-bar button')]
      .find((b) => b.textContent === '⚔') as HTMLButtonElement;
    toggle.click();
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toBe(7);

    // A closer creature walks by — the engaged target must NOT change.
    creatures.push({ id: 9, x: 101, y: 100, z: 7, health: 100 });
    vi.advanceTimersByTime(1600);
    expect(sent).toHaveLength(1);

    // The engaged target dies — re-acquire the nearest living one.
    creatures[1].health = 0;
    vi.advanceTimersByTime(600);
    expect(sent).toHaveLength(2);
    expect(sent[1][0]).toBe(0xa1);
    expect(sent[1][1]).toBe(9);

    binding.destroy();
  });
});
