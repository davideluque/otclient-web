import { ChatManager } from '../chat/ChatManager';
import { createChatPresentation, type ChatPresentationHandle } from '../chat/ChatPresentation';
import type { NpcChatContext } from '../chat/npcContext';
import type { GameClient } from '../net/common/GameClient';
import { MessageType } from '../net/common/types';
import { createGameMessageOverlay } from './gameMessageOverlay';
import { loadSpellSlots, spellByWords } from '../spells';

/**
 * Wires the chat stack to a live game session: server speak packets
 * (0xAA) land in the ChatManager, server text messages (0xB4 — login
 * MOTD, status lines) land in the default channel as "Server", channel
 * open/close packets keep tabs in sync, and the input box sends through
 * the client. Registered after registerWireSkips so these handlers
 * override the discard consumers per opcode.
 *
 * Gameplay uses a three-mode presentation: glance (default overlay),
 * quick (bottom sheet / side panel), and full (menu → Chat). All modes
 * share one ChatManager — history, channel, draft, and unread state.
 */
export interface ChatBindingHandle {
  /** The live ChatManager — the renderer reads speech bubbles from it. */
  manager: ChatManager;
  /** Full-screen chat interface (menu → Chat) sharing the same manager. */
  fullView: ChatPresentationHandle['fullView'];
  /** Presentation controller — mode transitions and NPC context. */
  presentation: ChatPresentationHandle;
  /** Activate NPC quick-reply chips in quick-chat mode. */
  setNpcContext(ctx: NpcChatContext | null): void;
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

const EMERGENCY_SPELL_LIMIT = 3;

export function bindChat(
  client: GameClient,
  parent: HTMLElement = document.body,
  opts: ChatBindingOptions = {},
): ChatBindingHandle {
  const protocol = client.getProtocol();
  const manager = new ChatManager();
  const gameMessages = createGameMessageOverlay(parent);

  const send = (packet: Parameters<GameClient['send']>[0]): void => {
    try {
      client.send(packet);
    } catch (e) {
      console.warn('[jamera] chat send failed:', e instanceof Error ? e.message : e);
    }
  };

  const presentation = createChatPresentation({
    chatManager: manager,
    protocol,
    sendPacket: send,
    parent,
    getEmergencySpells: () => loadSpellSlots()
      .slice(0, EMERGENCY_SPELL_LIMIT)
      .map((words) => {
        const def = spellByWords(words);
        return {
          id: words,
          label: def?.name ?? words,
          onCast: () => send(protocol.chat.buildSay(words)),
        };
      }),
  });

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
    gameMessages.show(messageClass, text);
    if (messageClass === MSG_EVENT_ADVANCE && text === 'You are dead.') {
      try {
        opts.onDeathMessage?.();
      } catch (e) {
        console.warn('[jamera] death handler failed:', e instanceof Error ? e.message : e);
      }
    }
    manager.handleMessage({
      senderName: 'Server',
      messageType: MessageType.Say,
      text,
      timestamp: Date.now(),
    });
  });

  return {
    manager,
    fullView: presentation.fullView,
    presentation,
    setNpcContext: (ctx) => presentation.setNpcContext(ctx),
    destroy: () => {
      dispatcher.off(op.CreatureSpeak);
      dispatcher.off(op.ChannelOpen);
      dispatcher.off(op.ChannelClose);
      dispatcher.off(op.TextMessage);
      presentation.destroy();
      gameMessages.destroy();
    },
  };
}
