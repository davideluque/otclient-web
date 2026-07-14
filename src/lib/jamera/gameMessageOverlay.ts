import { font, radius, space, zIndex } from '../ui/tokens';

export interface GameMessageOverlayHandle {
  readonly el: HTMLElement;
  show(messageClass: number, text: string): void;
  destroy(): void;
}

const STYLE_ID = 'game-message-overlay-style';
const MESSAGE_TTL_MS = 4500;
const MAX_VISIBLE = 4;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .game-message-overlay {
      position: fixed; left: 50%; bottom: calc(21vh + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%); z-index: ${zIndex.hud};
      width: min(86vw, 560px); display: flex; flex-direction: column;
      align-items: center; gap: ${space.sm}px; pointer-events: none;
      font-family: ${font.ui}; font-size: 0.76rem; text-align: center;
    }
    .game-message-overlay .message {
      max-width: 100%; padding: ${space.sm}px ${space.lg}px;
      color: #f3f3f3; background: rgba(0,0,0,0.58);
      border-radius: ${radius.md}px; text-shadow: 1px 1px #000;
      animation: game-message-in 120ms ease-out;
    }
    .game-message-overlay .warning { color: #ff6961; }
    .game-message-overlay .advance { color: #f3f3f3; }
    .game-message-overlay .info { color: #7dff7d; }
    .game-message-overlay .status { color: #e7e7e7; }
    @keyframes game-message-in { from { opacity: 0; transform: translateY(4px); } }
  `;
  document.head.appendChild(style);
}

function classNameFor(messageClass: number): string {
  if (messageClass === 0x12) return 'warning';
  if (messageClass === 0x13) return 'advance';
  if (messageClass === 0x16) return 'info';
  return 'status';
}

export function createGameMessageOverlay(parent: HTMLElement = document.body): GameMessageOverlayHandle {
  ensureStyles();
  const el = document.createElement('div');
  el.className = 'game-message-overlay';
  el.setAttribute('aria-live', 'polite');
  parent.appendChild(el);
  const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  const remove = (message: HTMLElement): void => {
    const timer = timers.get(message);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(message);
    message.remove();
  };

  return {
    el,
    show: (messageClass, text) => {
      const message = document.createElement('div');
      message.className = `message ${classNameFor(messageClass)}`;
      message.textContent = text;
      el.appendChild(message);
      while (el.children.length > MAX_VISIBLE) remove(el.firstElementChild as HTMLElement);
      timers.set(message, setTimeout(() => remove(message), MESSAGE_TTL_MS));
    },
    destroy: () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      el.remove();
    },
  };
}
