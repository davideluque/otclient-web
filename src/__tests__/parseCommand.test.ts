import { describe, it, expect } from 'vitest';
import { parseCommand } from '../lib/chat/ChatUI';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { MessageType, ChannelId } from '../lib/net/common/types';

const protocol = new GameProtocol();

function firstMessageType(packet: ReturnType<typeof protocol.chat.buildSay>): number {
  // chat packets: opcode(U8) + messageType(U8) + ...
  return packet.toUint8Array()[1];
}

describe('parseCommand', () => {
  it('/w Name msg → private message to Name', () => {
    const packet = parseCommand('/w Alice hello', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.PrivateTo);
  });

  it('/w with no message → null (no-op)', () => {
    expect(parseCommand('/w Alice', ChannelId.Default, protocol)).toBeNull();
  });

  it('/whisper Name msg → private message to Name (not local whisper)', () => {
    // Regression guard: previously `/whisper Alice hi` was sent as local
    // whisper text "Alice hi", leaking the intended-private message.
    const packet = parseCommand('/whisper Alice hi', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.PrivateTo);
  });

  it('/whisper msg (single word) → local whisper speech', () => {
    const packet = parseCommand('/whisper psst', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.Whisper);
  });

  it('/yell msg → yell speech', () => {
    const packet = parseCommand('/yell HELP', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.Yell);
  });

  it('plain text in Default channel → Say', () => {
    const packet = parseCommand('hello there', ChannelId.Default, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.Say);
  });

  it('plain text in non-Default channel → channel message', () => {
    const packet = parseCommand('selling sword', ChannelId.Trade, protocol);
    expect(packet).not.toBeNull();
    expect(firstMessageType(packet!)).toBe(MessageType.Channel);
  });
});
