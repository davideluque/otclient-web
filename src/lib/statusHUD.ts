/**
 * Status HUD — top-center HP and Mana bars styled after the classic
 * OTClient panel: pill bars with a subtle vertical gradient, an icon
 * on the left (heart for HP, lightning for Mana) and the current value
 * (not "current / max") in white on the right. Empty portion of the
 * bar is a darker gray rather than pure black so the pill shape
 * always reads as a 3D surface.
 *
 * UI-only: exposes setHp / setMana so the network layer can drive the
 * bars once stat packets are wired into GameWorld.
 */

export interface StatusHUDHandle {
  readonly el: HTMLElement;
  setVisible(visible: boolean): void;
  setHp(current: number, max: number): void;
  setMana(current: number, max: number): void;
  destroy(): void;
}

// Placeholder colors — replace with the exact OTClient hex values once
// you have them. Each pair = [top of gradient, bottom of gradient].
const HP_TOP = '#e2767c';
const HP_BOTTOM = '#a83033';
const MANA_TOP = '#6470cc';
const MANA_BOTTOM = '#3a48a0';

// Darker gray fill for the empty portion so the pill shape reads as a
// 3D surface even when fully drained.
const EMPTY_TOP = '#3a3a3a';
const EMPTY_BOTTOM = '#1a1a1a';

// Inline SVGs colored via `fill="currentColor"` so the icon picks up
// the row's `color` style. Keeping them tiny + monochrome (no emoji
// rendering differences across iOS / Android / desktop browsers).
const HEART_SVG = `
<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
  <path d="M12 21s-7-4.6-9.5-9.2C.7 8.7 2 5 5.3 4.1c2-.5 4 .4 6.7 3.5 2.7-3.1 4.7-4 6.7-3.5C22 5 23.3 8.7 21.5 11.8 19 16.4 12 21 12 21z"/>
</svg>`.trim();

const BOLT_SVG = `
<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
  <path d="M13 2L4 14h7l-1 8 10-13h-8z"/>
</svg>`.trim();

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

  const hpRow = buildRow(HEART_SVG, HP_TOP, HP_BOTTOM);
  const manaRow = buildRow(BOLT_SVG, MANA_TOP, MANA_BOTTOM);
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

function buildRow(iconSvg: string, fillTop: string, fillBottom: string): Row {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const iconEl = document.createElement('span');
  iconEl.innerHTML = iconSvg;
  iconEl.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'width:16px',
    'height:16px',
    // Icon uses the fill's top color so the pill and icon read as one
    // colored object (HP icon is red, mana icon is blue).
    `color:${fillTop}`,
  ].join(';');

  const barOuter = document.createElement('div');
  barOuter.style.cssText = [
    'flex:1',
    'height:14px',
    `background:linear-gradient(180deg, ${EMPTY_TOP} 0%, ${EMPTY_BOTTOM} 100%)`,
    'border:1px solid #222',
    'border-radius:7px',
    'overflow:hidden',
    'position:relative',
  ].join(';');

  const barFill = document.createElement('div');
  barFill.style.cssText = [
    'height:100%',
    'width:100%',
    `background:linear-gradient(180deg, ${fillTop} 0%, ${fillBottom} 100%)`,
    'transition:width 120ms linear',
  ].join(';');
  barOuter.appendChild(barFill);

  const numbers = document.createElement('span');
  numbers.style.cssText = [
    'min-width:42px',
    'text-align:right',
    'color:#fff',
    'font-weight:700',
    'font-size:0.92rem',
    'font-variant-numeric:tabular-nums',
    'text-shadow:0 1px 1px rgba(0,0,0,0.6)',
  ].join(';');

  row.appendChild(iconEl);
  row.appendChild(barOuter);
  row.appendChild(numbers);

  function set(current: number, max: number) {
    // Guard against non-finite / non-positive inputs from upstream (e.g.
    // server packets carrying malformed stats) so the bar never renders
    // `NaN%`.
    const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
    const safeCurrent = Number.isFinite(current) ? current : 0;
    const clamped = Math.max(0, Math.min(safeCurrent, safeMax));
    const pct = (clamped / safeMax) * 100;
    barFill.style.width = `${pct}%`;
    // Classic HUD shows only the current value, not "current / max".
    numbers.textContent = `${clamped}`;
  }

  return { el: row, set };
}
