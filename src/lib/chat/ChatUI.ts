import type { ChatManager } from './ChatManager';
import {
  buildSayPacket,
  buildChannelMessagePacket,
  buildPrivateMessagePacket,
  buildWhisperPacket,
  buildYellPacket,
} from '../net/7.6/chatProtocol';
import type { OutputPacket } from '../net/common/OutputPacket';

export type SendPacketFn = (packet: OutputPacket) => void;

/**
 * Creates the chat UI DOM elements and wires them to the ChatManager.
 * Returns the root element to append to the document.
 */
export function createChatUI(
  chatManager: ChatManager,
  sendPacket: SendPacketFn,
): HTMLElement {
  const root = document.createElement('div');
  root.id = 'chat-ui';
  root.innerHTML = `
    <div class="chat-tabs" id="chat-tabs"></div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-row">
      <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off" />
      <button id="chat-send">Send</button>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #chat-ui {
      position: fixed; bottom: 0; left: 0; right: 0;
      background: rgba(0, 0, 0, 0.85); color: #e0e0e0;
      font-family: system-ui, sans-serif; font-size: 0.8rem;
      max-height: 40vh; display: flex; flex-direction: column;
      z-index: 20; border-top: 1px solid #333;
    }
    .chat-tabs {
      display: flex; gap: 2px; padding: 4px 8px; overflow-x: auto;
      border-bottom: 1px solid #333; flex-shrink: 0;
    }
    .chat-tabs button {
      background: #222; color: #aaa; border: 1px solid #444;
      border-radius: 4px 4px 0 0; padding: 4px 12px; cursor: pointer;
      font-size: 0.75rem; white-space: nowrap;
    }
    .chat-tabs button.active { background: #333; color: #fff; border-bottom-color: #333; }
    .chat-tabs button.unread { color: #7c5cbf; }
    .chat-messages {
      flex: 1; overflow-y: auto; padding: 8px;
      min-height: 80px; max-height: 30vh;
    }
    .chat-messages .msg { margin: 2px 0; line-height: 1.4; }
    .chat-messages .msg .sender { color: #7c5cbf; font-weight: bold; }
    .chat-messages .msg .text { color: #ddd; }
    .chat-messages .msg .timestamp { color: #555; font-size: 0.7rem; margin-right: 4px; }
    .chat-input-row {
      display: flex; padding: 4px 8px; gap: 4px; flex-shrink: 0;
    }
    #chat-input {
      flex: 1; background: #111; color: #eee; border: 1px solid #444;
      border-radius: 4px; padding: 6px 8px; font-size: 0.85rem;
      outline: none;
    }
    #chat-input:focus { border-color: #7c5cbf; }
    #chat-send {
      background: #7c5cbf; color: #fff; border: none;
      border-radius: 4px; padding: 6px 12px; cursor: pointer;
      font-size: 0.85rem;
    }
  `;
  root.prepend(style);

  const tabsEl = root.querySelector('#chat-tabs') as HTMLElement;
  const messagesEl = root.querySelector('#chat-messages') as HTMLElement;
  const inputEl = root.querySelector('#chat-input') as HTMLInputElement;
  const sendBtn = root.querySelector('#chat-send') as HTMLButtonElement;

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const channel of chatManager.channelList) {
      const btn = document.createElement('button');
      btn.textContent = channel.name;
      if (channel.id === chatManager.activeChannelId) btn.classList.add('active');
      btn.addEventListener('click', () => {
        chatManager.setActiveChannel(channel.id);
        renderTabs();
        renderMessages();
      });
      tabsEl.appendChild(btn);
    }
  }

  function renderMessages() {
    const channel = chatManager.activeChannel;
    if (!channel) return;

    messagesEl.innerHTML = '';
    for (const msg of channel.messages) {
      const div = document.createElement('div');
      div.className = 'msg';
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      div.innerHTML = `<span class="timestamp">${time}</span><span class="sender">${msg.senderName}: </span><span class="text">${escapeHtml(msg.text)}</span>`;
      messagesEl.appendChild(div);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function handleSend() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';

    const packet = parseCommand(text, chatManager.activeChannelId);
    if (packet) sendPacket(packet);
  }

  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend();
  });

  // Re-render when messages arrive
  const origHandle = chatManager.handleMessage.bind(chatManager);
  chatManager.handleMessage = (msg) => {
    origHandle(msg);
    renderMessages();
  };

  renderTabs();
  renderMessages();

  return root;
}

/**
 * Parse chat commands: /w name msg, /whisper name msg, /yell msg
 */
function parseCommand(text: string, activeChannelId: number): OutputPacket | null {
  if (text.startsWith('/w ') || text.startsWith('/whisper ')) {
    const parts = text.replace(/^\/(w|whisper)\s+/, '').split(' ');
    const name = parts[0];
    const msg = parts.slice(1).join(' ');
    if (name && msg) return buildPrivateMessagePacket(name, msg);
    return null;
  }

  if (text.startsWith('/yell ')) {
    return buildYellPacket(text.slice(6));
  }

  if (text.startsWith('/whisper ')) {
    return buildWhisperPacket(text.slice(9));
  }

  // Default: send to active channel or as Say
  if (activeChannelId === 0) {
    return buildSayPacket(text);
  }
  return buildChannelMessagePacket(activeChannelId, text);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
