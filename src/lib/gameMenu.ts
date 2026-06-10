/**
 * Game menu — hamburger button that slides in a pane of menu entries.
 * Self-contained component (joystick.ts pattern). This is the planned
 * future home for what the temporary top-right Dev panel does today:
 * contextual entries (skills, settings, dev toggles, logout) living in
 * one mobile-friendly surface.
 */

export interface GameMenuItem {
  label: string;
  onSelect: () => void;
}

export interface GameMenuHandle {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  setItems(items: GameMenuItem[]): void;
  destroy(): void;
}

const STYLE_ID = 'game-menu-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .game-menu-btn {
      position: fixed; top: calc(8px + env(safe-area-inset-top, 0px)); right: 8px;
      width: 40px; height: 40px; border-radius: 10px;
      background: rgba(22,22,22,0.9); color: #e0e0e0;
      border: 1px solid #9a9a9a; font-size: 1.1rem;
      z-index: 41; cursor: pointer; touch-action: manipulation;
    }
    .game-menu-pane {
      position: fixed; top: 0; right: 0; bottom: 0; width: min(75vw, 260px);
      background: rgba(20,20,20,0.98); color: #e0e0e0;
      border-left: 1px solid #9a9a9a;
      font-family: system-ui, sans-serif; font-size: 0.9rem;
      z-index: 40; padding: 56px 0 12px;
      transform: translateX(100%); transition: transform 0.2s ease;
      display: flex; flex-direction: column;
    }
    .game-menu-pane.open { transform: translateX(0); }
    .game-menu-pane button {
      background: none; border: none; color: #e0e0e0; text-align: left;
      padding: 12px 18px; font-size: 0.9rem; cursor: pointer;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .game-menu-pane button:active { background: rgba(255,255,255,0.12); }
    .game-menu-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      z-index: 39; opacity: 0; pointer-events: none; transition: opacity 0.2s ease;
    }
    .game-menu-backdrop.open { opacity: 1; pointer-events: auto; }
  `;
  document.head.appendChild(style);
}

export function createGameMenu(items: GameMenuItem[], parent: HTMLElement = document.body): GameMenuHandle {
  ensureStyles();

  const el = document.createElement('div');

  const btn = document.createElement('button');
  btn.className = 'game-menu-btn';
  btn.type = 'button';
  btn.textContent = '☰';

  const backdrop = document.createElement('div');
  backdrop.className = 'game-menu-backdrop';

  const pane = document.createElement('div');
  pane.className = 'game-menu-pane';

  el.append(btn, backdrop, pane);
  parent.appendChild(el);

  const open = (): void => { pane.classList.add('open'); backdrop.classList.add('open'); };
  const close = (): void => { pane.classList.remove('open'); backdrop.classList.remove('open'); };

  btn.addEventListener('click', () => {
    if (pane.classList.contains('open')) close();
    else open();
  });
  backdrop.addEventListener('click', close);

  function setItems(next: GameMenuItem[]): void {
    pane.replaceChildren();
    for (const item of next) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label;
      b.addEventListener('click', () => {
        close();
        item.onSelect();
      });
      pane.appendChild(b);
    }
  }
  setItems(items);

  return { el, open, close, setItems, destroy: () => el.remove() };
}
