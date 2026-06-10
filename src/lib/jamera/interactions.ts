import type { Application } from 'pixi.js';
import type { GameClient } from '../net/common/GameClient';
import type { GameWorld } from '../GameWorld';
import { TILE_SIZE } from '../../constants';

/**
 * World-interaction input on the game canvas:
 *
 *  - LOOK (0x8C): right-click on desktop, long-press (~500ms without
 *    moving) on touch. The server's "You see ..." answer arrives as a
 *    0xB4 text message, which the chat binding already routes into the
 *    default channel — signs read themselves.
 *  - USE (0x82): double-click / double-tap. Ladders, ropes spots, sewer
 *    grates, doors, levers. (Stairs and holes don't need this — walking
 *    onto them floor-changes server-side already.)
 *
 * Targeting: the top item of the tapped tile (last in the tile's item
 * list), stackpos counted in the same order the tile model stores. The
 * server resolves the thing by position+stackpos; a slightly-off stack
 * index degrades to describing/using a neighbor on the same tile.
 */
export interface InteractionsHandle {
  destroy(): void;
}

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 12;

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
): { x: number; y: number; z: number } {
  const dxTiles = (clientX - app.screen.width / 2) / TILE_SIZE;
  const dyTiles = (clientY - app.screen.height / 2) / TILE_SIZE;
  return {
    x: Math.floor(world.playerX + 0.5 + dxTiles),
    y: Math.floor(world.playerY + 0.5 + dyTiles),
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

export function bindInteractions(
  client: GameClient,
  world: GameWorld,
  app: Application,
): InteractionsHandle {
  const canvas = app.canvas as HTMLCanvasElement;
  const protocol = client.getProtocol();

  function topItem(pos: { x: number; y: number; z: number }): { spriteId: number; stackPos: number } | null {
    const tile = world.getTile(pos.x, pos.y, pos.z);
    if (!tile || tile.items.length === 0) return null;
    const top = tile.items[tile.items.length - 1];
    return { spriteId: top.id, stackPos: tile.items.length - 1 };
  }

  function send(packet: { toUint8Array(): Uint8Array }): void {
    try {
      client.send(packet as Parameters<GameClient['send']>[0]);
    } catch (e) {
      console.warn('[jamera] interaction send failed:', e instanceof Error ? e.message : e);
    }
  }

  function look(clientX: number, clientY: number): void {
    const c = toCanvasSpace(canvas, app.screen, clientX, clientY);
    const pos = screenToWorldTile(app, world, c.x, c.y);
    const item = topItem(pos);
    if (!item) return;
    send(protocol.actions.buildLookAt(pos, item.spriteId, item.stackPos));
  }

  function use(clientX: number, clientY: number): void {
    const c = toCanvasSpace(canvas, app.screen, clientX, clientY);
    const pos = screenToWorldTile(app, world, c.x, c.y);
    const item = topItem(pos);
    if (!item) return;
    send(protocol.actions.buildUseItem(pos, item.spriteId, item.stackPos));
  }

  // Desktop: right-click looks, double-click uses.
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    look(e.clientX, e.clientY);
  };
  const onDblClick = (e: MouseEvent): void => {
    use(e.clientX, e.clientY);
  };

  // Touch: a press held LONG_PRESS_MS without wandering looks.
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressX = 0;
  let pressY = 0;
  const cancelPress = (): void => {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };
  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    pressX = e.clientX;
    pressY = e.clientY;
    cancelPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      look(pressX, pressY);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (pressTimer === null) return;
    if (Math.abs(e.clientX - pressX) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - pressY) > MOVE_TOLERANCE_PX) {
      cancelPress();
    }
  };

  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', cancelPress);
  canvas.addEventListener('pointercancel', cancelPress);

  return {
    destroy: () => {
      cancelPress();
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', cancelPress);
      canvas.removeEventListener('pointercancel', cancelPress);
    },
  };
}
