/**
 * VIP list — friends with online status (menu → VIP). Pure component:
 * entries in, add/remove intents out; the binding owns the wire.
 */

export interface VipEntry {
  guid: number;
  name: string;
  online: boolean;
}

export interface VipListOptions {
  onAdd(name: string): void;
  onRemove(guid: number): void;
}

export interface VipListHandle {
  readonly el: HTMLElement;
  setEntries(entries: VipEntry[]): void;
  open(): void;
  close(): void;
  destroy(): void;
}

const STYLE_ID = 'vip-list-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .vip-list {
      position: fixed; inset: 0; z-index: 60;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.55); font-family: system-ui, sans-serif;
    }
    .vip-list.open { display: flex; }
    .vip-list .card {
      width: min(92vw, 360px); max-height: min(70vh, 480px);
      background: rgba(20,20,20,0.98); color: #e0e0e0;
      border: 1px solid #555; border-radius: 12px;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .vip-list .head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid #333; font-weight: bold;
    }
    .vip-list .head button {
      background: none; border: none; color: #888; font-size: 1rem;
      cursor: pointer; padding: 2px 6px;
    }
    .vip-list .rows { flex: 1; overflow-y: auto; padding: 6px 10px; }
    .vip-list .empty { color: #777; text-align: center; padding: 14px 0; font-size: 0.85rem; }
    .vip-list .row {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 4px; border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 0.88rem;
    }
    .vip-list .row .dot {
      width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
      background: #555;
    }
    .vip-list .row.online .dot { background: #00bc00; }
    .vip-list .row .name { flex: 1; }
    .vip-list .row.online .name { color: #fff; }
    .vip-list .row .remove {
      background: none; border: none; color: #777; cursor: pointer;
      font-size: 0.85rem; padding: 2px 6px;
    }
    .vip-list .row .remove:hover { color: #fff; }
    .vip-list .add-row {
      display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #333;
    }
    .vip-list .add-row input {
      flex: 1; background: #111; color: #eee; border: 1px solid #444;
      border-radius: 6px; padding: 8px 10px;
      font-size: 16px; /* iOS focus auto-zoom floor */
      outline: none;
    }
    .vip-list .add-row button {
      background: #2e2e2e; color: #fff; border: 1px solid #777;
      border-radius: 6px; padding: 8px 14px; cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

export function createVipList(opts: VipListOptions, parent: HTMLElement = document.body): VipListHandle {
  ensureStyles();
  const el = document.createElement('div');
  el.className = 'vip-list';
  el.innerHTML = `
    <div class="card">
      <div class="head"><span>VIP</span><button type="button" aria-label="Close">✕</button></div>
      <div class="rows"></div>
      <div class="add-row">
        <input type="text" placeholder="Add player by name..." autocomplete="off" maxlength="32" />
        <button type="button">Add</button>
      </div>
    </div>
  `;
  parent.appendChild(el);

  const rowsEl = el.querySelector('.rows') as HTMLElement;
  const inputEl = el.querySelector('.add-row input') as HTMLInputElement;
  const addBtn = el.querySelector('.add-row button') as HTMLButtonElement;

  const setEntries = (entries: VipEntry[]): void => {
    rowsEl.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No VIPs yet — add a player below.';
      rowsEl.appendChild(empty);
      return;
    }
    const sorted = [...entries].sort((a, b) =>
      Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    for (const entry of sorted) {
      const row = document.createElement('div');
      row.className = 'row' + (entry.online ? ' online' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.name; // textContent: names are player-controlled
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Remove ${entry.name}`);
      remove.addEventListener('click', () => opts.onRemove(entry.guid));
      row.append(dot, name, remove);
      rowsEl.appendChild(row);
    }
  };

  const add = (): void => {
    const name = inputEl.value.trim();
    if (!name) return;
    inputEl.value = '';
    opts.onAdd(name);
  };
  addBtn.addEventListener('click', add);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add();
  });

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

  setEntries([]);

  return {
    el,
    setEntries,
    open,
    close,
    destroy: () => {
      document.removeEventListener('keydown', onKeyDown);
      el.remove();
    },
  };
}
