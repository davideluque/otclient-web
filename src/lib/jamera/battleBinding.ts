import { createBattleList, type BattleListHandle } from '../battleList';
import type { GameWorld } from '../GameWorld';
import type { CombatBindingHandle } from './combatBinding';

/**
 * Live battle list: visible creatures on the player's floor, sorted by
 * distance, refreshed on a timer (the renderer owns world.onChange).
 * Tapping an entry routes through the combat binding's attackTarget —
 * the ⚔ circle, the sticky retarget logic, and the highlight all stay
 * in sync because the combat binding owns the single source of truth.
 */
export interface BattleBindingHandle {
  readonly list: BattleListHandle;
  setVisible(visible: boolean): void;
  readonly visible: boolean;
  destroy(): void;
}

const REFRESH_MS = 500;

export function bindBattleList(
  world: GameWorld,
  combat: () => CombatBindingHandle | null,
  parent: HTMLElement = document.body,
): BattleBindingHandle {
  const list = createBattleList({
    onSelect: (id) => combat()?.attackTarget(id),
  }, parent);

  const refresh = (): void => {
    const targetId = combat()?.targetId ?? 0;
    const entries = world.getAllCreatures()
      .filter((c) => c.id !== world.playerCreatureId && c.z === world.playerZ && c.health > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        healthPercent: c.health,
        targeted: c.id === targetId,
        dist: Math.max(Math.abs(c.x - world.playerX), Math.abs(c.y - world.playerY)),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 25);
    list.setEntries(entries);
  };

  refresh();
  const timer = setInterval(() => {
    if (list.visible) refresh();
  }, REFRESH_MS);

  return {
    list,
    get visible() { return list.visible; },
    setVisible: (v) => list.setVisible(v),
    destroy: () => {
      clearInterval(timer);
      list.destroy();
    },
  };
}
