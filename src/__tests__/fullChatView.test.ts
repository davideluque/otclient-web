// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFullChatView } from '../lib/chat/FullChatView';
import { ChatManager } from '../lib/chat/ChatManager';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { MessageType } from '../lib/net/common/types';

afterEach(() => document.body.replaceChildren());

describe('createFullChatView', () => {
  it('shares history with the manager and renders incoming messages while open', () => {
    const manager = new ChatManager();
    manager.handleMessage({ senderName: 'Early', messageType: MessageType.Say, text: 'before open', timestamp: 1 });
    const view = createFullChatView(manager, new GameProtocol(), vi.fn(), document.body, {});

    view.open();
    const messages = document.querySelector('.full-chat-messages')!;
    expect(messages.textContent).toContain('before open'); // shared history

    manager.handleMessage({ senderName: 'Live', messageType: MessageType.Say, text: 'while open', timestamp: 2 });
    expect(messages.textContent).toContain('while open');
    view.destroy();
  });

  it('renders hostile content as text, sends through parseCommand, closes via ✕/backdrop/Escape', () => {
    const manager = new ChatManager();
    const sent: number[] = [];
    const onClose = vi.fn();
    const view = createFullChatView(manager, new GameProtocol(), (p) => sent.push(p.toUint8Array()[0]), document.body, { onClose });
    view.open();

    manager.handleMessage({
      senderName: '<img src=x onerror=alert(1)>', messageType: MessageType.Say,
      text: '<b>bold?</b>', timestamp: 3,
    });
    expect(document.querySelector('.full-chat-messages img')).toBeNull();
    expect(document.querySelector('.full-chat-messages b')).toBeNull();

    const input = document.querySelector('.full-chat-input-row input') as HTMLInputElement;
    input.value = 'hello from full view';
    (document.querySelector('.full-chat-input-row button') as HTMLButtonElement).click();
    expect(sent).toEqual([0x96]); // Say

    const el = document.querySelector('.full-chat') as HTMLElement;
    (document.querySelector('.full-chat-close') as HTMLButtonElement).click();
    expect(el.classList.contains('open')).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    view.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(el.classList.contains('open')).toBe(false);
    view.destroy();
    expect(document.querySelector('.full-chat')).toBeNull();
  });
});
