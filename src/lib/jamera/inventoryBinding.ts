import { createInventoryPane, slotName, type InventoryPaneHandle, type InventoryPaneOptions } from '../inventoryPane';
import type { GameClient } from '../net/common/GameClient';
import { inventorySlotPosition, PLAYER_BACKPACK_SLOT } from '../net/common/virtualPosition';
import { showActionSheet, type ActionSheetHandle, type ActionSheetAction } from '../actionSheet';
import type { ThingRef } from './interactions';

/**
 * Feeds the inventory pane from live equipment packets, replacing #146's
 * discard consumers: 0x78 InventorySet (U8 slot + item) and 0x79
 * InventoryClear (U8 slot). Tapping a filled slot offers Unequip →
 * backpack. The pane starts hidden behind a game-menu entry, like the
 * skill pane. Registered after registerWireSkips so these handlers
 * override per opcode.
 */
export interface InventoryBindingHandle {
  /** Toggle pane visibility (wired to a game-menu entry). */
  toggle(): void;
  destroy(): void;
}

export interface InventoryBindingOptions extends InventoryPaneOptions {
  /**
   * Arms the canvas crosshair mode (InteractionsHandle.armUseWith) with
   * the tapped equipment slot as the 0x83 `from`. Absent (tests) the
   * sheet omits Use with… — same convention as containerBinding.
   */
  armUseWith?: (from: ThingRef) => void;
}

export function bindInventory(
  client: GameClient,
  parent: HTMLElement = document.body,
  opts: InventoryBindingOptions = {},
): InventoryBindingHandle {
  const { armUseWith, ...paneOpts } = opts;
  const protocol = client.getProtocol();
  const op = protocol.serverOpcodes;
  const dispatcher = client.getDispatcher();

  let pane: InventoryPaneHandle | null = null;
  let sheet: ActionSheetHandle | null = null;
  let open = false;
  const ensurePane = (): InventoryPaneHandle => {
    if (!pane) {
      pane = createInventoryPane(parent, {
        ...paneOpts,
        onSlotTap: (wireSlot, itemId, count) => {
          // Unequipping the backpack onto its own slot would be a
          // from == to move the server drops — no sheet for that slot.
          if (wireSlot === PLAYER_BACKPACK_SLOT) return;
          sheet?.close();
          const actions: ActionSheetAction[] = [{
            // Targeting the backpack equipment slot puts the item
            // inside the equipped backpack (queryDestination). The
            // fromStackpos of an inventory thing is the slot number
            // itself — the server's own encode mirror
            // (Game::internalGetPosition) sets stackpos = pos.y.
            label: 'Unequip → backpack',
            onSelect: () => {
              try {
                client.send(protocol.actions.buildMoveThing(
                  inventorySlotPosition(wireSlot), itemId, wireSlot,
                  inventorySlotPosition(PLAYER_BACKPACK_SLOT), count ?? 1,
                ));
              } catch (e) {
                console.warn('[jamera] unequip send failed:', e instanceof Error ? e.message : e);
              }
            },
          }];
          if (armUseWith) {
            actions.push({
              // Same stackpos-is-the-slot rule as the unequip move above.
              label: 'Use with…',
              onSelect: () => armUseWith({
                position: inventorySlotPosition(wireSlot), thingId: itemId, stackPos: wireSlot,
              }),
            });
          }
          sheet = showActionSheet({ title: `#${itemId}`, parent, actions });
        },
      });
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
      sheet?.close();
      pane?.destroy();
    },
  };
}
