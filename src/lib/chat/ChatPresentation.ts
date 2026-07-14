import type { ChatManager, ChatPresentationMode } from './ChatManager';
import type { GameProtocol } from '../net/common/types';
import type { NpcChatContext } from './npcContext';
import { createGlanceChatOverlay } from './GlanceChatOverlay';
import { createQuickChatView, type EmergencySpellAction } from './QuickChatView';
import { createFullChatView, type FullChatViewHandle } from './FullChatView';
import type { SendPacketFn } from './ChatUI';

export interface ChatPresentationOptions {
  chatManager: ChatManager;
  protocol: GameProtocol;
  sendPacket: SendPacketFn;
  getEmergencySpells?: () => EmergencySpellAction[];
  parent?: HTMLElement;
}

export interface ChatPresentationHandle {
  readonly manager: ChatManager;
  readonly fullView: FullChatViewHandle;
  readonly mode: ChatPresentationMode;
  setMode(mode: ChatPresentationMode): void;
  openQuick(): void;
  openFull(): void;
  setNpcContext(ctx: NpcChatContext | null): void;
  destroy(): void;
}

export function createChatPresentation(opts: ChatPresentationOptions): ChatPresentationHandle {
  const { chatManager, protocol, sendPacket } = opts;
  let modeBeforeFull: ChatPresentationMode = 'glance';
  let quickWasOpen = false;

  const applyVisibility = (): void => {
    const mode = chatManager.presentationMode;
    glance.render();
    glance.el.style.display = mode === 'glance' ? '' : 'none';
    glance.buttonEl.style.display = mode === 'glance' ? '' : 'none';
    quick.el.classList.toggle('open', mode === 'quick');
    if (mode === 'quick') quick.render();
  };

  const setMode = (mode: ChatPresentationMode): void => {
    chatManager.setPresentationMode(mode);
    applyVisibility();
  };

  const openQuick = (): void => {
    setMode('quick');
    quick.render();
  };

  const openFull = (): void => {
    modeBeforeFull = chatManager.presentationMode;
    quickWasOpen = chatManager.presentationMode === 'quick';
    chatManager.setPresentationMode('full');
    applyVisibility();
    fullView.open();
  };

  const glance = createGlanceChatOverlay({
    chatManager,
    onOpenQuick: openQuick,
    parent: opts.parent,
  });

  const quick = createQuickChatView({
    chatManager,
    protocol,
    sendPacket,
    getEmergencySpells: opts.getEmergencySpells,
    parent: opts.parent,
    onClose: () => setMode('glance'),
    onExpand: openFull,
  });

  const fullView = createFullChatView(chatManager, protocol, sendPacket, opts.parent ?? document.body, {
    getDraft: () => chatManager.draft,
    setDraft: (text) => chatManager.setDraft(text),
    onClose: () => {
      const restore = quickWasOpen ? 'quick' : modeBeforeFull;
      chatManager.setPresentationMode(restore);
      applyVisibility();
      if (restore === 'quick') quick.render();
    },
  });

  const refresh = (): void => {
    if (chatManager.presentationMode === 'glance') glance.render();
    else if (chatManager.presentationMode === 'quick') quick.render();
  };

  const unsubMessages = chatManager.subscribe(() => refresh());
  const unsubChannels = chatManager.subscribeChannels(() => refresh());
  const unsubState = chatManager.subscribeState(() => {
    applyVisibility();
    refresh();
  });

  applyVisibility();

  return {
    manager: chatManager,
    fullView,
    get mode() { return chatManager.presentationMode; },
    setMode,
    openQuick,
    openFull,
    setNpcContext: (ctx) => chatManager.setNpcContext(ctx),
    destroy: () => {
      unsubMessages();
      unsubChannels();
      unsubState();
      glance.destroy();
      quick.destroy();
      fullView.destroy();
    },
  };
}
