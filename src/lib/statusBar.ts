/**
 * Player condition status bar — small chips under the HUD (top-left)
 * for the 7.6 condition icons (0xA2 bitmask, values per the server's
 * const76.h). The whole bar hides when no condition is active.
 */

export const StatusIcon = {
  Poison: 1,
  Burn: 2,
  Energy: 4,
  Drunk: 8,
  ManaShield: 16,
  Paralyze: 32,
  Haste: 64,
  /** "Swords" — in combat, logout/protection-zone blocked. */
  InFight: 128,
} as const;

const CHIPS: ReadonlyArray<{ bit: number; icon: string; title: string }> = [
  { bit: StatusIcon.Poison, icon: '☠️', title: 'Poisoned' },
  { bit: StatusIcon.Burn, icon: '🔥', title: 'Burning' },
  { bit: StatusIcon.Energy, icon: '⚡', title: 'Electrified' },
  { bit: StatusIcon.Drunk, icon: '🍺', title: 'Drunk' },
  { bit: StatusIcon.ManaShield, icon: '🔮', title: 'Mana shield' },
  { bit: StatusIcon.Paralyze, icon: '🐌', title: 'Paralyzed' },
  { bit: StatusIcon.Haste, icon: '💨', title: 'Hasted' },
  { bit: StatusIcon.InFight, icon: '⚔️', title: 'In combat (logout blocked)' },
];

export interface StatusBarHandle {
  readonly el: HTMLElement;
  setIcons(mask: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const STYLE_ID = 'status-bar-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .status-bar {
      position: fixed; top: calc(86px + env(safe-area-inset-top, 0px)); left: 8px;
      display: flex; gap: 4px; z-index: 30; pointer-events: none;
    }
    .status-bar .chip {
      width: 26px; height: 26px; border-radius: 6px;
      background: rgba(22,22,22,0.9); border: 1px solid #555;
      display: none; align-items: center; justify-content: center;
      font-size: 0.85rem;
    }
    .status-bar .chip.on { display: flex; }
  `;
  document.head.appendChild(style);
}

export function createStatusBar(parent: HTMLElement = document.body): StatusBarHandle {
  ensureStyles();
  const el = document.createElement('div');
  el.className = 'status-bar';
  const chips: Array<{ bit: number; node: HTMLElement }> = [];
  for (const { bit, icon, title } of CHIPS) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = icon;
    chip.title = title;
    chip.dataset['bit'] = String(bit);
    el.appendChild(chip);
    chips.push({ bit, node: chip });
  }
  parent.appendChild(el);

  let userVisible = true;

  return {
    el,
    setIcons: (mask) => {
      let any = false;
      for (const { bit, node } of chips) {
        const on = (mask & bit) !== 0;
        node.classList.toggle('on', on);
        any = any || on;
      }
      el.style.display = any && userVisible ? 'flex' : 'none';
    },
    setVisible: (visible) => {
      userVisible = visible;
      if (!visible) el.style.display = 'none';
    },
    destroy: () => el.remove(),
  };
}
