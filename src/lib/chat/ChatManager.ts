import type { ChatMessage } from '../net/chatProtocol';
import { MessageType, ChannelId } from '../net/chatProtocol';

export interface Channel {
  id: number;
  name: string;
  messages: ChatMessage[];
}

export interface SpeechBubble {
  senderName: string;
  text: string;
  x: number;
  y: number;
  z: number;
  expiresAt: number;
}

const SPEECH_BUBBLE_DURATION_MS = 5000;
const MAX_MESSAGES_PER_CHANNEL = 200;

export class ChatManager {
  private channels = new Map<number, Channel>();
  private _activeChannelId: number;
  private _speechBubbles: SpeechBubble[] = [];

  constructor() {
    // Default channels
    this.addChannel(ChannelId.Default, 'Default');
    this.addChannel(ChannelId.GameChat, 'Game Chat');
    this.addChannel(ChannelId.Trade, 'Trade');
    this.addChannel(ChannelId.Help, 'Help');
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
   * Process an incoming chat message and route it to the correct channel.
   */
  handleMessage(msg: ChatMessage): void {
    const channelId = this.routeMessage(msg);
    const channel = this.channels.get(channelId);

    if (channel) {
      channel.messages.push(msg);
      if (channel.messages.length > MAX_MESSAGES_PER_CHANNEL) {
        channel.messages.shift();
      }
    }

    // Create speech bubble for local messages
    if (msg.position && this.isLocalSpeech(msg.messageType)) {
      this._speechBubbles.push({
        senderName: msg.senderName,
        text: msg.text,
        x: msg.position.x,
        y: msg.position.y,
        z: msg.position.z,
        expiresAt: Date.now() + SPEECH_BUBBLE_DURATION_MS,
      });
    }
  }

  /**
   * Remove expired speech bubbles. Call each frame.
   */
  cleanupBubbles(now: number): void {
    this._speechBubbles = this._speechBubbles.filter(b => b.expiresAt > now);
  }

  private routeMessage(msg: ChatMessage): number {
    if (msg.channelId !== undefined && this.channels.has(msg.channelId)) {
      return msg.channelId;
    }

    switch (msg.messageType) {
      case MessageType.PrivateFrom:
      case MessageType.PrivateRed:
        return ChannelId.Default; // Private messages go to default
      case MessageType.Channel:
      case MessageType.ChannelRed:
      case MessageType.ChannelHighlight:
        return msg.channelId ?? ChannelId.Default;
      default:
        return ChannelId.Default;
    }
  }

  private isLocalSpeech(type: number): boolean {
    return (
      type === MessageType.Say ||
      type === MessageType.Whisper ||
      type === MessageType.Yell ||
      type === MessageType.MonsterSay ||
      type === MessageType.MonsterYell
    );
  }
}
