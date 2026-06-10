// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { ChatManager } from '../lib/chat/ChatManager';
import { createChatUI } from '../lib/chat/ChatUI';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { MessageType } from '../lib/net/common/types';

function mountUi(manager: ChatManager): ReturnType<typeof createChatUI> {
  const ui = createChatUI(manager, new GameProtocol(), vi.fn());
  document.body.appendChild(ui.el);
  return ui;
}

describe('createChatUI message rendering', () => {
  it('renders attacker-controlled sender names and text as text, never HTML', () => {
    const manager = new ChatManager();
    const ui = mountUi(manager);

    // Sender names and message text both arrive from the server/other
    // players — a payload like this must never become live DOM.
    manager.handleMessage({
      senderName: '<img src=x onerror="document.title=\'pwned\'">',
      text: '<b>bold</b><script>document.title="pwned"</script>',
      messageType: MessageType.Say,
      timestamp: 0,
    });

    expect(ui.el.querySelector('img')).toBeNull();
    expect(ui.el.querySelector('script')).toBeNull();
    expect(ui.el.querySelector('b')).toBeNull();
    expect(ui.el.querySelector('.sender')?.textContent).toContain('<img src=x');
    expect(ui.el.querySelector('.text')?.textContent).toContain('<b>bold</b>');
    document.body.replaceChildren();
  });
});

describe('ChatManager.subscribe (the chat API)', () => {
  it('notifies every subscriber per message and unsubscribes cleanly', async () => {
    const { ChatManager } = await import('../lib/chat/ChatManager');
    const { MessageType } = await import('../lib/net/common/types');
    const manager = new ChatManager();
    const seen: string[] = [];
    const unsubA = manager.subscribe((m) => seen.push(`A:${m.text}`));
    manager.subscribe((m) => seen.push(`B:${m.text}`));

    manager.handleMessage({ senderName: 'x', messageType: MessageType.Say, text: 'one', timestamp: 1 });
    expect(seen).toEqual(['A:one', 'B:one']);

    unsubA();
    manager.handleMessage({ senderName: 'x', messageType: MessageType.Say, text: 'two', timestamp: 2 });
    expect(seen).toEqual(['A:one', 'B:one', 'B:two']);
  });
});
