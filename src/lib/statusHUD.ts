/**
 * Status HUD — top-left HP and Mana bars with numbers.
 * Self-contained DOM component, same pattern as joystick.ts / devControls.ts.
 *
 * UI-only: exposes setHp / setMana so the network layer can drive the bars
 * once stat packets are wired into GameWorld. Until then, callers pass
 * placeholder values so the component is visible during dev.
 */

export interface StatusHUDHandle {
  readonly el: HTMLElement;
  setVisible(visible: boolean): void;
  setHp(current: number, max: number): void;
  setMana(current: number, max: number): void;
  destroy(): void;
}

const HP_COLOR = '#c83737';
const MANA_COLOR = '#3a6ec8';
const BAR_BG = 'rgba(0,0,0,0.55)';

export function createStatusHUD(): StatusHUDHandle {
  document.querySelector('.status-hud')?.remove();

  const root = document.createElement('div');
  root.className = 'status-hud';
  root.style.cssText = [
    'position:fixed',
    // env(safe-area-inset-top) keeps the HUD clear of iOS notch / status bar.
    'top:max(12px, env(safe-area-inset-top))',
    // Centered horizontally so the top-left corner is free for the
    // future minimap. translateX(-50%) lets the widget grow naturally
    // with its content without being pinned to a fixed width.
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:60',
    'font-family:system-ui,sans-serif',
    'font-size:0.78rem',
    'color:#eee',
    'background:rgba(20,20,20,0.7)',
    'border:1px solid #333',
    'border-radius:12px',
    'padding:8px 12px',
    'display:flex',
    'flex-direction:column',
    'gap:6px',
    'min-width:172px',
    'pointer-events:none',
  ].join(';');

  const hpRow = buildRow('HP', HP_COLOR);
  const manaRow = buildRow('MP', MANA_COLOR);
  root.appendChild(hpRow.el);
  root.appendChild(manaRow.el);

  document.body.appendChild(root);

  return {
    el: root,
    setVisible(visible) {
      root.style.display = visible ? 'flex' : 'none';
    },
    setHp(current, max) {
      hpRow.set(current, max);
    },
    setMana(current, max) {
      manaRow.set(current, max);
    },
    destroy() {
      root.remove();
    },
  };
}

interface Row {
  el: HTMLDivElement;
  set(current: number, max: number): void;
}

function buildRow(label: string, fillColor: string): Row {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:6px;';

  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.cssText = 'width:18px;color:#aaa;font-weight:600;';

  const barOuter = document.createElement('div');
  barOuter.style.cssText = [
    'flex:1',
    'height:14px',
    `background:${BAR_BG}`,
    'border:1px solid #222',
    'border-radius:7px',
    'overflow:hidden',
    'position:relative',
  ].join(';');

  const barFill = document.createElement('div');
  barFill.style.cssText = [
    'height:100%',
    'width:100%',
    `background:${fillColor}`,
    'transition:width 120ms linear',
  ].join(';');
  barOuter.appendChild(barFill);

  const numbers = document.createElement('span');
  numbers.style.cssText = 'min-width:62px;text-align:right;font-variant-numeric:tabular-nums;';

  row.appendChild(labelEl);
  row.appendChild(barOuter);
  row.appendChild(numbers);

  function set(current: number, max: number) {
    // Guard against non-finite / non-positive inputs from upstream (e.g.
    // server packets carrying malformed stats) so the bar never renders
    // `NaN%` or `NaN / NaN`.
    const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
    const safeCurrent = Number.isFinite(current) ? current : 0;
    const clamped = Math.max(0, Math.min(safeCurrent, safeMax));
    const pct = (clamped / safeMax) * 100;
    barFill.style.width = `${pct}%`;
    numbers.textContent = `${clamped} / ${safeMax}`;
  }

  return { el: row, set };
}
