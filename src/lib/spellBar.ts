/**
 * Spell buttons fanned along a quarter-circle hugging the bottom-right
 * corner, MOBA-style (Mobile Legends): the corner anchor slot is the
 * big always-there button (the auto-attack toggle in game), spells
 * sweep the arc from straight-left of it (slot 1, where the thumb
 * rests) up to straight-above. Self-contained component (joystick.ts
 * pattern): factory function, injected styles, explicit handle.
 * Touch-first: big hit targets, pointerdown casting, no hover
 * dependence.
 */

export interface SpellDef {
  id: string;
  /** Short label shown on the button, e.g. "exura" or an emoji rune. */
  label: string;
  /** Library image for the button face; label stays as fallback/tooltip. */
  iconUrl?: string | null;
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

/** Anchor-center → spell-center distance along the arc. */
const ARC_RADIUS = 112;
/** Spell button diameter — thumb-sized; the corner anchor is ANCHOR_SIZE. */
const BUTTON_SIZE = 64;
const ANCHOR_SIZE = 72;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .spell-bar {
      position: fixed; right: 10px;
      bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      width: ${ANCHOR_SIZE / 2 + ARC_RADIUS + BUTTON_SIZE / 2 + 4}px;
      height: ${ANCHOR_SIZE / 2 + ARC_RADIUS + BUTTON_SIZE / 2 + 4}px;
      z-index: 30; user-select: none; pointer-events: none;
    }
    .spell-bar button {
      position: absolute; pointer-events: auto;
      width: ${BUTTON_SIZE}px; height: ${BUTTON_SIZE}px; border-radius: 50%;
      background: rgba(22,22,22,0.9); color: #e0e0e0;
      border: 2px solid #9a9a9a; font-size: 0.7rem;
      font-family: system-ui, sans-serif;
      overflow: hidden;
      cursor: pointer; touch-action: manipulation;
    }
    .spell-bar button.anchor {
      right: 0; bottom: 0;
      width: ${ANCHOR_SIZE}px; height: ${ANCHOR_SIZE}px;
      font-size: 1.3rem;
    }
    .spell-bar button:disabled { border-color: #444; color: #666; cursor: default; }
    .spell-bar button img {
      /* Full-bleed: the artwork fills the whole round slot. */
      width: 100%; height: 100%; object-fit: cover; border-radius: 50%;
      image-rendering: pixelated; pointer-events: none;
    }
    .spell-bar button:disabled img { opacity: 0.4; filter: grayscale(1); }
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

  // Fan the slots over the quarter circle: slot 1 sits straight left
  // of the corner anchor (closest to the resting thumb), the last slot
  // straight above it. A single slot takes the 45° midpoint.
  const count = opts.spells.length;
  const anchorCenter = ANCHOR_SIZE / 2;
  opts.spells.forEach((def, i) => {
    const angle = ((count > 1 ? (i * 90) / (count - 1) : 45) * Math.PI) / 180;
    const right = anchorCenter + ARC_RADIUS * Math.cos(angle) - BUTTON_SIZE / 2;
    const bottom = anchorCenter + ARC_RADIUS * Math.sin(angle) - BUTTON_SIZE / 2;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.right = `${Math.round(right)}px`;
    btn.style.bottom = `${Math.round(bottom)}px`;
    btn.title = def.label;
    const cd = document.createElement('div');
    cd.className = 'cd';
    if (def.iconUrl) {
      const img = document.createElement('img');
      img.src = def.iconUrl;
      img.alt = def.label;
      img.draggable = false;
      // A broken/missing asset degrades to the text label, inserted
      // before the cooldown overlay so an active sweep isn't disturbed.
      img.addEventListener('error', () => {
        img.remove();
        btn.insertBefore(document.createTextNode(def.label), cd);
      });
      btn.appendChild(img);
    } else {
      btn.textContent = def.label;
    }
    btn.appendChild(cd);
    btn.addEventListener('pointerdown', () => {
      const e = entries.get(def.id);
      if (!e || btn.disabled || performance.now() < e.readyAt) return;
      opts.onCast(def.id);
      triggerCooldown(def.id);
    });
    el.appendChild(btn);
    entries.set(def.id, { btn, cd, def, readyAt: 0 });
  });

  return {
    el,
    triggerCooldown,
    setEnabled: (id, enabled) => {
      const e = entries.get(id);
      if (e) e.btn.disabled = !enabled;
    },
    setVisible: (visible) => { el.style.display = visible ? '' : 'none'; },
    destroy: () => {
      for (const e of entries.values()) clearTimeout(e.timer);
      el.remove();
    },
  };
}
