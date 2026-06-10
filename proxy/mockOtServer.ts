/**
 * Minimal mock of the jamera 7.6 server, for end-to-end testing the full
 * client stack (WS proxy → framing → login flow → wire parsing →
 * renderer) without the dockerized server. Speaks just enough verified
 * 7.6 wire format (layouts mirror protocol76.cpp) to:
 *
 *  - answer a login request with MOTD + a one-character list
 *  - answer a game login with SelfAppear + an 18×14 grass map +
 *    player stats + a welcome text message
 *  - answer move packets (0x65–0x68) with the matching map row/column
 *    so server-confirmed walking works
 *  - echo say packets (0x96) back as creature speech (0xAA)
 *
 * Run: npx tsx proxy/mockOtServer.ts   (login :7171, game :7172 — the
 * same ports proxy/server.ts forwards to by default)
 */

import * as net from 'node:net';

const LOGIN_PORT = parseInt(process.env['OT_LOGIN_PORT'] ?? '7171', 10);
const GAME_PORT = parseInt(process.env['OT_GAME_PORT'] ?? '7172', 10);

/** Ground item the map is paved with. 102 = 7.6 grass (plain, non-stackable). */
const GROUND_ID = parseInt(process.env['MOCK_GROUND_ID'] ?? '102', 10);

const PLAYER_ID = 0x10000001;
const SPAWN = { x: 100, y: 100, z: 7 };

class FrameWriter {
  private bytes: number[] = [];

