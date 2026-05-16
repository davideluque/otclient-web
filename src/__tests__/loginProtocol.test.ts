import { describe, it, expect } from 'vitest';
import {
  buildLoginPacket,
  buildGameLoginPacket,
  parseLoginResponse,
  isLoginError,
} from '../lib/net/7.6/loginProtocol';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import type { XteaKey } from '../lib/net/common/xtea';

const TEST_KEY: XteaKey = [1, 2, 3, 4];

describe('buildLoginPacket', () => {
  it('produces valid login packet structure', () => {
    const pkt = buildLoginPacket(123456, 'testpass', TEST_KEY);
    const inp = new InputPacket(pkt.toArrayBuffer());

    expect(inp.getU8()).toBe(0x01); // opcode
    expect(inp.getU16()).toBe(2);   // OS
    expect(inp.getU16()).toBe(760); // version

    // XTEA key
    expect(inp.getU32()).toBe(1);
    expect(inp.getU32()).toBe(2);
    expect(inp.getU32()).toBe(3);
    expect(inp.getU32()).toBe(4);

    // Account + password
    expect(inp.getU32()).toBe(123456);
    expect(inp.getString()).toBe('testpass');
  });
});

describe('buildGameLoginPacket', () => {
  it('produces valid game login packet structure', () => {
    const pkt = buildGameLoginPacket(123456, 'Player', 'pass', TEST_KEY);
    const inp = new InputPacket(pkt.toArrayBuffer());

    expect(inp.getU8()).toBe(0x0a); // opcode
    expect(inp.getU16()).toBe(2);   // OS
    expect(inp.getU16()).toBe(760); // version

    // XTEA key
    expect(inp.getU32()).toBe(1);
    expect(inp.getU32()).toBe(2);
    expect(inp.getU32()).toBe(3);
    expect(inp.getU32()).toBe(4);

    // Credentials
    expect(inp.getU32()).toBe(123456);
    expect(inp.getString()).toBe('Player');
    expect(inp.getString()).toBe('pass');
  });
});

describe('parseLoginResponse', () => {
  it('parses login error', () => {
    const out = new OutputPacket();
    out.addU8(0x0a); // error opcode
    out.addString('Invalid account');

    const result = parseLoginResponse(new InputPacket(out.toArrayBuffer()));
    expect(isLoginError(result)).toBe(true);
    if (isLoginError(result)) {
      expect(result.message).toBe('Invalid account');
    }
  });

  it('parses character list with MOTD', () => {
    const out = new OutputPacket();
    out.addU8(0x14); // MOTD opcode
    out.addString('Welcome to Tibia!');
    out.addU8(0x64); // character list opcode

    // 2 characters
    out.addU8(2);

    // Character 1
    out.addString('Player1');
    out.addString('World1');
    out.addU8(127); out.addU8(0); out.addU8(0); out.addU8(1); // 127.0.0.1
    out.addU16(7172);

    // Character 2
    out.addString('Player2');
    out.addString('World1');
    out.addU8(192); out.addU8(168); out.addU8(1); out.addU8(100); // 192.168.1.100
    out.addU16(7172);

    out.addU16(30); // premium days

    const result = parseLoginResponse(new InputPacket(out.toArrayBuffer()));
    expect(isLoginError(result)).toBe(false);
    if (!isLoginError(result)) {
      expect(result.motd).toBe('Welcome to Tibia!');
      expect(result.characters).toHaveLength(2);
      expect(result.characters[0].name).toBe('Player1');
      expect(result.characters[0].worldIp).toBe('127.0.0.1');
      expect(result.characters[1].name).toBe('Player2');
      expect(result.characters[1].worldIp).toBe('192.168.1.100');
      expect(result.premiumDays).toBe(30);
    }
  });

  it('parses character list without MOTD', () => {
    const out = new OutputPacket();
    out.addU8(0x64); // character list opcode (no MOTD)
    out.addU8(1);

    out.addString('Solo');
    out.addString('TestWorld');
    out.addU8(10); out.addU8(0); out.addU8(0); out.addU8(1);
    out.addU16(7172);

    out.addU16(0);

    const result = parseLoginResponse(new InputPacket(out.toArrayBuffer()));
    expect(isLoginError(result)).toBe(false);
    if (!isLoginError(result)) {
      expect(result.motd).toBeUndefined();
      expect(result.characters).toHaveLength(1);
      expect(result.characters[0].name).toBe('Solo');
      expect(result.premiumDays).toBe(0);
    }
  });
});
