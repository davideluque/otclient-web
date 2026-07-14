import { describe, it, expect } from 'vitest';
import { parseOtb, useableClientIds, OtbAttr, OtbGroups } from '../lib/otb';

const NODE_START = 0xfe;
const NODE_END = 0xff;
const ESCAPE_CHAR = 0xfd;

function pushU16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function pushU32(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

/**
 * Build a root node data block: type byte (0x00) + flags (0) + attr header + version header.
 * Escape special bytes in the output.
 */
function buildRootData(opts?: { minorVersion?: number }): number[] {
  const raw: number[] = [];
  raw.push(0x00); // node type
  pushU32(raw, 0); // flags

  // Attribute: type=0x01 (version data), length = 148
  raw.push(0x01);
  pushU16(raw, 148);

  // Version fields
  pushU32(raw, 0);  // version
  pushU32(raw, 3);  // major
  pushU32(raw, opts?.minorVersion ?? 760); // minor (client version)
  pushU32(raw, 0);  // build

  // CSD version: 128 bytes null-padded
  const csd = 'OTB 7.60';
  for (let i = 0; i < 128; i++) {
    raw.push(i < csd.length ? csd.charCodeAt(i) : 0);
  }

  return escapeBytes(raw);
}

/** Escape bytes that collide with node markers. */
function escapeBytes(raw: number[]): number[] {
  const escaped: number[] = [];
  for (const b of raw) {
    if (b === NODE_START || b === NODE_END || b === ESCAPE_CHAR) {
      escaped.push(ESCAPE_CHAR, b);
    } else {
      escaped.push(b);
    }
  }
  return escaped;
}

/** Build an item node with given serverId, clientId, and optional flags/group. */
function buildItemNode(serverId: number, clientId: number, flags = 0, group = 0x01): number[] {
  const raw: number[] = [];
  raw.push(group); // node type (itemgroup_t)
  pushU32(raw, flags);

  // ServerID attr
  raw.push(OtbAttr.ServerID);
  pushU16(raw, 2); // length
  pushU16(raw, serverId);

  // ClientID attr
  raw.push(OtbAttr.ClientID);
  pushU16(raw, 2); // length
  pushU16(raw, clientId);

  const escaped = escapeBytes(raw);
  return [NODE_START, ...escaped, NODE_END];
}

/** Build a complete .otb file buffer. */
function buildOtb(
  items: Array<{ serverId: number; clientId: number; flags?: number; group?: number }>,
  opts?: { minorVersion?: number },
): ArrayBuffer {
  const bytes: number[] = [];

  // 4-byte file identifier
  pushU32(bytes, 0);

  // Root node start
  bytes.push(NODE_START);
  bytes.push(...buildRootData(opts));

  // Item nodes (children of root)
  for (const item of items) {
    bytes.push(...buildItemNode(item.serverId, item.clientId, item.flags, item.group));
  }

  // Root node end
  bytes.push(NODE_END);

  return new Uint8Array(bytes).buffer;
}

describe('parseOtb', () => {
  it('parses version header', () => {
    const otb = parseOtb(buildOtb([]));
    expect(otb.version.majorVersion).toBe(3);
    expect(otb.version.minorVersion).toBe(760);
    expect(otb.version.csdVersion).toBe('OTB 7.60');
  });

  it('parses item nodes with server and client IDs', () => {
    const otb = parseOtb(
      buildOtb([
        { serverId: 100, clientId: 200 },
        { serverId: 101, clientId: 201 },
      ]),
    );
    expect(otb.items).toHaveLength(2);
    expect(otb.items[0].serverId).toBe(100);
    expect(otb.items[0].clientId).toBe(200);
    expect(otb.items[1].serverId).toBe(101);
    expect(otb.items[1].clientId).toBe(201);
  });

  it('builds serverToClient map', () => {
    const otb = parseOtb(
      buildOtb([
        { serverId: 2001, clientId: 3050 },
        { serverId: 2002, clientId: 3051 },
      ]),
    );
    expect(otb.serverToClient.get(2001)).toBe(3050);
    expect(otb.serverToClient.get(2002)).toBe(3051);
    expect(otb.serverToClient.has(9999)).toBe(false);
  });

  it('builds serverIdToFlags map for capability lookups', () => {
    const blockSolid = 1 << 0;
    const floorChangeDown = 1 << 8;
    const otb = parseOtb(
      buildOtb([
        { serverId: 2001, clientId: 3050, flags: blockSolid },
        { serverId: 2002, clientId: 3051, flags: floorChangeDown },
        { serverId: 2003, clientId: 3052 }, // no flags
      ]),
    );
    expect(otb.serverIdToFlags.get(2001)).toBe(blockSolid);
    expect(otb.serverIdToFlags.get(2002)).toBe(floorChangeDown);
    expect(otb.serverIdToFlags.get(2003)).toBe(0);
    expect(otb.serverIdToFlags.has(9999)).toBe(false);
  });

  it('preserves item flags', () => {
    const flags = (1 << 0) | (1 << 5); // BlockSolid | Pickupable
    const otb = parseOtb(buildOtb([{ serverId: 100, clientId: 200, flags }]));
    expect(otb.items[0].flags).toBe(flags);
  });

  it('handles empty items list', () => {
    const otb = parseOtb(buildOtb([]));
    expect(otb.items).toHaveLength(0);
    expect(otb.serverToClient.size).toBe(0);
  });

  it('handles escape sequences in data correctly', () => {
    // Use a serverId that contains 0xFD when encoded as U16 LE
    // 0xFD = 253, so serverId=253 → bytes [0xFD, 0x00] which needs escaping
    const otb = parseOtb(buildOtb([{ serverId: 253, clientId: 100 }]));
    expect(otb.items[0].serverId).toBe(253);
    expect(otb.items[0].clientId).toBe(100);
  });

  it('handles serverId containing 0xFE byte', () => {
    // 0xFE = 254
    const otb = parseOtb(buildOtb([{ serverId: 254, clientId: 100 }]));
    expect(otb.items[0].serverId).toBe(254);
  });
});

describe('useableClientIds', () => {
  const useable = 1 << 4;

  it('collects Useable-flagged items by client id', () => {
    const ids = useableClientIds(parseOtb(buildOtb([
      { serverId: 2001, clientId: 3050, flags: useable },
      { serverId: 2002, clientId: 3051 },
    ])));
    expect(ids).toEqual(new Set([3050]));
  });

  it('includes blocking door-group items even without the Useable flag', () => {
    // The 7.6 OTB never flags doors Useable (the server opens them via
    // actions.xml) — the node-type group + BlockSolid marks a closed or
    // locked door. Open (walkable) doors stay walk targets: using one
    // closes it onto whoever tapped the doorway.
    const blockSolid = 1 << 0;
    const ids = useableClientIds(parseOtb(buildOtb([
      { serverId: 1210, clientId: 1629, group: OtbGroups.Door, flags: blockSolid },
      { serverId: 1211, clientId: 1630, group: OtbGroups.Door }, // open door
      { serverId: 2002, clientId: 3051 },
    ])));
    expect(ids).toEqual(new Set([1629]));
  });

  it('parses the node-type group byte', () => {
    const otb = parseOtb(buildOtb([{ serverId: 1211, clientId: 1630, group: OtbGroups.Door }]));
    expect(otb.items[0].group).toBe(OtbGroups.Door);
  });
});
