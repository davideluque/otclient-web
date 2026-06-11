import { MessageType, ChannelId, type ChatMessage } from '../net/common/types';

export interface Channel {
  id: number;
  name: string;
  messages: ChatMessage[];
}

export interface SpeechBubble {
  senderName: string;
  /** Concatenated messages from this speaker, newline-separated. */
  text: string;
  /** Drives the on-screen style: yellow says:/whispers:/yells: for
   *  players, orange bare text for monsters (OTClient statictext). */
  messageType: number;
  x: number;
  y: number;
  z: number;
  expiresAt: number;
}

// OTClient statictext durations: per-character with a floor, doubled
// for yells so long-range shouting stays readable.
const SPEECH_MS_PER_CHAR = 60;
const SPEECH_MIN_DURATION_MS = 3000;
const MAX_MESSAGES_PER_CHANNEL = 200;
const DEFAULT_CHANNELS = [
  { id: ChannelId.Default, name: 'Default' },
  { id: ChannelId.GameChat, name: 'Game Chat' },
  { id: ChannelId.Trade, name: 'Trade' },
  { id: ChannelId.Help, name: 'Help' },
] as const;

export class ChatManager {
  private channels = new Map<number, Channel>();
  private _activeChannelId: number;
  private _speechBubbles: SpeechBubble[] = [];
  private messageListeners = new Set<(msg: ChatMessage) => void>();

  constructor() {
    for (const channel of DEFAULT_CHANNELS) {
      this.addChannel(channel.id, channel.name);
    }
    this._activeChannelId = ChannelId.Default;
  }

  get activeChannelId(): number {
    return this._activeChannelId;
  }

  get activeChannel(): Channel | undefined {
    return this.channels.get(this._activeChannelId);
  }

  get channelList(): Channel[] {
    return [...this.channels.values()];
  }

  get speechBubbles(): SpeechBubble[] {
    return this._speechBubbles;
  }

  addChannel(id: number, name: string): void {
    if (!this.channels.has(id)) {
      this.channels.set(id, { id, name, messages: [] });
    }
  }

  removeChannel(id: number): void {
    this.channels.delete(id);
    if (this._activeChannelId === id) {
      this._activeChannelId = ChannelId.Default;
    }
  }

  setActiveChannel(id: number): void {
    if (this.channels.has(id)) {
      this._activeChannelId = id;
    }
  }

  getChannel(id: number): Channel | undefined {
    return this.channels.get(id);
  }

  /**
   * Subscribe to every processed message. THE extension point for chat
   * interfaces (compact overlay, full view, speech bubbles): consumers
   * used to monkey-patch handleMessage and chain each other — fragile
   * with more than one. Returns an unsubscribe.
   */
  subscribe(listener: (msg: ChatMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  handleMessage(msg: ChatMessage): void {
    const channel = this.channels.get(this.channelIdForMessage(msg));

    if (channel) {
      this.appendMessage(channel, msg);
    }

    if (msg.position && this.hasSpeechBubbleMessageType(msg.messageType)) {
      this.addSpeechBubble(msg, msg.position);
    }

    for (const listener of this.messageListeners) listener(msg);
  }

  /** Remove expired speech bubbles. Call each frame. */
  cleanupBubbles(now: number): void {
    this._speechBubbles = this._speechBubbles.filter(b => b.expiresAt > now);
  }

  private channelIdForMessage(msg: ChatMessage): number {
    if (msg.channelId !== undefined && this.channels.has(msg.channelId)) {
      return msg.channelId;
    }

    switch (msg.messageType) {
      case MessageType.PrivateFrom:
      case MessageType.PrivateRed:
        return ChannelId.Default;
      case MessageType.Channel:
      case MessageType.ChannelRed:
      case MessageType.ChannelOrange:
      case MessageType.ChannelRedAnonymous:
        return msg.channelId ?? ChannelId.Default;
      default:
        return ChannelId.Default;
    }
  }

  private appendMessage(channel: Channel, msg: ChatMessage): void {
    channel.messages.push(msg);
    if (channel.messages.length > MAX_MESSAGES_PER_CHANNEL) {
      channel.messages.shift();
    }
  }

  private addSpeechBubble(msg: ChatMessage, position: NonNullable<ChatMessage['position']>): void {
    let duration = Math.max(SPEECH_MIN_DURATION_MS, msg.text.length * SPEECH_MS_PER_CHAR);
    if (msg.messageType === MessageType.Yell || msg.messageType === MessageType.MonsterYell) {
      duration *= 2;
    }
    // Same speaker, same kind, still on screen → stack the new line
    // under the existing text (classic Tibia pushes the says-text up).
    const existing = this._speechBubbles.find(
      (b) => b.senderName === msg.senderName
        && b.messageType === msg.messageType
        && b.expiresAt > msg.timestamp,
    );
    if (existing) {
      existing.text += `\n${msg.text}`;
      existing.x = position.x;
      existing.y = position.y;
      existing.z = position.z;
      existing.expiresAt = msg.timestamp + duration;
      return;
    }
    this._speechBubbles.push({
      senderName: msg.senderName,
      text: msg.text,
      messageType: msg.messageType,
      x: position.x,
      y: position.y,
      z: position.z,
      expiresAt: msg.timestamp + duration,
    });
  }

  private hasSpeechBubbleMessageType(type: number): boolean {
    return (
      type === MessageType.Say ||
      type === MessageType.Whisper ||
      type === MessageType.Yell ||
      type === MessageType.MonsterSay ||
      type === MessageType.MonsterYell
    );
  }
}
