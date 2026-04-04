import { describe, it, expect } from 'vitest';
import {
  parseCreatureSpeak,
  buildSayPacket,
  buildChannelMessagePacket,
  buildPrivateMessagePacket,
  buildWhisperPacket,
  buildYellPacket,
  MessageType,
} from '../lib/net/chatProtocol';
import { InputPacket } from '../lib/net/InputPacket';
import { OutputPacket } from '../lib/net/OutputPacket';

describe('parseCreatureSpeak', () => {
  it('parses a Say message with position', () => {
    const out = new OutputPacket();
    out.addString('Player1');
    out.addU8(MessageType.Say);
    out.addPosition(32000, 32000, 7);
    out.addString('Hello!');

    const msg = parseCreatureSpeak(new InputPacket(out.toArrayBuffer()));
    expect(msg.senderName).toBe('Player1');
    expect(msg.messageType).toBe(MessageType.Say);
    expect(msg.text).toBe('Hello!');
    expect(msg.position).toEqual({ x: 32000, y: 32000, z: 7 });
    expect(msg.channelId).toBeUndefined();
  });

  it('parses a Channel message with channel ID', () => {
    const out = new OutputPacket();
    out.addString('Trader');
    out.addU8(MessageType.Channel);
    out.addU16(5); // Trade channel
    out.addString('Selling sword!');

    const msg = parseCreatureSpeak(new InputPacket(out.toArrayBuffer()));
    expect(msg.senderName).toBe('Trader');
    expect(msg.messageType).toBe(MessageType.Channel);
    expect(msg.channelId).toBe(5);
    expect(msg.text).toBe('Selling sword!');
    expect(msg.position).toBeUndefined();
  });

  it('parses a Private message', () => {
    const out = new OutputPacket();
    out.addString('Friend');
    out.addU8(MessageType.PrivateFrom);
    out.addString('Hey, meet me at depot');

    const msg = parseCreatureSpeak(new InputPacket(out.toArrayBuffer()));
    expect(msg.senderName).toBe('Friend');
    expect(msg.messageType).toBe(MessageType.PrivateFrom);
    expect(msg.text).toBe('Hey, meet me at depot');
  });

  it('parses a Monster yell', () => {
    const out = new OutputPacket();
    out.addString('Demon');
    out.addU8(MessageType.MonsterYell);
    out.addPosition(100, 200, 7);
    out.addString('GRRR!');

    const msg = parseCreatureSpeak(new InputPacket(out.toArrayBuffer()));
    expect(msg.senderName).toBe('Demon');
    expect(msg.messageType).toBe(MessageType.MonsterYell);
    expect(msg.text).toBe('GRRR!');
    expect(msg.position).toBeDefined();
  });
});

describe('outgoing chat packets', () => {
  it('builds Say packet', () => {
    const pkt = buildSayPacket('Hello world');
    const inp = new InputPacket(pkt.toArrayBuffer());
    expect(inp.getU8()).toBe(0x96);
    expect(inp.getU8()).toBe(MessageType.Say);
    expect(inp.getString()).toBe('Hello world');
  });

  it('builds Channel message packet', () => {
    const pkt = buildChannelMessagePacket(5, 'Selling rune');
    const inp = new InputPacket(pkt.toArrayBuffer());
    expect(inp.getU8()).toBe(0x96);
    expect(inp.getU8()).toBe(MessageType.Channel);
    expect(inp.getU16()).toBe(5);
    expect(inp.getString()).toBe('Selling rune');
  });

  it('builds Private message packet', () => {
    const pkt = buildPrivateMessagePacket('Friend', 'Hi!');
    const inp = new InputPacket(pkt.toArrayBuffer());
    expect(inp.getU8()).toBe(0x96);
    expect(inp.getU8()).toBe(MessageType.PrivateTo);
    expect(inp.getString()).toBe('Friend');
    expect(inp.getString()).toBe('Hi!');
  });

  it('builds Whisper packet', () => {
    const pkt = buildWhisperPacket('psst');
    const inp = new InputPacket(pkt.toArrayBuffer());
    expect(inp.getU8()).toBe(0x96);
    expect(inp.getU8()).toBe(MessageType.Whisper);
    expect(inp.getString()).toBe('psst');
  });

  it('builds Yell packet', () => {
    const pkt = buildYellPacket('HELP');
    const inp = new InputPacket(pkt.toArrayBuffer());
    expect(inp.getU8()).toBe(0x96);
    expect(inp.getU8()).toBe(MessageType.Yell);
    expect(inp.getString()).toBe('HELP');
  });
});
