/**
 * Settings pane — a centered overlay of toggle rows, opened from the
 * game menu. Toggles are *adapters*: each row reads its live state via
 * `get()` when the pane opens and writes through `set(on)`, so the pane
 * never owns game state and can't drift from other control surfaces
 * (e.g. the combat bar's ⚔ circle). Self-contained component
 * (joystick.ts pattern): injected styles, no page-CSS deps.
 */

export interface SettingsToggle {
  label: string;
  /** Read the current value (called every time the pane opens). */
  get(): boolean;
  /** Apply a new value. */
  set(on: boolean): void;
  /** Optional explanation line under the label. */
  hint?: string;
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
    .settings-list { overflow-y: auto; padding: 4px 0 10px; }
    .settings-row {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; padding: 10px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .settings-row .text { min-width: 0; }
    .settings-row .label { font-size: 0.9rem; }
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
    .settings-switch[aria-checked="true"] { background: #3c3c5a; }
    .settings-switch[aria-checked="true"]::after {
      transform: translateX(20px); background: #e0e0e0;
    }
  `;
  document.head.appendChild(style);
}

export function createSettingsPane(
  toggles: SettingsToggle[],
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

  const list = document.createElement('div');
  list.className = 'settings-list';

  const switches: Array<{ btn: HTMLButtonElement; toggle: SettingsToggle }> = [];
  for (const toggle of toggles) {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const text = document.createElement('div');
    text.className = 'text';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = toggle.label;
    text.appendChild(label);
    if (toggle.hint) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = toggle.hint;
      text.appendChild(hint);
    }

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
    switches.push({ btn, toggle });
  }

  card.append(head, list);
  el.appendChild(card);
  parent.appendChild(el);

  const syncAll = (): void => {
    for (const { btn, toggle } of switches) {
      btn.setAttribute('aria-checked', String(toggle.get()));
    }
  };

  const open = (): void => {
    syncAll(); // live state may have changed from other surfaces (⚔)
    el.classList.add('open');
  };
  const close = (): void => { el.classList.remove('open'); };

  closeBtn.addEventListener('click', close);
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });

  return { el, open, close, destroy: () => el.remove() };
}
