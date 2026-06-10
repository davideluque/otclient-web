/**
 * HUD — health/mana bars + level badge. Self-contained component
 * following the joystick.ts pattern: factory function, injected styles,
 * explicit handle with update + destroy.
 *
 * The stats shape mirrors what the 7.6 server sends in AddPlayerStats
 * (0xA0): health/maxHealth, mana/maxMana, level — so wiring it to the
 * live GameClient later is a straight field-for-field map.
 */

export interface HudStats {
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  level: number;
}

export interface HudHandle {
  readonly el: HTMLElement;
  setStats(stats: HudStats): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const STYLE_ID = 'hud-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .hud {
      position: fixed; top: calc(8px + env(safe-area-inset-top, 0px)); left: 8px;
      display: flex; align-items: center; gap: 8px;
      font-family: system-ui, sans-serif; z-index: 30;
      user-select: none; pointer-events: none;
    }
    .hud .hud-level {
      width: 34px; height: 34px; border-radius: 50%;
      background: #1a1a2e; border: 2px solid #7c5cbf;
      color: #e0e0e0; font-size: 0.8rem; font-weight: bold;
      display: flex; align-items: center; justify-content: center;
    }
    .hud .hud-bars { display: flex; flex-direction: column; gap: 4px; }
    .hud .hud-bar {
      width: 140px; height: 12px; border-radius: 6px;
      background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);
      overflow: hidden; position: relative;
    }
    .hud .hud-bar .fill {
      height: 100%; width: 100%;
      transition: width 0.25s ease;
    }
    .hud .hud-bar.hp .fill { background: linear-gradient(#d9534f, #a02622); }
    .hud .hud-bar.mp .fill { background: linear-gradient(#4f74d9, #2243a0); }
    .hud .hud-bar .num {
      position: absolute; inset: 0; text-align: center;
      font-size: 9px; line-height: 12px; color: #fff;
      text-shadow: 0 1px 1px #000;
    }
  `;
  document.head.appendChild(style);
}

export function createHud(initial: HudStats, parent: HTMLElement = document.body): HudHandle {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = `
    <div class="hud-level"></div>
    <div class="hud-bars">
      <div class="hud-bar hp"><div class="fill"></div><div class="num"></div></div>
      <div class="hud-bar mp"><div class="fill"></div><div class="num"></div></div>
    </div>
  `;
  parent.appendChild(el);

  const levelEl = el.querySelector('.hud-level') as HTMLElement;
  const hpFill = el.querySelector('.hp .fill') as HTMLElement;
  const hpNum = el.querySelector('.hp .num') as HTMLElement;
  const mpFill = el.querySelector('.mp .fill') as HTMLElement;
  const mpNum = el.querySelector('.mp .num') as HTMLElement;

  function setStats(stats: HudStats): void {
    const hpPct = stats.maxHealth > 0 ? Math.max(0, Math.min(1, stats.health / stats.maxHealth)) : 0;
    const mpPct = stats.maxMana > 0 ? Math.max(0, Math.min(1, stats.mana / stats.maxMana)) : 0;
    hpFill.style.width = `${hpPct * 100}%`;
    mpFill.style.width = `${mpPct * 100}%`;
    hpNum.textContent = `${stats.health} / ${stats.maxHealth}`;
    mpNum.textContent = `${stats.mana} / ${stats.maxMana}`;
    levelEl.textContent = String(stats.level);
  }

  setStats(initial);

  return {
    el,
    setStats,
    setVisible: (visible) => { el.style.display = visible ? 'flex' : 'none'; },
    destroy: () => el.remove(),
  };
}
