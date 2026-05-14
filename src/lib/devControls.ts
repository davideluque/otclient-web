/**
 * Dev controls panel — collapsible UI surface for development toggles.
 * Follows the joystick.ts self-contained-component pattern: factory
 * function, inline styles, classes not IDs, pointerdown for iOS.
 */

export interface DevToggle {
  label: string;
  /** Initial state. */
  defaultOn: boolean;
  onChange: (on: boolean) => void;
}

export interface DevControlsHandle {
  readonly el: HTMLElement;
  setVisible(visible: boolean): void;
  /** Update a toggle's state from outside (e.g. resize resets zoom). */
  setToggle(label: string, on: boolean): void;
  destroy(): void;
}

export function createDevControls(toggles: DevToggle[]): DevControlsHandle {
  // Guard against re-entry: remove any prior instance.
  document.querySelector('.dev-controls')?.remove();

  const root = document.createElement('div');
  root.className = 'dev-controls';
  root.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'z-index:60',
    'font-family:system-ui,sans-serif', 'font-size:0.75rem',
    'user-select:none', 'touch-action:none',
  ].join(';');

  // Collapse/expand button
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'dev-controls-toggle';
  collapseBtn.textContent = 'Dev';
  collapseBtn.style.cssText = [
    'display:block', 'margin-left:auto',
    'padding:4px 10px', 'border:none', 'border-radius:4px',
    'background:#3a3a3a', 'color:#ccc', 'cursor:pointer',
    'touch-action:none',
  ].join(';');
  root.appendChild(collapseBtn);

  // Panel body (hidden by default)
  const panel = document.createElement('div');
  panel.className = 'dev-controls-panel';
  panel.style.cssText = [
    'display:none', 'margin-top:4px', 'padding:8px',
    'background:rgba(30,30,30,0.9)', 'border-radius:6px',
    'border:1px solid #444', 'min-width:140px',
  ].join(';');
  root.appendChild(panel);

  let expanded = false;
  collapseBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    expanded = !expanded;
    panel.style.display = expanded ? 'block' : 'none';
    collapseBtn.textContent = expanded ? 'Dev ▾' : 'Dev';
  });

  // Build toggle rows
  const toggleEls = new Map<string, HTMLButtonElement>();
  const toggleStates = new Map<string, boolean>();

  for (const toggle of toggles) {
    toggleStates.set(toggle.label, toggle.defaultOn);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:4px 0;gap:8px;';

    const label = document.createElement('span');
    label.textContent = toggle.label;
    label.style.color = '#aaa';

    const btn = document.createElement('button');
    btn.className = 'dev-controls-btn';
    btn.style.cssText = [
      'padding:3px 8px', 'border:none', 'border-radius:3px',
      'cursor:pointer', 'font-size:0.7rem', 'min-width:40px',
      'touch-action:none',
    ].join(';');
    applyToggleStyle(btn, toggle.defaultOn);

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const next = !toggleStates.get(toggle.label)!;
      toggleStates.set(toggle.label, next);
      applyToggleStyle(btn, next);
      toggle.onChange(next);
    });

    toggleEls.set(toggle.label, btn);
    row.appendChild(label);
    row.appendChild(btn);
    panel.appendChild(row);
  }

  document.body.appendChild(root);

  return {
    el: root,
    setVisible(visible: boolean) {
      root.style.display = visible ? 'block' : 'none';
    },
    setToggle(label: string, on: boolean) {
      const btn = toggleEls.get(label);
      if (!btn) return;
      toggleStates.set(label, on);
      applyToggleStyle(btn, on);
    },
    destroy() {
      root.remove();
    },
  };
}

function applyToggleStyle(btn: HTMLButtonElement, on: boolean) {
  btn.textContent = on ? 'ON' : 'OFF';
  btn.style.background = on ? '#5a4a90' : '#3a3a3a';
  btn.style.color = on ? '#fff' : '#888';
}
