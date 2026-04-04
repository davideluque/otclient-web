import { InputPacket } from './InputPacket';
import { OutputPacket } from './OutputPacket';

// --- Message types (SpeakType in OT 7.6) ---

export const MessageType = {
  Say: 0x01,
  Whisper: 0x02,
  Yell: 0x03,
  PrivateFrom: 0x04,
  PrivateTo: 0x05,
  ChannelManagement: 0x06,
  Channel: 0x07,
  ChannelHighlight: 0x08,
  Broadcast: 0x09,
  ChannelRed: 0x0a,
  PrivateRed: 0x0b,
  MonsterSay: 0x0d,
  MonsterYell: 0x0e,
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// --- Standard channel IDs ---

export const ChannelId = {
  Default: 0,
  GameChat: 7,
  Trade: 5,
  RLChat: 6,
  Help: 8,
  Private: 0xffff,
} as const;

// --- Data types ---

export interface ChatMessage {
  senderName: string;
  messageType: number;
  text: string;
  position?: { x: number; y: number; z: number };
  channelId?: number;
  timestamp: number;
}

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
