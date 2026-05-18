import { Container, Graphics, Text, TextStyle } from 'pixi.js';

/**
 * Classic-Tibia-style overlay above a creature: a thin colored health bar
 * with the creature's name above it. Designed to be added as a child of
 * the creature's sprite container so it moves and is occluded along with
 * the creature.
 *
 * Dimensions and styling mirror the original 7.x client: a 27x4 bar with
 * a 1px black border surrounding a 25x2 colored fill, and the name text
 * inherits the bar color (green > 60% > yellow > 30% > red) with a dark
 * stroke for legibility on varied backgrounds.
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
const NAME_GAP = 2;

const HEALTHY = 0x4caf50;
const WOUNDED = 0xe4b333;
const CRITICAL = 0xc83737;
const THRESHOLD_HEALTHY = 60;
const THRESHOLD_WOUNDED = 30;

function colorForPercent(percent: number): number {
  if (percent > THRESHOLD_HEALTHY) return HEALTHY;
  if (percent > THRESHOLD_WOUNDED) return WOUNDED;
  return CRITICAL;
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

  const nameText = new Text({
    text: name,
    style: new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: 9,
      fontWeight: 'bold',
      fill: colorForPercent(healthPercent),
      stroke: { color: 0x000000, width: 2 },
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
