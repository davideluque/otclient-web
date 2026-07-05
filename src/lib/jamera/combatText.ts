import { Container, Text, TextStyle } from 'pixi.js';
import { tibiaColorToHex } from '../lighting';
import { ANIMATED_TEXT_TTL_MS } from '../GameWorld';
import type { GameWorld } from '../GameWorld';
import { TILE_SIZE } from '../../constants';

/** Total upward drift over a text's ANIMATED_TEXT_TTL_MS life. */
export const TEXT_RISE_PX = 24;
/** Fraction of the life after which the fade-out runs. */
const FADE_START = 0.75;

/**
 * Deterministic per-text x-jitter in [-6, +6] px so simultaneous hits
 * don't stack into one unreadable column. Derived from the start stamp
 * instead of Math.random so every repaint of the same frame lands the
 * text in the same place — and GameWorld stays free of cosmetic state.
 */
export function textJitterPx(startedAt: number): number {
  // floor before shifting: performance.now() is fractional, and the
  // raw modulo would leak up to +6.99 past the intended +6 edge.
  return Math.floor(startedAt % 13) - 6;
}

/** Rise/alpha of a text at `now`: climbs linearly, fades near the end. */
export function textMotionAt(now: number, startedAt: number): { rise: number; alpha: number } {
  const life = Math.min(1, Math.max(0, (now - startedAt) / ANIMATED_TEXT_TTL_MS));
  const alpha = life <= FADE_START ? 1 : (1 - life) / (1 - FADE_START);
  return { rise: TEXT_RISE_PX * life, alpha };
}

/**
 * Renders the floating combat numbers (0x84 animated text) above their
 * tiles, classic Tibia style: colored digits that drift upward and fade
 * out. Same index-pooling approach as SpeechBubbleRenderer — Text
 * objects are reused across frames, only their fields update.
 */
export class CombatTextRenderer {
  private container = new Container();
  private sprites: Text[] = [];
  // One shared style per palette color (216 max): swapping a Text's
  // style dirties its layout even for an identical object, so entries
  // reuse these by reference and only reassign on an actual change.
  private styles = new Map<number, TextStyle>();

  getContainer(): Container {
    return this.container;
  }

  private styleFor(color: number): TextStyle {
    let style = this.styles.get(color);
    if (!style) {
      style = new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        fontWeight: 'bold',
        fill: tibiaColorToHex(color),
        stroke: { color: '#000000', width: 2 },
      });
      this.styles.set(color, style);
    }
    return style;
  }

  /**
   * Repaint from `world.animatedTexts` (the caller prunes first). The
   * container lives in world-pixel space, like the effects layer.
   */
  update(world: GameWorld, now: number): void {
    const texts = world.animatedTexts.filter((t) => t.z === world.playerZ);

    while (this.sprites.length > texts.length) {
      const removed = this.sprites.pop()!;
      this.container.removeChild(removed);
      removed.destroy();
    }
    while (this.sprites.length < texts.length) {
      const text = new Text({ text: '' });
      // Bottom-center anchor above the tile, like the says-stack.
      text.anchor.set(0.5, 1);
      this.container.addChild(text);
      this.sprites.push(text);
    }

    for (let i = 0; i < texts.length; i++) {
      const entry = texts[i];
      const sprite = this.sprites[i];
      sprite.text = entry.text;
      const style = this.styleFor(entry.color);
      if (sprite.style !== style) sprite.style = style;
      const { rise, alpha } = textMotionAt(now, entry.startedAt);
      sprite.x = (entry.x + 0.5) * TILE_SIZE + textJitterPx(entry.startedAt);
      sprite.y = entry.y * TILE_SIZE - rise;
      sprite.alpha = alpha;
    }
  }

  destroy(): void {
    for (const s of this.sprites) {
      s.destroy();
    }
    this.sprites = [];
    this.container.destroy({ children: true });
  }
}
