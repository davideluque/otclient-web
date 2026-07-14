// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatManager } from '../lib/chat/ChatManager';
import { createChatPresentation } from '../lib/chat/ChatPresentation';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { ChannelId, MessageType } from '../lib/net/common/types';
import { keyboardOverlapHeight, isLandscapeLayout, readVisualViewport } from '../lib/chat/viewportChat';
import { resolveNpcReplies, DEFAULT_NPC_REPLIES } from '../lib/chat/npcContext';

afterEach(() => document.body.replaceChildren());

function mountPresentation(manager = new ChatManager()) {
  const sent: unknown[] = [];
  const presentation = createChatPresentation({
    chatManager: manager,
    protocol: new GameProtocol(),
    sendPacket: (p) => sent.push(p),
    getEmergencySpells: () => [
      { id: 'exura', label: 'Light Healing', onCast: vi.fn() },
    ],
  });
  return { presentation, manager, sent };
}

describe('createChatPresentation', () => {
  it('starts in glance mode with chat button and no quick panel', () => {
    const { presentation } = mountPresentation();
    expect(presentation.mode).toBe('glance');
    expect(document.querySelector('.chat-open-btn')).not.toBeNull();
    expect(document.querySelector('.quick-chat.open')).toBeNull();
    presentation.destroy();
  });

  it('transitions glance → quick → full → back to quick', () => {
    const { presentation } = mountPresentation();
    presentation.openQuick();
    expect(presentation.mode).toBe('quick');
    expect(document.querySelector('.quick-chat.open')).not.toBeNull();

    presentation.openFull();
    expect(document.querySelector('.full-chat.open')).not.toBeNull();

    (document.querySelector('.full-chat-close') as HTMLButtonElement).click();
    expect(presentation.mode).toBe('quick');
    expect(document.querySelector('.quick-chat.open')).not.toBeNull();
    presentation.destroy();
  });

  it('closing full from glance returns to glance', () => {
    const { presentation } = mountPresentation();
    presentation.openFull();
    (document.querySelector('.full-chat-close') as HTMLButtonElement).click();
    expect(presentation.mode).toBe('glance');
    presentation.destroy();
  });

  it('tracks unread in glance and clears on openQuick', () => {
    const { presentation, manager } = mountPresentation();
    manager.handleMessage({
      senderName: 'A', messageType: MessageType.Say, text: 'hi', timestamp: 1,
    });
    expect(manager.unreadCount).toBe(1);
    expect(document.querySelector('.chat-open-btn')!.classList.contains('has-unread')).toBe(true);

    presentation.openQuick();
    expect(manager.unreadCount).toBe(0);
    presentation.destroy();
  });

  it('shares history and active channel across modes', () => {
    const { presentation, manager } = mountPresentation();
    manager.setActiveChannel(5);
    manager.handleMessage({
      senderName: 'Bob', messageType: MessageType.Channel, channelId: 5,
      text: 'shared', timestamp: 1,
    });

    presentation.openQuick();
    expect(document.querySelector('.quick-chat-messages')!.textContent).toContain('shared');
    expect([...document.querySelectorAll('.quick-chat-tabs button')]
      .find((b) => b.classList.contains('active'))!.textContent).toBe('Trade');

    presentation.openFull();
    expect(document.querySelector('.full-chat-messages')!.textContent).toContain('shared');
    presentation.destroy();
  });

  it('preserves draft across state changes', () => {
    const { presentation, manager } = mountPresentation();
    presentation.openQuick();
    const input = document.querySelector('.quick-chat-input-row input') as HTMLInputElement;
    input.value = 'unsent draft';
    input.dispatchEvent(new Event('input'));
    expect(manager.draft).toBe('unsent draft');

    presentation.setMode('glance');
    presentation.openQuick();
    expect((document.querySelector('.quick-chat-input-row input') as HTMLInputElement).value)
      .toBe('unsent draft');
    presentation.destroy();
  });

  it('quick-reply chips send through normal chat protocol', () => {
    const { presentation, manager, sent } = mountPresentation();
    presentation.setNpcContext({ npcName: 'Tom', replies: [{ label: 'hi', text: 'hi' }] });
    presentation.openQuick();

    const chip = [...document.querySelectorAll('.quick-chat-npc button')]
      .find((b) => b.textContent === 'hi') as HTMLButtonElement;
    chip.click();
    expect(sent).toHaveLength(1);
    expect((sent[0] as { toUint8Array(): Uint8Array }).toUint8Array()[0]).toBe(0x96);
    expect(manager.npcContext?.npcName).toBe('Tom');
    presentation.destroy();
  });

  it('NPC quick-replies use say path even when another tab is active', () => {
    const { presentation, manager, sent } = mountPresentation();
    manager.setActiveChannel(ChannelId.Trade);
    presentation.setNpcContext({ npcName: 'Tom', replies: [{ label: 'hi', text: 'hi' }] });
    presentation.openQuick();

    const chip = [...document.querySelectorAll('.quick-chat-npc button')]
      .find((b) => b.textContent === 'hi') as HTMLButtonElement;
    chip.click();
    expect(sent).toHaveLength(1);
    expect((sent[0] as { toUint8Array(): Uint8Array }).toUint8Array()[0]).toBe(0x96);
    presentation.destroy();
  });

  it('renders hostile sender names as text in quick chat', () => {
    const { presentation, manager } = mountPresentation();
    manager.handleMessage({
      senderName: '<img src=x onerror=alert(1)>',
      messageType: MessageType.Say,
      text: '<b>x</b>',
      timestamp: 1,
    });
    presentation.openQuick();
    expect(document.querySelector('.quick-chat-messages img')).toBeNull();
    expect(document.querySelector('.quick-chat-messages b')).toBeNull();
    presentation.destroy();
  });

  it('keeps scroll position when a message arrives while scrolled up', () => {
    const { presentation, manager } = mountPresentation();
    for (let i = 0; i < 30; i++) {
      manager.handleMessage({
        senderName: 'A', messageType: MessageType.Say, text: `line ${i}`, timestamp: i,
      });
    }
    presentation.openQuick();

    // happy-dom has no layout, so fake a scrollable pane the user has
    // scrolled up in (700px above the bottom — well past the 24px snap).
    const messagesEl = document.querySelector('.quick-chat-messages') as HTMLElement;
    Object.defineProperty(messagesEl, 'scrollHeight', { get: () => 1000, configurable: true });
    Object.defineProperty(messagesEl, 'clientHeight', { get: () => 100, configurable: true });
    let scrollTop = 200;
    Object.defineProperty(messagesEl, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => { scrollTop = v; },
      configurable: true,
    });

    manager.handleMessage({
      senderName: 'B', messageType: MessageType.Say, text: 'new while reading', timestamp: 99,
    });
    expect(messagesEl.textContent).toContain('new while reading');
    expect(scrollTop).toBe(200);
    presentation.destroy();
  });

  it('typing in the quick input does not rebuild the message list', () => {
    const { presentation, manager } = mountPresentation();
    manager.handleMessage({
      senderName: 'A', messageType: MessageType.Say, text: 'hello', timestamp: 1,
    });
    presentation.openQuick();

    const messagesEl = document.querySelector('.quick-chat-messages') as HTMLElement;
    const firstRow = messagesEl.firstElementChild;
    expect(firstRow).not.toBeNull();

    const input = document.querySelector('.quick-chat-input-row input') as HTMLInputElement;
    input.focus();
    input.value = 'draft text';
    input.dispatchEvent(new Event('input'));

    expect(messagesEl.firstElementChild).toBe(firstRow);
    presentation.destroy();
  });

  it('cleans up DOM and listeners on destroy', () => {
    const { presentation } = mountPresentation();
    presentation.openQuick();
    presentation.destroy();
    expect(document.querySelector('.chat-open-btn')).toBeNull();
    expect(document.querySelector('.quick-chat')).toBeNull();
    expect(document.querySelector('.full-chat')).toBeNull();
  });
});

