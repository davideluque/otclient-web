// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBattleList, healthColor } from '../lib/battleList';
import { bindBattleList } from '../lib/jamera/battleBinding';
import type { GameWorld } from '../lib/GameWorld';
import type { CombatBindingHandle } from '../lib/jamera/combatBinding';

afterEach(() => document.body.replaceChildren());

describe('createBattleList', () => {
  it('renders entries with health bars, highlights the target, reports taps', () => {
    const onSelect = vi.fn();
    const list = createBattleList({ onSelect });
    list.setEntries([
      { id: 7, name: 'Rat', healthPercent: 100, targeted: false },
      { id: 9, name: 'Rotworm', healthPercent: 15, targeted: true },
    ]);
    const entries = [...document.querySelectorAll('.battle-list .entry')];
    expect(entries).toHaveLength(2);
    expect(entries[1].classList.contains('targeted')).toBe(true);
    (entries[0] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith(7);
    list.destroy();
  });

  it('health colors follow the nameplate bands', () => {
    expect(healthColor(100)).toBe('#00bc00');
    expect(healthColor(50)).toBe('#a1a100');
    expect(healthColor(5)).toBe('#910f0f');
  });
});

describe('bindBattleList', () => {
  it('lists same-floor living creatures by distance and routes taps to attackTarget', () => {
    const creatures = [
      { id: 1, name: 'me', x: 100, y: 100, z: 7, health: 100 },   // self
      { id: 2, name: 'Far Rat', x: 110, y: 100, z: 7, health: 80 },
      { id: 3, name: 'Near Rat', x: 101, y: 100, z: 7, health: 50 },
      { id: 4, name: 'Dead', x: 100, y: 101, z: 7, health: 0 },   // dead
      { id: 5, name: 'Below', x: 100, y: 100, z: 8, health: 90 }, // other floor
    ];
    const world = {
      playerCreatureId: 1, playerX: 100, playerY: 100, playerZ: 7,
      getAllCreatures: () => creatures,
    } as unknown as GameWorld;
    const attackTarget = vi.fn();
    const combat = { attackTarget, targetId: 3 } as unknown as CombatBindingHandle;

    const binding = bindBattleList(world, () => combat);
    const names = [...document.querySelectorAll('.battle-list .name')].map((n) => n.textContent);
    expect(names).toEqual(['Near Rat', 'Far Rat']); // sorted, filtered
    expect(document.querySelector('.entry.targeted .name')?.textContent).toBe('Near Rat');

    (document.querySelector('.battle-list .entry') as HTMLButtonElement).click();
    expect(attackTarget).toHaveBeenCalledWith(3);
    binding.destroy();
    expect(document.querySelector('.battle-list')).toBeNull();
  });
});

describe('close button', () => {
  it('renders a ✕ that fires onClose', () => {
    let closed = 0;
    const list = createBattleList({ onSelect: () => {}, onClose: () => { closed++; } }, document.body);
    const btn = document.querySelector('.battle-list [aria-label="Close battle list"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(closed).toBe(1);
    list.destroy();
  });
});
