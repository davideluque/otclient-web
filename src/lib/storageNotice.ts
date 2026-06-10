/**
 * Storage notice toast — self-contained UI component following the
 * joystick.ts pattern: factory function, injected styles, no external
 * CSS dependency. Used for storage events (quota, eviction, no-IDB)
 * that need their own surface: the loader status line is gone once the
 * game is running, and several of these fire *after* a successful boot.
 *
 * One notice at a time — the latest wins. Click to dismiss; auto-hides
 * after 15s.
 */

const STYLE_ID = 'storage-notice-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .storage-notice {
      position: fixed; left: 50%; transform: translateX(-50%);
      bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
      max-width: min(90vw, 28rem); padding: 0.75rem 1rem;
      background: #1a1a2e; color: #e0e0e0;
      border: 1px solid #7c5cbf; border-radius: 8px;
      font-family: system-ui, sans-serif;
      font-size: 0.85rem; line-height: 1.4;
      z-index: 20; cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

export function showStorageNotice(msg: string): void {
  ensureStyles();
  // One notice at a time — a second one would render on top of the first.
  document.querySelector('.storage-notice')?.remove();
  const el = document.createElement('div');
  el.className = 'storage-notice';
  el.textContent = msg;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 15000);
}
