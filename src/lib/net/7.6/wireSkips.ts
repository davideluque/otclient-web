/**
 * Baseline consumers for every 7.6 server opcode the client doesn't
 * (yet) act on. The dispatcher can't know an opcode's payload length
 * without a handler, so a single unhandled opcode silently drops the
 * rest of its frame — including map/creature updates batched after it.
 * These handlers consume each payload exactly (layouts verified against
 * the jamera server source, protocol76.cpp) and discard it.
 *
 * Register BEFORE stateful consumers (GameWorld, chat, …):
 * PacketDispatcher.on is last-write-wins, so real handlers registered
 * afterwards override these one by one as features land.
 */

import type { PacketDispatcher } from '../common/PacketDispatcher';
import type { GameProtocol } from '../common/types';
import type { InputPacket } from '../common/InputPacket';

export function registerWireSkips(dispatcher: PacketDispatcher, protocol: GameProtocol): void {
  const serverOp = protocol.serverOpcodes;
  const parseItem = (p: InputPacket): void => { protocol.map.parseItem(p); };
  const readString = (p: InputPacket): void => { p.getString(); };
  const skipBytes = (n: number) => (p: InputPacket): void => { p.skip(n); };
  const consumeOpcodeOnly = (): void => { /* opcode only */ };

  // GM permission block (32 bytes) sent right after LoginInfo for GM
  // accounts. We don't render a GM UI.
  dispatcher.on(serverOp.GMActions, skipBytes(32));
  // Login queue: message string + U8 retry seconds.
  dispatcher.on(serverOp.LoginQueue, (p) => { p.getString(); p.skip(1); });
  // Death → relogin prompt. Opcode only.
  dispatcher.on(serverOp.ReloginWindow, consumeOpcodeOnly);

  // Containers — a real container UI will replace these.
  dispatcher.on(serverOp.ContainerOpen, (p) => {
    p.skip(1); // container id
    p.skip(2); // the container item id itself, without an item count byte
    p.getString(); // name
    p.skip(1 + 1); // capacity, hasParent
    const count = p.getU8();
    for (let i = 0; i < count; i++) parseItem(p);
  });
  dispatcher.on(serverOp.ContainerClose, skipBytes(1));
  dispatcher.on(serverOp.ContainerAddItem, (p) => { p.skip(1); parseItem(p); });
  dispatcher.on(serverOp.ContainerUpdateItem, (p) => { p.skip(2); parseItem(p); });
  dispatcher.on(serverOp.ContainerRemoveItem, skipBytes(2));

  // Inventory — an inventory UI will replace these.
  dispatcher.on(serverOp.InventorySet, (p) => { p.skip(1); parseItem(p); });
  dispatcher.on(serverOp.InventoryClear, skipBytes(1));

  // NPC shop window (0x7A-0x7C) — the shop binding replaces these.
  dispatcher.on(serverOp.ShopOpen, (p) => {
    p.getString(); // npc name
    const count = p.getU16();
    // U16 serverId, U16 clientSpriteId, U8 subType, name, U32 buy, U32 sell
    for (let i = 0; i < count; i++) { p.skip(5); p.getString(); p.skip(8); }
  });
  dispatcher.on(serverOp.ShopGoods, (p) => {
    p.skip(4); // money
    const count = p.getU8();
    p.skip(count * 4); // U16 serverId + U16 owned count each
  });
  dispatcher.on(serverOp.ShopClose, consumeOpcodeOnly);

  // Trade windows.
  const trade = (p: InputPacket): void => {
    p.getString(); // counterpart name
    const count = p.getU8();
    for (let i = 0; i < count; i++) parseItem(p);
  };
  dispatcher.on(serverOp.TradeRequest, trade);
  dispatcher.on(serverOp.TradeRequestAck, trade);
  dispatcher.on(serverOp.TradeClose, consumeOpcodeOnly);

  // World/ambient.
  dispatcher.on(serverOp.WorldLight, skipBytes(2)); // level, color
  dispatcher.on(serverOp.MagicEffect, skipBytes(6)); // pos(5), effect type
  dispatcher.on(serverOp.AnimatedText, (p) => { p.skip(6); p.getString(); }); // pos(5), color, text
  dispatcher.on(serverOp.DistanceShot, skipBytes(11)); // from(5), to(5), type
  dispatcher.on(serverOp.CreatureSquare, skipBytes(5)); // creature U32, color

  // Creature attributes without a consumer yet.
  dispatcher.on(serverOp.CreatureLight, skipBytes(6)); // U32, level, color
  dispatcher.on(serverOp.CreatureSkull, skipBytes(5)); // U32, skull
  dispatcher.on(serverOp.CreatureShield, skipBytes(5)); // U32, party shield

  // Item text / house windows. Both can carry an optional trailing
  // writer-name string that's indistinguishable from a following opcode
  // without item context, and both only appear as direct responses to a
  // player opening them — consume the rest of the frame.
  const restOfFrame = (p: InputPacket): void => { p.skip(p.bytesLeft); };
  dispatcher.on(serverOp.TextWindow, restOfFrame);
  dispatcher.on(serverOp.HouseWindow, restOfFrame);

  // Player state — the HUD/skill panes will replace these.
  dispatcher.on(serverOp.PlayerStats, skipBytes(20)); // hp(2) maxhp(2) cap(2) exp(4) lvl(2) lvl%(1) mana(2) maxmana(2) mlvl(1) mlvl%(1) soul(1)
  dispatcher.on(serverOp.PlayerSkills, skipBytes(14)); // 7 × (level, percent)
  dispatcher.on(serverOp.Icons, skipBytes(1));
  dispatcher.on(serverOp.VipState, (p) => { p.skip(4); p.getString(); p.skip(1); }); // guid, name, online
  dispatcher.on(serverOp.VipLogin, skipBytes(4));
  dispatcher.on(serverOp.VipLogout, skipBytes(4));
  dispatcher.on(serverOp.CancelTarget, consumeOpcodeOnly);
  dispatcher.on(serverOp.TextMessage, (p) => { p.skip(1); p.getString(); }); // class, text
  dispatcher.on(serverOp.CancelWalk, skipBytes(1)); // direction to face

  // Chat infrastructure — the chat-wiring PR will replace the ones the
  // UI needs. parseSpeak consumes the full variable layout correctly.
  dispatcher.on(serverOp.CreatureSpeak, (p) => { protocol.chat.parseSpeak(p); });
  dispatcher.on(serverOp.ChannelsDialog, (p) => {
    const count = p.getU8();
    for (let i = 0; i < count; i++) { p.skip(2); p.getString(); }
  });
  dispatcher.on(serverOp.ChannelOpen, (p) => { p.skip(2); p.getString(); });
  dispatcher.on(serverOp.PrivateChannelOpen, readString);
  dispatcher.on(serverOp.RuleViolationsChannel, skipBytes(2));
  dispatcher.on(serverOp.RuleViolationRemove, readString);
  dispatcher.on(serverOp.RuleViolationCancel, readString);
  dispatcher.on(serverOp.RuleViolationLock, consumeOpcodeOnly);
  dispatcher.on(serverOp.PrivateChannelCreate, (p) => { p.skip(2); p.getString(); });
  dispatcher.on(serverOp.ChannelClose, skipBytes(2));

  // Floor changes ship full multi-floor map descriptions plus appended
  // row updates in the same frame. Real handling (re-anchoring the
  // visible floors) is the floors PR; until then consume the frame so
  // taking stairs can't poison the connection. The visible artifact is
  // stale edge tiles until the next full map description.
  dispatcher.on(serverOp.FloorChangeUp, restOfFrame);
  dispatcher.on(serverOp.FloorChangeDown, restOfFrame);
}
