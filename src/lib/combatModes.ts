/**
 * Combat mode controls — the classic Tibia trio as compact circles on
 * the right edge above the spell bar: fight stance (offensive /
 * balanced / defensive — tap cycles), chase (follow opponent), and
 * secure mode (PK protection: on = can't attack players). The host
 * owns the wire side via onChange; the component is pure UI state.
 */

export interface CombatModesState {
  fightMode: 1 | 2 | 3; // 1 offensive, 2 balanced, 3 defensive
  chase: boolean;
  secure: boolean;
}

export interface CombatModesOptions {
  initial?: Partial<CombatModesState>;
  onChange(state: CombatModesState): void;
}

export interface CombatModesHandle {
  readonly el: HTMLElement;
  readonly state: CombatModesState;
  setState(next: Partial<CombatModesState>): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const FIGHT_ICONS: Record<1 | 2 | 3, { icon: string; title: string }> = {
  1: { icon: '⚔️', title: 'Offensive (full attack)' },
  2: { icon: '⚖️', title: 'Balanced' },
  3: { icon: '🛡️', title: 'Defensive (full defense)' },
};

const STYLE_ID = 'combat-modes-style';

function normalizeFightMode(value: unknown): 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3 ? value : 2;
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .combat-modes {
      /* Clears the hotkey arc below (its corner box tops out ~184px). */
      position: fixed; right: 8px; bottom: calc(200px + env(safe-area-inset-bottom, 0px));
      display: flex; flex-direction: column; gap: 6px; z-index: 30;
    }
    .combat-modes button {
      width: 40px; height: 40px; border-radius: 50%;
      background: rgba(22,22,22,0.9); color: #e0e0e0;
      border: 2px solid #555; font-size: 1rem;
      cursor: pointer; touch-action: manipulation; padding: 0;
    }
    .combat-modes button.on { border-color: #e0e0e0; background: rgba(60,60,60,0.95); }
    .combat-modes button:focus-visible { outline: 2px solid #888; outline-offset: 2px; }
  `;
  document.head.appendChild(style);
}

export function createCombatModes(opts: CombatModesOptions, parent: HTMLElement = document.body): CombatModesHandle {
  ensureStyles();
  const state: CombatModesState = {
    fightMode: normalizeFightMode(opts.initial?.fightMode),
    chase: normalizeBool(opts.initial?.chase, false),
    secure: normalizeBool(opts.initial?.secure, true),
  };

  const el = document.createElement('div');
  el.className = 'combat-modes';

  const fightBtn = document.createElement('button');
  fightBtn.type = 'button';
  fightBtn.dataset['role'] = 'fight';
  const chaseBtn = document.createElement('button');
  chaseBtn.type = 'button';
  chaseBtn.dataset['role'] = 'chase';
  chaseBtn.textContent = '👣';
  const secureBtn = document.createElement('button');
  secureBtn.type = 'button';
  secureBtn.dataset['role'] = 'secure';
  secureBtn.textContent = '🔒';
  el.append(fightBtn, chaseBtn, secureBtn);
  parent.appendChild(el);

  const render = (): void => {
    const f = FIGHT_ICONS[state.fightMode];
    fightBtn.textContent = f.icon;
    fightBtn.title = f.title;
    fightBtn.classList.toggle('on', state.fightMode === 1);
    chaseBtn.title = state.chase ? 'Chase opponent: on' : 'Chase opponent: off';
    chaseBtn.classList.toggle('on', state.chase);
    secureBtn.title = state.secure ? 'Secure mode: on (PK-safe)' : 'Secure mode: OFF — you can attack players';
    secureBtn.classList.toggle('on', state.secure);
  };

  const commit = (): void => {
    render();
    opts.onChange({ ...state });
  };

  fightBtn.addEventListener('click', () => {
    state.fightMode = state.fightMode === 3 ? 1 : ((state.fightMode + 1) as 1 | 2 | 3);
    commit();
  });
  chaseBtn.addEventListener('click', () => {
    state.chase = !state.chase;
    commit();
  });
  secureBtn.addEventListener('click', () => {
    state.secure = !state.secure;
    commit();
  });

  render();

  return {
    el,
    get state() { return { ...state }; },
    setState: (next) => {
      if (!next || typeof next !== 'object') return;
      if ('fightMode' in next) state.fightMode = normalizeFightMode(next.fightMode);
      if ('chase' in next) state.chase = normalizeBool(next.chase, state.chase);
      if ('secure' in next) state.secure = normalizeBool(next.secure, state.secure);
      render();
    },
    setVisible: (visible) => { el.style.display = visible ? 'flex' : 'none'; },
    destroy: () => el.remove(),
  };
}
