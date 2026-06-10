import { createStatusBar, type StatusBarHandle } from '../statusBar';
import type { GameClient } from '../net/common/GameClient';

/**
 * Live condition icons: 0xA2 carries a single U8 bitmask (poison 1,
 * burn 2, energy 4, drunk 8, mana shield 16, paralyze 32, haste 64,
 * in-fight 128 — verified against const76.h / sendIcons).
 */
export interface StatusBindingHandle {
  readonly bar: StatusBarHandle;
  destroy(): void;
}

export function bindStatus(client: GameClient, parent: HTMLElement = document.body): StatusBindingHandle {
  const bar = createStatusBar(parent);
  bar.setIcons(0);

  const dispatcher = client.getDispatcher();
  const op = client.getProtocol().serverOpcodes;
  dispatcher.on(op.Icons, (p) => {
    bar.setIcons(p.getU8());
  });

  return {
    bar,
    destroy: () => {
      dispatcher.off(op.Icons);
      bar.destroy();
    },
  };
}
