/**
 * Battle list — visible creatures with name + health bar, tap to
 * target. Pure component: the host supplies entries and receives tap
 * callbacks; the live binding owns world polling and the combat wire.
 */
import { makeDraggable } from './draggable';

export interface BattleEntry {
  id: number;
  name: string;
  /** 0-100. */
  healthPercent: number;
  /** Highlighted as the engaged target. */
  targeted: boolean;
}

export interface BattleListOptions {
  onSelect(id: number): void;
}

export interface BattleListHandle {
  readonly el: HTMLElement;
  setEntries(entries: BattleEntry[]): void;
  setVisible(visible: boolean): void;
  readonly visible: boolean;
  destroy(): void;
}

/** Health bar color bands, matching the nameplate convention. */
export function healthColor(percent: number): string {
  if (percent > 92) return '#00bc00';
  if (percent > 60) return '#50a150';
  if (percent > 30) return '#a1a100';
  if (percent > 8) return '#bf0a0a';
  return '#910f0f';
}

const STYLE_ID = 'battle-list-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .battle-list {
      position: fixed; left: 8px; top: calc(122px + env(safe-area-inset-top, 0px));
      width: 132px; max-height: 40vh; overflow-y: auto;
      background: rgba(18,18,18,0.92); border: 1px solid #555;
      border-radius: 10px; padding: 6px; z-index: 30;
      font-family: system-ui, sans-serif; font-size: 0.72rem; color: #ddd;
    }
    .battle-list .empty { color: #777; text-align: center; padding: 4px 0; }
    .battle-list .drag-handle {
      color: #999; text-align: center; padding: 1px 0 5px;
      border-bottom: 1px solid #333; margin-bottom: 3px;
    }
    .battle-list .entry {
      display: block; width: 100%; text-align: left;
      background: none; border: 1px solid transparent; border-radius: 6px;
      color: inherit; padding: 4px 6px; cursor: pointer;
    }
    .battle-list .entry.targeted { border-color: #d9534f; background: rgba(217,83,79,0.12); }
    .battle-list .entry .name {
      display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .battle-list .entry .bar {
      height: 4px; border-radius: 2px; background: rgba(0,0,0,0.6);
      overflow: hidden; margin-top: 2px;
    }
    .battle-list .entry .bar .fill { height: 100%; }
  `;
  document.head.appendChild(style);
}

export function createBattleList(opts: BattleListOptions, parent: HTMLElement = document.body): BattleListHandle {
  ensureStyles();
  const el = document.createElement('div');
  el.className = 'battle-list';
  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.textContent = 'Battle';
  const entriesEl = document.createElement('div');
  entriesEl.className = 'entries';
  el.append(dragHandle, entriesEl);
  parent.appendChild(el);
  const stopDragging = makeDraggable(el, dragHandle);

  let visible = true;

  const setEntries = (entries: BattleEntry[]): void => {
    entriesEl.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No creatures';
      entriesEl.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'entry' + (entry.targeted ? ' targeted' : '');
      btn.dataset['id'] = String(entry.id);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.name || '???';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = `${Math.max(0, Math.min(100, entry.healthPercent))}%`;
      fill.style.background = healthColor(entry.healthPercent);
      bar.appendChild(fill);
      btn.append(name, bar);
      btn.addEventListener('click', () => opts.onSelect(entry.id));
      entriesEl.appendChild(btn);
    }
  };

  setEntries([]);

  return {
    el,
    setEntries,
    get visible() { return visible; },
    setVisible: (v) => {
      visible = v;
      el.style.display = v ? 'block' : 'none';
    },
    destroy: () => {
      stopDragging();
      el.remove();
    },
  };
}
