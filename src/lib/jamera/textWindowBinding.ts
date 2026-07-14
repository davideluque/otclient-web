import type { GameClient } from '../net/common/GameClient';
import { createTextWindow } from '../textWindow';

export interface TextWindowBindingHandle {
  destroy(): void;
}

export interface TextWindowBindingOptions {
  /** DAT-backed writable-item check; avoids guessing from max/text lengths. */
  isWritable?: (itemId: number) => boolean;
}

/** Jamera 7.6 book/sign and house-list windows (server opcodes 0x96/0x97). */
export function bindTextWindows(
  client: GameClient,
  parent: HTMLElement = document.body,
  opts: TextWindowBindingOptions = {},
): TextWindowBindingHandle {
  const pane = createTextWindow(parent);
  const dispatcher = client.getDispatcher();
  const op = client.getProtocol().serverOpcodes;
  const protocol = client.getProtocol();
  const send = (packet: Parameters<GameClient['send']>[0]): void => {
    try {
      client.send(packet);
    } catch (e) {
      console.warn('[jamera] text-window send failed:', e instanceof Error ? e.message : e);
    }
  };

  dispatcher.on(op.TextWindow, (packet) => {
    const windowId = packet.getU32();
    const itemId = packet.getU16();
    const maxLength = packet.getU16();
    const text = packet.getString();
    const writer = packet.getString();
    const writable = opts.isWritable?.(itemId) ?? false;
    pane.show({
      title: writable ? 'Edit text' : 'Written text',
      text,
      writer,
      maxLength: writable ? maxLength : undefined,
      onSave: writable
        ? (next) => send(protocol.actions.buildUpdateTextWindow(windowId, next))
        : undefined,
    });
  });
  dispatcher.on(op.HouseWindow, (packet) => {
    const listId = packet.getU8();
    const windowId = packet.getU32();
    pane.show({
      title: 'Edit house list',
      text: packet.getString(),
      onSave: (next) => send(protocol.actions.buildUpdateHouseWindow(listId, windowId, next)),
    });
  });

  return {
    destroy: () => {
      dispatcher.off(op.TextWindow);
      dispatcher.off(op.HouseWindow);
      pane.destroy();
    },
  };
}
