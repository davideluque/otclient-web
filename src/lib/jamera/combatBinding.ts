import { createSpellBar, type SpellBarHandle } from '../spellBar';
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
  /** Exposed for tests: whether auto-attack is engaged. */
  readonly attacking: boolean;
  destroy(): void;
}

const RETARGET_MS = 500;

const SPELLS = [
  { id: 'exura', label: 'exura', cooldownMs: 1000 },
  { id: 'exura vita', label: 'vita', cooldownMs: 2000 },
  { id: 'utevo lux', label: 'lux', cooldownMs: 2000 },
] as const;

export function bindCombat(client: GameClient, world: GameWorld): CombatBindingHandle {
  const protocol = client.getProtocol();
  let attacking = false;
  let currentTarget = 0;

  const send = (packet: { toUint8Array(): Uint8Array }): void => {
    try {
      client.send(packet as Parameters<GameClient['send']>[0]);
    } catch (e) {
      console.warn('[jamera] combat send failed:', e instanceof Error ? e.message : e);
    }
  };

  const bar: SpellBarHandle = createSpellBar({
    spells: [...SPELLS],
    onCast: (id) => send(protocol.chat.buildSay(id)),
  });

  // The auto-attack toggle rides the same bar as a fourth circle. The
  // spell-bar API treats it as a zero-cooldown "spell"; engaged state is
  // shown by disabling/enabling… a dedicated toggle visual can come with
  // a gallery pass. For now the circle text flips ⚔/✋ via the DOM.
  const attackBtn = document.createElement('button');
  attackBtn.type = 'button';
  attackBtn.textContent = '⚔';
  attackBtn.style.cssText = [
    'width:56px', 'height:56px', 'border-radius:50%',
    'background:rgba(26,26,46,0.9)', 'color:#e0e0e0',
    'border:2px solid #555', 'font-size:1.3rem',
    'cursor:pointer', 'touch-action:manipulation',
  ].join(';');
  bar.el.prepend(attackBtn);

  function nearestCreatureId(): number {
    // Sticky: keep the engaged target while it's still a valid kill
    // (alive, same floor) — only re-acquire when it drops out.
    if (currentTarget !== 0) {
      const current = world.getAllCreatures().find((c) => c.id === currentTarget);
      if (current && current.z === world.playerZ && current.health > 0) return currentTarget;
    }
    let best = 0;
    let bestDist = Infinity;
    for (const c of world.getAllCreatures()) {
      if (c.id === world.playerCreatureId || c.z !== world.playerZ || c.health <= 0) continue;
      const d = Math.max(Math.abs(c.x - world.playerX), Math.abs(c.y - world.playerY));
      if (d < bestDist) {
        bestDist = d;
        best = c.id;
      }
    }
    return best;
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

  attackBtn.addEventListener('click', () => {
    attacking = !attacking;
    attackBtn.textContent = attacking ? '✋' : '⚔';
    attackBtn.style.borderColor = attacking ? '#d9534f' : '#555';
    if (!attacking && currentTarget !== 0) {
      currentTarget = 0;
      send(protocol.actions.buildAttack(0)); // stop
    } else {
      retarget();
    }
  });

  return {
    get attacking() { return attacking; },
    destroy: () => {
      clearInterval(timer);
      if (attacking && currentTarget !== 0) send(protocol.actions.buildAttack(0));
      bar.destroy();
    },
  };
}
