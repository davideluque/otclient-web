import { ChatManager } from '../chat/ChatManager';
import { createChatUI } from '../chat/ChatUI';
import type { GameClient } from '../net/common/GameClient';
import { MessageType } from '../net/common/types';

/**
 * Wires the chat stack to a live game session: server speak packets
 * (0xAA) land in the ChatManager, server text messages (0xB4 — login
 * MOTD, status lines) land in the default channel as "Server", and the
 * input box sends through the client. Registered after registerWireSkips
 * so these handlers override the discard consumers per opcode.
 *
 * On coarse-pointer devices the panel starts collapsed behind a 💬
 * toggle — a 40vh chat overlay on a phone would bury the joystick.
 */
export interface ChatBindingHandle {
  /** The live ChatManager — the renderer reads speech bubbles from it. */
  manager: ChatManager;
  destroy(): void;
}

export function bindChat(client: GameClient, parent: HTMLElement = document.body): ChatBindingHandle {
  const protocol = client.getProtocol();
  const manager = new ChatManager();

  const ui = createChatUI(manager, protocol, (packet) => {
    try {
      client.send(packet);
    } catch (e) {
      console.warn('[jamera] chat send failed:', e instanceof Error ? e.message : e);
    }
  }, {
    onClose: () => { open = false; applyOpen(); },
  });
  parent.appendChild(ui);

  // Register AFTER createChatUI: the UI wraps manager.handleMessage to
  // re-render, and these handlers must hit the wrapped version.
  const dispatcher = client.getDispatcher();
  const op = protocol.serverOpcodes;
  dispatcher.on(op.CreatureSpeak, (p) => {
    manager.handleMessage(protocol.chat.parseSpeak(p));
  });
  dispatcher.on(op.TextMessage, (p) => {
    p.skip(1); // message class — styling can use it later
    manager.handleMessage({
      senderName: 'Server',
      messageType: MessageType.Say,
      text: p.getString(),
      timestamp: Date.now(),
    });
  });

  // Collapse toggle. The ChatUI stylesheet sets display:flex on #chat-ui,
  // so visibility is driven via style.display (the [hidden] attribute
  // loses that specificity fight — same pitfall as the login overlay).
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = '💬';
  toggle.style.cssText = [
    'position:fixed', 'right:8px',
    'bottom:calc(8px + env(safe-area-inset-bottom, 0px))',
    'width:44px', 'height:44px', 'border-radius:50%',
    'background:rgba(22,22,22,0.9)', 'border:1px solid #9a9a9a',
    'font-size:1.1rem', 'z-index:45', 'cursor:pointer',
  ].join(';');
  let open = !window.matchMedia('(pointer: coarse)').matches;
  const applyOpen = (): void => {
    ui.style.display = open ? 'flex' : 'none';
    toggle.style.display = open ? 'none' : 'block';
  };
  toggle.addEventListener('click', () => { open = true; applyOpen(); });
  // Closing lives on ChatUI's explicit ✕ (the onClose above). The old
  // dblclick-on-tabs collapse was a touch footgun: two quick taps while
  // switching channels read as a dblclick and made the panel vanish.
  applyOpen();
  parent.appendChild(toggle);

  return {
    manager,
    destroy: () => {
      dispatcher.off(op.CreatureSpeak);
      dispatcher.off(op.TextMessage);
      ui.remove();
      toggle.remove();
    },
  };
}
