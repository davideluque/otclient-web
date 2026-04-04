import { Container, Text, TextStyle } from 'pixi.js';
import type { ChatManager, SpeechBubble } from './ChatManager';

const TILE_SIZE = 32;
const BUBBLE_STYLE = new TextStyle({
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  fill: '#ffffff',
  stroke: { color: '#000000', width: 2 },
  wordWrap: true,
  wordWrapWidth: 150,
  align: 'center',
});

interface BubbleSprite {
  text: Text;
  bubble: SpeechBubble;
}

/**
 * Renders speech bubbles above creatures on the map.
 */
export class SpeechBubbleRenderer {
  private container = new Container();
  private sprites: BubbleSprite[] = [];

  getContainer(): Container {
    return this.container;
  }

  /**
   * Update speech bubbles from ChatManager state.
   * Call each frame.
   */
  update(
    chatManager: ChatManager,
    originX: number,
    originY: number,
    zoom: number,
    now: number,
  ): void {
    chatManager.cleanupBubbles(now);
    const bubbles = chatManager.speechBubbles;

    // Remove excess sprites
    while (this.sprites.length > bubbles.length) {
      const removed = this.sprites.pop()!;
      this.container.removeChild(removed.text);
      removed.text.destroy();
    }

    // Add new sprites
    while (this.sprites.length < bubbles.length) {
      const text = new Text({ text: '', style: BUBBLE_STYLE });
      text.anchor.set(0.5, 1);
      this.container.addChild(text);
      this.sprites.push({ text, bubble: bubbles[this.sprites.length] });
    }

    // Update positions and text
    for (let i = 0; i < bubbles.length; i++) {
      const bubble = bubbles[i];
      const sprite = this.sprites[i];
      sprite.bubble = bubble;
      sprite.text.text = `${bubble.senderName}: ${bubble.text}`;
      sprite.text.x = (bubble.x - originX + 0.5) * TILE_SIZE * zoom;
      sprite.text.y = (bubble.y - originY) * TILE_SIZE * zoom - 8;
      sprite.text.scale.set(Math.min(1, zoom));
    }
  }

  destroy(): void {
    for (const s of this.sprites) {
      s.text.destroy();
    }
    this.sprites = [];
    this.container.destroy({ children: true });
  }
}
