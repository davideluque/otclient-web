import { font, radius, space, surface, zIndex } from '../ui/tokens';

/**
 * Transient DOM feedback for canvas interactions: the tap rings
 * (white walk / gold use / red attack), the use-with crosshair hint
 * bar, and the world item-drag ghost + drop marker. Pure
 * style-injection + element lifecycle — no game state.
 */

const HINT_STYLE_ID = 'use-with-hint-style';
const TAP_FEEDBACK_STYLE_ID = 'tap-feedback-style';
const DRAG_FEEDBACK_STYLE_ID = 'world-drag-feedback-style';

export function ensureDragStyles(): void {
  if (document.getElementById(DRAG_FEEDBACK_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = DRAG_FEEDBACK_STYLE_ID;
  style.textContent = `
    .world-item-drag, .world-item-drop {
      position: fixed; pointer-events: none; z-index: ${zIndex.hud};
      width: 32px; height: 32px; margin: -16px 0 0 -16px;
      border-radius: ${radius.sm}px;
    }
    .world-item-drag {
      border: 2px solid #ffd45a; background: rgb(255 212 90 / 22%);
      box-shadow: 0 2px 10px rgb(0 0 0 / 55%);
    }
    .world-item-drop { border: 2px dashed rgb(255 255 255 / 80%); }
  `;
  document.head.appendChild(style);
}

export function ensureHintStyles(): void {
  if (document.getElementById(HINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HINT_STYLE_ID;
  style.textContent = `
    .use-with-hint {
      position: fixed; top: calc(${space.lg}px + env(safe-area-inset-top, 0px));
      left: 50%; transform: translateX(-50%); z-index: ${zIndex.hud};
      display: flex; align-items: center; gap: ${space.lg}px;
      padding: ${space.lg}px ${space.xl}px;
      background: ${surface.panelBg}; border: 1px solid ${surface.panelBorder};
      border-radius: ${radius.lg}px; color: ${surface.textPrimary};
      font-family: ${font.ui}; font-size: ${font.sizeMd}rem; user-select: none;
    }
    .use-with-hint button {
      background: none; border: none; color: ${surface.textMuted};
      font-size: ${font.sizeLg}rem; cursor: pointer; padding: 0 ${space.sm}px;
    }
  `;
  document.head.appendChild(style);
}

export type TapFeedbackKind = 'walk' | 'use' | 'attack';

export function showTapFeedback(clientX: number, clientY: number, kind: TapFeedbackKind): void {
  if (!document.getElementById(TAP_FEEDBACK_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = TAP_FEEDBACK_STYLE_ID;
    style.textContent = `
      .world-tap-feedback {
        position: fixed; width: 30px; height: 30px; margin: -15px 0 0 -15px;
        z-index: ${zIndex.hud}; border: 2px solid #eee; border-radius: 50%;
        pointer-events: none; animation: world-tap-pop 360ms ease-out forwards;
      }
      .world-tap-feedback.use { border-color: #ffd45a; }
      .world-tap-feedback.attack { border-color: #ff5f57; }
      @keyframes world-tap-pop {
        from { opacity: 0.95; transform: scale(0.45); }
        to { opacity: 0; transform: scale(1.45); }
      }
    `;
    document.head.appendChild(style);
  }
  const marker = document.createElement('div');
  marker.className = `world-tap-feedback ${kind}`;
  marker.style.left = `${clientX}px`;
  marker.style.top = `${clientY}px`;
  document.body.appendChild(marker);
  const fallbackTimer = setTimeout(() => marker.remove(), 500);
  marker.addEventListener('animationend', () => {
    clearTimeout(fallbackTimer);
    marker.remove();
  }, { once: true });
}

