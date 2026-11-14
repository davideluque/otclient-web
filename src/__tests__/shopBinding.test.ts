// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bindShop } from '../lib/jamera/shopBinding';
import { ShopManager } from '../lib/shop';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { registerWireSkips } from '../lib/net/7.6/wireSkips';
import type { GameClient } from '../lib/net/common/GameClient';

function makeClient() {
  const protocol = new GameProtocol();
  const dispatcher = new PacketDispatcher();
  const send = vi.fn();
  const client = {
    getProtocol: () => protocol,
    getDispatcher: () => dispatcher,
    send,
  } as unknown as GameClient;
  return { client, dispatcher, protocol, send };
}

function shopOpenFrame(): OutputPacket {
  const out = new OutputPacket();
  out.addU8(0x7a);
  out.addString('Bashira');
  out.addU16(2);
  out.addU16(2120); out.addU16(3003); out.addU8(0);
  out.addString('rope'); out.addU32(50); out.addU32(8);
  out.addU16(2006); out.addU16(2874); out.addU8(11);
  out.addString('vial of oil'); out.addU32(100); out.addU32(0);
  return out;
}

function shopGoodsFrame(money: number, items: Array<[number, number]>): OutputPacket {
  const out = new OutputPacket();
  out.addU8(0x7b);
  out.addU32(money);
  out.addU8(items.length);
  for (const [serverId, count] of items) {
    out.addU16(serverId);
    out.addU16(count);
  }
  return out;
}

function packetBytes(packet: unknown): number[] {
  return [...new Uint8Array((packet as OutputPacket).toArrayBuffer())];
}

describe('bindShop', () => {
  it('overrides the wireSkips and mirrors open/goods/close', () => {
    const { client, dispatcher } = makeClient();
    registerWireSkips(dispatcher, client.getProtocol());
    const binding = bindShop(client);

    dispatcher.dispatch(new InputPacket(shopOpenFrame().toArrayBuffer()));
    expect(binding.manager.current?.npcName).toBe('Bashira');
    expect(binding.manager.current?.items).toHaveLength(2);

    dispatcher.dispatch(new InputPacket(shopGoodsFrame(750, [[2120, 4]]).toArrayBuffer()));
    expect(binding.manager.current?.money).toBe(750);
    expect(binding.manager.current?.goods.get(2120)).toBe(4);

    const close = new OutputPacket();
    close.addU8(0x7c);
    dispatcher.dispatch(new InputPacket(close.toArrayBuffer()));
    expect(binding.manager.current).toBeNull();
    binding.destroy();
  });

  it('destroy() unregisters the handlers and clears state', () => {
    const { client, dispatcher } = makeClient();
    registerWireSkips(dispatcher, client.getProtocol());
    const binding = bindShop(client);

    dispatcher.dispatch(new InputPacket(shopOpenFrame().toArrayBuffer()));
    expect(binding.manager.current).not.toBeNull();
    binding.destroy();
    expect(binding.manager.current).toBeNull();
  });

  it('renders the window, sends a buy request from the amount sheet, and closes', () => {
    const { client, dispatcher, send } = makeClient();
    registerWireSkips(dispatcher, client.getProtocol());
    const binding = bindShop(client, document.body);

    dispatcher.dispatch(new InputPacket(shopOpenFrame().toArrayBuffer()));
    dispatcher.dispatch(new InputPacket(shopGoodsFrame(1000, [[2120, 4]]).toArrayBuffer()));

    const pane = document.querySelector('.shop-pane') as HTMLElement;
    expect(pane).not.toBeNull();
    expect(pane.style.display).not.toBe('none');
    expect(pane.textContent).toContain('Bashira');
    expect(pane.textContent).toContain('1000 gp');

    // Buy tab lists both buyable entries; tap the fluid to check subtype echo.
    const rows = [...pane.querySelectorAll('.row')] as HTMLElement[];
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('rope'),
      expect.stringContaining('vial of oil'),
    ]);
    rows[1].click();

    const sheetActions = [...document.querySelectorAll('.action-sheet button')] as HTMLElement[];
    const buyFive = sheetActions.find((b) => b.textContent?.includes('Buy 5'));
    expect(buyFive?.textContent).toContain('500 gp'); // 5 × 100, display only
    buyFive!.click();
    // C->S 0x7A: u16 serverId 2006, u8 subType 11, u8 amount 5 — no price bytes.
    expect(packetBytes(send.mock.calls.at(-1)![0])).toEqual([0x7a, 0xd6, 0x07, 11, 5]);

    // ✕ sends the close request and drops the window locally.
    (pane.querySelector('.head button:last-child') as HTMLElement).click();
    expect(packetBytes(send.mock.calls.at(-1)![0])).toEqual([0x7c]);
    expect(binding.manager.current).toBeNull();
    expect(pane.style.display).toBe('none');
    binding.destroy();
  });

  it('caps sell amounts by owned count and echoes the catalog identity', () => {
    const { client, dispatcher, send } = makeClient();
    registerWireSkips(dispatcher, client.getProtocol());
    const binding = bindShop(client, document.body);

    dispatcher.dispatch(new InputPacket(shopOpenFrame().toArrayBuffer()));
    dispatcher.dispatch(new InputPacket(shopGoodsFrame(1000, [[2120, 7]]).toArrayBuffer()));

    const pane = document.querySelector('.shop-pane') as HTMLElement;
    const sellTab = [...pane.querySelectorAll('.tabs button')].find((b) => b.textContent === 'Sell') as HTMLElement;
    sellTab.click();

    const rows = [...pane.querySelectorAll('.row')] as HTMLElement[];
    expect(rows).toHaveLength(1); // only rope is sellable
    expect(rows[0].textContent).toContain('×7');
    rows[0].click();

    const labels = [...document.querySelectorAll('.action-sheet button')]
      .map((b) => b.textContent ?? '')
      .filter((t) => t.startsWith('Sell'));
    // Steps 1 and 5 fit within the 7 owned; 10+ do not.
    expect(labels).toEqual(['Sell 1 — 8 gp', 'Sell 5 — 40 gp']);

    (
      [...document.querySelectorAll('.action-sheet button')]
        .find((b) => b.textContent === 'Sell 5 — 40 gp') as HTMLElement
    ).click();
    expect(packetBytes(send.mock.calls.at(-1)![0])).toEqual([0x7b, 0x48, 0x08, 0, 5]);
    binding.destroy();
  });
});

describe('ShopManager', () => {
  it('ignores goods without an open window and keeps money across re-open', () => {
    const manager = new ShopManager();
    manager.setGoods({ money: 99, items: [] });
    expect(manager.current).toBeNull();

    manager.open({ npcName: 'A', items: [] });
    manager.setGoods({ money: 42, items: [{ serverId: 1, count: 2 }] });
    manager.open({ npcName: 'B', items: [] }); // superseding window keeps last money
    expect(manager.current?.npcName).toBe('B');
    expect(manager.current?.money).toBe(42);
  });
});
