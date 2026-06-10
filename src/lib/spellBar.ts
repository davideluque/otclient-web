/**
 * Spell button bar — a row of round cast buttons with cooldown sweeps.
 * Self-contained component (joystick.ts pattern): factory function,
 * injected styles, explicit handle. Touch-first: big hit targets,
 * pointerdown casting, no hover dependence.
 */

export interface SpellDef {
  id: string;
  /** Short label shown on the button, e.g. "exura" or an emoji rune. */
  label: string;
  cooldownMs: number;
}

export interface SpellBarOptions {
  spells: SpellDef[];
  /** Fires when a ready (off-cooldown) spell button is pressed. */
  onCast: (id: string) => void;
  parent?: HTMLElement;
}

export interface SpellBarHandle {
  readonly el: HTMLElement;
  /** Start a spell's cooldown sweep (also done automatically on cast). */
  triggerCooldown(id: string): void;
  setEnabled(id: string, enabled: boolean): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const STYLE_ID = 'spell-bar-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .spell-bar {
      position: fixed; right: 16px;
      bottom: calc(24px + env(safe-area-inset-bottom, 0px));
      display: flex; flex-direction: column; gap: 10px;
      z-index: 30; user-select: none;
    }
    .spell-bar button {
      width: 56px; height: 56px; border-radius: 50%;
      background: rgba(26,26,46,0.9); color: #e0e0e0;
      border: 2px solid #7c5cbf; font-size: 0.7rem;
      font-family: system-ui, sans-serif;
      position: relative; overflow: hidden;
      cursor: pointer; touch-action: manipulation;
    }
    .spell-bar button:disabled { border-color: #444; color: #666; cursor: default; }
    .spell-bar button .cd {
      position: absolute; inset: 0; border-radius: 50%;
      background: rgba(0,0,0,0.65);
      transform-origin: bottom;
      transform: scaleY(0);
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

export function createSpellBar(opts: SpellBarOptions): SpellBarHandle {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'spell-bar';
  (opts.parent ?? document.body).appendChild(el);

  interface Entry { btn: HTMLButtonElement; cd: HTMLElement; def: SpellDef; readyAt: number; timer?: ReturnType<typeof setTimeout> }
  const entries = new Map<string, Entry>();

  function triggerCooldown(id: string): void {
    const e = entries.get(id);
    if (!e) return;
    e.readyAt = performance.now() + e.def.cooldownMs;
    // Sweep: fill instantly, then shrink over the cooldown. Forcing a
    // reflow between the two transform writes makes the transition run.
    e.cd.style.transition = 'none';
    e.cd.style.transform = 'scaleY(1)';
    void e.cd.offsetHeight;
    e.cd.style.transition = `transform ${e.def.cooldownMs}ms linear`;
    e.cd.style.transform = 'scaleY(0)';
    clearTimeout(e.timer);
    e.timer = setTimeout(() => { e.readyAt = 0; }, e.def.cooldownMs);
  }

  for (const def of opts.spells) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = def.label;
    const cd = document.createElement('div');
    cd.className = 'cd';
    btn.appendChild(cd);
    btn.addEventListener('pointerdown', () => {
      const e = entries.get(def.id);
      if (!e || btn.disabled || performance.now() < e.readyAt) return;
      opts.onCast(def.id);
      triggerCooldown(def.id);
    });
    el.appendChild(btn);
    entries.set(def.id, { btn, cd, def, readyAt: 0 });
  }

  return {
    el,
    triggerCooldown,
    setEnabled: (id, enabled) => {
      const e = entries.get(id);
      if (e) e.btn.disabled = !enabled;
    },
    setVisible: (visible) => { el.style.display = visible ? 'flex' : 'none'; },
    destroy: () => {
      for (const e of entries.values()) clearTimeout(e.timer);
      el.remove();
    },
  };
}
