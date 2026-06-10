// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVipList } from '../lib/vipList';
import { bindVip } from '../lib/jamera/vipBinding';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import type { GameClient } from '../lib/net/common/GameClient';

afterEach(() => document.body.replaceChildren());

describe('createVipList', () => {
  it('sorts online-first, reports add and remove intents', () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const vip = createVipList({ onAdd, onRemove });
    vip.setEntries([
      { guid: 1, name: 'Zeta', online: false },
      { guid: 2, name: 'Alpha', online: true },
    ]);
    const names = [...document.querySelectorAll('.vip-list .name')].map((n) => n.textContent);
    expect(names).toEqual(['Alpha', 'Zeta']); // online first

    const input = document.querySelector('.add-row input') as HTMLInputElement;
    input.value = 'New Friend';
    (document.querySelector('.add-row button') as HTMLButtonElement).click();
    expect(onAdd).toHaveBeenCalledWith('New Friend');

    (document.querySelector('.vip-list .remove') as HTMLButtonElement).click();
    expect(onRemove).toHaveBeenCalledWith(2); // Alpha's guid
    vip.destroy();
  });
});

describe('bindVip', () => {
  function makeClient() {
    const protocol = new GameProtocol();
    const dispatcher = new PacketDispatcher();
    const sent: number[][] = [];
    const client = {
      getProtocol: () => protocol,
      getDispatcher: () => dispatcher,
      send: (p: { toUint8Array(): Uint8Array }) => sent.push([...p.toUint8Array()]),
    } as unknown as GameClient;
    return { client, dispatcher, sent };
  }

  it('renders 0xD2 entries, flips on 0xD3/0xD4, sends 0xDC/0xDD', () => {
    const { client, dispatcher, sent } = makeClient();
    const binding = bindVip(client);

    const state = new OutputPacket();
    state.addU8(0xd2);
    state.addU32(42);
    state.addString('GOD Bruno');
    state.addU8(0); // offline
    dispatcher.dispatch(new InputPacket(state.toArrayBuffer()));
    expect(document.querySelector('.vip-list .row')?.classList.contains('online')).toBe(false);

    const login = new OutputPacket();
    login.addU8(0xd3);
    login.addU32(42);
    dispatcher.dispatch(new InputPacket(login.toArrayBuffer()));
    expect(document.querySelector('.vip-list .row')?.classList.contains('online')).toBe(true);

    const input = document.querySelector('.add-row input') as HTMLInputElement;
    input.value = 'Gurz';
    (document.querySelector('.add-row button') as HTMLButtonElement).click();
    expect(sent[0][0]).toBe(0xdc);

    (document.querySelector('.vip-list .remove') as HTMLButtonElement).click();
    expect(sent[1]).toEqual([0xdd, 42, 0, 0, 0]);
    expect(document.querySelector('.vip-list .row .name')).toBeNull(); // removed locally

    binding.destroy();
    expect(document.querySelector('.vip-list')).toBeNull();
  });
});
