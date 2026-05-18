import { Container, Graphics, Text, TextStyle } from 'pixi.js';

/**
 * Classic-Tibia-style overlay above a creature: a thin colored health bar
 * with the creature's name above it. Designed to be added as a child of
 * the creature's sprite container so it moves and is occluded along with
 * the creature.
 *
 * Dimensions and color bands are taken from upstream OTClient
 * (src/client/creature.cpp): a 27x4 bar with a 1px black border around
 * a 25x2 fill, and the name text inherits the same six-band health
 * color (bright green > 92% > dark green > 60% > yellow > 30% >
 * red > 8% > dark red > 3% > darker red). A 2px black stroke keeps
 * the name legible on varied tile backgrounds.
 *
 * UI-only: `setHealth` accepts a 0..100 percentage. Until the server
 * `CreatureHealth` packet is wired into `GameWorld`, callers pass a
 * placeholder value so the bar is visible.
 */

export interface CreatureOverlay {
  readonly container: Container;
  setHealth(percent: number): void;
  setName(name: string): void;
  destroy(): void;
}

const BAR_WIDTH = 27;
const BAR_HEIGHT = 4;
const BAR_BORDER = 1;
const BAR_BG = 0x000000;
const NAME_GAP = 1;

// Six-band health color mapping, ported verbatim from upstream OTClient
// (src/client/creature.cpp, drawInformation). Both the bar fill and the
// name text use the same band so a glance at either reads the same.
const BAND_BRIGHT_GREEN = 0x00bc00;
const BAND_DARK_GREEN = 0x50a150;
const BAND_YELLOW = 0xa1a100;
const BAND_RED = 0xbf0a0a;
const BAND_DARK_RED = 0x910f0f;
const BAND_DARKER_RED = 0x850c0c;

function colorForPercent(percent: number): number {
  if (percent > 92) return BAND_BRIGHT_GREEN;
  if (percent > 60) return BAND_DARK_GREEN;
  if (percent > 30) return BAND_YELLOW;
  if (percent > 8) return BAND_RED;
  if (percent > 3) return BAND_DARK_RED;
  return BAND_DARKER_RED;
}

/**
 * Build the overlay. The container's local origin (0, 0) is the
 * bottom-center of the bar, so the caller positions it by setting
 * `container.x = centerX; container.y = barBottomY`. The name renders
 * above the bar; the bar fill grows rightward from the left edge.
 */
export function createCreatureOverlay(name: string, healthPercent = 100): CreatureOverlay {
  const container = new Container();

  const bar = new Graphics();
  container.addChild(bar);

  // OTClient uses a bitmap "verdana-11px-rounded" font. Falling back to
  // Verdana is the closest the browser can match without shipping a font.
  const nameText = new Text({
    text: name,
    style: new TextStyle({
      fontFamily: 'Verdana, "DejaVu Sans", sans-serif',
      // OTClient ships an 11px bitmap font for desktop; on phones that
      // reads too large at our scale, so render ~18% smaller.
      fontSize: 9,
      // Bold weight + 1px stroke approximates the density of OTClient's
      // bitmap font. Stripping both reads too thin; doubling them
      // (bold + 2px stroke) thickens every glyph.
      fontWeight: 'bold',
      fill: colorForPercent(healthPercent),
      stroke: { color: 0x000000, width: 1 },
      align: 'center',
    }),
  });
  nameText.anchor.set(0.5, 1);
  nameText.y = -BAR_HEIGHT - NAME_GAP;
  container.addChild(nameText);

  // Cache last applied color so changing health within the same threshold
  // band doesn't trigger a TextStyle update + Text canvas re-render.
  let lastColor = colorForPercent(healthPercent);

  function draw(percent: number) {
    const clamped = Math.max(0, Math.min(100, percent));
    const color = colorForPercent(clamped);

    bar.clear();
    // Outer 1px black border (full rect).
    bar.rect(-BAR_WIDTH / 2, -BAR_HEIGHT, BAR_WIDTH, BAR_HEIGHT).fill(BAR_BG);
    // Inner colored fill, inset by 1px on all sides; width scales with HP.
    const innerMaxW = BAR_WIDTH - BAR_BORDER * 2;
    const innerW = (innerMaxW * clamped) / 100;
    if (innerW > 0) {
      bar
        .rect(-BAR_WIDTH / 2 + BAR_BORDER, -BAR_HEIGHT + BAR_BORDER, innerW, BAR_HEIGHT - BAR_BORDER * 2)
        .fill(color);
    }

    if (color !== lastColor) {
      nameText.style.fill = color;
      lastColor = color;
    }
  }

  draw(healthPercent);

  return {
    container,
    setHealth: draw,
    setName(next: string) {
      nameText.text = next;
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