describe('viewportChat helpers', () => {
  it('readVisualViewport falls back to window dimensions', () => {
    const vp = readVisualViewport();
    expect(vp.width).toBeGreaterThan(0);
    expect(vp.height).toBeGreaterThan(0);
  });

  it('keyboardOverlapHeight is zero without visualViewport shrink', () => {
    expect(keyboardOverlapHeight()).toBe(0);
  });

  it('isLandscapeLayout reflects width vs height', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400);
    expect(isLandscapeLayout()).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('npcContext', () => {
  it('provides default replies and merges purchase choices', () => {
    expect(resolveNpcReplies({}).map((r) => r.label))
      .toEqual(DEFAULT_NPC_REPLIES.map((r) => r.label));
    const merged = resolveNpcReplies({
      purchaseChoices: [{ label: 'sword', text: 'buy sword' }],
    });
    expect(merged.some((r) => r.text === 'buy sword')).toBe(true);
  });
});

describe('ChatManager presentation state', () => {
  let manager: ChatManager;
  beforeEach(() => { manager = new ChatManager(); });

  it('bumps unread only in glance mode', () => {
    manager.handleMessage({
      senderName: 'x', messageType: MessageType.Say, text: 'a', timestamp: 1,
    });
    expect(manager.unreadCount).toBe(1);
    manager.setPresentationMode('quick');
    manager.handleMessage({
      senderName: 'x', messageType: MessageType.Say, text: 'b', timestamp: 2,
    });
    expect(manager.unreadCount).toBe(0);
  });
});
