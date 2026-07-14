import type { ChatManager } from './ChatManager';
import { ChannelId, type GameProtocol } from '../net/common/types';
import { parseCommand, type SendPacketFn } from './ChatUI';
import { buildMessageRow } from './chatDom';
import { resolveNpcReplies } from './npcContext';
import {
  bindVisualViewport,
  isLandscapeLayout,
  keyboardOverlapHeight,
  readVisualViewport,
} from './viewportChat';

export interface EmergencySpellAction {
  id: string;
  label: string;
  onCast: () => void;
}

export interface QuickChatViewOptions {
  chatManager: ChatManager;
  protocol: GameProtocol;
  sendPacket: SendPacketFn;
  onClose: () => void;
  onExpand: () => void;
  /** Landscape keyboard-open strip — first few configured spells. */
  getEmergencySpells?: () => EmergencySpellAction[];
  parent?: HTMLElement;
}

export interface QuickChatViewHandle {
  readonly el: HTMLElement;
  render(): void;
  /**
   * Refresh tabs and messages for new chat traffic without touching the
   * scroll position (unless the user is already at the bottom) — render()
   * is for opening/mode changes and restores the saved channel scroll.
   */
  renderIncremental(): void;
  applyLayout(): void;
  focusInput(): void;
  destroy(): void;
}

