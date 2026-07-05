/**
 * Death dialog — a full-screen modal shown when the server announces the
 * player's death, in place of the silent dump to the login screen. It
 * deliberately lives OUTSIDE the per-session teardown in jamera/main.ts:
 * death drops the connection while the dialog is showing, and it must
 * survive that teardown so the player reads "You are dead." instead of
 * an unexplained "Disconnected." Self-contained component (settingsPane
 * pattern): injected styles, no page-CSS deps.
 */

export interface DeathDialogOptions {
  /** Fired when the player taps Continue (or presses Escape). */
  onContinue(): void;
  parent?: HTMLElement;
}

export interface DeathDialogHandle {
  readonly el: HTMLElement;
  destroy(): void;
}

const STYLE_ID = 'death-dialog-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .death-dialog {
      position: fixed; inset: 0; z-index: 100;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.75);
      font-family: system-ui, sans-serif;
    }
    .death-card {
      width: min(92vw, 340px);
      background: rgba(20,20,36,0.98); color: #e0e0e0;
      border: 1px solid #555; border-radius: 12px;
      padding: 28px 20px 22px; text-align: center;
    }
    .death-card .skull { font-size: 3rem; line-height: 1; }
    .death-card .title { font-size: 1.2rem; font-weight: bold; margin-top: 12px; }
    .death-card .subtitle { font-size: 0.85rem; color: #aaa; margin-top: 8px; }
    .death-card .continue {
      margin-top: 20px; padding: 10px 32px;
      background: #333; color: #e0e0e0;
      border: 1px solid #666; border-radius: 8px;
      font-size: 0.95rem; cursor: pointer;
    }
    .death-card .continue:hover, .death-card .continue:active { background: #444; color: #fff; }
    .death-card .continue:focus-visible { outline: 2px solid #888; outline-offset: 2px; }
  `;
  document.head.appendChild(style);
}

// A second death signal (Jamera sends both the text message and, on
// standard servers, 0x28) must not stack a second modal.
let active: DeathDialogHandle | null = null;

export function showDeathDialog(opts: DeathDialogOptions): DeathDialogHandle {
  // isConnected guards against a stale handle whose element something
  // external removed — that would otherwise block every future dialog.
  if (active && active.el.isConnected) return active;
  active = null;
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'death-dialog';

  const card = document.createElement('div');
  card.className = 'death-card';
  const skull = document.createElement('div');
  skull.className = 'skull';
  skull.textContent = '💀';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'You are dead.';
  const subtitle = document.createElement('div');
  subtitle.className = 'subtitle';
  subtitle.textContent = 'Your character will respawn at the temple.';
  const continueBtn = document.createElement('button');
  continueBtn.type = 'button';
  continueBtn.className = 'continue';
  continueBtn.textContent = 'Continue';
  card.append(skull, title, subtitle, continueBtn);
  el.appendChild(card);
  (opts.parent ?? document.body).appendChild(el);
  // Focus the primary action: Enter/Space dismisses immediately, and
  // screen readers announce the dialog through the focus move.
  continueBtn.focus();

  const destroy = (): void => {
    document.removeEventListener('keydown', onKeyDown);
    el.remove();
    active = null;
  };
  const proceed = (): void => {
    destroy();
    opts.onContinue();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // Other document-level Escape listeners (full chat, menus) must not
    // also fire from behind the modal.
    e.preventDefault();
    e.stopPropagation();
    proceed();
  };
  continueBtn.addEventListener('click', proceed);
  document.addEventListener('keydown', onKeyDown);

  const handle: DeathDialogHandle = { el, destroy };
  active = handle;
  return handle;
}
