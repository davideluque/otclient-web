import type { ChatManager } from './ChatManager';
import type { GameProtocol } from '../net/common/types';
import { ChannelId } from '../net/common/types';
import type { OutputPacket } from '../net/common/OutputPacket';

export type SendPacketFn = (packet: OutputPacket) => void;

/**
 * Creates the chat UI DOM elements and wires them to the ChatManager.
 * Returns the root element to append to the document.
 */
export interface ChatUIOptions {
  /**
   * Renders a ✕ button at the right of the tab strip and invokes this
   * when it's pressed. The host owns what "close" means (the jamera
   * binding hides the panel; menu → Chat reopens); without the option
   * the button isn't rendered.
   */
  onClose?: () => void;
}

export interface ChatUIHandle {
  readonly el: HTMLElement;
  destroy(): void;
}

export function createChatUI(
  chatManager: ChatManager,
  protocol: GameProtocol,
  sendPacket: SendPacketFn,
  opts: ChatUIOptions = {},
): ChatUIHandle {
  const root = document.createElement('div');
  root.id = 'chat-ui';
  root.innerHTML = `
    <div class="chat-tabs-row">
      <div class="chat-tabs" id="chat-tabs"></div>
      <button class="chat-close" title="Close chat" aria-label="Close chat">✕</button>
    </div>
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
      display: flex; flex-direction: column;
      z-index: 20; border-top: 1px solid #333;
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    .chat-tabs-row {
      display: flex; align-items: center;
      border-bottom: 1px solid #333; flex-shrink: 0;
    }
    .chat-tabs {
      display: flex; gap: 2px; padding: 4px 8px; overflow-x: auto;
      flex: 1; min-width: 0;
    }
    .chat-tabs button {
      background: #222; color: #aaa; border: 1px solid #444;
      border-radius: 4px 4px 0 0; padding: 4px 12px; cursor: pointer;
      font-size: 0.75rem; white-space: nowrap;
    }
    .chat-tabs button.active { background: #333; color: #fff; border-bottom-color: #333; }
    .chat-tabs button.unread { color: #9a9a9a; }
    .chat-close {
      background: none; border: none; color: #888;
      font-size: 0.95rem; padding: 4px 12px; cursor: pointer;
      flex-shrink: 0;
    }
    .chat-close:hover, .chat-close:active { color: #fff; }
    /* Fixed compact height — roughly four message lines. The panel must
       not grow/shrink with whichever channel happens to be active; on a
       phone a content-driven height makes the whole panel jump on every
       tab switch and bury the joystick when a channel is busy. */
    .chat-messages {
      height: 6.5em; flex: none; overflow-y: auto; padding: 6px 8px;
    }
    .chat-messages .msg { margin: 2px 0; line-height: 1.4; }
    .chat-messages .msg .sender { color: #9a9a9a; font-weight: bold; }
    .chat-messages .msg .text { color: #ddd; }
    .chat-messages .msg .timestamp { color: #555; font-size: 0.7rem; margin-right: 4px; }
    .chat-input-row {
      display: flex; padding: 4px 8px; gap: 4px; flex-shrink: 0;
    }
    #chat-input {
      flex: 1; background: #111; color: #eee; border: 1px solid #444;
      border-radius: 4px; padding: 6px 8px;
      /* 16px minimum: iOS pinch-zooms the page on focusing any smaller
         input and stays zoomed — same bug as the login form. */
      font-size: 16px;
      outline: none;
    }
    #chat-input:focus { border-color: #9a9a9a; }
    #chat-send {
      background: #2e2e2e; color: #fff; border: 1px solid #777;
      border-radius: 4px; padding: 6px 12px; cursor: pointer;
      font-size: 0.85rem;
    }
  `;
  root.prepend(style);

  const tabsEl = root.querySelector('#chat-tabs') as HTMLElement;
  const messagesEl = root.querySelector('#chat-messages') as HTMLElement;
  const inputEl = root.querySelector('#chat-input') as HTMLInputElement;
  const sendBtn = root.querySelector('#chat-send') as HTMLButtonElement;
  const closeBtn = root.querySelector('.chat-close') as HTMLButtonElement;

  if (opts.onClose) {
    closeBtn.addEventListener('click', opts.onClose);
  } else {
    closeBtn.style.display = 'none';
  }

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

    messagesEl.replaceChildren();
    for (const msg of channel.messages) {
      const div = document.createElement('div');
      div.className = 'msg';
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Built with textContent, never innerHTML: senderName and text are
      // server/player-controlled, so any HTML interpolation here is a DOM
      // XSS sink (a player named `<img onerror=…>` would execute).
      div.append(
        makeSpan('timestamp', time),
        makeSpan('sender', `${msg.senderName}: `),
        makeSpan('text', msg.text),
      );
      messagesEl.appendChild(div);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function handleSend() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';

    const packet = parseCommand(text, chatManager.activeChannelId, protocol);
    if (packet) sendPacket(packet);
  }

  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend();
  });

  // Re-render when messages arrive; channel open/close packets refresh tabs.
  const unsubscribeMessages = chatManager.subscribe(() => renderMessages());
  const unsubscribeChannels = chatManager.subscribeChannels(() => {
    renderTabs();
    renderMessages();
  });

  renderTabs();
  renderMessages();

  return {
    el: root,
    destroy: () => {
      unsubscribeMessages();
      unsubscribeChannels();
      root.remove();
    },
  };
}