const STYLE_ID = 'quick-chat-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .quick-chat {
      position: fixed; z-index: 25;
      display: none; flex-direction: column;
      background: rgba(12,12,12,0.96); color: #e0e0e0;
      border: 1px solid #444; font-family: system-ui, sans-serif;
      font-size: 0.78rem; touch-action: manipulation;
    }
    .quick-chat.open { display: flex; }
    .quick-chat.portrait {
      left: 0; right: 0;
      border-radius: 14px 14px 0 0;
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    .quick-chat.landscape {
      top: 0; bottom: 0;
      border-radius: 0 12px 12px 0;
      padding-left: env(safe-area-inset-left, 0px);
      width: 38vw; max-width: 420px; min-width: 240px;
    }
    .quick-chat-head {
      display: flex; align-items: center; gap: 4px;
      padding: 6px 8px; border-bottom: 1px solid #333; flex-shrink: 0;
      touch-action: none;
    }
    .quick-chat-drag { flex: 1; text-align: center; color: #666; font-size: 0.7rem; }
    .quick-chat-tabs {
      display: flex; gap: 2px; overflow-x: auto; flex: 1; min-width: 0;
    }
    .quick-chat-tabs button {
      background: #222; color: #aaa; border: 1px solid #444;
      border-radius: 6px; padding: 4px 10px; cursor: pointer;
      font-size: 0.72rem; white-space: nowrap; min-height: 32px;
    }
    .quick-chat-tabs button.active { background: #333; color: #fff; }
    .quick-chat-head-actions { display: flex; gap: 2px; flex-shrink: 0; }
    .quick-chat-head-actions button {
      width: 44px; height: 44px; min-width: 44px; min-height: 44px;
      background: none; border: none; color: #aaa; font-size: 1rem;
      cursor: pointer; border-radius: 8px;
    }
    .quick-chat-head-actions button:active { background: rgba(255,255,255,0.08); color: #fff; }
    .quick-chat-messages {
      flex: 1; overflow-y: auto; padding: 6px 10px; min-height: 0;
    }
    .quick-chat-messages .msg { margin: 2px 0; line-height: 1.4; }
    .quick-chat-messages .msg .sender { color: #9a9a9a; font-weight: bold; }
    .quick-chat-messages .msg .timestamp { color: #555; font-size: 0.68rem; margin-right: 4px; }
    .quick-chat-npc {
      display: none; flex-wrap: wrap; gap: 6px;
      padding: 6px 10px; border-top: 1px solid #333; flex-shrink: 0;
    }
    .quick-chat-npc.visible { display: flex; }
    .quick-chat-npc .npc-label {
      width: 100%; color: #9a9a9a; font-size: 0.68rem;
    }
    .quick-chat-npc button {
      background: #2a2a2a; color: #e0e0e0; border: 1px solid #555;
      border-radius: 16px; padding: 6px 12px; font-size: 0.78rem;
      min-height: 32px; cursor: pointer;
    }
    .quick-chat-input-row {
      display: flex; gap: 6px; padding: 6px 10px; flex-shrink: 0;
      border-top: 1px solid #333;
    }
    .quick-chat-input-row input {
      flex: 1; background: #111; color: #eee; border: 1px solid #444;
      border-radius: 6px; padding: 8px 10px; font-size: 16px; outline: none;
    }
    .quick-chat-input-row input:focus { border-color: #9a9a9a; }
    .quick-chat-input-row button {
      min-width: 44px; min-height: 44px;
      background: #2e2e2e; color: #fff; border: 1px solid #777;
      border-radius: 6px; padding: 0 14px; cursor: pointer;
    }
    .quick-chat-emergency {
      display: none; position: fixed; z-index: 26;
      right: calc(8px + env(safe-area-inset-right, 0px));
      bottom: calc(8px + env(safe-area-inset-bottom, 0px));
      gap: 6px; flex-direction: row;
    }
    .quick-chat-emergency.visible { display: flex; }
    .quick-chat-emergency button {
      width: 44px; height: 44px; border-radius: 50%;
      background: rgba(22,22,22,0.92); color: #e0e0e0;
      border: 2px solid #9a9a9a; font-size: 0.62rem;
      cursor: pointer; touch-action: manipulation;
    }
  `;
  document.head.appendChild(style);
}

export function createQuickChatView(opts: QuickChatViewOptions): QuickChatViewHandle {
  ensureStyles();
  const parent = opts.parent ?? document.body;

  const el = document.createElement('div');
  el.className = 'quick-chat';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Quick chat');

  const head = document.createElement('div');
  head.className = 'quick-chat-head';
  const dragHint = document.createElement('div');
  dragHint.className = 'quick-chat-drag';
  dragHint.textContent = '⌄';
  dragHint.setAttribute('aria-hidden', 'true');
  const tabsEl = document.createElement('div');
  tabsEl.className = 'quick-chat-tabs';
  const headActions = document.createElement('div');
  headActions.className = 'quick-chat-head-actions';
  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.setAttribute('aria-label', 'Expand to full chat');
  expandBtn.textContent = '⛶';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close chat');
  closeBtn.textContent = '✕';
  headActions.append(expandBtn, closeBtn);
  head.append(dragHint, tabsEl, headActions);

  const messagesEl = document.createElement('div');
  messagesEl.className = 'quick-chat-messages';

  const npcEl = document.createElement('div');
  npcEl.className = 'quick-chat-npc';

  const inputRow = document.createElement('div');
  inputRow.className = 'quick-chat-input-row';
  const inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.placeholder = 'Type a message…';
  inputEl.autocomplete = 'off';
  inputEl.setAttribute('aria-label', 'Chat message');
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.textContent = 'Send';
  sendBtn.setAttribute('aria-label', 'Send message');
  inputRow.append(inputEl, sendBtn);

  el.append(head, messagesEl, npcEl, inputRow);
  parent.appendChild(el);

  const emergencyEl = document.createElement('div');
  emergencyEl.className = 'quick-chat-emergency';
  parent.appendChild(emergencyEl);

  let inputFocused = false;
  let swipeStartY = 0;

  const renderTabs = (): void => {
    tabsEl.replaceChildren();
    for (const channel of opts.chatManager.channelList) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = channel.name;
      if (channel.id === opts.chatManager.activeChannelId) btn.classList.add('active');
      btn.addEventListener('click', () => {
        opts.chatManager.saveScrollPosition(
          quickScrollKey(opts.chatManager.activeChannelId),
          messagesEl.scrollTop,
        );
        opts.chatManager.setActiveChannel(channel.id);
        renderTabs();
        renderMessages(true);
      });
      tabsEl.appendChild(btn);
    }
  };

  const quickScrollKey = (channelId: number): string => `quick-${channelId}`;

  const renderMessages = (restoreChannelScroll = false): void => {
    const channel = opts.chatManager.activeChannel;
    if (!channel) return;
    const prevScroll = messagesEl.scrollTop;
    const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 24;
    messagesEl.replaceChildren();
    for (const msg of channel.messages) {
      messagesEl.appendChild(buildMessageRow(msg));
    }
    const key = quickScrollKey(opts.chatManager.activeChannelId);
    if (restoreChannelScroll) {
      const saved = opts.chatManager.getScrollPosition(key);
      messagesEl.scrollTop = saved > 0 ? saved : messagesEl.scrollHeight;
    } else if (atBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else {
      messagesEl.scrollTop = prevScroll;
    }
  };

  const renderNpc = (): void => {
    npcEl.replaceChildren();
    const ctx = opts.chatManager.npcContext;
    if (!ctx) {
      npcEl.classList.remove('visible');
      return;
    }
    npcEl.classList.add('visible');
    if (ctx.npcName) {
      const label = document.createElement('div');
      label.className = 'npc-label';
      label.textContent = ctx.npcName;
      npcEl.appendChild(label);
    }
    for (const reply of resolveNpcReplies(ctx)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = reply.label;
      chip.addEventListener('click', () => {
        const packet = parseCommand(reply.text, ChannelId.Default, opts.protocol);
        if (packet) opts.sendPacket(packet);
      });
      npcEl.appendChild(chip);
    }
  };

  const renderEmergency = (): void => {
    emergencyEl.replaceChildren();
    const show = inputFocused && isLandscapeLayout() && keyboardOverlapHeight() > 0;
    emergencyEl.classList.toggle('visible', show);
    if (!show || !opts.getEmergencySpells) return;
    for (const spell of opts.getEmergencySpells()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = spell.label;
      btn.textContent = spell.label.slice(0, 4);
      btn.addEventListener('click', () => spell.onCast());
      emergencyEl.appendChild(btn);
    }
  };

  const syncDraftFromManager = (): void => {
    if (document.activeElement !== inputEl) {
      inputEl.value = opts.chatManager.draft;
    }
  };

  const handleSend = (): void => {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    opts.chatManager.setDraft('');
    const packet = parseCommand(text, opts.chatManager.activeChannelId, opts.protocol);
    if (packet) opts.sendPacket(packet);
  };

  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend();
  });
  inputEl.addEventListener('input', () => {
    opts.chatManager.setDraft(inputEl.value);
  });
  inputEl.addEventListener('focus', () => {
    inputFocused = true;
    renderEmergency();
    applyLayout();
  });
  inputEl.addEventListener('blur', () => {
    inputFocused = false;
    renderEmergency();
    applyLayout();
  });

  closeBtn.addEventListener('click', () => {
    opts.chatManager.saveScrollPosition(
      quickScrollKey(opts.chatManager.activeChannelId),
      messagesEl.scrollTop,
    );
    opts.onClose();
  });
  expandBtn.addEventListener('click', () => {
    opts.chatManager.saveScrollPosition(
      quickScrollKey(opts.chatManager.activeChannelId),
      messagesEl.scrollTop,
    );
    opts.onExpand();
  });

  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    swipeStartY = e.clientY;
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointerup', (e) => {
    if (head.hasPointerCapture(e.pointerId)) {
      head.releasePointerCapture(e.pointerId);
    }
    if (e.clientY - swipeStartY > 48 && !isLandscapeLayout()) {
      opts.onClose();
    }
  });
  head.addEventListener('pointercancel', (e) => {
    if (head.hasPointerCapture(e.pointerId)) {
      head.releasePointerCapture(e.pointerId);
    }
  });

  const applyLayout = (): void => {
    const landscape = isLandscapeLayout();
    el.classList.toggle('portrait', !landscape);
    el.classList.toggle('landscape', landscape);
    dragHint.style.display = landscape ? 'none' : '';

    const vp = readVisualViewport();
    const kb = keyboardOverlapHeight();

    if (landscape) {
      el.style.top = `${vp.offsetTop}px`;
      el.style.left = `${vp.offsetLeft}px`;
      el.style.height = `${vp.height}px`;
      el.style.bottom = 'auto';
      el.style.width = '';
      if (kb > 0) {
        messagesEl.style.maxHeight = `${Math.max(80, vp.height * 0.35)}px`;
      } else {
        messagesEl.style.maxHeight = '';
      }
    } else {
      el.style.left = `${vp.offsetLeft}px`;
      el.style.width = `${vp.width}px`;
      const sheetFraction = kb > 0 ? 0.28 : 0.33;
      const sheetHeight = Math.round(vp.height * sheetFraction);
      el.style.height = `${sheetHeight}px`;
      el.style.bottom = `${Math.max(0, kb)}px`;
      el.style.top = 'auto';
      messagesEl.style.maxHeight = '';
    }
    renderEmergency();
  };

  const render = (): void => {
    syncDraftFromManager();
    renderTabs();
    renderMessages(true);
    renderNpc();
    applyLayout();
  };

  const renderIncremental = (): void => {
    syncDraftFromManager();
    renderTabs();
    renderMessages(false);
  };

  const unsubViewport = bindVisualViewport(applyLayout);

  return {
    el,
    render,
    renderIncremental,
    applyLayout,
    focusInput: () => inputEl.focus(),
    destroy: () => {
      unsubViewport();
      el.remove();
      emergencyEl.remove();
    },
  };
}
