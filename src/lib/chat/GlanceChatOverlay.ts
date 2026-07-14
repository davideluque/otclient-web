import type { ChatManager } from './ChatManager';
import { buildMessageRow, isPersistentGlanceMessage } from './chatDom';

export interface GlanceChatOverlayHandle {
  readonly el: HTMLElement;
  readonly buttonEl: HTMLButtonElement;
  render(): void;
  destroy(): void;
}

const STYLE_ID = 'glance-chat-style';
const GLANCE_MAX = 3;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .chat-glance-stack {
      position: fixed; z-index: 19; pointer-events: auto;
      display: flex; flex-direction: column; gap: 3px;
      max-width: min(58vw, 280px);
      font-family: system-ui, sans-serif; font-size: 0.72rem;
      user-select: none;
    }
    @media (orientation: portrait) {
      .chat-glance-stack {
        left: calc(8px + env(safe-area-inset-left, 0px));
        bottom: calc(148px + env(safe-area-inset-bottom, 0px));
      }
    }
    @media (orientation: landscape) {
      .chat-glance-stack {
        left: calc(8px + env(safe-area-inset-left, 0px));
        top: calc(52px + env(safe-area-inset-top, 0px));
        bottom: auto;
      }
    }
    .chat-glance-msg {
      background: rgba(0,0,0,0.55); color: #e8e8e8;
      border-radius: 8px; padding: 4px 8px; line-height: 1.35;
      pointer-events: auto; cursor: pointer;
      backdrop-filter: blur(4px);
    }
    .chat-glance-msg .sender { color: #bdbdbd; font-weight: 600; }
    .chat-glance-msg .timestamp { color: #666; font-size: 0.65rem; margin-right: 4px; }
    .chat-glance-msg.faded { opacity: 0.45; }
    .chat-glance-msg.persistent { opacity: 0.92; }
    .chat-open-btn {
      position: fixed; z-index: 19;
      width: 44px; height: 44px; min-width: 44px; min-height: 44px;
      border-radius: 10px; border: 1px solid #777;
      background: rgba(22,22,22,0.88); color: #e0e0e0;
      font-size: 1.1rem; cursor: pointer; touch-action: manipulation;
    }
    @media (orientation: portrait) {
      .chat-open-btn {
        left: calc(8px + env(safe-area-inset-left, 0px));
        bottom: calc(96px + env(safe-area-inset-bottom, 0px));
      }
    }
    @media (orientation: landscape) {
      .chat-open-btn {
        left: calc(8px + env(safe-area-inset-left, 0px));
        bottom: calc(8px + env(safe-area-inset-bottom, 0px));
      }
    }
    .chat-open-btn .badge {
      position: absolute; top: -4px; right: -4px;
      min-width: 18px; height: 18px; padding: 0 4px;
      border-radius: 9px; background: #d9534f; color: #fff;
      font-size: 0.65rem; font-weight: 700; line-height: 18px;
      text-align: center; display: none;
    }
    .chat-open-btn.has-unread .badge { display: block; }
  `;
  document.head.appendChild(style);
}

export interface GlanceChatOverlayOptions {
  chatManager: ChatManager;
  onOpenQuick: () => void;
  parent?: HTMLElement;
}

export function createGlanceChatOverlay(opts: GlanceChatOverlayOptions): GlanceChatOverlayHandle {
  ensureStyles();
  const parent = opts.parent ?? document.body;

  const stack = document.createElement('div');
  stack.className = 'chat-glance-stack';
  stack.setAttribute('role', 'log');
  stack.setAttribute('aria-label', 'Recent chat messages');
  parent.appendChild(stack);

  const buttonEl = document.createElement('button');
  buttonEl.type = 'button';
  buttonEl.className = 'chat-open-btn';
  buttonEl.setAttribute('aria-label', 'Open chat');
  buttonEl.innerHTML = '💬<span class="badge" aria-hidden="true"></span>';
  parent.appendChild(buttonEl);

  const badgeEl = buttonEl.querySelector('.badge') as HTMLElement;

  const openQuick = (): void => opts.onOpenQuick();
  stack.addEventListener('click', openQuick);
  buttonEl.addEventListener('click', openQuick);

  const render = (): void => {
    const channel = opts.chatManager.activeChannel;
    stack.replaceChildren();
    if (!channel) return;

    const recent = channel.messages.slice(-GLANCE_MAX);
    recent.forEach((msg, i) => {
      const row = buildMessageRow(msg, 'chat-glance-msg');
      const age = recent.length - 1 - i;
      if (isPersistentGlanceMessage(msg)) {
        row.classList.add('persistent');
      } else if (age >= 1) {
        row.classList.add('faded');
      }
      stack.appendChild(row);
    });

    const unread = opts.chatManager.unreadCount;
    badgeEl.textContent = unread > 99 ? '99+' : String(unread);
    buttonEl.classList.toggle('has-unread', unread > 0);
  };

  return {
    el: stack,
    buttonEl,
    render,
    destroy: () => {
      stack.remove();
      buttonEl.remove();
    },
  };
}
