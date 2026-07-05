import type { GameClient } from '../net/common/GameClient';
import { ContainerManager } from '../containers';

export interface ContainerBindingHandle {
  readonly manager: ContainerManager;
  destroy(): void;
}

/**
 * Routes the five server container packets (0x6E–0x72) into a
 * ContainerManager. Registered after registerWireSkips so these handlers
 * override the discard consumers per opcode. The pane (and its close/up
 * sends) layers on top of the manager — this binding is wire → state only.
 */
export function bindContainers(client: GameClient): ContainerBindingHandle {
  const protocol = client.getProtocol();
  const dispatcher = client.getDispatcher();
  const op = protocol.serverOpcodes;
  const manager = new ContainerManager();

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
      manager.clear();
    },
  };
}
