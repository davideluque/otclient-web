/**
 * NPC shop window — a single draggable window listing what the focused
 * npc sells and buys, with Buy/Sell tabs. Self-contained component
 * (joystick.ts pattern): factory, injected styles, explicit handle.
 *
 * Rendering only: the pane never talks to the wire. The shop binding
 * feeds it OpenShop state and receives taps back through callbacks.
 */

import type { ShopItem } from './net/common/types';
import type { OpenShop } from './shop';
import { makeDraggable } from './draggable';

export type ShopSide = 'buy' | 'sell';

export interface ShopPaneOptions {
  /** Item graphic for a row (canvas scaled to fit); null → #id text. */
  renderThumb?: (clientItemId: number) => HTMLCanvasElement | null;
  /** Player tapped an entry on the given side (row is tappable only when the side's price > 0). */
  onItemTap?: (side: ShopSide, item: ShopItem, ownedCount: number) => void;
  /** Player tapped ✕. */
  onClose?: () => void;
}

export interface ShopPaneHandle {
  readonly el: HTMLElement;
  update(shop: OpenShop | null): void;
  destroy(): void;
}

const STYLE_ID = 'shop-pane-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .shop-pane {
      position: fixed; top: 18%; left: 50%; transform: translateX(-50%);
      z-index: 32; width: min(320px, calc(100vw - 24px));
      background: rgba(22,22,22,0.95); border: 1px solid #9a9a9a;
      border-radius: 10px; padding: 8px;
      font-family: system-ui, sans-serif; user-select: none;
    }
    .shop-pane .head {
      display: flex; align-items: center; gap: 6px;
      color: #e0e0e0; font-size: 0.8rem; padding-bottom: 6px;
    }
    .shop-pane .head .name {
      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .shop-pane .head .money { color: #ffd76a; white-space: nowrap; }
    .shop-pane .head button {
      background: rgba(0,0,0,0.45); border: 1px solid #3a3a55;
      border-radius: 6px; color: #e0e0e0; font-size: 0.75rem;
      width: 26px; height: 26px; padding: 0; cursor: pointer;
    }
    .shop-pane .tabs { display: flex; gap: 4px; padding-bottom: 6px; }
    .shop-pane .tabs button {
      flex: 1; background: rgba(0,0,0,0.45); border: 1px solid #3a3a55;
      border-radius: 6px; color: #e0e0e0; font-size: 0.75rem;
      height: 28px; padding: 0; cursor: pointer;
    }
    .shop-pane .tabs button.active { border-color: #ffd76a; color: #ffd76a; }
    .shop-pane .rows { max-height: 45vh; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .shop-pane .row {
      display: flex; align-items: center; gap: 8px; width: 100%;
      background: rgba(0,0,0,0.45); border: 1px solid #9a9a9a;
      border-radius: 6px; color: #e0e0e0; font-size: 0.75rem;
      padding: 4px 8px; cursor: pointer; text-align: left;
    }
    .shop-pane .row .thumb {
      width: 32px; height: 32px; flex: none; position: relative;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.6rem;
    }
    .shop-pane .row .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .shop-pane .row .owned { color: #9ad19a; white-space: nowrap; }
    .shop-pane .row .price { color: #ffd76a; white-space: nowrap; }
    .shop-pane .empty { color: #9a9a9a; font-size: 0.75rem; text-align: center; padding: 10px 0; }
  `;
  document.head.appendChild(style);
}

export function createShopPane(
  parent: HTMLElement = document.body,
  opts: ShopPaneOptions = {},
): ShopPaneHandle {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'shop-pane';
  el.style.display = 'none';
  parent.appendChild(el);

  let side: ShopSide = 'buy';
  let shop: OpenShop | null = null;
  let stopDrag: (() => void) | null = null;

  const renderRow = (item: ShopItem): HTMLElement => {
    const owned = shop?.goods.get(item.serverId) ?? 0;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';
    row.addEventListener('click', () => opts.onItemTap?.(side, item, owned));

    const thumbBox = document.createElement('span');
    thumbBox.className = 'thumb';
    const thumb = opts.renderThumb?.(item.clientId) ?? null;
    if (thumb) {
      thumb.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;';
      thumbBox.appendChild(thumb);
    } else {
      thumbBox.textContent = `#${item.serverId}`;
    }
    row.appendChild(thumbBox);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = item.name;
    row.appendChild(label);

    if (side === 'sell') {
      const ownedEl = document.createElement('span');
      ownedEl.className = 'owned';
      ownedEl.textContent = `×${owned}`;
      row.appendChild(ownedEl);
    }

    const price = document.createElement('span');
    price.className = 'price';
    price.textContent = `${side === 'buy' ? item.buyPrice : item.sellPrice} gp`;
    row.appendChild(price);

    return row;
  };

  const render = (): void => {
    if (!shop) {
      el.style.display = 'none';
      el.replaceChildren();
      stopDrag?.();
      stopDrag = null;
      return;
    }
    el.style.display = '';

    const head = document.createElement('div');
    head.className = 'head';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = shop.npcName;
    const money = document.createElement('span');
    money.className = 'money';
    money.textContent = `${shop.money} gp`;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', () => opts.onClose?.());
    head.append(name, money, close);

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    for (const tabSide of ['buy', 'sell'] as const) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.textContent = tabSide === 'buy' ? 'Buy' : 'Sell';
      if (side === tabSide) tab.className = 'active';
      tab.addEventListener('click', () => {
        side = tabSide;
        render();
      });
      tabs.appendChild(tab);
    }

    const rows = document.createElement('div');
    rows.className = 'rows';
    const entries = shop.items.filter((i) => (side === 'buy' ? i.buyPrice > 0 : i.sellPrice > 0));
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = side === 'buy' ? 'Nothing for sale.' : 'Buys nothing.';
      rows.appendChild(empty);
    } else {
      for (const item of entries) rows.appendChild(renderRow(item));
    }

    el.replaceChildren(head, tabs, rows);
    stopDrag?.();
    stopDrag = makeDraggable(el, head);
  };

  return {
    el,
    update(next: OpenShop | null): void {
      if (next === null) side = 'buy'; // fresh window starts on Buy
      shop = next;
      render();
    },
    destroy(): void {
      stopDrag?.();
      el.remove();
    },
  };
}
