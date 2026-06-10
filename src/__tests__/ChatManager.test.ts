import { describe, it, expect, beforeEach } from 'vitest';
import { ChatManager } from '../lib/chat/ChatManager';
import { MessageType, ChannelId, type ChatMessage } from '../lib/net/common/types';

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    senderName: 'Player',
    messageType: MessageType.Say,
    text: 'Hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ChatManager', () => {
  let chat: ChatManager;

  beforeEach(() => {
    chat = new ChatManager();
  });

  it('starts with default channels', () => {
    const channels = chat.channelList;
    expect(channels.length).toBeGreaterThanOrEqual(4);
    expect(chat.getChannel(ChannelId.Default)).toBeDefined();
    expect(chat.getChannel(ChannelId.Trade)).toBeDefined();
  });

  it('starts with Default as active channel', () => {
    expect(chat.activeChannelId).toBe(ChannelId.Default);
  });

  it('routes Say messages to Default channel', () => {
    chat.handleMessage(makeMsg({ messageType: MessageType.Say, position: { x: 0, y: 0, z: 7 } }));
    expect(chat.getChannel(ChannelId.Default)!.messages).toHaveLength(1);
  });

  it('routes Channel messages to the specified channel', () => {
    chat.handleMessage(makeMsg({
      messageType: MessageType.Channel,
      channelId: ChannelId.Trade,
      text: 'Selling sword',
    }));
    expect(chat.getChannel(ChannelId.Trade)!.messages).toHaveLength(1);
    expect(chat.getChannel(ChannelId.Trade)!.messages[0].text).toBe('Selling sword');
  });

  it('switches active channel', () => {
    chat.setActiveChannel(ChannelId.Trade);
    expect(chat.activeChannelId).toBe(ChannelId.Trade);
    expect(chat.activeChannel?.name).toBe('Trade');
  });

  it('ignores switching to non-existent channel', () => {
    chat.setActiveChannel(9999);
    expect(chat.activeChannelId).toBe(ChannelId.Default);
  });

  it('adds and removes channels', () => {
    chat.addChannel(100, 'Custom');
    expect(chat.getChannel(100)).toBeDefined();
    chat.removeChannel(100);
    expect(chat.getChannel(100)).toBeUndefined();
  });

  it('falls back to Default when active channel is removed', () => {
    chat.addChannel(100, 'Custom');
    chat.setActiveChannel(100);
    chat.removeChannel(100);
    expect(chat.activeChannelId).toBe(ChannelId.Default);
  });

  it('creates speech bubbles for Say messages with position', () => {
    chat.handleMessage(makeMsg({
      messageType: MessageType.Say,
      position: { x: 100, y: 200, z: 7 },
      text: 'Hi there!',
    }));
    expect(chat.speechBubbles).toHaveLength(1);
    expect(chat.speechBubbles[0].text).toBe('Hi there!');
    expect(chat.speechBubbles[0].x).toBe(100);
  });

  it('does not create speech bubbles for Channel messages', () => {
    chat.handleMessage(makeMsg({
      messageType: MessageType.Channel,
      channelId: ChannelId.Trade,
    }));
    expect(chat.speechBubbles).toHaveLength(0);
  });

  it('cleans up expired speech bubbles', () => {
    const now = Date.now();
    chat.handleMessage(makeMsg({
      messageType: MessageType.Say,
      position: { x: 0, y: 0, z: 7 },
    }));
    expect(chat.speechBubbles).toHaveLength(1);

    // Simulate time passing
    chat.cleanupBubbles(now + 10000);
    expect(chat.speechBubbles).toHaveLength(0);
  });

  it('caps messages per channel', () => {
    for (let i = 0; i < 250; i++) {
      chat.handleMessage(makeMsg({ text: `msg ${i}` }));
    }
    expect(chat.getChannel(ChannelId.Default)!.messages.length).toBeLessThanOrEqual(200);
  });
});
