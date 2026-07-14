import { makeDraggable } from './draggable';

export interface TextWindowContent {
  title: string;
  text: string;
  writer?: string;
  /** When present, render an editor and submit its current value here. */
  onSave?: (text: string) => void;
  maxLength?: number;
}

export interface TextWindowHandle {
  readonly el: HTMLElement;
  show(content: TextWindowContent): void;
  close(): void;
  destroy(): void;
}

const STYLE_ID = 'text-window-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .text-window { position: fixed; inset: 0; z-index: 60; display: none;
      align-items: center; justify-content: center; background: rgba(0,0,0,.55);
      font-family: system-ui, sans-serif; }
    .text-window.open { display: flex; }
    .text-window .card { width: min(88vw, 380px); max-height: min(70vh, 520px);
      display: flex; flex-direction: column; overflow: hidden;
      background: rgba(24,22,17,.98); color: #e8e0cf; border: 1px solid #777;
      border-radius: 10px; }
    .text-window .head { display: flex; align-items: center; justify-content: space-between;
      padding: 9px 12px; border-bottom: 1px solid #4b463d; font-size: .84rem; }
    .text-window .head button { background: none; border: 0; color: #aaa;
      font-size: 1rem; padding: 2px 6px; cursor: pointer; }
    .text-window .content { overflow: auto; padding: 14px; white-space: pre-wrap;
      overflow-wrap: anywhere; font-family: Georgia, serif; font-size: .88rem;
      line-height: 1.5; min-height: 90px; }
    .text-window textarea.content { box-sizing: border-box; width: calc(100% - 28px);
      margin: 14px; resize: vertical; background: #15130f; color: #e8e0cf;
      border: 1px solid #5b554b; border-radius: 6px; outline: none; }
    .text-window .writer { padding: 0 14px 12px; color: #999;
      font-size: .72rem; text-align: right; }
    .text-window .actions { display: none; justify-content: flex-end; gap: 8px;
      padding: 0 14px 14px; }
    .text-window.editable .actions { display: flex; }
    .text-window .actions button { min-height: 34px; padding: 0 14px;
      border: 1px solid #777; border-radius: 7px; background: #333;
      color: #eee; font: inherit; cursor: pointer; }
    .text-window .actions .save { border-color: #6d965c; background: #294326; }
  `;
  document.head.appendChild(style);
}

export function createTextWindow(parent: HTMLElement = document.body): TextWindowHandle {
  ensureStyles();
  const el = document.createElement('div');
  el.className = 'text-window';
  el.innerHTML = `<div class="card"><div class="head"><span></span><button type="button" aria-label="Close">✕</button></div><div class="content"></div><div class="writer"></div><div class="actions"><button type="button" class="cancel">Cancel</button><button type="button" class="save">Save</button></div></div>`;
  parent.appendChild(el);
  const card = el.querySelector('.card') as HTMLElement;
  const head = el.querySelector('.head') as HTMLElement;
  const title = head.querySelector('span') as HTMLElement;
  let content = el.querySelector('.content') as HTMLElement;
  const writer = el.querySelector('.writer') as HTMLElement;
  const actions = el.querySelector('.actions') as HTMLElement;
  const cancel = actions.querySelector('.cancel') as HTMLButtonElement;
  const save = actions.querySelector('.save') as HTMLButtonElement;
  const stopDragging = makeDraggable(card, head);

  let currentSave: ((text: string) => void) | undefined;

  const close = (): void => el.classList.remove('open');
  (head.querySelector('button') as HTMLButtonElement).addEventListener('click', close);
  cancel.addEventListener('click', close);
  save.addEventListener('click', () => {
    if (!(content instanceof HTMLTextAreaElement) || !currentSave) return;
    save.disabled = true;
    currentSave(content.value);
    close();
  });
  el.addEventListener('click', (event) => { if (event.target === el) close(); });

  return {
    el,
    show: (next) => {
      title.textContent = next.title;
      currentSave = next.onSave;
      const replacement = next.onSave
        ? document.createElement('textarea')
        : document.createElement('div');
      replacement.className = 'content';
      if (replacement instanceof HTMLTextAreaElement) {
        replacement.value = next.text;
        if (next.maxLength !== undefined) replacement.maxLength = next.maxLength;
      } else {
        replacement.textContent = next.text || '(blank)';
      }
      content.replaceWith(replacement);
      content = replacement;
      writer.textContent = next.writer ? `— ${next.writer}` : '';
      save.disabled = false;
      el.classList.toggle('editable', Boolean(next.onSave));
      el.classList.add('open');
      if (replacement instanceof HTMLTextAreaElement) replacement.focus();
    },
    close,
    destroy: () => {
      stopDragging();
      el.remove();
    },
  };
}