/**
 * Parse chat commands:
 * - /w Name msg → private message to Name
 * - /whisper Name msg → private message to Name (alias for /w)
 * - /whisper msg (single word) → local whisper speech
 * - /yell msg → yell speech
 *
 * Ambiguity note: `/whisper Name msg` is treated as private — preserving the
 * "/whisper Name msg" command contract — so a multi-word local whisper must
 * be sent without the `/whisper` prefix.
 *
 * Unknown commands: any input starting with `/` that doesn't match a known
 * command above returns null (silent no-op). This prevents typo-driven
 * privacy leaks — e.g. `/wAlice secret` (missing space) or `/pm Bob secret`
 * would otherwise fall through to the public Say/channel branch.
 *
 * Leading whitespace is stripped before any prefix matching so callers can't
 * accidentally bypass the slash-command guards by passing `"  /w Alice hi"`
 * — `String.prototype.trimStart` covers Unicode whitespace per the spec.
 */
export function parseCommand(
  text: string,
  activeChannelId: number,
  protocol: GameProtocol,
): OutputPacket | null {
  text = text.trimStart();

  if (text.startsWith('/w ')) {
    return parsePrivateOrNull(text.slice(3), protocol);
  }

  if (text.startsWith('/whisper ')) {
    const whisperText = text.slice(9).trimStart();
    const privateMessage = parseRecipientAndMessage(whisperText);
    if (privateMessage) {
      return protocol.chat.buildPrivateMessage(privateMessage.recipientName, privateMessage.message);
    }
    return protocol.chat.buildWhisper(whisperText);
  }

  if (text.startsWith('/yell ')) {
    return protocol.chat.buildYell(text.slice(6));
  }

  // Any other slash input is an unrecognised command — drop it rather than
  // leak intended-private text to the public channel.
  if (text.startsWith('/')) {
    return null;
  }

  if (activeChannelId === ChannelId.Default) {
    return protocol.chat.buildSay(text);
  }
  return protocol.chat.buildChannelMessage(activeChannelId, text);
}

function parsePrivateOrNull(rest: string, protocol: GameProtocol): OutputPacket | null {
  const privateMessage = parseRecipientAndMessage(rest);
  if (!privateMessage) return null;
  return protocol.chat.buildPrivateMessage(privateMessage.recipientName, privateMessage.message);
}

function parseRecipientAndMessage(text: string): { recipientName: string; message: string } | null {
  const match = text.trimStart().match(/^(\S+)\s+(.+)$/);
  if (!match) return null;
  return { recipientName: match[1], message: match[2] };
}

function makeSpan(className: string, text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}
