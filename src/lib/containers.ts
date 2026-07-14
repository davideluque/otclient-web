import type { ContainerOpenEvent, MapTileItem } from './net/common/types';

/** One open container window, mirrored from the server's packets. */
export interface OpenContainer {
  /** Window id (cid, 0–15) — the server addresses every update by it. */
  id: number;
  /** Client id of the container item itself (bag, corpse, depot…). */
  itemId: number;
  name: string;
  capacity: number;
  hasParent: boolean;
  items: MapTileItem[];
}

/** The server rejects window ids above 0x0F (player.cpp addContainer). */
export const MAX_CONTAINER_ID = 0x0f;
const PENDING_OPEN_TTL_MS = 5_000;

/**
 * Client-side mirror of the player's open containers. Bindings feed it
 * parsed 0x6E–0x72 events; the pane renders from it via subscribe().
 * Version-agnostic — everything version-specific stays in the parsers.
 */
export class ContainerManager {
  private containers = new Map<number, OpenContainer>();
  private pendingOpenIds = new Map<number, number>();
  private listeners = new Set<() => void>();

  /** Open windows sorted by id — stable pane order across updates. */
  get list(): OpenContainer[] {
    return [...this.containers.values()].sort((a, b) => a.id - b.id);
  }

  get(id: number): OpenContainer | undefined {
    return this.containers.get(id);
  }

  /**
   * 0x6E — open or re-describe. The same id arriving again REPLACES the
   * window in place: that's how the up-arrow (0x88) and opening a nested
   * container reuse the parent's window server-side.
   */
  open(event: ContainerOpenEvent): void {
    this.pendingOpenIds.delete(event.containerId);
    this.containers.set(event.containerId, {
      id: event.containerId,
      itemId: event.containerItemId,
      name: event.name,
      capacity: event.capacity,
      hasParent: event.hasParent,
      items: [...event.items],
    });
    this.notify();
  }

  /** 0x6F. Unknown ids are ignored (close echo can race a re-open). */
  close(id: number): void {
    this.pendingOpenIds.delete(id);
    if (this.containers.delete(id)) this.notify();
  }

  /** 0x70 — no slot on the wire: the server prepends at slot 0. */
  addItem(id: number, item: MapTileItem): void {
    const container = this.containers.get(id);
    if (!container) return;
    container.items.unshift(item);
    this.notify();
  }

  /** 0x71. Out-of-range slots are dropped rather than corrupting state. */
  updateItem(id: number, slot: number, item: MapTileItem): void {
    const container = this.containers.get(id);
    if (!container || slot < 0 || slot >= container.items.length) return;
    container.items[slot] = item;
    this.notify();
  }

  /** 0x72. */
  removeItem(id: number, slot: number): void {
    const container = this.containers.get(id);
    if (!container || slot < 0 || slot >= container.items.length) return;
    container.items.splice(slot, 1);
    this.notify();
  }

  /**
   * The window id to put in 0x82's index byte when opening a container:
   * first free id, reserved until the matching 0x6E arrives. With all 16
   * in use, reuse 0 — the server overwrites that window in place and
   * re-sends 0x6E for it.
   */
  nextFreeId(): number {
    this.prunePendingOpenIds();
    for (let id = 0; id <= MAX_CONTAINER_ID; id++) {
      if (!this.containers.has(id) && !this.pendingOpenIds.has(id)) {
        this.pendingOpenIds.set(id, Date.now() + PENDING_OPEN_TTL_MS);
        return id;
      }
    }
    return 0;
  }

  /** Session teardown — drop all windows without notifying. */
  clear(): void {
    this.containers.clear();
    this.pendingOpenIds.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private prunePendingOpenIds(): void {
    const now = Date.now();
    for (const [id, expiresAt] of this.pendingOpenIds) {
      if (expiresAt <= now) this.pendingOpenIds.delete(id);
    }
  }
}
