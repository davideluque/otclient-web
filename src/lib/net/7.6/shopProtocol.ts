import type { InputPacket } from '../common/InputPacket';
import { OutputPacket } from '../common/OutputPacket';
import type { ShopGoodsEvent, ShopItem, ShopOpenEvent } from '../common/types';
import { ClientOp } from './opcodes';

/**
 * 7.6 NPC shop window packets (jamera extension, opcodes 0x7A-0x7C).
 * Layouts verified against the server contract (docs/protocol/npc-shop.md,
 * Protocol76::sendShopWindow / sendShopGoods / parseShop* in protocol76.cpp):
 *   ShopOpen  0x7A: npcName + U16 count + count × (U16 serverId,
 *             U16 clientSpriteId, U8 subType, name, U32 buyPrice, U32 sellPrice)
 *   ShopGoods 0x7B: U32 money + U8 count + count × (U16 serverId, U16 owned)
 *   ShopClose 0x7C: opcode only
 * Requests echo the catalog's serverId + subType; prices never go on the
 * wire (the server prices transactions exclusively from its own catalog).
 */

export function parseShopOpen(packet: InputPacket): ShopOpenEvent {
  const npcName = packet.getString();
  const itemCount = packet.getU16();
  const items: ShopItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    items.push({
      serverId: packet.getU16(),
      clientId: packet.getU16(),
      subType: packet.getU8(),
      name: packet.getString(),
      buyPrice: packet.getU32(),
      sellPrice: packet.getU32(),
    });
  }
  return { npcName, items };
}

export function parseShopGoods(packet: InputPacket): ShopGoodsEvent {
  const money = packet.getU32();
  const itemCount = packet.getU8();
  const items: ShopGoodsEvent['items'] = [];
  for (let i = 0; i < itemCount; i++) {
    items.push({ serverId: packet.getU16(), count: packet.getU16() });
  }
  return { money, items };
}

export function buildShopBuyPacket(serverId: number, subType: number, amount: number): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.ShopBuy);
  out.addU16(serverId);
  out.addU8(subType);
  out.addU8(amount);
  return out;
}

export function buildShopSellPacket(serverId: number, subType: number, amount: number): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.ShopSell);
  out.addU16(serverId);
  out.addU8(subType);
  out.addU8(amount);
  return out;
}

export function buildShopClosePacket(): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.ShopClose);
  return out;
}
