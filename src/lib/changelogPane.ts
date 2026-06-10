import { CHANGELOG, type ChangelogEntry } from './changelog';

/**
 * Changelog pane — a centered overlay listing what's landed on main,
 * newest first, grouped by date. Opened from the game menu so testers
 * can see what changed without leaving the game. Self-contained
 * component (joystick.ts pattern): injected styles, no page-CSS deps.
 */

export interface ChangelogPaneHandle {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
}

const STYLE_ID = 'changelog-pane-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .changelog-pane {
      position: fixed; inset: 0; z-index: 60;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.55);
      font-family: system-ui, sans-serif;
    }
    .changelog-pane.open { display: flex; }
    .changelog-card {
      width: min(92vw, 420px); max-height: min(75vh, 560px);
      background: rgba(20,20,36,0.98); color: #e0e0e0;
      border: 1px solid #555; border-radius: 12px;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .changelog-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid #333;
      font-weight: bold; font-size: 0.95rem;
    }
    .changelog-head button {
      background: none; border: none; color: #888;
      font-size: 1rem; cursor: pointer; padding: 2px 6px;
    }
    .changelog-head button:hover, .changelog-head button:active { color: #fff; }
    .changelog-list { overflow-y: auto; padding: 8px 14px 14px; }
    .changelog-date {
      color: #888; font-size: 0.72rem; letter-spacing: 0.04em;
      margin: 10px 0 4px; text-transform: uppercase;
    }
    .changelog-item {
      font-size: 0.85rem; line-height: 1.45; margin: 0 0 6px;
      padding-left: 14px; position: relative;
    }
    .changelog-item::before { content: '•'; position: absolute; left: 2px; color: #666; }
  `;
  document.head.appendChild(style);
}

export function createChangelogPane(
  entries: ChangelogEntry[] = CHANGELOG,
  parent: HTMLElement = document.body,
): ChangelogPaneHandle {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'changelog-pane';

  const card = document.createElement('div');
  card.className = 'changelog-card';

  const head = document.createElement('div');
  head.className = 'changelog-head';
  const title = document.createElement('span');
  title.textContent = 'Changelog';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close changelog');
  head.append(title, closeBtn);

  const list = document.createElement('div');
  list.className = 'changelog-list';
  let lastDate = '';
  for (const entry of entries) {
    if (entry.date !== lastDate) {
      lastDate = entry.date;
      const d = document.createElement('div');
      d.className = 'changelog-date';
      d.textContent = entry.date;
      list.appendChild(d);
    }
    const item = document.createElement('p');
    item.className = 'changelog-item';
    item.textContent = entry.text;
    list.appendChild(item);
  }

  card.append(head, list);
  el.appendChild(card);
  parent.appendChild(el);

  // Escape closes too; the listener only exists while the pane is open
  // so a closed pane costs nothing and can't leak past destroy().
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const open = (): void => {
    el.classList.add('open');
    document.addEventListener('keydown', onKeyDown);
  };
  const close = (): void => {
    el.classList.remove('open');
    document.removeEventListener('keydown', onKeyDown);
  };

  closeBtn.addEventListener('click', close);
  // Tap outside the card closes — but not taps inside it.
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });

  return {
    el,
    open,
    close,
    toggle: () => {
      if (el.classList.contains('open')) close();
      else open();
    },
    destroy: () => {
      document.removeEventListener('keydown', onKeyDown);
      el.remove();
    },
  };
}
