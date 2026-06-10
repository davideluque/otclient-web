/**
 * UI design tokens — single source of truth for colors, spacing, radii,
 * type, and z-index used across DOM widgets (statusHUD, devControls,
 * joystick, chat, …) and PixiJS overlays (creatureOverlay).
 *
 * Layer dialects
 * --------------
 * PixiJS APIs want numeric hex (`0xRRGGBB`); CSS wants string hex /
 * `rgba(…)`. Each token is authored in whichever form its current
 * consumer needs. When a token becomes shared across layers, the
 * second representation is derived on demand with `hexToCss()` (DOM
 * gets the string) — there is intentionally no parallel string copy
 * sitting next to the numeric source. That keeps the numeric value
 * unambiguously the source of truth and avoids the two copies
 * drifting out of sync.
 *
 * Today: `healthBand` is the only cross-layer palette — it lives as
 * numbers here and `cssTokens.ts` injects the CSS forms via
 * `hexToCss()` so DOM components can read them via `var(--…)`.
 *
 * Unit handling
 * -------------
 * Numeric tokens (`space`, `radius`, sizes) are stored as raw numbers.
 * Units (`px`, `rem`) are appended by `cssTokens.ts` when generating
 * CSS, so TS code can do arithmetic on them without parsing strings.
 *
 * Scaffold only — nothing imports this yet. Wiring lands as follow-ups
 * once PR #103 is merged.
 */

/** Six-band creature health palette, ported from OTClient creature.cpp. */
export const healthBand = {
  brightGreen: 0x00bc00,
  darkGreen: 0x50a150,
  yellow: 0xa1a100,
  red: 0xbf0a0a,
  darkRed: 0x910f0f,
  darkerRed: 0x850c0c,
} as const;

/** Gradient color pairs for the HP / Mana pill bars. */
export const barGradient = {
  hp: { top: '#e2767c', bottom: '#a83033' },
  mana: { top: '#6470cc', bottom: '#3a48a0' },
  empty: { top: '#3a3a3a', bottom: '#1a1a1a' },
} as const;

/** Surface chrome for DOM panels (HUD, dev controls, dialogs). */
export const surface = {
  panelBg: 'rgba(20,20,20,0.7)',
  panelBorder: '#333',
  textPrimary: '#eee',
  textMuted: '#aaa',
  textNumeric: '#fff',
  textShadow: '0 1px 1px rgba(0,0,0,0.6)',
} as const;

/** Pixel spacing scale. Use these names, not raw numbers. */
export const space = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  xxl: 16,
} as const;

/** Border radii (px) for cards and pill shapes. */
export const radius = {
  sm: 4,
  md: 7, // matches pill bars at 14px height
  lg: 12, // panels / cards
} as const;

/** Font stacks (strings) + sizes (rem multipliers, stored as raw
 *  numbers so callers can do arithmetic; `cssTokens.ts` appends the
 *  `rem` unit when generating CSS). */
export const font = {
  ui: 'system-ui, sans-serif',
  // Verdana approximates OTClient's bitmap `verdana-11px-rounded` until
  // we ship the actual bitmap font as an asset.
  game: 'Verdana, "DejaVu Sans", sans-serif',
  sizeXs: 0.72,
  sizeSm: 0.78,
  sizeMd: 0.92,
  sizeLg: 1,
} as const;

/** Stacking order for fixed widgets. Gaps left between layers so new
 *  surfaces can slot in without renumbering callers. */
export const zIndex = {
  chat: 20,
  joystick: 50,
  hud: 60,
  devControls: 70,
  modal: 100,
} as const;

/**
 * Convert a Pixi-style numeric color (`0xRRGGBB`) to a CSS hex string.
 * Throws on inputs that can't represent a 24-bit RGB color so a
 * mistakenly-passed sentinel value doesn't silently produce a string
 * like `#-1` that CSS would reject at parse time.
 */
export function hexToCss(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffff) {
    throw new RangeError(`hexToCss expects an integer between 0x000000 and 0xFFFFFF (got ${n})`);
  }
  return '#' + n.toString(16).padStart(6, '0');
}
