import { describe, expect, it } from 'vitest';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import {
  parseShopOpen,
  parseShopGoods,
  buildShopBuyPacket,
  buildShopSellPacket,
  buildShopClosePacket,
} from '../lib/net/7.6/shopProtocol';
import { ClientOp, ServerOp } from '../lib/net/7.6/opcodes';

// Wire contract: jameraServer76 docs/protocol/npc-shop.md (opcodes 0x7A-0x7C).

function shopOpenFrame(): OutputPacket {
  const out = new OutputPacket();
  out.addString('Bashira');
  out.addU16(2);
  // rope: plain item, buyable and sellable
  out.addU16(2120); // serverItemId
  out.addU16(3003); // clientSpriteId
  out.addU8(0); // subType
  out.addString('rope');
  out.addU32(50); // buyPrice
  out.addU32(8); // sellPrice
  // vial of oil: fluid container, subtype 11, buy only
  out.addU16(2006);
  out.addU16(2874);
  out.addU8(11);
  out.addString('vial of oil');
  out.addU32(100);
  out.addU32(0);
  return out;
}

describe('shopProtocol', () => {
  it('uses the 0x7A-0x7C block, distinct from player trade 0x7D-0x7F', () => {
    expect(ServerOp.ShopOpen).toBe(0x7a);
    expect(ServerOp.ShopGoods).toBe(0x7b);
    expect(ServerOp.ShopClose).toBe(0x7c);
    expect(ClientOp.ShopBuy).toBe(0x7a);
    expect(ClientOp.ShopSell).toBe(0x7b);
    expect(ClientOp.ShopClose).toBe(0x7c);
    // Player-to-player trade must remain untouched.
    expect(ServerOp.TradeRequest).toBe(0x7d);
    expect(ServerOp.TradeRequestAck).toBe(0x7e);
    expect(ServerOp.TradeClose).toBe(0x7f);
  });

  it('parses ShopOpen with both item ids, subtype and per-unit prices', () => {
    const event = parseShopOpen(new InputPacket(shopOpenFrame().toArrayBuffer()));
    expect(event.npcName).toBe('Bashira');
    expect(event.items).toEqual([
      { serverId: 2120, clientId: 3003, subType: 0, name: 'rope', buyPrice: 50, sellPrice: 8 },
      { serverId: 2006, clientId: 2874, subType: 11, name: 'vial of oil', buyPrice: 100, sellPrice: 0 },
    ]);
  });

  it('parses an empty ShopGoods', () => {
    const out = new OutputPacket();
    out.addU32(0);
    out.addU8(0);
    const event = parseShopGoods(new InputPacket(out.toArrayBuffer()));
    expect(event.money).toBe(0);
    expect(event.items).toEqual([]);
  });

  it('parses ShopGoods money and owned counts', () => {
    const out = new OutputPacket();
    out.addU32(123456);
    out.addU8(2);
    out.addU16(2120);
    out.addU16(3);
    out.addU16(2554);
    out.addU16(65535);
    const event = parseShopGoods(new InputPacket(out.toArrayBuffer()));
    expect(event.money).toBe(123456);
    expect(event.items).toEqual([
      { serverId: 2120, count: 3 },
      { serverId: 2554, count: 65535 },
    ]);
  });

  it('builds a buy request: opcode, server id, subtype, amount', () => {
    const p = new InputPacket(buildShopBuyPacket(2006, 11, 5).toArrayBuffer());
    expect(p.getU8()).toBe(0x7a);
    expect(p.getU16()).toBe(2006);
    expect(p.getU8()).toBe(11);
    expect(p.getU8()).toBe(5);
    expect(p.bytesLeft).toBe(0);
  });

  it('builds a sell request: opcode, server id, subtype, amount', () => {
    const p = new InputPacket(buildShopSellPacket(2120, 0, 100).toArrayBuffer());
    expect(p.getU8()).toBe(0x7b);
    expect(p.getU16()).toBe(2120);
    expect(p.getU8()).toBe(0);
    expect(p.getU8()).toBe(100);
    expect(p.bytesLeft).toBe(0);
  });

  it('builds a close request with no payload', () => {
    const p = new InputPacket(buildShopClosePacket().toArrayBuffer());
    expect(p.getU8()).toBe(0x7c);
    expect(p.bytesLeft).toBe(0);
  });

  it('never puts prices in outgoing packets', () => {
    // Buy/sell requests are 5 bytes total: u8 opcode + u16 id + u8 subtype + u8 amount.
    expect(buildShopBuyPacket(2120, 0, 1).length).toBe(5);
    expect(buildShopSellPacket(2120, 0, 1).length).toBe(5);
  });
});
