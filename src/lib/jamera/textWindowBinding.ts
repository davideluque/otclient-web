import type { GameClient } from '../net/common/GameClient';
import { createTextWindow } from '../textWindow';

export interface TextWindowBindingHandle {
  destroy(): void;
}

/** Jamera 7.6 book/sign and house-list windows (server opcodes 0x96/0x97). */
export function bindTextWindows(
  client: GameClient,
  parent: HTMLElement = document.body,
): TextWindowBindingHandle {
  const pane = createTextWindow(parent);
  const dispatcher = client.getDispatcher();
  const op = client.getProtocol().serverOpcodes;

  dispatcher.on(op.TextWindow, (packet) => {
    packet.getU32(); // window id, only needed for writable replies
    packet.getU16(); // item client id
    packet.getU16(); // maximum text length
    const text = packet.getString();
    const writer = packet.getString();
    pane.show({ title: 'Written text', text, writer });
  });
  dispatcher.on(op.HouseWindow, (packet) => {
    packet.getU8(); // door/list id
    packet.getU32(); // window id
    pane.show({ title: 'House list', text: packet.getString() });
  });

  return {
    destroy: () => {
      dispatcher.off(op.TextWindow);
      dispatcher.off(op.HouseWindow);
      pane.destroy();
    },
  };
}
