import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { healthBand, font } from '../ui/tokens';

/**
 * Classic-Tibia nameplate above a creature: a 27×4 health bar (1px black
 * border, 25×2 fill) with the creature's stroked name above it, both
 * tinted by the same six-band health color. Dimensions and bands ported
 * from upstream OTClient (src/client/creature.cpp) — design originally
 * contributed in PR #103, reborn here against live wire data.
 */

const BAR_WIDTH = 27;
const BAR_HEIGHT = 4;
const BAR_BORDER = 1;
const NAME_GAP = 2;

function colorForPercent(percent: number): number {
  if (percent > 92) return healthBand.brightGreen;
  if (percent > 60) return healthBand.darkGreen;
  if (percent > 30) return healthBand.yellow;
  if (percent > 8) return healthBand.red;
  if (percent > 3) return healthBand.darkRed;
  return healthBand.darkerRed;
}

export interface NameplateHandle {
  readonly container: Container;
  update(name: string, healthPercent: number): void;
  destroy(): void;
}

/**
 * The container's local origin is the bar's top-center: position it with
 * `container.x = tileCenterX; container.y = aboveHeadY`.
 */
export function createNameplate(name: string, healthPercent: number): NameplateHandle {
  const container = new Container();

  const bar = new Graphics();
  const nameText = new Text({
    text: name,
    style: new TextStyle({
      fontFamily: font.game,
      fontSize: 9,
      fontWeight: 'bold',
      fill: colorForPercent(healthPercent),
      stroke: { color: 0x000000, width: 2 },
    }),
  });
  nameText.anchor.set(0.5, 1);
  nameText.y = -NAME_GAP;
  container.addChild(nameText, bar);

  let lastName = '';
  let lastPercent = -1;

  function update(nextName: string, percent: number): void {
    const clamped = Math.max(0, Math.min(100, percent));

    if (nextName !== lastName) {
      nameText.text = nextName;
      lastName = nextName;
    }

    if (clamped !== lastPercent) {
      const color = colorForPercent(clamped);
      nameText.style.fill = color;

      bar.clear();
      bar.rect(-BAR_WIDTH / 2, 0, BAR_WIDTH, BAR_HEIGHT).fill(0x000000);
      // Floor at 1px while alive: 1-2% health must not render an empty
      // bar — an empty bar reads as dead.
      const fillWidth = clamped > 0
        ? Math.max(1, Math.round((BAR_WIDTH - BAR_BORDER * 2) * (clamped / 100)))
        : 0;
      if (fillWidth > 0) {
        bar.rect(-BAR_WIDTH / 2 + BAR_BORDER, BAR_BORDER, fillWidth, BAR_HEIGHT - BAR_BORDER * 2).fill(color);
      }
      lastPercent = clamped;
    }
  }

  update(name, healthPercent);

  return {
    container,
    update,
    destroy: () => container.destroy({ children: true }),
  };
}
