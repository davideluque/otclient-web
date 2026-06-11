import { SPELLS, SPELL_SLOT_COUNT, spellByWords, spellIconUrl, type SpellDef } from './spells';

/**
 * Hotkeys menu (menu → Hotkeys): the full spell registry behind the
 * right-side cast buttons. Tap a slot to open the picker, tap a spell
 * to assign it; picking a spell that already sits in another slot
 * SWAPS the two slots, so rearranging never duplicates a hotkey.
 * The host persists and applies via onChange.
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
      display: flex; flex-direction: column; max-height: min(80vh, 560px);
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
    .spell-customizer .slot, .spell-customizer .pick {
      display: flex; align-items: center; gap: 10px; width: 100%;
      background: #1c1c1c; border: 1px solid #555; border-radius: 10px;
      color: #e0e0e0; padding: 10px 12px; cursor: pointer; text-align: left;
    }
    .spell-customizer .icon {
      width: 28px; height: 28px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 1.3rem;
    }
    .spell-customizer .icon img {
      width: 28px; height: 28px; object-fit: contain; image-rendering: pixelated;
    }
    .spell-customizer .name { flex: 1; }
    .spell-customizer .words { color: #888; font-size: 0.75rem; }
    .spell-customizer .picker {
      display: none; flex-direction: column; gap: 6px;
      overflow-y: auto; padding: 8px 10px 12px;
    }
    .spell-customizer .group {
      color: #888; font-size: 0.72rem; text-transform: uppercase;
      letter-spacing: 0.08em; padding: 6px 4px 0;
    }
    .spell-customizer .pick.assigned { border-color: #9a9a9a; }
    .spell-customizer .pick .in-slot { color: #9a9a9a; font-size: 0.72rem; }
    .spell-customizer.picking .rows, .spell-customizer.picking .hint { display: none; }
    .spell-customizer.picking .picker { display: flex; }
  `;
  document.head.appendChild(style);
}

/** The slot's face: library image when available, emoji otherwise. */
function iconEl(def: SpellDef): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'icon';
  const url = spellIconUrl(def);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = def.name;
    img.draggable = false;
    img.addEventListener('error', () => {
      img.remove();
      icon.textContent = def.icon;
    });
    icon.appendChild(img);
  } else {
    icon.textContent = def.icon;
  }
  return icon;
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
      <div class="head"><span class="title">Hotkeys</span><button type="button" aria-label="Close">✕</button></div>
      <div class="hint">Tap a slot, then pick its spell. Picking a spell that is on another slot swaps them.</div>
      <div class="rows"></div>
      <div class="picker"></div>
    </div>
  `;
  parent.appendChild(el);

  const titleEl = el.querySelector('.title') as HTMLElement;
  const rowsEl = el.querySelector('.rows') as HTMLElement;
  const pickerEl = el.querySelector('.picker') as HTMLElement;
  const slotButtons: HTMLButtonElement[] = [];
  let pickingSlot = -1;

  const renderRow = (i: number): void => {
    const def = spellByWords(slots[i]) ?? SPELLS[0];
    const btn = slotButtons[i];
    btn.innerHTML = '';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `Slot ${i + 1}: ${def.name}`;
    const words = document.createElement('span');
    words.className = 'words';
    words.textContent = def.words;
    btn.append(iconEl(def), name, words);
  };

  const showSlots = (): void => {
    pickingSlot = -1;
    el.classList.remove('picking');
    titleEl.textContent = 'Hotkeys';
  };

  const assign = (def: SpellDef): void => {
    const i = pickingSlot;
    const already = slots.indexOf(def.words);
    if (already !== -1 && already !== i) {
      // Swap, so a spell never occupies two slots.
      slots[already] = slots[i];
      renderRow(already);
    }
    slots[i] = def.words;
    renderRow(i);
    opts.onChange([...slots]);
    showSlots();
  };

  const renderPicker = (): void => {
    pickerEl.innerHTML = '';
    // Pre-grouped (not streamed off registry order) so each header
    // appears exactly once — the house commands sit at the registry's
    // tail and would otherwise reopen a second "Instant" section.
    const groups: Array<{ title: string; spells: SpellDef[] }> = [
      { title: 'Instant', spells: SPELLS.filter((s) => !s.conjure) },
      { title: 'Conjure & runes', spells: SPELLS.filter((s) => s.conjure) },
    ];
    for (const { title, spells } of groups) {
      const head = document.createElement('div');
      head.className = 'group';
      head.textContent = title;
      pickerEl.appendChild(head);
      for (const def of spells) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pick';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = def.name;
        const words = document.createElement('span');
        words.className = 'words';
        words.textContent = def.words;
        btn.append(iconEl(def), name, words);
        const slotIdx = slots.indexOf(def.words);
        if (slotIdx !== -1) {
          btn.classList.add('assigned');
          const tag = document.createElement('span');
          tag.className = 'in-slot';
          tag.textContent = `slot ${slotIdx + 1}`;
          btn.appendChild(tag);
        }
        btn.addEventListener('click', () => assign(def));
        pickerEl.appendChild(btn);
      }
    }
  };

  const openPicker = (i: number): void => {
    pickingSlot = i;
    renderPicker();
    el.classList.add('picking');
    titleEl.textContent = `Slot ${i + 1} — pick a spell`;
    pickerEl.scrollTop = 0;
  };

  for (let i = 0; i < SPELL_SLOT_COUNT; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot';
    btn.addEventListener('click', () => openPicker(i));
    rowsEl.appendChild(btn);
    slotButtons.push(btn);
    renderRow(i);
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // Escape backs out of the picker first, then closes.
    if (pickingSlot !== -1) showSlots();
    else close();
  };
  const open = (): void => {
    showSlots();
    el.classList.add('open');
    document.addEventListener('keydown', onKeyDown);
  };
  const close = (): void => {
    el.classList.remove('open');
    showSlots();
    document.removeEventListener('keydown', onKeyDown);
  };
  (el.querySelector('.head button') as HTMLButtonElement).addEventListener('click', () => {
    if (pickingSlot !== -1) showSlots();
    else close();
  });
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
