import type { GameClient } from '../net/common/GameClient';
import type { WirePosition } from '../net/common/types';
import { containerSlotPosition, inventorySlotPosition, PLAYER_BACKPACK_SLOT } from '../net/common/virtualPosition';
import { ContainerManager } from '../containers';
import { createContainerPane, type ContainerPaneHandle, type ContainerPaneOptions } from '../containerPane';
import { showActionSheet, type ActionSheetHandle, type ActionSheetAction } from '../actionSheet';
import type { ThingRef } from './interactions';

export interface ContainerBindingHandle {
  readonly manager: ContainerManager;
  destroy(): void;
}

export interface ContainerBindingOptions {
  renderThumb?: ContainerPaneOptions['renderThumb'];
  /**
   * Live player position, read when Drop is selected (the drop target
   * is the tile under the player). Absent (tests, pre-world mounts)
   * the sheet simply omits Drop.
   */
  playerPosition?: () => WirePosition;
  /**
   * Arms the canvas crosshair mode (InteractionsHandle.armUseWith) with
   * the tapped item as the 0x83 `from`. Absent (tests) the sheet omits
   * Use with… — same convention as playerPosition/Drop above.
   */
  armUseWith?: (from: ThingRef) => void;
  /** Arms a trade offer; the next world creature tap chooses the partner. */
  armTrade?: (from: ThingRef) => void;
}

/**
 * Routes the five server container packets (0x6E–0x72) into a
 * ContainerManager. Registered after registerWireSkips so these handlers
 * override the discard consumers per opcode. With a `parent`, a container
 * pane renders the manager: ✕ sends 0x87, ⬆ sends 0x88, and tapping an
 * item opens a Loot / Look / Drop action sheet; without one the binding
 * stays wire → state only (node-env tests).
 */
export function bindContainers(
  client: GameClient,
  parent?: HTMLElement,
  opts: ContainerBindingOptions = {},
): ContainerBindingHandle {
  const protocol = client.getProtocol();
  const dispatcher = client.getDispatcher();
  const op = protocol.serverOpcodes;
  const manager = new ContainerManager();

  let pane: ContainerPaneHandle | null = null;
  let unsubscribe: (() => void) | null = null;
  let sheet: ActionSheetHandle | null = null;
  const closeSheet = (): void => {
    sheet?.close();
    sheet = null;
  };
  if (parent) {
    const send = (packet: Parameters<GameClient['send']>[0]): void => {
      try {
        client.send(packet);
      } catch (e) {
        console.warn('[jamera] container send failed:', e instanceof Error ? e.message : e);
      }
    };
    pane = createContainerPane(parent, {
      renderThumb: opts.renderThumb,
      onClose: (cid) => send(protocol.containers.buildClose(cid)),
      onUp: (cid) => send(protocol.containers.buildUp(cid)),
      onItemTap: (cid, slot, item) => {
        const from = containerSlotPosition(cid, slot);
        const count = item.count ?? 1;
        const actions: ActionSheetAction[] = [
          {
            // The move target is the backpack *equipment slot*: with a
            // backpack equipped the server's queryDestination forwards
            // the item into that backpack, which is what looting means.
            label: 'Loot',
            onSelect: () => send(protocol.actions.buildMoveThing(
              from, item.id, slot, inventorySlotPosition(PLAYER_BACKPACK_SLOT), count,
            )),
          },
          {
            // The 0xB4 "You see …" answer already lands in the chat channel.
            label: 'Look',
            onSelect: () => send(protocol.actions.buildLookAt(from, item.id, slot)),
          },
        ];
        const armUseWith = opts.armUseWith;
        if (armUseWith) {
          actions.push({
            // Rope, shovel, rune: arm the crosshair — the next canvas
            // tap picks the 0x83 target.
            label: 'Use with…',
            onSelect: () => armUseWith({ position: from, thingId: item.id, stackPos: slot }),
          });
        }
        if (opts.armTrade) {
          actions.push({
            label: 'Trade with…',
            onSelect: () => opts.armTrade?.({ position: from, thingId: item.id, stackPos: slot }),
          });
        }
        const playerPosition = opts.playerPosition;
        if (playerPosition) {
          actions.push({
            label: 'Drop',
            onSelect: () => send(protocol.actions.buildMoveThing(
              from, item.id, slot, playerPosition(), count,
            )),
          });
        }
        closeSheet();
        sheet = showActionSheet({ title: `#${item.id}`, actions, parent });
      },
    });
    unsubscribe = manager.subscribe(() => {
      pane?.update(manager.list);
      // Container updates can prepend/remove items and shift stack positions.
      // Force the player to tap the freshly rendered slot before sending.
      closeSheet();
    });
  }

  dispatcher.on(op.ContainerOpen, (p) => {
    manager.open(protocol.containers.parseOpen(p));
  });
  dispatcher.on(op.ContainerClose, (p) => {
    manager.close(protocol.containers.parseClose(p));
  });
  dispatcher.on(op.ContainerAddItem, (p) => {
    const { containerId, item } = protocol.containers.parseAddItem(p);
    manager.addItem(containerId, item);
  });
  dispatcher.on(op.ContainerUpdateItem, (p) => {
    const { containerId, slot, item } = protocol.containers.parseUpdateItem(p);
    manager.updateItem(containerId, slot, item);
  });
  dispatcher.on(op.ContainerRemoveItem, (p) => {
    const { containerId, slot } = protocol.containers.parseRemoveItem(p);
    manager.removeItem(containerId, slot);
  });

  return {
    manager,
    destroy: () => {
      dispatcher.off(op.ContainerOpen);
      dispatcher.off(op.ContainerClose);
      dispatcher.off(op.ContainerAddItem);
      dispatcher.off(op.ContainerUpdateItem);
      dispatcher.off(op.ContainerRemoveItem);
      // The handle exposes `manager` — dropping the subscription keeps a
      // retained manager from pinning the destroyed pane's DOM.
      unsubscribe?.();
      closeSheet();
      pane?.destroy();
      manager.clear();
    },
  };
}