  u8(v: number): this { this.bytes.push(v & 0xff); return this; }
  u16(v: number): this { this.bytes.push(v & 0xff, (v >> 8) & 0xff); return this; }
  u32(v: number): this {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  str(s: string): this {
    this.u16(s.length);
    for (const ch of s) this.bytes.push(ch.charCodeAt(0) & 0xff);
    return this;
  }
  pos(x: number, y: number, z: number): this { return this.u16(x).u16(y).u8(z); }

  /** Length-prefixed frame, ready for the TCP socket. */
  frame(): Buffer {
    const len = this.bytes.length;
    return Buffer.from([len & 0xff, (len >> 8) & 0xff, ...this.bytes]);
  }
}

/**
 * Emit a rectangular map description: grass on floor 7 inside the area,
 * every other visible floor empty — using the same shared-skip-marker
 * encoding as GetMapDescription (markers cover 1 + count cells).
 */
function writeMapArea(w: FrameWriter, width: number, height: number, playerZ: number): void {
  const floors = playerZ <= 7 ? [7, 6, 5, 4, 3, 2, 1, 0] : [playerZ - 2, playerZ - 1, playerZ, playerZ + 1, playerZ + 2];
  for (const z of floors) {
    if (z === playerZ) {
      // Grass tiles: ground item, then a zero-skip slot terminator each.
      // The player creature goes on the tile matching the SelfAppear
      // position — only in the INITIAL full-map description. Cells run
      // column-major (x outer, y inner, like GetMapDescription), so the
      // window starting at (x-8, y-6) puts the player at column 8 row 6
      // = cell 8*height + 6. Movement row/column slices must not repeat
      // the creature or every step would duplicate the player.
      const isFullMap = width === 18 && height === 14;
      const playerCell = 8 * height + 6;
      for (let i = 0; i < width * height; i++) {
        w.u16(GROUND_ID);
        if (isFullMap && i === playerCell && z === SPAWN.z) {
          // The player stands on the first tile (known-creature form not
          // needed — 0x61 introduces it with name + outfit).
          w.u16(0x61);
          w.u32(0); // removeKnown
          w.u32(PLAYER_ID);
          w.str('Trinity');
          w.u8(100); // health %
          w.u8(2);   // direction: south
          w.u8(128); // lookType (citizen)
          w.u8(78).u8(69).u8(58).u8(95); // colors — the server schema's new-character defaults
          w.u8(0).u8(0); // light
          w.u16(220); // speed
          w.u8(0).u8(0); // skull, shield
        }
        w.u8(0x00).u8(0xff);
      }
    } else {
      // Whole floor empty.
      let cells = width * height;
      while (cells > 0) {
        const chunk = Math.min(cells, 256);
        w.u8(chunk - 1).u8(0xff);
        cells -= chunk;
      }
    }
  }
}

// --- Login server -----------------------------------------------------

const loginServer = net.createServer((socket) => {
  socket.once('data', () => {
    const w = new FrameWriter();
    w.u8(0x14).str('1\nWelcome to the mock server.');
    w.u8(0x64);
    w.u8(1); // one character
    w.str('Trinity').str('Mock');
    w.u8(127).u8(0).u8(0).u8(1); // worldIp (ignored by the client — proxy routes)
    w.u16(GAME_PORT);
    w.u16(30); // premium days
    socket.write(w.frame());
  });
  socket.on('error', () => socket.destroy());
});

// --- Game server ------------------------------------------------------

const gameServer = net.createServer((socket) => {
  const player = { ...SPAWN };
  let entered = false;
  let buffered = Buffer.alloc(0);

  const send = (w: FrameWriter): void => { socket.write(w.frame()); };

  function enterGame(): void {
    entered = true;
    const w = new FrameWriter();
    w.u8(0x0a).u32(PLAYER_ID).u16(0x0032).u8(0x00); // SelfAppear
    w.u8(0x64).pos(player.x, player.y, player.z);
    writeMapArea(w, 18, 14, player.z);
    // Stats (0xA0): hp, maxhp, cap, exp, level, level%, mana, maxmana,
    // mlevel, mlevel%, soul.
    w.u8(0xa0).u16(150).u16(185).u16(400).u32(4200).u16(8).u8(50)
      .u16(35).u16(90).u8(2).u8(20).u8(100);
    w.u8(0xb4).u8(0x11).str('Welcome to the mock server.');
    send(w);
  }

  function move(dx: number, dy: number, opcode: number): void {
    player.x += dx;
    player.y += dy;
    const w = new FrameWriter();
    w.u8(opcode);
    // The new edge slice: a column for east/west, a row for north/south.
    writeMapArea(w, dx !== 0 ? 1 : 18, dx !== 0 ? 14 : 1, player.z);
    send(w);
  }

  function handlePacket(payload: Buffer): void {
    const opcode = payload[0];
    if (!entered) {
      enterGame(); // first packet on the game socket is the game login
      return;
    }
    switch (opcode) {
      case 0x65: move(0, -1, 0x65); break;
      case 0x66: move(1, 0, 0x66); break;
      case 0x67: move(0, 1, 0x67); break;
      case 0x68: move(-1, 0, 0x68); break;
      case 0x96: { // say → echo back as creature speech
        // payload: opcode, U8 type, string text
        const len = payload[2] | (payload[3] << 8);
        const text = payload.subarray(4, 4 + len).toString('latin1');
        const w = new FrameWriter();
        w.u8(0xaa).str('Trinity').u8(0x01).pos(player.x, player.y, player.z).str(text);
        send(w);
        break;
      }
      default: break; // ping replies etc. — nothing to do
    }
  }

  socket.on('data', (data: Buffer) => {
    buffered = Buffer.concat([buffered, data]);
    while (buffered.length >= 2) {
      const len = buffered[0] | (buffered[1] << 8);
      if (buffered.length < 2 + len) break;
      handlePacket(buffered.subarray(2, 2 + len));
      buffered = buffered.subarray(2 + len);
    }
  });
  socket.on('error', () => socket.destroy());
});

loginServer.listen(LOGIN_PORT, '127.0.0.1', () => {
  console.log(`mock OT login server on 127.0.0.1:${LOGIN_PORT}`);
});
gameServer.listen(GAME_PORT, '127.0.0.1', () => {
  console.log(`mock OT game server on 127.0.0.1:${GAME_PORT}`);
});
