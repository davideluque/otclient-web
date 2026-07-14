import type { ChatManager } from './ChatManager';
import type { GameProtocol } from '../net/common/types';
import { parseCommand, type SendPacketFn } from './ChatUI';

/**
 * Full-screen chat interface — the second consumer of the ChatManager
 * API (the compact bottom overlay is the first; speech bubbles the
 * third). All of them subscribe to the same manager, so history,
 * channels, and routing are shared: send from here, see it there.
 * Opened from the game menu; ✕ / backdrop-tap / Escape close.
 */

export interface FullChatViewHandle {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  destroy(): void;
}

const STYLE_ID = 'full-chat-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .full-chat {
      position: fixed; inset: 0; z-index: 60;
      display: none; align-items: stretch; justify-content: center;
      background: rgba(0,0,0,0.6);
      font-family: system-ui, sans-serif;
      padding: calc(10px + env(safe-area-inset-top, 0px)) 10px calc(10px + env(safe-area-inset-bottom, 0px));
    }
    .full-chat.open { display: flex; }
    .full-chat-card {
      width: min(96vw, 560px); display: flex; flex-direction: column;
      background: rgba(18,18,18,0.98); color: #e0e0e0;
      border: 1px solid #555; border-radius: 12px; overflow: hidden;
    }
    .full-chat-head {
      display: flex; align-items: center; gap: 4px;
      padding: 8px 10px; border-bottom: 1px solid #333;
    }
    .full-chat-tabs {
      display: flex; gap: 4px; overflow-x: auto; flex: 1; min-width: 0;
    }
    .full-chat-tabs button {
      background: #222; color: #aaa; border: 1px solid #444;
      border-radius: 6px; padding: 5px 12px; cursor: pointer;
      font-size: 0.8rem; white-space: nowrap;
    }
    .full-chat-tabs button.active { background: #3a3a3a; color: #fff; }
    .full-chat-close {
      background: none; border: none; color: #888;
      font-size: 1rem; padding: 4px 10px; cursor: pointer; flex-shrink: 0;
    }
    .full-chat-close:hover, .full-chat-close:active { color: #fff; }
    .full-chat-messages { flex: 1; overflow-y: auto; padding: 10px 12px; }
    .full-chat-messages .msg { margin: 3px 0; line-height: 1.45; font-size: 0.82rem; }
    .full-chat-messages .msg .timestamp { color: #555; font-size: 0.72rem; margin-right: 6px; }
    .full-chat-messages .msg .sender { color: #bdbdbd; font-weight: bold; }
    .full-chat-messages .msg .text { color: #e6e6e6; }
    .full-chat-input-row {
      display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #333;
    }
    .full-chat-input-row input {
      flex: 1; background: #111; color: #eee; border: 1px solid #444;
      border-radius: 6px; padding: 8px 10px;
      font-size: 16px; /* iOS focus auto-zoom floor */
      outline: none;
    }
    .full-chat-input-row input:focus { border-color: #9a9a9a; }
    .full-chat-input-row button {
      background: #2e2e2e; color: #fff; border: 1px solid #777;
      border-radius: 6px; padding: 8px 14px; cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

export function createFullChatView(
  chatManager: ChatManager,
  protocol: GameProtocol,
  sendPacket: SendPacketFn,
  parent: HTMLElement = document.body,
): FullChatViewHandle {
  ensureStyles();

  const el = document.createElement('div');
  el.className = 'full-chat';
  el.innerHTML = `
    <div class="full-chat-card">
      <div class="full-chat-head">
        <div class="full-chat-tabs"></div>
        <button class="full-chat-close" type="button" aria-label="Close chat">✕</button>
      </div>
      <div class="full-chat-messages"></div>
      <div class="full-chat-input-row">
        <input type="text" placeholder="Type a message..." autocomplete="off" />
        <button type="button">Send</button>
      </div>
    </div>
  `;
  parent.appendChild(el);

  const tabsEl = el.querySelector('.full-chat-tabs') as HTMLElement;
  const messagesEl = el.querySelector('.full-chat-messages') as HTMLElement;
  const inputEl = el.querySelector('.full-chat-input-row input') as HTMLInputElement;
  const sendBtn = el.querySelector('.full-chat-input-row button') as HTMLButtonElement;
  const closeBtn = el.querySelector('.full-chat-close') as HTMLButtonElement;

  const renderTabs = (): void => {
    tabsEl.replaceChildren();
    for (const channel of chatManager.channelList) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = channel.name;
      if (channel.id === chatManager.activeChannelId) btn.classList.add('active');
      btn.addEventListener('click', () => {
        chatManager.setActiveChannel(channel.id);
        renderTabs();
        renderMessages();
      });
      tabsEl.appendChild(btn);
    }
  };

  const renderMessages = (): void => {
    const channel = chatManager.activeChannel;
    if (!channel) return;
    messagesEl.replaceChildren();
    for (const msg of channel.messages) {
      const div = document.createElement('div');
      div.className = 'msg';
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // textContent only — sender/text are player-controlled (XSS).
      div.append(span('timestamp', time), span('sender', `${msg.senderName}: `), span('text', msg.text));
      messagesEl.appendChild(div);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const handleSend = (): void => {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    const packet = parseCommand(text, chatManager.activeChannelId, protocol);
    if (packet) sendPacket(packet);
  };
  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend();
  });

  const unsubscribe = chatManager.subscribe(() => {
    if (el.classList.contains('open')) renderMessages();
  });
  const unsubscribeChannels = chatManager.subscribeChannels(() => {
    if (!el.classList.contains('open')) return;
    renderTabs();
    renderMessages();
  });

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const open = (): void => {
    renderTabs();
    renderMessages();
    el.classList.add('open');
    document.addEventListener('keydown', onKeyDown);
  };
  const close = (): void => {
    el.classList.remove('open');
    document.removeEventListener('keydown', onKeyDown);
  };
  closeBtn.addEventListener('click', close);
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });

  return {
    el,
    open,
    close,
    destroy: () => {
      unsubscribe();
      unsubscribeChannels();
      document.removeEventListener('keydown', onKeyDown);
      el.remove();
    },
  };
}
