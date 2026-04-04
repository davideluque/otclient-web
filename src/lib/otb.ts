import { BinaryReader } from './BinaryReader';
import { NODE_START, NODE_END, readNodeData, skipNode } from './nodeTree';

// --- Item attribute types ---

export const OtbAttr = {
  ServerID: 0x10,
  ClientID: 0x11,
  Name: 0x12,
  Speed: 0x14,
  SpriteHash: 0x1f,
  MinimapColor: 0x20,
  Light: 0x22,
  Light2: 0x24,
  TopOrder: 0x25,
} as const;

// --- Item flags (bitmask) ---

export const OtbFlags = {
  BlockSolid: 1 << 0,
  BlockProjectile: 1 << 1,
  BlockPathfind: 1 << 2,
  HasHeight: 1 << 3,
  Useable: 1 << 4,
  Pickupable: 1 << 5,
  Moveable: 1 << 6,
  Stackable: 1 << 7,
  FloorChangeDown: 1 << 8,
  FloorChangeNorth: 1 << 9,
  FloorChangeEast: 1 << 10,
  FloorChangeSouth: 1 << 11,
  FloorChangeWest: 1 << 12,
  AlwaysOnTop: 1 << 13,
  Readable: 1 << 14,
  Rotatable: 1 << 15,
  Hangable: 1 << 16,
  HookSouth: 1 << 17,
  HookEast: 1 << 18,
  AnimateAlways: 1 << 19,
  LookThrough: 1 << 20,
} as const;

// --- Data types ---

export interface OtbVersion {
  version: number;
  majorVersion: number;
  minorVersion: number;
  buildNumber: number;
  csdVersion: string;
}

export interface OtbItem {
  flags: number;
  serverId: number;
  clientId: number;
  speed?: number;
  topOrder?: number;
  lightLevel?: number;
  lightColor?: number;
  minimapColor?: number;
  name?: string;
}

export interface OtbFile {
  version: OtbVersion;
  items: OtbItem[];
  /** Map from server item ID → client item ID (for fast lookups). */
  serverToClient: Map<number, number>;
}

// --- Parsers ---

function parseVersion(bytes: Uint8Array): OtbVersion {
  const reader = new BinaryReader(bytes.buffer as ArrayBuffer);
  // Root node starts with a type byte (0x00), skip it
  reader.skip(1);

  // Skip 4 bytes (flags = 0 for root)
  reader.skip(4);

  // Skip attribute header (type byte + length u16)
  reader.skip(1 + 2);

  const version = reader.getU32();
  const majorVersion = reader.getU32();
  const minorVersion = reader.getU32();
  const buildNumber = reader.getU32();

  // CSD version: 128-byte null-terminated string
  const csdBytes = bytes.subarray(reader.position, reader.position + 128);
  const nullIdx = csdBytes.indexOf(0);
  const csdVersion = new TextDecoder().decode(csdBytes.subarray(0, nullIdx >= 0 ? nullIdx : 128));

  return { version, majorVersion, minorVersion, buildNumber, csdVersion };
}

function parseItem(bytes: Uint8Array): OtbItem {
  const reader = new BinaryReader(bytes.buffer as ArrayBuffer);

  // First byte is node type (item group type), skip it
  reader.skip(1);

  const flags = reader.getU32();

  const item: OtbItem = { flags, serverId: 0, clientId: 0 };

  while (reader.position < bytes.length) {
    const attrType = reader.getU8();
    const attrLen = reader.getU16();
    const attrStart = reader.position;

    switch (attrType) {
      case OtbAttr.ServerID:
        item.serverId = reader.getU16();
        break;
      case OtbAttr.ClientID:
        item.clientId = reader.getU16();
        break;
      case OtbAttr.Speed:
        item.speed = reader.getU16();
        break;
      case OtbAttr.TopOrder:
        item.topOrder = reader.getU8();
        break;
      case OtbAttr.Light:
      case OtbAttr.Light2:
        item.lightLevel = reader.getU16();
        item.lightColor = reader.getU16();
        break;
      case OtbAttr.MinimapColor:
        item.minimapColor = reader.getU16();
        break;
      case OtbAttr.Name: {
        const nameBytes = bytes.subarray(attrStart, attrStart + attrLen);
        item.name = new TextDecoder().decode(nameBytes);
        reader.skip(attrLen);
        break;
      }
      default:
        // Skip unknown attributes
        reader.skip(attrLen);
        break;
    }

    // Ensure we've advanced past this attribute's data
    const consumed = reader.position - attrStart;
    if (consumed < attrLen) {
      reader.skip(attrLen - consumed);
    }
  }

  return item;
}

export function parseOtb(buffer: ArrayBuffer): OtbFile {
  const data = new Uint8Array(buffer);
  let offset = 0;

  // File starts with 4 zero bytes (identifier), then NODE_START
  if (data.length < 5) {
    throw new Error('Invalid OTB file: buffer too small');
  }
  offset += 4;

  // Expect NODE_START for root
  if (data[offset] !== NODE_START) {
    throw new Error(`Expected NODE_START at offset ${offset}, got 0x${data[offset].toString(16)}`);
  }
  offset++;

  // Read root node data
  const root = readNodeData(data, offset);
  const version = parseVersion(root.bytes);
  offset = root.nextOffset;

  // Parse child item nodes
  const items: OtbItem[] = [];
  const serverToClient = new Map<number, number>();

  while (offset < data.length) {
    const marker = data[offset];

    if (marker === NODE_END) {
      break; // End of root node
    }

    if (marker === NODE_START) {
      offset++; // skip NODE_START
      const node = readNodeData(data, offset);
      offset = node.nextOffset;

      // Skip any children of this item node
      while (offset < data.length && data[offset] === NODE_START) {
        offset++;
        offset = skipNode(data, offset);
      }

      // Expect NODE_END for this item node
      if (offset < data.length && data[offset] === NODE_END) {
        offset++;
      }

      const item = parseItem(node.bytes);
      items.push(item);

      if (item.serverId > 0 && item.clientId > 0) {
        serverToClient.set(item.serverId, item.clientId);
      }
    } else {
      offset++;
    }
  }

  return { version, items, serverToClient };
}
