import { SPELLS, SPELL_SLOT_COUNT, spellByWords } from './spells';

/**
 * Spell slot customizer (menu → Spells): one row per right-side slot;
 * tapping a row cycles through the known-spell registry (mobile-first —
 * no dropdowns). The host persists and applies via onChange.
 */

export interface SpellCustomizerOptions {
  initial: string[];
  onChange(slots: string[]): void;
}

export interface SpellCustomizerHandle {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  destroy(): void;
}

const STYLE_ID = 'spell-customizer-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .spell-customizer {
      position: fixed; inset: 0; z-index: 60;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.55); font-family: system-ui, sans-serif;
    }
    .spell-customizer.open { display: flex; }
    .spell-customizer .card {
      width: min(92vw, 380px); background: rgba(20,20,20,0.98); color: #e0e0e0;
      border: 1px solid #555; border-radius: 12px; overflow: hidden;
    }
    .spell-customizer .head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid #333; font-weight: bold;
    }
    .spell-customizer .head button {
      background: none; border: none; color: #888; font-size: 1rem;
      cursor: pointer; padding: 2px 6px;
    }
    .spell-customizer .hint { padding: 8px 14px 0; color: #888; font-size: 0.75rem; }
    .spell-customizer .rows { padding: 8px 10px 12px; display: flex; flex-direction: column; gap: 8px; }
    .spell-customizer .slot {
      display: flex; align-items: center; gap: 10px; width: 100%;
      background: #1c1c1c; border: 1px solid #555; border-radius: 10px;
      color: #e0e0e0; padding: 10px 12px; cursor: pointer; text-align: left;
    }
    .spell-customizer .slot .icon { font-size: 1.3rem; }
    .spell-customizer .slot .name { flex: 1; }
    .spell-customizer .slot .words { color: #888; font-size: 0.75rem; }
  `;
  document.head.appendChild(style);
}

export function createSpellCustomizer(
  opts: SpellCustomizerOptions,
  parent: HTMLElement = document.body,
): SpellCustomizerHandle {
  ensureStyles();
  const slots = [...opts.initial];
  while (slots.length < SPELL_SLOT_COUNT) slots.push(SPELLS[0].words);

  const el = document.createElement('div');
  el.className = 'spell-customizer';
  el.innerHTML = `
    <div class="card">
      <div class="head"><span>Spell slots</span><button type="button" aria-label="Close">✕</button></div>
      <div class="hint">Tap a slot to cycle through the known spells. Changes apply immediately.</div>
      <div class="rows"></div>
    </div>
  `;
  parent.appendChild(el);

  const rowsEl = el.querySelector('.rows') as HTMLElement;
  const buttons: HTMLButtonElement[] = [];

  const renderRow = (i: number): void => {
    const def = spellByWords(slots[i]) ?? SPELLS[0];
    const btn = buttons[i];
    btn.innerHTML = '';
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = def.icon;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `Slot ${i + 1}: ${def.name}`;
    const words = document.createElement('span');
    words.className = 'words';
    words.textContent = def.words;
    btn.append(icon, name, words);
  };

  for (let i = 0; i < SPELL_SLOT_COUNT; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot';
    btn.addEventListener('click', () => {
      const idx = SPELLS.findIndex((s) => s.words === slots[i]);
      slots[i] = SPELLS[(idx + 1) % SPELLS.length].words;
      renderRow(i);
      opts.onChange([...slots]);
    });
    rowsEl.appendChild(btn);
    buttons.push(btn);
    renderRow(i);
  }

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
  (el.querySelector('.head button') as HTMLButtonElement).addEventListener('click', close);
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });

  return {
    el,
    open,
    close,
    destroy: () => {
      document.removeEventListener('keydown', onKeyDown);
      el.remove();
    },
  };
}
