import { Container, Text, TextStyle } from 'pixi.js';
import { MessageType } from '../net/common/types';
import type { ChatManager, SpeechBubble } from './ChatManager';
import { TILE_SIZE } from '../../constants';

// Classic Tibia on-screen text colors (OTClient statictext.cpp):
// players speak in yellow, monsters in orange.
const SAY_YELLOW = '#efef00';
const MONSTER_ORANGE = '#fe6500';

function makeStyle(fill: string): TextStyle {
  return new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: 11,
    fill,
    stroke: { color: '#000000', width: 2 },
    wordWrap: true,
    wordWrapWidth: 150,
    align: 'center',
  });
}

const PLAYER_STYLE = makeStyle(SAY_YELLOW);
const MONSTER_STYLE = makeStyle(MONSTER_ORANGE);

/**
 * On-screen text for one bubble, OTClient statictext format: player
 * speech reads "Name says:" (whispers:/yells:) with the message lines
 * below; monster sound is just the bare text.
 */
export function composeSpeech(bubble: SpeechBubble): { text: string; monster: boolean } {
  switch (bubble.messageType) {
    case MessageType.Whisper:
      return { text: `${bubble.senderName} whispers:\n${bubble.text}`, monster: false };
    case MessageType.Yell:
      return { text: `${bubble.senderName} yells:\n${bubble.text}`, monster: false };
    case MessageType.MonsterSay:
    case MessageType.MonsterYell:
      return { text: bubble.text, monster: true };
    default:
      return { text: `${bubble.senderName} says:\n${bubble.text}`, monster: false };
  }
}

interface BubbleSprite {
  text: Text;
  bubble: SpeechBubble;
}

/**
 * Renders speech text above creatures on the map, classic Tibia style.
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
      const text = new Text({ text: '', style: PLAYER_STYLE });
      // Bottom-center anchor: appended lines grow the text UPWARD from
      // its spot above the nameplate, the classic says-stack.
      text.anchor.set(0.5, 1);
      this.container.addChild(text);
      this.sprites.push({ text, bubble: bubbles[this.sprites.length] });
    }

    // Update positions and text
    for (let i = 0; i < bubbles.length; i++) {
      const bubble = bubbles[i];
      const sprite = this.sprites[i];
      sprite.bubble = bubble;
      const { text, monster } = composeSpeech(bubble);
      sprite.text.text = text;
      // Only swap styles on an actual change — assignment dirties the
      // PIXI text layout even for the identical object, and this runs
      // every frame.
      const style = monster ? MONSTER_STYLE : PLAYER_STYLE;
      if (sprite.text.style !== style) sprite.text.style = style;
      // Slightly right of tile center, bottom edge just above the
      // nameplate (which sits at tileY − 14).
      sprite.text.x = (bubble.x - originX + 0.5) * TILE_SIZE * zoom + 2;
      sprite.text.y = (bubble.y - originY) * TILE_SIZE * zoom - 16;
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
