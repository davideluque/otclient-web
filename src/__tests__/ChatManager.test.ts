import { describe, it, expect, beforeEach } from 'vitest';
import { ChatManager, type SpeechBubble } from '../lib/chat/ChatManager';
import { composeSpeech } from '../lib/chat/SpeechBubbleRenderer';
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

  it('stacks repeated speech from the same speaker into one bubble', () => {
    const t = Date.now();
    chat.handleMessage(makeMsg({
      messageType: MessageType.Say,
      position: { x: 100, y: 200, z: 7 },
      text: 'exura',
      timestamp: t,
    }));
    chat.handleMessage(makeMsg({
      messageType: MessageType.Say,
      position: { x: 100, y: 201, z: 7 },
      text: 'exura vita',
      timestamp: t + 500,
    }));
    expect(chat.speechBubbles).toHaveLength(1);
    expect(chat.speechBubbles[0].text).toBe('exura\nexura vita');
    // Bubble follows the speaker's latest position.
    expect(chat.speechBubbles[0].y).toBe(201);

    // A different speaker gets their own bubble.
    chat.handleMessage(makeMsg({
      senderName: 'Other',
      messageType: MessageType.Say,
      position: { x: 101, y: 200, z: 7 },
      text: 'hi',
      timestamp: t + 600,
    }));
    expect(chat.speechBubbles).toHaveLength(2);
  });

  it('caps stacked lines at 10 and never shortens the remaining display time', () => {
    const t = Date.now();
    for (let i = 0; i < 14; i++) {
      chat.handleMessage(makeMsg({
        messageType: MessageType.Say,
        position: { x: 0, y: 0, z: 7 },
        text: `line${i}`,
        timestamp: t + i,
      }));
    }
    expect(chat.speechBubbles).toHaveLength(1);
    const lines = chat.speechBubbles[0].text.split('\n');
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe('line4'); // oldest fell off
    expect(lines[9]).toBe('line13');

    // A long text then a quick "hi" must not cut the long one short.
    chat.cleanupBubbles(t + 100000);
    chat.handleMessage(makeMsg({
      messageType: MessageType.Say, position: { x: 0, y: 0, z: 7 },
      text: 'x'.repeat(100), timestamp: t, // expires t + 6000
    }));
    chat.handleMessage(makeMsg({
      messageType: MessageType.Say, position: { x: 0, y: 0, z: 7 },
      text: 'hi', timestamp: t + 100, // own duration would end at t + 3100
    }));
    expect(chat.speechBubbles[0].expiresAt).toBe(t + 6000);
  });

  it('scales bubble duration with text length, doubled for yells', () => {
    const t = Date.now();
    const short = 'hi'; // floor: 3000ms
    const long = 'x'.repeat(100); // 100 × 60ms = 6000ms
    chat.handleMessage(makeMsg({
      messageType: MessageType.Say, position: { x: 0, y: 0, z: 7 }, text: short, timestamp: t,
    }));
    expect(chat.speechBubbles[0].expiresAt).toBe(t + 3000);
    chat.cleanupBubbles(t + 10000);

    chat.handleMessage(makeMsg({
      messageType: MessageType.Say, position: { x: 0, y: 0, z: 7 }, text: long, timestamp: t,
    }));
    expect(chat.speechBubbles[0].expiresAt).toBe(t + 6000);
    chat.cleanupBubbles(t + 10000);

    chat.handleMessage(makeMsg({
      messageType: MessageType.Yell, position: { x: 0, y: 0, z: 7 }, text: short, timestamp: t,
    }));
    expect(chat.speechBubbles[0].expiresAt).toBe(t + 6000);
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

describe('composeSpeech (classic on-screen format)', () => {
  function bubble(messageType: number, text = 'exura'): SpeechBubble {
    return { senderName: 'Gurz', text, messageType, x: 0, y: 0, z: 7, expiresAt: 0 };
  }

  it('players speak yellow with the says:/whispers:/yells: prefix', () => {
    expect(composeSpeech(bubble(MessageType.Say)))
      .toEqual({ text: 'Gurz says:\nexura', monster: false });
    expect(composeSpeech(bubble(MessageType.Whisper)))
      .toEqual({ text: 'Gurz whispers:\nexura', monster: false });
    expect(composeSpeech(bubble(MessageType.Yell)))
      .toEqual({ text: 'Gurz yells:\nexura', monster: false });
  });

  it('monsters get bare orange text, no prefix', () => {
    expect(composeSpeech(bubble(MessageType.MonsterSay, 'Grrr')))
      .toEqual({ text: 'Grrr', monster: true });
    expect(composeSpeech(bubble(MessageType.MonsterYell, 'GRAAR')))
      .toEqual({ text: 'GRAAR', monster: true });
  });

  it('stacked lines stay under one prefix', () => {
    expect(composeSpeech(bubble(MessageType.Say, 'exura\nexura vita')))
      .toEqual({ text: 'Gurz says:\nexura\nexura vita', monster: false });
  });
});
