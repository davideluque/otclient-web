import { battleCandidates } from './battleBinding';
import { debugConsole } from '../debugConsole';
import { createSpellBar, type SpellBarHandle } from '../spellBar';
import { loadSpellSlots, spellByWords, spellIconUrl } from '../spells';
import type { GameClient } from '../net/common/GameClient';
import type { GameWorld } from '../GameWorld';

/**
 * Combat controls: the gallery's spell-circle bar (bottom-right) wired
 * to real casting, plus a toggleable auto-attack.
 *
 * - Spells in 7.6 are cast by SAYING the words — onCast routes through
 *   the regular Say packet, so casts also appear in chat/bubbles like
 *   the original client.
 * - Auto-attack (⚔ toggle circle): acquire the nearest other creature
 *   on the player's floor and send 0xA1; the server keeps swinging at a
 *   set target on its own. The target is sticky — every 500ms it is
 *   only re-checked for validity (alive, same floor), and a new nearest
 *   is acquired when it drops, so a closer passer-by doesn't cause
 *   target dancing. Toggling off sends Attack(0) (stop).
 */
export interface CombatBindingHandle {
  /** Re-read the configured spell slots (the customizer's apply hook). */
  reloadSpells(): void;
  cast(words: string): boolean;
  cooldownUntil(words: string): number;
  /** Whether auto-attack is engaged (tests + the Settings toggle read this). */
  readonly attacking: boolean;
  /** The currently attacked creature id (0 = none) — battle list highlight. */
  readonly targetId: number;
  /** Programmatic engage/disengage — the Settings toggle's entry point. */
  setAttacking(on: boolean): void;
  /**
   * Attack a specific creature (battle list tap): engages auto-attack
   * with this exact target; the sticky logic keeps it until it dies.
   * The same id again disengages (classic battle-list toggle).
   */
  attackTarget(id: number): void;
  attackNextMonster(): void;
  destroy(): void;
}

const RETARGET_MS = 500;

/** The configured right-side slots, resolved through the registry. */
function slotSpells(): Array<{ id: string; label: string; iconUrl: string | null; cooldownMs: number }> {
  return loadSpellSlots().map((words) => {
    const def = spellByWords(words);
    return {
      id: words,
      label: def ? `${def.icon} ${def.name.split(' ')[0]}` : words,
      iconUrl: def ? spellIconUrl(def) : null,
      cooldownMs: def?.cooldownMs ?? 2000,
    };
  });
}

export function bindCombat(client: GameClient, world: GameWorld, restrictTargets = false): CombatBindingHandle {
  const protocol = client.getProtocol();
  let attacking = false;
  let currentTarget = 0;
  let monstersOnly = restrictTargets;

  const send = (packet: { toUint8Array(): Uint8Array }): boolean => {
    try {
      client.send(packet as Parameters<GameClient['send']>[0]);
      return true;
    } catch (e) {
      debugConsole?.warn('[jamera] combat send failed:', e instanceof Error ? e.message : e);
      return false;
    }
  };

  const deadlines = new Map<string, number>();
  const cooldownUntil = (words: string): number => deadlines.get(words) ?? 0;
  function cast(words: string): boolean {
    const spell = spellByWords(words);
    const now = performance.now();
    if (!spell || now < cooldownUntil(words) || client.getState() !== 'in_game') return false;
    if (!send(protocol.chat.buildSay(spell.words))) return false;
    deadlines.set(words, now + spell.cooldownMs);
    bar.triggerCooldown(words);
    return true;
  }
  const mountBar = () => createSpellBar({ spells: slotSpells(), onCast: cast, externalCooldown: true });
  let bar: SpellBarHandle = mountBar();

  // The auto-attack toggle is the bar's corner anchor — the big button
  // the spell slots fan around (the MOBA basic-attack position). The
  // circle text flips ⚔/✋ via the DOM.
  const attackBtn = document.createElement('button');
  attackBtn.type = 'button';
  attackBtn.className = 'anchor';
  attackBtn.textContent = '⚔';
  attackBtn.style.borderColor = '#555';
  bar.el.prepend(attackBtn);

  function nearestCreatureId(): number {
    // Sticky: keep the engaged target while it's still a valid kill
    // (alive, same floor) — only re-acquire when it drops out.
    if (currentTarget !== 0) {
      const current = world.getAllCreatures().find((c) => c.id === currentTarget);
      if (current && current.z === world.playerZ && current.health > 0) return currentTarget;
    }
    return battleCandidates(world, monstersOnly)[0]?.id ?? 0;
  }

  const retarget = (): void => {
    if (!attacking || client.getState() !== 'in_game') return;
    const target = nearestCreatureId();
    if (target !== currentTarget) {
      currentTarget = target;
      send(protocol.actions.buildAttack(target));
    }
  };
  const timer = setInterval(retarget, RETARGET_MS);

  // One state function shared by every control surface (the ⚔ circle
  // and the menu's Settings toggle) so they can't drift apart.
  const setAttacking = (on: boolean): void => {
    if (on === attacking) return;
    monstersOnly = restrictTargets;
    attacking = on;
    attackBtn.textContent = attacking ? '✋' : '⚔';
    attackBtn.style.borderColor = attacking ? '#d9534f' : '#555';
    if (!attacking && currentTarget !== 0) {
      currentTarget = 0;
      send(protocol.actions.buildAttack(0)); // stop
    } else {
      retarget();
    }
  };

  attackBtn.addEventListener('click', () => setAttacking(!attacking));

  const attackTarget = (id: number, restrictToMonsters = restrictTargets): void => {
    if (restrictToMonsters && !battleCandidates(world, true).some(c => c.id === id)) return;
    monstersOnly = restrictToMonsters;
    if (attacking && currentTarget === id) {
      setAttacking(false); // tap the engaged target again = stop
      return;
    }
    attacking = true;
    attackBtn.textContent = '✋';
    attackBtn.style.borderColor = '#d9534f';
    currentTarget = id;
    send(protocol.actions.buildAttack(id));
  };

  const reloadSpells = (): void => {
    // Rebuild the bar with the new slots; the ⚔ circle rides the bar,
    // so re-prepend it (it keeps its current visual state).
    bar.destroy();
    bar = mountBar();
    for (const [words, end] of deadlines) {
      const remaining = end - performance.now();
      if (remaining > 0) bar.triggerCooldown(words, remaining);
    }
    bar.el.prepend(attackBtn);
  };

  return {
    reloadSpells,
    cast,
    cooldownUntil,
    get attacking() { return attacking; },
    get targetId() { return attacking ? currentTarget : 0; },
    setAttacking,
    attackTarget,
    attackNextMonster() {
      const candidates = battleCandidates(world, true);
      if (!candidates.length) {
        setAttacking(false);
        return;
      }
      const index = candidates.findIndex((entry) => entry.id === currentTarget);
      const next = candidates[(index + 1) % candidates.length].id;
      monstersOnly = true;
      if (next !== currentTarget) attackTarget(next, true);
    },
    destroy: () => {
      clearInterval(timer);
      if (attacking && currentTarget !== 0) send(protocol.actions.buildAttack(0));
      bar.destroy();
    },
  };
}
