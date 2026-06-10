// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { ChatManager } from '../lib/chat/ChatManager';
import { createChatUI } from '../lib/chat/ChatUI';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { MessageType } from '../lib/net/common/types';

function mountUi(manager: ChatManager): HTMLElement {
  const ui = createChatUI(manager, new GameProtocol(), vi.fn());
  document.body.appendChild(ui);
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

    expect(ui.querySelector('img')).toBeNull();
    expect(ui.querySelector('script')).toBeNull();
    expect(ui.querySelector('b')).toBeNull();
    expect(ui.querySelector('.sender')?.textContent).toContain('<img src=x');
    expect(ui.querySelector('.text')?.textContent).toContain('<b>bold</b>');
    document.body.replaceChildren();
  });
});
