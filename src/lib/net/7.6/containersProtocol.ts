import type { InputPacket } from '../common/InputPacket';
import { OutputPacket } from '../common/OutputPacket';
import type { ContainerOpenEvent, MapTileItem } from '../common/types';
import { ClientOp } from './opcodes';
import { parseItem } from './mapParser';

/**
 * 7.6 container packets, layouts verified against the server's
 * sendContainer / parse{Close,UpArrow}Container (protocol76.cpp):
 *   Open   0x6E: cid + U16 containerClientId (no count byte) + name +
 *                capacity + hasParent + U8 itemCount + items
 *   Close  0x6F: cid          Add    0x70: cid + item (slot 0, no slot byte)
 *   Update 0x71: cid + slot + item   Remove 0x72: cid + slot
 * Items use the shared conditional-count serialization (parseItem).
 */

export function parseContainerOpen(packet: InputPacket): ContainerOpenEvent {
  const containerId = packet.getU8();
  // The container item id arrives via AddItemId — clientId only, never a
  // count byte, even when the container type is itself stackable-flagged.
  const containerItemId = packet.getU16();
  const name = packet.getString();
  const capacity = packet.getU8();
  const hasParent = packet.getU8() !== 0;
  const itemCount = packet.getU8();
  const items: MapTileItem[] = [];
  for (let i = 0; i < itemCount; i++) items.push(parseItem(packet));
  return { containerId, containerItemId, name, capacity, hasParent, items };
}

export function parseContainerClose(packet: InputPacket): number {
  return packet.getU8();
}

export function parseContainerAddItem(packet: InputPacket): { containerId: number; item: MapTileItem } {
  return { containerId: packet.getU8(), item: parseItem(packet) };
}

export function parseContainerUpdateItem(
  packet: InputPacket,
): { containerId: number; slot: number; item: MapTileItem } {
  return { containerId: packet.getU8(), slot: packet.getU8(), item: parseItem(packet) };
}

export function parseContainerRemoveItem(packet: InputPacket): { containerId: number; slot: number } {
  return { containerId: packet.getU8(), slot: packet.getU8() };
}

export function buildCloseContainerPacket(containerId: number): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.CloseContainer);
  out.addU8(containerId);
  return out;
}

export function buildUpContainerPacket(containerId: number): OutputPacket {
  const out = new OutputPacket();
  out.addU8(ClientOp.UpArrowContainer);
  out.addU8(containerId);
  return out;
}
