import { describe, it, expect } from 'vitest';
import { GameProtocol, DEFAULT_76_CONFIG } from '../lib/net/7.6/GameProtocol';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { InputPacket } from '../lib/net/common/InputPacket';
import { MessageType } from '../lib/net/common/types';

describe('GameProtocol (7.6)', () => {
  describe('config', () => {
    it('applies the 7.6 defaults when no overrides given', () => {
      const protocol = new GameProtocol();
      expect(protocol.config).toEqual(DEFAULT_76_CONFIG);
      expect(protocol.config.version).toBe(760);
      // OT 7.6 has no XTEA and no RSA — both came in later versions.
      expect(protocol.config.useXTEA).toBe(false);
      expect(protocol.config.useRSA).toBe(false);
    });

    it('overrides individual fields via the constructor', () => {
      const protocol = new GameProtocol({ clientVersion: 761 });
      expect(protocol.config.clientVersion).toBe(761);
      expect(protocol.config.version).toBe(760);
      expect(protocol.config.useXTEA).toBe(false);
    });

    it('throws when useRSA: true is requested (RSA not implemented)', () => {
      // Privacy guard: caller asking for RSA must not silently receive
      // plaintext. Fail loud until a real RSA implementation lands.
      expect(() => new GameProtocol({ useRSA: true })).toThrow(/useRSA/);
    });
  });

  describe('opcodes', () => {
    it('exposes server opcodes with stable names', () => {
      const { serverOpcodes } = new GameProtocol();
      expect(serverOpcodes.MapDescription).toBe(0x64);
      expect(serverOpcodes.CreatureMove).toBe(0x6d);
      expect(serverOpcodes.CreatureSpeak).toBe(0xaa);
    });

    it('exposes client opcodes with stable names', () => {
      const { clientOpcodes } = new GameProtocol();
      expect(clientOpcodes.Say).toBe(0x96);
      expect(clientOpcodes.Ping).toBe(0x1e);
    });
  });

  describe('login', () => {
    const protocol = new GameProtocol();

    it('buildLoginRequest produces a non-empty packet starting with the login opcode', () => {
      const packet = protocol.login.buildLoginRequest(12345, 'secret');
      expect(packet.length).toBeGreaterThan(0);
      const bytes = packet.toUint8Array();
      expect(bytes[0]).toBe(protocol.clientOpcodes.LoginServerRequest);
    });

    it('buildGameLogin produces a non-empty packet starting with the game-login opcode', () => {
      const packet = protocol.login.buildGameLogin(12345, 'Bruno', 'secret');
      const bytes = packet.toUint8Array();
      expect(bytes[0]).toBe(protocol.clientOpcodes.GameServerRequest);
    });

    it('isLoginError narrows the response type', () => {
      const errorResponse = { message: 'Account is banned' };
      const okResponse = { characters: [], premiumDays: 0 };
      expect(protocol.login.isLoginError(errorResponse)).toBe(true);
      expect(protocol.login.isLoginError(okResponse)).toBe(false);
    });

    it('config.clientVersion flows through to the login packet bytes', () => {
      // Login packet layout: opcode(1) + os(U16) + clientVersion(U16) + ...
      // clientVersion sits at byte offset 3..5 (little-endian).
      const default760 = new GameProtocol();
      const default760Bytes = default760.login.buildLoginRequest(1, 'pw').toUint8Array();
      expect(default760Bytes[3] | (default760Bytes[4] << 8)).toBe(760);

      const jamera761 = new GameProtocol({ clientVersion: 761 });
      const jamera761Bytes = jamera761.login.buildLoginRequest(1, 'pw').toUint8Array();
      expect(jamera761Bytes[3] | (jamera761Bytes[4] << 8)).toBe(761);

      const gameLoginBytes = jamera761.login.buildGameLogin(1, 'Bruno', 'pw').toUint8Array();
      expect(gameLoginBytes[3] | (gameLoginBytes[4] << 8)).toBe(761);
    });

    it('config file signatures flow through to the login packet bytes', () => {
      // File sigs sit at offset 5..17 (3 × U32 after the 5-byte header).
      const protocol = new GameProtocol({
        datSignature: 0xaabbccdd,
        sprSignature: 0x11223344,
        picSignature: 0x55667788,
      });
      const inp = new InputPacket(protocol.login.buildLoginRequest(1, 'pw').toArrayBuffer());
      inp.skip(5); // opcode + os + version
      expect(inp.getU32()).toBe(0xaabbccdd);
      expect(inp.getU32()).toBe(0x11223344);
      expect(inp.getU32()).toBe(0x55667788);
    });
  });

  describe('chat', () => {
    const protocol = new GameProtocol();

    it('buildSay produces a packet starting with the Say opcode + Say message type', () => {
      const packet = protocol.chat.buildSay('hello');
      const bytes = packet.toUint8Array();
      expect(bytes[0]).toBe(protocol.clientOpcodes.Say);
      expect(bytes[1]).toBe(MessageType.Say);
    });

    it('buildChannelMessage embeds the channel ID', () => {
      const packet = protocol.chat.buildChannelMessage(5, 'hi trade');
      const bytes = packet.toUint8Array();
      expect(bytes[1]).toBe(MessageType.Channel);
      // little-endian U16 at offset 2
      expect(bytes[2] | (bytes[3] << 8)).toBe(5);
    });

    it('parseSpeak roundtrips a Say message', () => {
      const out = new OutputPacket();
      out.addString('Alice');
      out.addU8(MessageType.Say);
      out.addPosition(100, 200, 7);
      out.addString('hello world');
      const msg = protocol.chat.parseSpeak(new InputPacket(out.toArrayBuffer()));
      expect(msg.senderName).toBe('Alice');
      expect(msg.messageType).toBe(MessageType.Say);
      expect(msg.text).toBe('hello world');
      expect(msg.position).toEqual({ x: 100, y: 200, z: 7 });
    });
  });

  describe('creature', () => {
    const protocol = new GameProtocol();

    it('parseMove reads from + stack + to positions', () => {
      const out = new OutputPacket();
      out.addPosition(10, 20, 7); // from
      out.addU8(1);               // stack
      out.addPosition(11, 20, 7); // to
      const event = protocol.creature.parseMove(new InputPacket(out.toArrayBuffer()));
      expect(event.type).toBe('move');
      expect(event.fromX).toBe(10);
      expect(event.fromStack).toBe(1);
      expect(event.toX).toBe(11);
    });

    it('parseHealth reads creature ID + health percent', () => {
      const out = new OutputPacket();
      out.addU32(42);
      out.addU8(75);
      const event = protocol.creature.parseHealth(new InputPacket(out.toArrayBuffer()));
      expect(event.creatureId).toBe(42);
      expect(event.healthPercent).toBe(75);
    });
  });

  describe('map', () => {
    it('parseDescription handles an empty (all-skip) area without throwing', () => {
      const protocol = new GameProtocol();
      const out = new OutputPacket();
      // Single tile area, skip marker + skip count of 0
      out.addU16(0xffff);
      out.addU16(0);
      const tiles = protocol.map.parseDescription(
        new InputPacket(out.toArrayBuffer()),
        0, 0, 0, 0, 7,
      );
      expect(tiles).toEqual([]);
    });
  });
});
