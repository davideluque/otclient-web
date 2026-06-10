import { createInventoryPane, slotName, type InventoryPaneHandle, type InventoryPaneOptions } from '../inventoryPane';
import type { GameClient } from '../net/common/GameClient';

/**
 * Feeds the inventory pane from live equipment packets, replacing #146's
 * discard consumers: 0x78 InventorySet (U8 slot + item) and 0x79
 * InventoryClear (U8 slot). The pane starts hidden behind a game-menu
 * entry, like the skill pane. Registered after registerWireSkips so
 * these handlers override per opcode.
 */
export interface InventoryBindingHandle {
  /** Toggle pane visibility (wired to a game-menu entry). */
  toggle(): void;
  destroy(): void;
}

export function bindInventory(
  client: GameClient,
  parent: HTMLElement = document.body,
  paneOpts: InventoryPaneOptions = {},
): InventoryBindingHandle {
  const protocol = client.getProtocol();
  const op = protocol.serverOpcodes;
  const dispatcher = client.getDispatcher();

  let pane: InventoryPaneHandle | null = null;
  let open = false;
  const ensurePane = (): InventoryPaneHandle => {
    if (!pane) {
      pane = createInventoryPane(parent, paneOpts);
      pane.setVisible(open);
    }
    return pane;
  };

  dispatcher.on(op.InventorySet, (p) => {
    const slot = slotName(p.getU8());
    const item = protocol.map.parseItem(p);
    if (slot) ensurePane().setSlot(slot, item.id, item.count);
  });
  dispatcher.on(op.InventoryClear, (p) => {
    const slot = slotName(p.getU8());
    if (slot) ensurePane().setSlot(slot, null);
  });

  return {
    toggle: () => {
      open = !open;
      ensurePane().setVisible(open);
    },
    destroy: () => {
      dispatcher.off(op.InventorySet);
      dispatcher.off(op.InventoryClear);
      pane?.destroy();
    },
  };
}
