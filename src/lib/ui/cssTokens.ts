/**
 * Inject the design tokens from `tokens.ts` as CSS custom properties on
 * `:root`, so DOM widgets can reference them via `var(--…)` instead of
 * embedding raw values in `cssText` strings.
 *
 * Call `injectCssTokens()` once on app startup, before any DOM widget
 * mounts. Idempotent — re-running it replaces the previous stylesheet
 * so hot-reload / theme switching stay clean.
 *
 * Scaffold only — `injectCssTokens` is not called anywhere yet. Wiring
 * lands as a follow-up once PR #103 is merged.
 */

import { barGradient, surface, space, radius, font, zIndex } from './tokens';

const STYLE_ID = 'ui-design-tokens';

export function injectCssTokens(): void {
  const css = `:root {
  /* Bar gradients */
  --bar-hp-top: ${barGradient.hp.top};
  --bar-hp-bottom: ${barGradient.hp.bottom};
  --bar-mana-top: ${barGradient.mana.top};
  --bar-mana-bottom: ${barGradient.mana.bottom};
  --bar-empty-top: ${barGradient.empty.top};
  --bar-empty-bottom: ${barGradient.empty.bottom};

  /* Surface chrome */
  --surface-panel-bg: ${surface.panelBg};
  --surface-panel-border: ${surface.panelBorder};
  --color-text-primary: ${surface.textPrimary};
  --color-text-muted: ${surface.textMuted};
  --color-text-numeric: ${surface.textNumeric};
  --text-shadow-soft: ${surface.textShadow};

  /* Spacing scale (px) */
  --space-xs: ${space.xs}px;
  --space-sm: ${space.sm}px;
  --space-md: ${space.md}px;
  --space-lg: ${space.lg}px;
  --space-xl: ${space.xl}px;
  --space-xxl: ${space.xxl}px;

  /* Radii (px) */
  --radius-sm: ${radius.sm}px;
  --radius-md: ${radius.md}px;
  --radius-lg: ${radius.lg}px;

  /* Typography */
  --font-ui: ${font.ui};
  --font-game: ${font.game};
  --font-size-xs: ${font.sizeXs};
  --font-size-sm: ${font.sizeSm};
  --font-size-md: ${font.sizeMd};
  --font-size-lg: ${font.sizeLg};

  /* Z-index */
  --z-chat: ${zIndex.chat};
  --z-joystick: ${zIndex.joystick};
  --z-hud: ${zIndex.hud};
  --z-dev-controls: ${zIndex.devControls};
  --z-modal: ${zIndex.modal};
}`;

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}
