import { createMinimap, minimapIndexToRgb, type MinimapHandle } from '../minimap';
import { DatAttr, type ThingType } from '../dat';
import type { GameWorld } from '../GameWorld';

/**
 * Live minimap: colors come from the .dat MinimapColor attribute of the
 * topmost flagged item on each known tile (the original client's
 * automap source). Repaints on a timer rather than world.onChange — the
 * renderer owns that single slot, and a 3,249-pixel ImageData repaint
 * every 400ms is negligible next to it.
 */
export interface MinimapBindingHandle {
  /** The component, exposed for the Settings visibility toggle. */
  readonly minimap: MinimapHandle;
  setVisible(visible: boolean): void;
  readonly visible: boolean;
  destroy(): void;
}

const REFRESH_MS = 400;

export function bindMinimap(
  world: GameWorld,
  datIndex: () => Map<number, ThingType> | null,
  parent: HTMLElement = document.body,
): MinimapBindingHandle {
  const colorCache = new Map<number, number | null>();
  let visible = true;

  const itemColor = (id: number): number | null => {
    const cached = colorCache.get(id);
    if (cached !== undefined) return cached;
    // Don't cache misses while the .dat hasn't loaded — ids first seen
    // pre-atlas would otherwise stay black for the whole session.
    const dat = datIndex();
    if (!dat) return null;
    const attr = dat.get(id)?.attrs.get(DatAttr.MinimapColor);
    const c = typeof attr === 'number' ? minimapIndexToRgb(attr) : null;
    colorCache.set(id, c);
    return c;
  };

  const minimap = createMinimap({
    // Settings' "Show minimap" row reads `visible` back live, so the ✕
    // and the toggle stay in sync through the same flag.
    onClose: () => {
      visible = false;
      minimap.setVisible(false);
    },
    getCenter: () => ({ x: world.playerX, y: world.playerY, z: world.playerZ }),
    tileColor: (x, y, z) => {
      const tile = world.getTile(x, y, z);
      if (!tile) return null;
      // Topmost flagged item wins, like the original automap.
      for (let i = tile.items.length - 1; i >= 0; i--) {
        const c = itemColor(tile.items[i].id);
        if (c !== null) return c;
      }
      return null;
    },
  }, parent);

  const timer = setInterval(() => {
    if (visible) minimap.refresh();
  }, REFRESH_MS);

  return {
    minimap,
    get visible() { return visible; },
    setVisible: (v) => {
      visible = v;
      minimap.setVisible(v);
    },
    destroy: () => {
      clearInterval(timer);
      minimap.destroy();
    },
  };
}
