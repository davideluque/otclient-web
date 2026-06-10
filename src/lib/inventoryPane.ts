/**
 * Inventory pane — the classic Tibia equipment cross: ten slots in the
 * canonical 7.6 wire order (creature.h: 1 head, 2 necklace, 3 backpack,
 * 4 armor, 5 right hand, 6 left hand, 7 legs, 8 feet, 9 ring, 10 ammo).
 * Self-contained component (joystick.ts pattern): factory, injected
 * styles, explicit handle.
 *
 * Item visuals are textual for now (item id + count badge) — sprite
 * thumbnails need the atlas and arrive with a later renderer pass; the
 * slot semantics and wire plumbing don't have to wait for them.
 */

export const INVENTORY_SLOTS = [
  'head', 'necklace', 'backpack', 'armor', 'right',
  'left', 'legs', 'feet', 'ring', 'ammo',
] as const;

export type InventorySlotName = (typeof INVENTORY_SLOTS)[number];

/** Wire slot byte (1-based, creature.h) → slot name. */
export function slotName(wireSlot: number): InventorySlotName | null {
  return INVENTORY_SLOTS[wireSlot - 1] ?? null;
}

export interface InventoryPaneHandle {
  readonly el: HTMLElement;
  setSlot(slot: InventorySlotName, itemId: number | null, count?: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

const STYLE_ID = 'inventory-pane-style';

// Classic cross arrangement on a 3×4 grid (column, row), 0-indexed.
const SLOT_GRID: Record<InventorySlotName, [number, number]> = {
  necklace: [0, 0], head: [1, 0], backpack: [2, 0],
  left: [0, 1], armor: [1, 1], right: [2, 1],
  ring: [0, 2], legs: [1, 2], ammo: [2, 2],
  feet: [1, 3],
};

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .inventory-pane {
      position: fixed; top: 50%; right: 12px; transform: translateY(-50%);
      display: grid; grid-template-columns: repeat(3, 46px);
      grid-template-rows: repeat(4, 46px); gap: 4px;
      padding: 10px; background: rgba(22,22,22,0.95);
      border: 1px solid #9a9a9a; border-radius: 10px;
      font-family: system-ui, sans-serif; z-index: 30; user-select: none;
    }
    .inventory-pane .slot {
      background: rgba(0,0,0,0.45); border: 1px solid #3a3a55;
      border-radius: 6px; position: relative;
      display: flex; align-items: center; justify-content: center;
      color: #888; font-size: 0.6rem; text-align: center;
    }
    .inventory-pane .slot.filled { border-color: #9a9a9a; color: #e0e0e0; }
    .inventory-pane .slot .count {
      position: absolute; right: 2px; bottom: 1px;
      font-size: 0.6rem; color: #fff; text-shadow: 0 1px 1px #000;
    }
  `;
  document.head.appendChild(style);
}

export interface InventoryPaneOptions {
  /**
   * Render an item graphic for a slot (a canvas the cell scales to
   * fit). Return null to fall back to the textual #id label — also the
   * behavior when the option is absent (gallery, pre-asset mounts).
   */
  renderThumb?: (itemId: number) => HTMLCanvasElement | null;
}

export function createInventoryPane(
  parent: HTMLElement = document.body,
  opts: InventoryPaneOptions = {},
): InventoryPaneHandle {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'inventory-pane';

  const slots = new Map<InventorySlotName, { cell: HTMLElement; label: HTMLElement; count: HTMLElement }>();
  for (const name of INVENTORY_SLOTS) {
    const [col, row] = SLOT_GRID[name];
    const cell = document.createElement('div');
    cell.className = 'slot';
    cell.style.gridColumn = String(col + 1);
    cell.style.gridRow = String(row + 1);
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = name;
    const count = document.createElement('span');
    count.className = 'count';
    cell.append(label, count);
    el.appendChild(cell);
    slots.set(name, { cell, label, count });
  }
  parent.appendChild(el);

  return {
    el,
    setSlot: (slot, itemId, count) => {
      const s = slots.get(slot);
      if (!s) return;
      s.cell.querySelector('canvas')?.remove();
      if (itemId === null) {
        s.cell.classList.remove('filled');
        s.label.textContent = slot;
        s.count.textContent = '';
      } else {
        s.cell.classList.add('filled');
        const thumb = opts.renderThumb?.(itemId) ?? null;
        if (thumb) {
          thumb.style.cssText = 'position:absolute;inset:2px;width:calc(100% - 4px);height:calc(100% - 4px);object-fit:contain;image-rendering:pixelated;';
          s.cell.appendChild(thumb);
          s.label.textContent = '';
        } else {
          s.label.textContent = `#${itemId}`;
        }
        s.count.textContent = count !== undefined && count > 1 ? String(count) : '';
      }
    },
    setVisible: (visible) => { el.style.display = visible ? 'grid' : 'none'; },
    destroy: () => el.remove(),
  };
}
