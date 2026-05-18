/**
 * UI design tokens — single source of truth for colors, spacing, radii,
 * type, and z-index used across DOM widgets (statusHUD, devControls,
 * joystick, chat, …) and PixiJS overlays (creatureOverlay).
 *
 * Two representations of color are exported because the two layers
 * speak different dialects:
 *   - PixiJS APIs want numeric hex (`0xRRGGBB`).
 *   - CSS wants string hex (`'#RRGGBB'`) or `rgba(…)`.
 *
 * Where a token is used by both layers, both forms live in the same
 * object so changing the source value updates both call sites.
 *
 * Scaffold only — nothing imports this yet. Wiring landings as a
 * follow-up once PR #103 is merged.
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

/** Border radii for cards and pill shapes. */
export const radius = {
  sm: 4,
  md: 7, // matches pill bars at 14px height
  lg: 12, // panels / cards
} as const;

/** Font stacks + sizes. Game text uses a Verdana fallback for the
 *  pixel-font feel; chrome uses the host system UI font. */
export const font = {
  ui: 'system-ui, sans-serif',
  // Verdana approximates OTClient's bitmap `verdana-11px-rounded` until
  // we ship the actual bitmap font as an asset.
  game: 'Verdana, "DejaVu Sans", sans-serif',
  sizeXs: '0.72rem',
  sizeSm: '0.78rem',
  sizeMd: '0.92rem',
  sizeLg: '1rem',
} as const;

/** Stacking order for fixed widgets. Keep gaps so we can slot new
 *  layers in without renumbering callers. */
export const zIndex = {
  chat: 20,
  joystick: 50,
  hud: 60,
  devControls: 60,
  modal: 100,
} as const;

/** Convert a Pixi-style numeric color (`0xRRGGBB`) to a CSS hex string. */
export function hexToCss(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}
