import type { ShopGoodsEvent, ShopItem, ShopOpenEvent } from './net/common/types';

/** The open NPC shop window, mirrored from the server's packets. */
export interface OpenShop {
  npcName: string;
  items: ShopItem[];
  /** Total gold the player carries (from the last 0x7B). */
  money: number;
  /** Owned counts of sellable catalog items, by server item id. */
  goods: Map<number, number>;
}

/**
 * Client-side mirror of the NPC shop window (at most one open at a time —
 * the server supersedes an old window before opening a new one). Bindings
 * feed it parsed 0x7A/0x7B/0x7C events; the pane renders from it via
 * subscribe(). Version-agnostic — the wire layout stays in the parsers.
 */
export class ShopManager {
  private shop: OpenShop | null = null;
  private listeners = new Set<() => void>();

  get current(): OpenShop | null {
    return this.shop;
  }

  /** 0x7A — open (or replace) the shop window. */
  open(event: ShopOpenEvent): void {
    this.shop = {
      npcName: event.npcName,
      items: event.items,
      money: this.shop?.money ?? 0,
      goods: this.shop?.goods ?? new Map(),
    };
    this.notify();
  }

  /**
   * 0x7B — money + sellable holdings. The server sends it right after
   * 0x7A and again after every successful transaction; it can also arrive
   * unsolicited, which is a no-op without an open window.
   */
  setGoods(event: ShopGoodsEvent): void {
    if (!this.shop) return;
    this.shop.money = event.money;
    this.shop.goods = new Map(event.items.map((g) => [g.serverId, g.count]));
    this.notify();
  }

  /** 0x7C — the server closed the window. */
  close(): void {
    if (!this.shop) return;
    this.shop = null;
    this.notify();
  }

  clear(): void {
    this.shop = null;
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
