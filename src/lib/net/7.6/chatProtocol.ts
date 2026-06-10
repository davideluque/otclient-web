import { InputPacket } from '../common/InputPacket';
import { OutputPacket } from '../common/OutputPacket';
import { MessageType } from '../common/types';
import type { ChatMessage } from '../common/types';

// --- Incoming packet parsers ---

/**
 * Parse a CreatureSpeak packet (opcode 0xAA) from the server.
 */
export function parseCreatureSpeak(packet: InputPacket): ChatMessage {
  const senderName = packet.getString();
  const messageType = packet.getU8();

  let position: ChatMessage['position'];
  let channelId: ChatMessage['channelId'];

  switch (messageType) {
    case MessageType.Say:
    case MessageType.Whisper:
    case MessageType.Yell:
    case MessageType.MonsterSay:
    case MessageType.MonsterYell:
      position = packet.getPosition();
      break;
    case MessageType.Channel:
    case MessageType.ChannelRed:
    case MessageType.ChannelHighlight:
    case MessageType.ChannelManagement:
      channelId = packet.getU16();
      break;
    case MessageType.PrivateFrom:
    case MessageType.PrivateRed:
    case MessageType.Broadcast:
      // No extra data
      break;
  }

  const text = packet.getString();

  return {
    senderName,
    messageType,
    text,
    position,
    channelId,
    timestamp: Date.now(),
  };
}

// --- Outgoing packet builders ---

/**
 * Build a Say packet (local chat on the map).
 */
export function buildSayPacket(text: string): OutputPacket {
  const out = new OutputPacket();
  out.addU8(0x96); // ClientOp.Say
  out.addU8(MessageType.Say);
  out.addString(text);
  return out;
}

/**
 * Build a channel message packet.
 */
export function buildChannelMessagePacket(channelId: number, text: string): OutputPacket {
  const out = new OutputPacket();
  out.addU8(0x96);
  out.addU8(MessageType.Channel);
  out.addU16(channelId);
  out.addString(text);
  return out;
}

/**
 * Build a private message packet.
 */
export function buildPrivateMessagePacket(recipientName: string, text: string): OutputPacket {
  const out = new OutputPacket();
  out.addU8(0x96);
  out.addU8(MessageType.PrivateTo);
  out.addString(recipientName);
  out.addString(text);
  return out;
}

/**
 * Build a whisper packet.
 */
export function buildWhisperPacket(text: string): OutputPacket {
  const out = new OutputPacket();
  out.addU8(0x96);
  out.addU8(MessageType.Whisper);
  out.addString(text);
  return out;
}

/**
 * Build a yell packet.
 */
export function buildYellPacket(text: string): OutputPacket {
  const out = new OutputPacket();
  out.addU8(0x96);
  out.addU8(MessageType.Yell);
  out.addString(text);
  return out;
}
