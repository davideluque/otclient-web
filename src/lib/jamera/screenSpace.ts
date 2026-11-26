import type { Application } from 'pixi.js';
import type { GameWorld } from '../GameWorld';
import type { ThingType } from '../dat';
import type { WirePosition } from '../net/common/types';
import { spriteIndex } from '../tileRenderer';
import { TILE_SIZE } from '../../constants';

/**
 * Screen ↔ world coordinate inversions for canvas hit-testing:
 * viewport pixels → canvas space → world tile, plus the sprite-
 * extent-aware resolution of taps on multi-tile floor-change
 * artwork to its anchor tile.
 */

/**
 * Canvas-space pixel → world tile, inverting the renderer's centering
 * math. Callers must convert viewport (client) coordinates to canvas
 * space first — see toCanvasSpace.
 */
export function screenToWorldTile(
  app: Application,
  world: GameWorld,
  clientX: number,
  clientY: number,
  selfPos?: { x: number; y: number } | null,
): { x: number; y: number; z: number } {
  // The stage carries the viewport cover-zoom; one on-screen tile is
  // TILE_SIZE × zoom canvas pixels. (Tests stub `app` without a stage.)
  const zoom = app.stage?.scale?.x || 1;
  const dxTiles = (clientX - app.screen.width / 2) / (TILE_SIZE * zoom);
  const dyTiles = (clientY - app.screen.height / 2) / (TILE_SIZE * zoom);
  // The camera centers on the RENDERED self position, which a predicted
  // route can put tiles ahead of world.playerX/Y — decode against what
  // the player actually sees or a mid-route tap lands on the wrong tile.
  const anchorX = selfPos?.x ?? world.playerX;
  const anchorY = selfPos?.y ?? world.playerY;
  return {
    x: Math.floor(anchorX + 0.5 + dxTiles),
    y: Math.floor(anchorY + 0.5 + dyTiles),
    z: world.playerZ,
  };
}

/**
 * Viewport (clientX/Y) → canvas-space coordinates, robust to the canvas
 * being offset, letterboxed, or CSS-scaled relative to its logical
 * app.screen size.
 */
export function toCanvasSpace(
  canvas: HTMLCanvasElement,
  screen: { width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (screen.width / rect.width),
    y: (clientY - rect.top) * (screen.height / rect.height),
  };
}

/**
 * Resolve a tap on visible floor-change artwork to the item's anchor tile.
 *
 * DAT sprites are anchored at their bottom-right tile and may extend up and
 * left over neighbouring tiles.  A 2x2 stair therefore has only one logical
 * floor-change tile but four visible tile-sized pieces.  Grid-only hit testing
 * makes three of those pieces walk to ordinary ground instead of the stair.
 */
export function floorChangeTileAtPointer(
  world: GameWorld,
  datIndex: Map<number, ThingType>,
  pointedTile: WirePosition,
  floorChangeIds?: Set<number>,
): WirePosition {
  if (!floorChangeIds || floorChangeIds.size === 0) return pointedTile;

  let maxWidth = 1;
  let maxHeight = 1;
  for (const id of floorChangeIds) {
    const frame = datIndex.get(id)?.frameGroup;
    if (!frame) continue;
    maxWidth = Math.max(maxWidth, frame.width);
    maxHeight = Math.max(maxHeight, frame.height);
  }

  // Anchors whose sprites cover the pointed tile can only lie down/right of
  // it. Iterate in reverse render order so overlapping artwork selects the
  // visually topmost (most south-eastern) stair.
  for (let anchorY = pointedTile.y + maxHeight - 1; anchorY >= pointedTile.y; anchorY--) {
    for (let anchorX = pointedTile.x + maxWidth - 1; anchorX >= pointedTile.x; anchorX--) {
      const tile = world.getTile(anchorX, anchorY, pointedTile.z);
      if (!tile) continue;

      for (let itemIndex = tile.items.length - 1; itemIndex >= 0; itemIndex--) {
        const item = tile.items[itemIndex];
        if (!floorChangeIds.has(item.id)) continue;
        const frame = datIndex.get(item.id)?.frameGroup;
        if (!frame) continue;

        const pieceX = anchorX - pointedTile.x;
        const pieceY = anchorY - pointedTile.y;
        if (pieceX >= frame.width || pieceY >= frame.height) continue;

        const patX = ((anchorX % frame.numPatternX) + frame.numPatternX) % frame.numPatternX;
        const patY = ((anchorY % frame.numPatternY) + frame.numPatternY) % frame.numPatternY;
        let hasVisiblePiece = false;
        for (let layer = 0; layer < frame.layers; layer++) {
          if (frame.spriteIds[spriteIndex(frame, 0, patX, patY, layer, pieceY, pieceX)]) {
            hasVisiblePiece = true;
            break;
          }
        }
        if (hasVisiblePiece) return { x: anchorX, y: anchorY, z: pointedTile.z };
      }
    }
  }

  return pointedTile;
}

