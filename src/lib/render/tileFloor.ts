import { Container, type Texture } from 'pixi.js';
import { tilePositionKey } from '../../constants';
import type { ThingType } from '../dat';
import { renderTile, setItemAnimationFrame, type AnimatedSprite } from '../tileRenderer';
import type { ResolvedTile } from '../tileMap';

// Map coordinates are unsigned 16-bit. Reserve the second half of each
// row for its creatures so the next row's tall items can cover them.
const ROW_WIDTH = 0x10000;
export function creatureDrawOrder(row: number, x: number): number {
  return (row * 2 + 1) * ROW_WIDTH + x;
}

interface TileEntry {
  container: Container;
  itemIds: number[];
  animated: AnimatedSprite[];
  seen: number;
}

/** Retains the sprites for the visible, unoccluded tiles of one floor. */
export class TileFloor {
  readonly container = new Container();
  private readonly entries = new Map<number, TileEntry>();
  private revision = 0;

  private readonly datIndex: Map<number, ThingType>;
  private readonly getTexture: (id: number) => Texture | null;
  private readonly animated?: Set<AnimatedSprite>;

  constructor(
    datIndex: Map<number, ThingType>,
    getTexture: (id: number) => Texture | null,
    animated?: Set<AnimatedSprite>,
  ) {
    this.datIndex = datIndex;
    this.getTexture = getTexture;
    this.animated = animated;
    this.container.sortableChildren = true;
  }

  update(tiles: Iterable<ResolvedTile>, covered?: ReadonlySet<number>, frame = 0): void {
    this.revision++;
    for (const tile of tiles) {
      const key = tilePositionKey(tile.x, tile.y);
      if (covered?.has(key) || tile.items.length === 0) continue;
      const old = this.entries.get(key);
      // The live world synthesizes ResolvedTiles for each scan. Compare
      // the ordered DAT ids, which are the inputs renderTile draws here.
      if (old && old.itemIds.length === tile.items.length &&
          tile.items.every((item, i) => item.clientId === old.itemIds[i])) {
        old.seen = this.revision;
        continue;
      }
      if (old) this.remove(old);
      const container = new Container();
      container.zIndex = tile.y * 2 * ROW_WIDTH + tile.x;
      const animated: AnimatedSprite[] = [];
      renderTile(tile, container, animated, this.datIndex, this.getTexture);
      this.container.addChild(container);
      if (this.animated) {
        for (const sprite of animated) {
          setItemAnimationFrame(sprite, frame);
          this.animated.add(sprite);
        }
      }
      this.entries.set(key, {
        container, animated, seen: this.revision, itemIds: tile.items.map(item => item.clientId),
      });
    }
    for (const [key, entry] of this.entries) {
      if (entry.seen !== this.revision) {
        this.remove(entry);
        this.entries.delete(key);
      }
    }
  }

  private remove(entry: TileEntry): void {
    for (const sprite of entry.animated) this.animated?.delete(sprite);
    entry.container.destroy({ children: true });
  }

  destroy(): void {
    for (const entry of this.entries.values()) this.remove(entry);
    this.entries.clear();
    // Creature sprites and persistent nameplates belong to the caller.
    this.container.destroy();
  }
}
