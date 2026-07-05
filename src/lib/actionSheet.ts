/**
 * Action sheet — a one-shot bottom sheet of tap actions (mobile
 * context-menu replacement): one button per action plus Cancel.
 * Selecting anything, Cancel, or tapping the backdrop removes it.
 * Self-contained component (joystick.ts pattern): factory, injected
 * styles, explicit handle.
 */

import { zIndex } from './ui/tokens';

export interface ActionSheetAction {
  label: string;
  onSelect(): void;
}

export interface ActionSheetOptions {
  title?: string;
  actions: ActionSheetAction[];
  parent?: HTMLElement;
}

export interface ActionSheetHandle {
  readonly el: HTMLElement;
  /** Remove the sheet without selecting (same as Cancel). */
  close(): void;
}

const STYLE_ID = 'action-sheet-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .action-sheet-backdrop {
      position: fixed; inset: 0; z-index: ${zIndex.modal};
      background: rgba(0,0,0,0.45);
      font-family: system-ui, sans-serif; user-select: none;
    }
    .action-sheet {
      position: fixed; left: 0; right: 0; bottom: 0;
      display: flex; flex-direction: column; gap: 6px;
      padding: 10px 10px calc(10px + env(safe-area-inset-bottom));
      background: rgba(22,22,22,0.97); border-top: 1px solid #9a9a9a;
      border-radius: 14px 14px 0 0;
    }
    .action-sheet .title {
      color: #9a9a9a; font-size: 0.75rem; text-align: center; padding: 2px 0 4px;
    }
    .action-sheet button {
      background: rgba(0,0,0,0.45); border: 1px solid #3a3a55;
      border-radius: 8px; color: #e0e0e0; font-size: 0.95rem;
      padding: 12px; cursor: pointer;
    }
    .action-sheet button.cancel { color: #9a9a9a; }
  `;
  document.head.appendChild(style);
}

export function showActionSheet(opts: ActionSheetOptions): ActionSheetHandle {
  ensureStyles();

  const backdrop = document.createElement('div');
  backdrop.className = 'action-sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'action-sheet';
  backdrop.appendChild(sheet);

  // Escape closes too — matching the other overlays. The sheet is
  // one-shot, so the listener only lives while it is on screen.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const close = (): void => {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
  };
  document.addEventListener('keydown', onKeyDown);

  if (opts.title) {
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = opts.title;
    sheet.appendChild(title);
  }
  for (const action of opts.actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      close();
      action.onSelect();
    });
    sheet.appendChild(button);
  }
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', close);
  sheet.appendChild(cancel);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  (opts.parent ?? document.body).appendChild(backdrop);
  return { el: backdrop, close };
}
