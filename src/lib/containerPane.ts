/**
 * Container windows — one compact window per open container (corpse,
 * bag, depot), stacked vertically on the left edge under the minimap
 * (the inventory cross owns the right edge). Self-contained component
 * (joystick.ts pattern): factory, injected styles, explicit handle.
 *
 * Cells are real DOM above the canvas, so taps land here instead of
 * walking the player — same reason the other overlays are DOM.
 */

import type { OpenContainer } from './containers';
import type { MapTileItem } from './net/common/types';
import { makeDraggable } from './draggable';

export interface ContainerPaneOptions {
  /**
   * Render an item graphic for a cell (a canvas the cell scales to
   * fit). Return null to fall back to the textual #id label — also the
   * behavior when the option is absent (gallery, pre-asset mounts).
   */
  renderThumb?: (itemId: number) => HTMLCanvasElement | null;
  onClose?: (cid: number) => void;
  onUp?: (cid: number) => void;
  onItemTap?: (cid: number, slot: number, item: MapTileItem) => void;
}

export interface ContainerPaneHandle {
  readonly el: HTMLElement;
  update(containers: OpenContainer[]): void;
  destroy(): void;
}

const STYLE_ID = 'container-pane-style';
const GRID_COLUMNS = 4;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .container-pane {
      position: fixed; top: 35%; left: 12px; z-index: 30;
      display: flex; flex-direction: column; gap: 8px;
      max-height: 55vh; overflow-y: auto;
      font-family: system-ui, sans-serif; user-select: none;
    }
    .container-pane .window {
      background: rgba(22,22,22,0.95); border: 1px solid #9a9a9a;
      border-radius: 10px; padding: 8px;
    }
    .container-pane .head {
      display: flex; align-items: center; gap: 6px;
      color: #e0e0e0; font-size: 0.75rem; padding-bottom: 6px;
    }
    .container-pane .head .name {
      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .container-pane .head button {
      background: rgba(0,0,0,0.45); border: 1px solid #3a3a55;
      border-radius: 6px; color: #e0e0e0; font-size: 0.75rem;
      width: 26px; height: 26px; padding: 0; cursor: pointer;
    }
    .container-pane .grid {
      display: grid; grid-template-columns: repeat(${GRID_COLUMNS}, 46px);
      grid-auto-rows: 46px; gap: 4px;
    }
    .container-pane .cell {
      background: rgba(0,0,0,0.45); border: 1px solid #3a3a55;
      border-radius: 6px; position: relative; opacity: 0.5; padding: 0;
      display: flex; align-items: center; justify-content: center;
      color: #e0e0e0; font-size: 0.6rem; text-align: center;
    }
    .container-pane .cell.filled {
      border-color: #9a9a9a; opacity: 1; cursor: pointer;
    }
    .container-pane .cell .count {
      position: absolute; right: 2px; bottom: 1px;
      font-size: 0.6rem; color: #fff; text-shadow: 0 1px 1px #000;
    }
  `;
  document.head.appendChild(style);
}

export function createContainerPane(
  parent: HTMLElement = document.body,
  opts: ContainerPaneOptions = {},
): ContainerPaneHandle {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'container-pane';
  el.style.display = 'none';
  parent.appendChild(el);

  const headerButton = (text: string, onTap: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onTap);
    return button;
  };

  const renderCell = (container: OpenContainer, slot: number): HTMLElement => {
    const item = container.items[slot];
    if (!item) {
      const empty = document.createElement('div');
      empty.className = 'cell';
      return empty;
    }
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell filled';
    cell.addEventListener('click', () => opts.onItemTap?.(container.id, slot, item));
    const thumb = opts.renderThumb?.(item.id) ?? null;
    if (thumb) {
      thumb.style.cssText = 'position:absolute;inset:2px;width:calc(100% - 4px);height:calc(100% - 4px);object-fit:contain;image-rendering:pixelated;';
      cell.appendChild(thumb);
    } else {
      cell.textContent = `#${item.id}`;
    }
    if (item.count !== undefined) {
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(item.count);
      cell.appendChild(count);
    }
    return cell;
  };

  const renderWindow = (container: OpenContainer): HTMLElement => {
    const win = document.createElement('div');
    win.className = 'window';
    const head = document.createElement('div');
    head.className = 'head';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = container.name;
    head.appendChild(name);
    if (container.hasParent) {
      head.appendChild(headerButton('⬆', () => opts.onUp?.(container.id)));
    }
    head.appendChild(headerButton('✕', () => opts.onClose?.(container.id)));
    makeDraggable(el, head);
    const grid = document.createElement('div');
    grid.className = 'grid';
    // A container can overfill past its nominal capacity (server-side
    // moves); render every item, then pad with dimmed empties.
    const cells = Math.max(container.capacity, container.items.length);
    for (let slot = 0; slot < cells; slot++) {
      grid.appendChild(renderCell(container, slot));
    }
    win.append(head, grid);
    return win;
  };

  return {
    el,
    update: (containers) => {
      const sorted = [...containers].sort((a, b) => a.id - b.id);
      // replaceChildren resets the pane's scroll; a loot tick must not
      // yank the list back to the top mid-scroll.
      const scrollTop = el.scrollTop;
      el.replaceChildren(...sorted.map(renderWindow));
      el.style.display = sorted.length > 0 ? 'flex' : 'none';
      el.scrollTop = scrollTop;
    },
    destroy: () => el.remove(),
  };
}
