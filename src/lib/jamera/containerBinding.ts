import type { GameClient } from '../net/common/GameClient';
import { ContainerManager } from '../containers';
import { createContainerPane, type ContainerPaneHandle, type ContainerPaneOptions } from '../containerPane';

export interface ContainerBindingHandle {
  readonly manager: ContainerManager;
  destroy(): void;
}

export interface ContainerBindingOptions {
  renderThumb?: ContainerPaneOptions['renderThumb'];
}

/**
 * Routes the five server container packets (0x6E–0x72) into a
 * ContainerManager. Registered after registerWireSkips so these handlers
 * override the discard consumers per opcode. With a `parent`, a container
 * pane renders the manager and its taps send ✕ 0x87 / ⬆ 0x88 / look 0x8C;
 * without one the binding stays wire → state only (node-env tests).
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
      // 7.6 addresses a container slot through the virtual position
      // x=0xFFFF, y=0x40|cid, z=slot (game.cpp internalGetThing); the
      // 0xB4 "You see …" answer already lands in the chat channel.
      onItemTap: (cid, slot, item) =>
        send(protocol.actions.buildLookAt({ x: 0xffff, y: 0x40 | cid, z: slot }, item.id, slot)),
    });
    unsubscribe = manager.subscribe(() => pane?.update(manager.list));
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
      pane?.destroy();
      manager.clear();
    },
  };
}
