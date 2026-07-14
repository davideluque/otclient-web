/**
 * Settings pane — a centered overlay of toggle rows, opened from the
 * game menu. Toggles are *adapters*: each row reads its live state via
 * `get()` when the pane opens and writes through `set(on)`, so the pane
 * never owns game state and can't drift from other control surfaces
 * (e.g. the combat bar's ⚔ circle). Self-contained component
 * (joystick.ts pattern): injected styles, no page-CSS deps.
 */
import { makeDraggable } from './draggable';

export interface SettingsToggle {
  kind: 'toggle';
  label: string;
  /** Read the current value (called every time the pane opens). */
  get(): boolean;
  /** Apply a new value. */
  set(on: boolean): void;
  /** Optional explanation line under the label. */
  hint?: string;
}

/** A numeric range row (e.g. brightness %) — same adapter contract. */
export interface SettingsSlider {
  kind: 'slider';
  label: string;
  min: number;
  max: number;
  step?: number;
  /** Suffix shown after the value readout, e.g. '%'. */
  unit?: string;
  get(): number;
  set(value: number): void;
  hint?: string;
}

export type SettingsEntry = SettingsToggle | SettingsSlider;

function isSlider(entry: SettingsEntry): entry is SettingsSlider {
  return entry.kind === 'slider';
}

export interface SettingsPaneHandle {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  destroy(): void;
}

const STYLE_ID = 'settings-pane-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .settings-pane {
      position: fixed; inset: 0; z-index: 60;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.55);
      font-family: system-ui, sans-serif;
    }
    .settings-pane.open { display: flex; }
    .settings-card {
      width: min(92vw, 380px); max-height: min(70vh, 480px);
      background: rgba(20,20,36,0.98); color: #e0e0e0;
      border: 1px solid #555; border-radius: 12px;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .settings-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid #333;
      font-weight: bold; font-size: 0.95rem;
    }
    .settings-head button {
      background: none; border: none; color: #888;
      font-size: 1rem; cursor: pointer; padding: 2px 6px;
    }
    .settings-head button:hover, .settings-head button:active { color: #fff; }
    .settings-head button:focus-visible {
      color: #fff; outline: 2px solid #888; outline-offset: 2px; border-radius: 4px;
    }
    .settings-list { overflow-y: auto; padding: 4px 0 10px; }
    .settings-row {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding: 10px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .settings-row .text { min-width: 0; }
    .settings-row .label { font-size: 0.84rem; }
    .settings-row .hint { font-size: 0.72rem; color: #888; margin-top: 2px; }
    .settings-switch {
      flex-shrink: 0; width: 46px; height: 26px; border-radius: 13px;
      border: 1px solid #555; background: #222;
      position: relative; cursor: pointer; padding: 0;
      transition: background 0.15s ease;
    }
    .settings-switch::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 20px; height: 20px; border-radius: 50%;
      background: #888; transition: transform 0.15s ease, background 0.15s ease;
    }
    .settings-switch:focus-visible { outline: 2px solid #888; outline-offset: 2px; }
    .settings-switch[aria-checked="true"] { background: #4a4a4a; }
    .settings-switch[aria-checked="true"]::after {
      transform: translateX(20px); background: #e0e0e0;
    }
    .settings-row input[type="range"] {
      flex: 1; min-width: 90px; max-width: 160px; accent-color: #e0e0e0;
      touch-action: none;
    }
    .settings-row .value {
      flex-shrink: 0; width: 44px; text-align: right;
      color: #aaa; font-size: 0.8rem; font-variant-numeric: tabular-nums;
    }
  `;
  document.head.appendChild(style);
}

export function createSettingsPane(
  entries: SettingsEntry[],
  parent: HTMLElement = document.body,
): SettingsPaneHandle {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'settings-pane';

  const card = document.createElement('div');
  card.className = 'settings-card';

  const head = document.createElement('div');
  head.className = 'settings-head';
  const title = document.createElement('span');
  title.textContent = 'Settings';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close settings');
  head.append(title, closeBtn);
  const stopDragging = makeDraggable(card, head);

  const list = document.createElement('div');
  list.className = 'settings-list';

  const syncs: Array<() => void> = [];
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const text = document.createElement('div');
    text.className = 'text';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = entry.label;
    text.appendChild(label);
    if (entry.hint) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = entry.hint;
      text.appendChild(hint);
    }

    if (isSlider(entry)) {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(entry.min);
      input.max = String(entry.max);
      input.step = String(entry.step ?? 1);
      input.setAttribute('aria-label', entry.label);
      const value = document.createElement('span');
      value.className = 'value';
      const readout = (): void => {
        value.textContent = `${entry.get()}${entry.unit ?? ''}`;
      };
      input.addEventListener('input', () => {
        entry.set(Number(input.value));
        readout(); // re-read: set() may clamp
      });
      row.append(text, input, value);
      list.appendChild(row);
      syncs.push(() => {
        input.value = String(entry.get());
        readout();
      });
      continue;
    }

    const toggle = entry;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-switch';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', toggle.label);
    btn.addEventListener('click', () => {
      const next = !(btn.getAttribute('aria-checked') === 'true');
      toggle.set(next);
      // Re-read instead of assuming: set() may refuse or clamp.
      btn.setAttribute('aria-checked', String(toggle.get()));
    });

    row.append(text, btn);
    list.appendChild(row);
    syncs.push(() => btn.setAttribute('aria-checked', String(toggle.get())));
  }

  card.append(head, list);
  el.appendChild(card);
  parent.appendChild(el);

  const syncAll = (): void => {
    for (const sync of syncs) sync();
  };
  // role="switch" requires aria-checked from the start, not only after
  // the first open.
  syncAll();

  // Escape closes too; the listener only exists while the pane is open
  // so a closed pane costs nothing and can't leak past destroy().
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const open = (): void => {
    syncAll(); // live state may have changed from other surfaces (⚔)
    el.classList.add('open');
    document.addEventListener('keydown', onKeyDown);
  };
  const close = (): void => {
    el.classList.remove('open');
    document.removeEventListener('keydown', onKeyDown);
  };

  closeBtn.addEventListener('click', close);
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });

  return {
    el,
    open,
    close,
    destroy: () => {
      document.removeEventListener('keydown', onKeyDown);
      stopDragging();
      el.remove();
    },
  };
}
