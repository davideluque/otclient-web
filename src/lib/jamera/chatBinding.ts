import { ChatManager } from '../chat/ChatManager';
import { createChatUI } from '../chat/ChatUI';
import { createFullChatView, type FullChatViewHandle } from '../chat/FullChatView';
import type { GameClient } from '../net/common/GameClient';
import { MessageType } from '../net/common/types';

/**
 * Wires the chat stack to a live game session: server speak packets
 * (0xAA) land in the ChatManager, server text messages (0xB4 — login
 * MOTD, status lines) land in the default channel as "Server", channel
 * open/close packets keep tabs in sync, and the input box sends through
 * the client. Registered after registerWireSkips so these handlers
 * override the discard consumers per opcode.
 *
 * On coarse-pointer devices the panel starts collapsed — a 40vh chat
 * overlay on a phone would bury the joystick. Reopening goes through
 * menu → Chat (the old 💬 corner toggle sat on top of the hotkey arc).
 */
export interface ChatBindingHandle {
  /** The live ChatManager — the renderer reads speech bubbles from it. */
  manager: ChatManager;
  /** Full-screen chat interface (menu → Chat) sharing the same manager. */
  fullView: FullChatViewHandle;
  destroy(): void;
}

export interface ChatBindingOptions {
  /**
   * Fired when the server's death announcement lands — a 0xB4 of class
   * MSG_EVENT_ADVANCE with the exact text "You are dead." (game.cpp:3941).
   * Jamera signals death this way because its ReloginWindow (0x28) call
   * site is commented out server-side (player.cpp:3398). Hooked here
   * instead of a second 0xB4 dispatcher handler: PacketDispatcher.on is
   * last-write-wins, so a separate handler would silence chat.
   */
  onDeathMessage?: () => void;
}

/** 7.6 TextMessage class for advance/event lines (enums.h MSG_EVENT_ADVANCE). */
const MSG_EVENT_ADVANCE = 0x13;

export function bindChat(
  client: GameClient,
  parent: HTMLElement = document.body,
  opts: ChatBindingOptions = {},
): ChatBindingHandle {
  const protocol = client.getProtocol();
  const manager = new ChatManager();

  // Declared ahead of createChatUI so the onClose closure never touches
  // a temporal dead zone; the real applyOpen is assigned once `ui` exists.
  let open = !window.matchMedia('(pointer: coarse)').matches;
  let applyOpen: () => void = () => {};

  const chatUi = createChatUI(manager, protocol, (packet) => {
    try {
      client.send(packet);
    } catch (e) {
      console.warn('[jamera] chat send failed:', e instanceof Error ? e.message : e);
    }
  }, {
    onClose: () => { open = false; applyOpen(); },
  });
  const ui = chatUi.el;
  parent.appendChild(ui);

  // Second interface over the same manager — shared history/channels;
  // both stay in sync through ChatManager.subscribe.
  const send = (packet: Parameters<GameClient['send']>[0]): void => {
    try {
      client.send(packet);
    } catch (e) {
      console.warn('[jamera] chat send failed:', e instanceof Error ? e.message : e);
    }
  };
  const fullView = createFullChatView(manager, protocol, send, parent);

  // Interfaces subscribe to the manager (ChatManager.subscribe), so
  // handler registration order no longer matters — kept after UI
  // creation for readability.
  const dispatcher = client.getDispatcher();
  const op = protocol.serverOpcodes;
  dispatcher.on(op.CreatureSpeak, (p) => {
    manager.handleMessage(protocol.chat.parseSpeak(p));
  });
  dispatcher.on(op.ChannelOpen, (p) => {
    const channel = protocol.chat.parseChannelOpen(p);
    manager.addChannel(channel.id, channel.name);
  });
  dispatcher.on(op.ChannelClose, (p) => {
    manager.removeChannel(protocol.chat.parseChannelClose(p));
  });
  dispatcher.on(op.TextMessage, (p) => {
    const messageClass = p.getU8(); // styling can use it later
    const text = p.getString();
    if (messageClass === MSG_EVENT_ADVANCE && text === 'You are dead.') {
      opts.onDeathMessage?.();
    }
    // The death line still flows to chat — it's part of the log too.
    manager.handleMessage({
      senderName: 'Server',
      messageType: MessageType.Say,
      text,
      timestamp: Date.now(),
    });
  });

  // The ChatUI stylesheet sets display:flex on #chat-ui, so visibility
  // is driven via style.display (the [hidden] attribute loses that
  // specificity fight — same pitfall as the login overlay). Closing
  // lives on ChatUI's explicit ✕ (the onClose above).
  applyOpen = () => {
    ui.style.display = open ? 'flex' : 'none';
  };
  applyOpen();

  return {
    manager,
    fullView,
    destroy: () => {
      dispatcher.off(op.CreatureSpeak);
      dispatcher.off(op.ChannelOpen);
      dispatcher.off(op.ChannelClose);
      dispatcher.off(op.TextMessage);
      fullView.destroy();
      chatUi.destroy();
    },
  };
}
