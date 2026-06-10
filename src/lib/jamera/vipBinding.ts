import { createVipList, type VipListHandle } from '../vipList';
import type { GameClient } from '../net/common/GameClient';

/**
 * Live VIP list: 0xD2 state entries (sent per VIP at login), 0xD3/0xD4
 * online/offline flips. Adds go out as 0xDC (by name), removals as
 * 0xDD (by guid). Registered after wireSkips, overriding its discard
 * consumers.
 */
export interface VipBindingHandle {
  readonly list: VipListHandle;
  destroy(): void;
}

export function bindVip(client: GameClient, parent: HTMLElement = document.body): VipBindingHandle {
  const protocol = client.getProtocol();
  const entries = new Map<number, { name: string; online: boolean }>();

  const send = (packet: Parameters<GameClient['send']>[0]): void => {
    try {
      client.send(packet);
    } catch (e) {
      console.warn('[jamera] vip send failed:', e instanceof Error ? e.message : e);
    }
  };

  const list = createVipList({
    onAdd: (name) => send(protocol.actions.buildAddVip(name)),
    onRemove: (guid) => {
      send(protocol.actions.buildRemoveVip(guid));
      // The server confirms removals silently — drop it locally too.
      entries.delete(guid);
      render();
    },
  }, parent);

  const render = (): void => {
    list.setEntries([...entries.entries()].map(([guid, e]) => ({ guid, ...e })));
  };

  const dispatcher = client.getDispatcher();
  const op = protocol.serverOpcodes;
  dispatcher.on(op.VipState, (p) => {
    const guid = p.getU32();
    const name = p.getString();
    const online = p.getU8() === 1;
    entries.set(guid, { name, online });
    render();
  });
  dispatcher.on(op.VipLogin, (p) => {
    const guid = p.getU32();
    const entry = entries.get(guid);
    if (entry) entry.online = true;
    render();
  });
  dispatcher.on(op.VipLogout, (p) => {
    const guid = p.getU32();
    const entry = entries.get(guid);
    if (entry) entry.online = false;
    render();
  });

  return {
    list,
    destroy: () => {
      dispatcher.off(op.VipState);
      dispatcher.off(op.VipLogin);
      dispatcher.off(op.VipLogout);
      list.destroy();
    },
  };
}
