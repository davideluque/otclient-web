import { Container, Graphics, Text, TextStyle } from 'pixi.js';

/**
 * Classic-Tibia-style overlay above a creature: a thin colored health bar
 * with the creature's name above it. Designed to be added as a child of
 * the creature's sprite container so it moves and is occluded along with
 * the creature.
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

const BAR_WIDTH = 26;
const BAR_HEIGHT = 3;
const BAR_BG = 0x000000;
const NAME_GAP = 2;

const HEALTHY = 0x4caf50;
const WOUNDED = 0xe4b333;
const CRITICAL = 0xc83737;
const THRESHOLD_HEALTHY = 60;
const THRESHOLD_WOUNDED = 30;

const NAME_STYLE = new TextStyle({
  fontFamily: 'system-ui, sans-serif',
  fontSize: 9,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 2 },
  align: 'center',
});

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

  const nameText = new Text({ text: name, style: NAME_STYLE });
  nameText.anchor.set(0.5, 1);
  nameText.y = -BAR_HEIGHT - NAME_GAP;
  container.addChild(nameText);

  function draw(percent: number) {
    const clamped = Math.max(0, Math.min(100, percent));
    const fillWidth = (BAR_WIDTH * clamped) / 100;
    const color = clamped > THRESHOLD_HEALTHY ? HEALTHY : clamped > THRESHOLD_WOUNDED ? WOUNDED : CRITICAL;

    bar.clear();
    bar.rect(-BAR_WIDTH / 2, -BAR_HEIGHT, BAR_WIDTH, BAR_HEIGHT).fill(BAR_BG);
    if (fillWidth > 0) {
      bar.rect(-BAR_WIDTH / 2, -BAR_HEIGHT, fillWidth, BAR_HEIGHT).fill(color);
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
