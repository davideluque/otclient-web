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
  const op = protocol.serverOpcodes;
  const item = (p: InputPacket): void => { protocol.map.parseItem(p); };
  const str = (p: InputPacket): void => { p.getString(); };
  const skip = (n: number) => (p: InputPacket): void => { p.skip(n); };
  const nothing = (): void => { /* opcode only */ };

  // GM permission block (32 bytes) sent right after LoginInfo for GM
  // accounts. We don't render a GM UI.
  dispatcher.on(op.GMActions, skip(32));
  // Login queue: message string + U8 retry seconds.
  dispatcher.on(op.LoginQueue, (p) => { p.getString(); p.skip(1); });
  // Death → relogin prompt. Opcode only.
  dispatcher.on(op.ReloginWindow, nothing);

  // Containers — a real container UI will replace these.
  dispatcher.on(op.ContainerOpen, (p) => {
    p.skip(1); // container id
    item(p);   // the container item itself
    p.getString(); // name
    p.skip(1 + 1); // capacity, hasParent
    const count = p.getU8();
    for (let i = 0; i < count; i++) item(p);
  });
  dispatcher.on(op.ContainerClose, skip(1));
  dispatcher.on(op.ContainerAddItem, (p) => { p.skip(1); item(p); });
  dispatcher.on(op.ContainerUpdateItem, (p) => { p.skip(2); item(p); });
  dispatcher.on(op.ContainerRemoveItem, skip(2));

  // Inventory — an inventory UI will replace these.
  dispatcher.on(op.InventorySet, (p) => { p.skip(1); item(p); });
  dispatcher.on(op.InventoryClear, skip(1));

  // Trade windows.
  const trade = (p: InputPacket): void => {
    p.getString(); // counterpart name
    const count = p.getU8();
    for (let i = 0; i < count; i++) item(p);
  };
  dispatcher.on(op.TradeRequest, trade);
  dispatcher.on(op.TradeRequestAck, trade);
  dispatcher.on(op.TradeClose, nothing);

  // World/ambient.
  dispatcher.on(op.WorldLight, skip(2)); // level, color
  dispatcher.on(op.MagicEffect, skip(6)); // pos(5), effect type
  dispatcher.on(op.AnimatedText, (p) => { p.skip(6); p.getString(); }); // pos(5), color, text
  dispatcher.on(op.DistanceShot, skip(11)); // from(5), to(5), type
  dispatcher.on(op.CreatureSquare, skip(5)); // creature U32, color

  // Creature attributes without a consumer yet.
  dispatcher.on(op.CreatureLight, skip(6)); // U32, level, color
  dispatcher.on(op.CreatureSkull, skip(5)); // U32, skull
  dispatcher.on(op.CreatureShield, skip(5)); // U32, party shield

  // Item text / house windows. Both can carry an optional trailing
  // writer-name string that's indistinguishable from a following opcode
  // without item context, and both only appear as direct responses to a
  // player opening them — consume the rest of the frame.
  const restOfFrame = (p: InputPacket): void => { p.skip(p.bytesLeft); };
  dispatcher.on(op.TextWindow, restOfFrame);
  dispatcher.on(op.HouseWindow, restOfFrame);

  // Player state — the HUD/skill panes will replace these.
  dispatcher.on(op.PlayerStats, skip(20)); // hp(2) maxhp(2) cap(2) exp(4) lvl(2) lvl%(1) mana(2) maxmana(2) mlvl(1) mlvl%(1) soul(1)
  dispatcher.on(op.PlayerSkills, skip(14)); // 7 × (level, percent)
  dispatcher.on(op.Icons, skip(1));
  dispatcher.on(op.CancelTarget, nothing);
  dispatcher.on(op.TextMessage, (p) => { p.skip(1); p.getString(); }); // class, text
  dispatcher.on(op.CancelWalk, skip(1)); // direction to face

  // Chat infrastructure — the chat-wiring PR will replace the ones the
  // UI needs. parseSpeak consumes the full variable layout correctly.
  dispatcher.on(op.CreatureSpeak, (p) => { protocol.chat.parseSpeak(p); });
  dispatcher.on(op.ChannelsDialog, (p) => {
    const count = p.getU8();
    for (let i = 0; i < count; i++) { p.skip(2); p.getString(); }
  });
  dispatcher.on(op.ChannelOpen, (p) => { p.skip(2); p.getString(); });
  dispatcher.on(op.PrivateChannelOpen, str);
  dispatcher.on(op.RuleViolationsChannel, skip(2));
  dispatcher.on(op.RuleViolationRemove, str);
  dispatcher.on(op.RuleViolationCancel, str);
  dispatcher.on(op.RuleViolationLock, nothing);
  dispatcher.on(op.PrivateChannelCreate, (p) => { p.skip(2); p.getString(); });
  dispatcher.on(op.ChannelClose, skip(2));

  // Floor changes ship full multi-floor map descriptions plus appended
  // row updates in the same frame. Real handling (re-anchoring the
  // visible floors) is the floors PR; until then consume the frame so
  // taking stairs can't poison the connection. The visible artifact is
  // stale edge tiles until the next full map description.
  dispatcher.on(op.FloorChangeUp, restOfFrame);
  dispatcher.on(op.FloorChangeDown, restOfFrame);
}
